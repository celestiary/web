import {Group, Quaternion, Vector3} from 'three'
import {RUN_END_MS, RUN_START_MS} from './rubin.js'
import {cubicAt, writeOffsets} from '../relativeToEye.js'


// A body's apparent path on Earth's sky over a span of days (Rubin.md):
// the body's position from Earth's centre each day, at its true distance,
// with the first of each month named and a ring where the body is at the
// clock's time.  Hung from Earth's orbitPosition, in the ecliptic of J2000
// turned to the date each frame as the orbit lines are, so it stays on the
// stars.  For 2026 ED138 the path is Earth's own motion reflected: 2° of
// retrograde from the April stationary point to August, while the body
// moves half a degree along its orbit.
//
// At the true distance, not a fixed sky radius: laid out 1e12 m from
// Earth's centre (6.7 au) the ring was 1.1″ off the body from the ground,
// the parallax of Earth's radius at 6.7 au against the body's at 47 au,
// and the two came apart in a field of 20″ (the maintainer's preview,
// 2026-10-28).  Where the body is, the ring is on it from anywhere.
//
// Relative to the eye (#340, relativeToEye.js): the daily positions are
// kept in float64, the line is drawn through a cubic between them at
// FINE_PER_DAY steps, and both the line's vertices and the ring are float32
// offsets from an anchor at the body's place at the frame's time, which is
// the line's and the ring's position (float64, composed on the CPU).  As a
// Float32Array at 7e12 m the points were held to 5e5 m, 13 screen pixels
// at a 0.00016° field: the ring jumped and the path missed the orbit line.
export const PATH_COLOR = 0x4fd8c8
const WIDTH_PX = 2
const OPACITY = 0.9
const MS_PER_DAY = 86400e3
// The drawn line's steps a day: a chord of Earth's orbit a 48th of a day
// long sags 2.4e3 m, 0.06 px at 47 au in a 0.00016° field on 500 px.
export const FINE_PER_DAY = 48
const UNIX_EPOCH_JD = 2440587.5
const tmpQuat = new Quaternion
const tmpPos = new Vector3
const tmpEarth = new Vector3


/**
 * @param {number} ms Unix ms
 * @returns {number} Julian Day (UTC)
 */
function jdOf(ms) {
  return (ms / MS_PER_DAY) + UNIX_EPOCH_JD
}


/** */
export default class ApparentPath extends Group {
  /**
   * @param {object} opts
   * @param {object} opts.elements The body's meanElements()
   * @param {(jd: number) => Vector3} opts.earthAt Earth's heliocentric
   *   position at a Julian Day (UTC), scene axes, ecliptic of date, metres
   * @param {object} opts.deps The first load's functions, handed in
   *   (install.js; rubin.js says why): `orbitAt` (meanElements.js),
   *   `precessionQuaternion`, `utcToTtJulianDay` and `J2000_JD`
   *   (celestialFrame.js), `newRings` (LagrangeMarks.js), `newLabels`
   *   (overlayMarks.js, or a stub), `newWideLineStrip` (wideLines.js),
   *   `OVERLAY_LAYER` (shared.js)
   * @param {() => boolean} [opts.approximate] Whether earthAt is the
   *   ephemeris's stand-in yet (Animation.vsopReady): the stand-in Earth is
   *   up to 20,000 km off VSOP87C's, 0.3″ at 47 au, so the path is
   *   sampled again when the ephemeris arrives
   * @param {number} [opts.startMs]
   * @param {number} [opts.endMs]
   * @param {?number} [opts.layer] deps.OVERLAY_LAYER by default
   */
  constructor({elements, earthAt, approximate = () => false, deps, startMs = RUN_START_MS, endMs = RUN_END_MS,
    layer = deps.OVERLAY_LAYER}) {
    super()
    this.name = 'rubin apparent path'
    this.deps = deps
    this.elements = elements
    this.earthAt = earthAt
    this.startMs = startMs
    this.endMs = endMs
    this.approximate = approximate
    const days = Math.round((endMs - startMs) / MS_PER_DAY)
    this.jds = new Float64Array(days + 1)
    /** The daily positions, float64. */
    this.points = new Float64Array((days + 1) * 3)
    /** The drawn line: the cubic through the days, float64. */
    const fineCount = (days * FINE_PER_DAY) + 1
    this.fine = new Float64Array(fineCount * 3)
    const entries = []
    for (let i = 0; i <= days; i++) {
      const ms = startMs + (i * MS_PER_DAY)
      this.jds[i] = jdOf(ms)
      const date = new Date(ms)
      if (date.getUTCDate() === 1) {
        entries.push({text: `1 ${date.toLocaleString('en-US', {month: 'short', timeZone: 'UTC'})}`,
          color: PATH_COLOR, at: [0, 0, 0], index: i})
      }
    }
    this.sample()
    for (const e of entries) {
      e.at = [this.points[3 * e.index], this.points[(3 * e.index) + 1], this.points[(3 * e.index) + 2]]
      delete e.index
    }
    /** Where the line's and the ring's vertices are relative to. */
    this.anchor = new Vector3(this.points[0], this.points[1], this.points[2])
    const offsets = writeOffsets(this.fine, this.anchor, new Float32Array(this.fine.length))
    this.line = deps.newWideLineStrip(offsets, {name: 'apparent path', color: PATH_COLOR, width: WIDTH_PX,
      opacity: OPACITY, material: {depthWrite: false, transparent: true}})
    this.marker = deps.newRings(PATH_COLOR, 1)
    this.marker.name = 'apparent path now'
    this.line.position.copy(this.anchor)
    this.marker.position.copy(this.anchor)
    this.labels = deps.newLabels(entries)
    this.months = entries
    this.add(this.line, this.marker, this.labels.sprites)
    if (layer !== null) {
      this.traverse((o) => o.layers.set(layer))
    }
    this.preAnimCb = (time, jd) => this.place(jd)
  }


  /**
   * The daily positions, and the fine line through them by the cubic, from
   * the ephemeris as it is now.
   */
  sample() {
    this._approximate = this.approximate()
    const {jds, points, fine} = this
    for (let i = 0; i < jds.length; i++) {
      this.positionJ2000(jds[i], tmpPos)
      points[3 * i] = tmpPos.x
      points[(3 * i) + 1] = tmpPos.y
      points[(3 * i) + 2] = tmpPos.z
    }
    for (let j = 0; 3 * j < fine.length; j++) {
      cubicAt(points, j / FINE_PER_DAY, tmpPos)
      fine[3 * j] = tmpPos.x
      fine[(3 * j) + 1] = tmpPos.y
      fine[(3 * j) + 2] = tmpPos.z
    }
  }


  /**
   * The body's position from Earth's centre, in the ecliptic of J2000,
   * scene axes, metres.
   *
   * @param {number} jd Julian Day (UTC)
   * @param {Vector3} [out]
   * @returns {Vector3}
   */
  positionJ2000(jd, out = new Vector3) {
    const {orbitAt, precessionQuaternion, utcToTtJulianDay, J2000_JD} = this.deps
    const jde = utcToTtJulianDay(jd)
    orbitAt(this.elements, jde, tmpQuat, out)
    // Earth's place is of date: back to J2000.
    tmpEarth.copy(this.earthAt(jd)).applyQuaternion(precessionQuaternion(jde, J2000_JD, tmpQuat))
    return out.sub(tmpEarth)
  }


  /**
   * The unit direction from Earth to the body, in the ecliptic of J2000.
   *
   * @param {number} jd Julian Day (UTC)
   * @param {Vector3} [out]
   * @returns {Vector3}
   */
  directionJ2000(jd, out = new Vector3) {
    return this.positionJ2000(jd, out).normalize()
  }


  /**
   * Turn the path to the date, and put the ring where the body is at the
   * clock's time, within the span: the anchor there, the ring at it and the
   * line's offsets re-written about it.
   *
   * @param {number} jd The frame's Julian Day (UTC)
   */
  place(jd) {
    const {precessionQuaternion, utcToTtJulianDay, J2000_JD} = this.deps
    precessionQuaternion(J2000_JD, utcToTtJulianDay(jd), this.quaternion)
    if (this._approximate && !this.approximate()) {
      // The ephemeris is in: sample it, and re-write the offsets.
      this.sample()
      const was = tmpEarth.copy(this.anchor)
      this.anchor.set(NaN, NaN, NaN)
      this.setAnchor(was)
    }
    const {jds, points} = this
    const n = jds.length
    const inSpan = jd >= jds[0] && jd <= jds[n - 1]
    this.marker.visible = inSpan
    if (!inSpan) {
      return
    }
    const f = (jd - jds[0]) / (jds[n - 1] - jds[0]) * (n - 1)
    this.setAnchor(cubicAt(points, f, tmpPos))
  }


  /**
   * Move the anchor: the line's and the ring's position, and the line's
   * vertices as offsets from it.
   *
   * @param {Vector3} at the path's frame (J2000), metres
   */
  setAnchor(at) {
    if (at.equals(this.anchor)) {
      return
    }
    this.anchor.copy(at)
    this.line.position.copy(at)
    this.marker.position.copy(at)
    const attr = this.line.geometry.getAttribute('position')
    writeOffsets(this.fine, at, attr.array)
    attr.needsUpdate = true
  }


  /** Out of the scene. */
  dispose() {
    this.removeFromParent()
    this.line.geometry.dispose()
    this.line.material.dispose()
    this.marker.geometry.dispose()
    this.marker.material.dispose()
  }
}
