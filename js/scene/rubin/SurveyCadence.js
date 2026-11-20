import {BufferAttribute, BufferGeometry, Group, LineBasicMaterial, LineSegments} from 'three'
import {FIELD_DIAMETER_DEG, buildNight, nextTargetVisit, nightOf, pointingAt} from './cadence.js'
import {SITE} from './rubin.js'


// Rubin's survey cadence in the scene (Rubin.md, "Cadence"): the modelled
// night's visits (cadence.js), the mount's pointing on them for
// RubinObservatory, and their fields as 3.5° circles on the sky.  Hung
// from Earth's orbitPosition in the ecliptic of J2000, turned to the date
// each frame as ApparentPath is, the circles far enough out that the
// site's parallax is under an arcsecond.  The night is built when the
// clock first enters it, once (a fraction of a second, in the frame).

/** The circles' distance from Earth's centre, metres (0.1″ of parallax from the ground). */
export const FIELD_SKY_M = 1e13
const SEGMENTS = 48
/** sRGB-ish display colours: the current field, those visited, the object's, those to come. */
const CURRENT = [1, 0.85, 0.3]
const TARGET_COLOR = [0.31, 0.85, 0.78]
const DONE = [0.55, 0.6, 0.75]
const AHEAD = [0.18, 0.2, 0.26]
/** A visited field fades to DONE × this over the night's following hour. */
const FADE_MS = 3600e3
const OBLIQUITY_J2000 = 23.4392911 * Math.PI / 180
const toRad = Math.PI / 180
const toDeg = 180 / Math.PI
const UNIX_EPOCH_JD = 2440587.5


/**
 * A J2000 RA and Dec to a unit direction in the ecliptic of J2000, scene
 * axes (ApparentPath's: ecliptic x, z, −y).
 *
 * @param {number} raDeg
 * @param {number} decDeg
 * @returns {number[]}
 */
export function raDecToScene(raDeg, decDeg) {
  const ra = raDeg * toRad
  const dec = decDeg * toRad
  const xq = Math.cos(dec) * Math.cos(ra)
  const yq = Math.cos(dec) * Math.sin(ra)
  const zq = Math.sin(dec)
  const c = Math.cos(OBLIQUITY_J2000)
  const s = Math.sin(OBLIQUITY_J2000)
  const ye = (yq * c) + (zq * s)
  const ze = (-yq * s) + (zq * c)
  return [xq, ze, -ye]
}


/**
 * The inverse of raDecToScene.
 *
 * @param {{x: number, y: number, z: number}} v Any length
 * @returns {{raDeg: number, decDeg: number}}
 */
export function sceneToRaDec(v) {
  const r = Math.hypot(v.x, v.y, v.z)
  const xe = v.x / r
  const ye = -v.z / r
  const ze = v.y / r
  const c = Math.cos(OBLIQUITY_J2000)
  const s = Math.sin(OBLIQUITY_J2000)
  const yq = (ye * c) - (ze * s)
  const zq = (ye * s) + (ze * c)
  return {raDeg: ((Math.atan2(yq, xe) * toDeg) + 360) % 360, decDeg: Math.asin(Math.max(-1, Math.min(1, zq))) * toDeg}
}


/**
 * A circle of a field's radius about a direction, as line segments.
 *
 * @param {number} raDeg
 * @param {number} decDeg
 * @param {Float32Array} out
 * @param {number} offset Floats
 */
function circleSegments(raDeg, decDeg, out, offset) {
  const radius = FIELD_DIAMETER_DEG / 2 * toRad
  const ra = raDeg * toRad
  const dec = decDeg * toRad
  // The field's centre, and two directions across it, equatorial.
  const n = [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)]
  const e = [-Math.sin(ra), Math.cos(ra), 0]
  const u = [-Math.sin(dec) * Math.cos(ra), -Math.sin(dec) * Math.sin(ra), Math.cos(dec)]
  const point = (k) => {
    const a = (k / SEGMENTS) * 2 * Math.PI
    const p = [0, 1, 2].map((i) => (n[i] * Math.cos(radius)) + (Math.sin(radius) * ((e[i] * Math.cos(a)) + (u[i] * Math.sin(a)))))
    const ras = Math.atan2(p[1], p[0]) * toDeg
    const decs = Math.asin(p[2]) * toDeg
    return raDecToScene(ras, decs).map((x) => x * FIELD_SKY_M)
  }
  for (let k = 0; k < SEGMENTS; k++) {
    out.set(point(k), offset + (k * 6))
    out.set(point(k + 1), offset + (k * 6) + 3)
  }
}


/**
 * @param {number} ms
 * @returns {string} `12 min`, `1 h 05 min`
 */
export function duration(ms) {
  const min = Math.round(ms / 60e3)
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`
}


/** */
export default class SurveyCadence extends Group {
  /**
   * @param {object} opts
   * @param {(jd: number) => {raDeg: number, decDeg: number}} opts.targetAt
   *   The object's J2000 place from Earth at a Julian Day (UTC)
   * @param {object} opts.deps The first load's functions (install.js):
   *   `precessionQuaternion`, `utcToTtJulianDay`, `J2000_JD`,
   *   `sceneReferred`, `OVERLAY_LAYER`
   * @param {object} [opts.site]
   * @param {?number} [opts.layer]
   * @param {(raDeg: number, decDeg: number, radiusDeg: number) => ?string} [opts.imagery] The
   *   readout's line for a field that holds Rubin imagery, or null (install.js: the First Look's
   *   coverage and the discovery image's footprint)
   */
  constructor({targetAt, deps, site = SITE, layer = deps.OVERLAY_LAYER, imagery = null}) {
    super()
    this.name = 'rubin cadence'
    this.deps = deps
    this.targetAt = targetAt
    this.site = site
    this.layer = layer
    this.imagery = imagery
    /** field → imagery's line, for the night built (resetImagery clears it). */
    this._imagery = new Map
    /** Whether the telescope follows the schedule (the app's switch). */
    this.enabled = false
    /** The night built (buildNight's, with `nightMs`), or null. */
    this.night = null
    this.lines = null
    this._fields = null
    this._colouredAt = null
    this.visible = false
    this.preAnimCb = (time, jd) => this.place(jd)
  }


  /**
   * The night that holds a time, built once.
   *
   * @param {number} ms
   * @returns {object} buildNight's, with nightMs
   */
  nightFor(ms) {
    const nightMs = nightOf(ms)
    if (this.night?.nightMs !== nightMs) {
      const mid = nightMs + (4.7 * 3600e3)
      const target = this.targetAt((mid / 86400e3) + UNIX_EPOCH_JD)
      this.night = {...buildNight({nightMs, site: this.site, target}), nightMs}
      this._imagery.clear()
      this._build()
    }
    return this.night
  }


  /**
   * The mount's pointing at a time, while the cadence is on.
   *
   * @param {number} ms
   * @returns {?{el: number, az: number, index: number, slewing: boolean, visit: object, count: number}}
   *   null when off, or outside the night's visits
   */
  pointing(ms) {
    if (!this.enabled) {
      return null
    }
    const {visits} = this.nightFor(ms)
    const p = pointingAt(visits, ms, this.site)
    return p ? {...p, visit: visits[p.index], count: visits.length} : null
  }


  /**
   * The panel's readout: where the night is, and the object's field.
   *
   * @param {number} ms
   * @returns {?{index: number, count: number, filter: ?string, slewing: boolean, isTarget: boolean,
   *   nextTargetMs: ?number, imagery: ?string, lines: string[]}} null when off
   */
  readout(ms) {
    if (!this.enabled) {
      return null
    }
    const {visits, startMs, endMs} = this.nightFor(ms)
    const p = pointingAt(visits, ms, this.site)
    const v = p ? visits[p.index] : null
    const next = nextTargetVisit(visits, ms)
    const isTarget = Boolean(v?.isTarget && !p.slewing)
    let where
    if (ms < startMs) {
      where = `Survey night starts in ${duration(startMs - ms)}`
    } else if (ms > endMs || !p) {
      where = 'Survey night over'
    } else {
      where = `${p.slewing ? 'Slewing to visit' : 'Visit'} ${p.index + 1} of ${visits.length}, filter ${v.filter}`
    }
    const imagery = v && !p.slewing ? this.imageryOf(v) : null
    const lines = [`${where} (modelled)`, isTarget ? '2026 ED138 is in this field' :
      next ? `2026 ED138's field next in ${duration(next.tMs - ms)}` : 'No more visits to 2026 ED138\'s field tonight']
    if (imagery) {
      lines.push(imagery)
    }
    return {
      index: p ? p.index : -1,
      count: visits.length,
      filter: v?.filter ?? null,
      slewing: p ? p.slewing : false,
      isTarget,
      nextTargetMs: next ? next.tMs : null,
      imagery,
      lines,
    }
  }


  /**
   * The imagery's line for a visit's field, asked once a field a night.
   *
   * @param {object} v A visit
   * @returns {?string}
   */
  imageryOf(v) {
    if (!this.imagery) {
      return null
    }
    if (!this._imagery.has(v.field)) {
      this._imagery.set(v.field, this.imagery(v.raDeg, v.decDeg, FIELD_DIAMETER_DEG / 2))
    }
    return this._imagery.get(v.field)
  }


  /** Ask the imagery again (its data arrived). */
  resetImagery() {
    this._imagery.clear()
  }


  /** The night's fields, a circle each, in the order first visited. */
  _build() {
    this._disposeLines()
    const fields = new Map
    for (const v of this.night.visits) {
      if (!fields.has(v.field)) {
        fields.set(v.field, {raDeg: v.raDeg, decDeg: v.decDeg, isTarget: v.isTarget, firstMs: v.tMs, index: fields.size})
      }
    }
    this._fields = [...fields.values()]
    this._fieldOf = this.night.visits.map((v) => fields.get(v.field).index)
    const floats = this._fields.length * SEGMENTS * 6
    const positions = new Float32Array(floats)
    this._fields.forEach((f, i) => circleSegments(f.raDeg, f.decDeg, positions, i * SEGMENTS * 6))
    const geometry = new BufferGeometry
    geometry.setAttribute('position', new BufferAttribute(positions, 3))
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(floats), 3))
    const material = this.deps.sceneReferred(new LineBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, toneMapped: false,
    }))
    this.lines = new LineSegments(geometry, material)
    this.lines.name = 'rubin cadence fields'
    this.lines.frustumCulled = false
    if (this.layer !== null) {
      this.lines.layers.set(this.layer)
    }
    this.add(this.lines)
    this._colouredAt = null
  }


  /**
   * Colour the fields for a time: the current one bright, those visited
   * fading, the object's in its own colour, those to come dim.
   *
   * @param {number} ms
   */
  _colour(ms) {
    const {visits} = this.night
    const p = pointingAt(visits, ms, this.site)
    const current = p && !p.slewing ? this._fieldOf[p.index] : -1
    const key = `${current}:${Math.floor(ms / 60e3)}`
    if (key === this._colouredAt) {
      return
    }
    this._colouredAt = key
    const lastMs = new Float64Array(this._fields.length).fill(-Infinity)
    for (let i = 0; i < visits.length && visits[i].tMs <= ms; i++) {
      lastMs[this._fieldOf[i]] = visits[i].tMs
    }
    const colors = this.lines.geometry.getAttribute('color')
    const perField = SEGMENTS * 2
    this._fields.forEach((f, i) => {
      let c
      if (i === current) {
        c = f.isTarget ? TARGET_COLOR.map((x) => Math.min(1, x * 1.3)) : CURRENT
      } else if (lastMs[i] > -Infinity) {
        const fade = Math.max(0.35, 1 - ((ms - lastMs[i]) / FADE_MS))
        c = (f.isTarget ? TARGET_COLOR : DONE).map((x) => x * fade)
      } else {
        c = f.isTarget ? TARGET_COLOR.map((x) => x * 0.6) : AHEAD
      }
      for (let k = 0; k < perField; k++) {
        colors.array.set(c, ((i * perField) + k) * 3)
      }
    })
    colors.needsUpdate = true
  }


  /**
   * A frame: turn to the date, and colour the fields.
   *
   * @param {number} jd The frame's Julian Day (UTC)
   */
  place(jd) {
    this.visible = this.enabled
    if (!this.enabled || !Number.isFinite(jd)) {
      return
    }
    const ms = (jd - UNIX_EPOCH_JD) * 86400e3
    this.nightFor(ms)
    const {precessionQuaternion, utcToTtJulianDay, J2000_JD} = this.deps
    precessionQuaternion(J2000_JD, utcToTtJulianDay(jd), this.quaternion)
    this._colour(ms)
  }


  /** The lines out. */
  _disposeLines() {
    if (this.lines) {
      this.remove(this.lines)
      this.lines.geometry.dispose()
      this.lines.material.dispose()
      this.lines = null
    }
  }


  /** Out of the scene. */
  dispose() {
    this.removeFromParent()
    this._disposeLines()
  }
}
