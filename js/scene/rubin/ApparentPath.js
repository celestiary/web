import {Group, Quaternion, Vector3} from 'three'
import {RUN_END_MS, RUN_START_MS} from './rubin.js'


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
export const PATH_COLOR = 0x4fd8c8
const WIDTH_PX = 2
const OPACITY = 0.9
const MS_PER_DAY = 86400e3
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
   * @param {number} [opts.startMs]
   * @param {number} [opts.endMs]
   * @param {?number} [opts.layer] deps.OVERLAY_LAYER by default
   */
  constructor({elements, earthAt, deps, startMs = RUN_START_MS, endMs = RUN_END_MS, layer = deps.OVERLAY_LAYER}) {
    super()
    this.name = 'rubin apparent path'
    this.deps = deps
    this.elements = elements
    this.earthAt = earthAt
    this.startMs = startMs
    this.endMs = endMs
    const days = Math.round((endMs - startMs) / MS_PER_DAY)
    this.jds = new Float64Array(days + 1)
    this.points = new Float32Array((days + 1) * 3)
    const entries = []
    for (let i = 0; i <= days; i++) {
      const ms = startMs + (i * MS_PER_DAY)
      const jd = jdOf(ms)
      this.jds[i] = jd
      this.positionJ2000(jd, tmpPos)
      this.points[3 * i] = tmpPos.x
      this.points[(3 * i) + 1] = tmpPos.y
      this.points[(3 * i) + 2] = tmpPos.z
      const date = new Date(ms)
      if (date.getUTCDate() === 1) {
        entries.push({text: `1 ${date.toLocaleString('en-US', {month: 'short', timeZone: 'UTC'})}`,
          color: PATH_COLOR, at: [tmpPos.x, tmpPos.y, tmpPos.z]})
      }
    }
    this.line = deps.newWideLineStrip(this.points, {name: 'apparent path', color: PATH_COLOR, width: WIDTH_PX,
      opacity: OPACITY, material: {depthWrite: false, transparent: true}})
    this.marker = deps.newRings(PATH_COLOR, 1)
    this.marker.name = 'apparent path now'
    this.labels = deps.newLabels(entries)
    this.months = entries
    this.add(this.line, this.marker, this.labels.sprites)
    if (layer !== null) {
      this.traverse((o) => o.layers.set(layer))
    }
    this.preAnimCb = (time, jd) => this.place(jd)
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
   * clock's time, within the span.
   *
   * @param {number} jd The frame's Julian Day (UTC)
   */
  place(jd) {
    const {precessionQuaternion, utcToTtJulianDay, J2000_JD} = this.deps
    precessionQuaternion(J2000_JD, utcToTtJulianDay(jd), this.quaternion)
    const {jds, points} = this
    const n = jds.length
    const inSpan = jd >= jds[0] && jd <= jds[n - 1]
    this.marker.visible = inSpan
    if (!inSpan) {
      return
    }
    const f = Math.min(n - 1.000001, (jd - jds[0]) / (jds[n - 1] - jds[0]) * (n - 1))
    const i = Math.floor(f)
    const t = f - i
    const attr = this.marker.geometry.getAttribute('position')
    for (let k = 0; k < 3; k++) {
      attr.array[k] = points[(3 * i) + k] + (t * (points[(3 * (i + 1)) + k] - points[(3 * i) + k]))
    }
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
