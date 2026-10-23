import {Quaternion, Vector3} from 'three'
import {J2000_JD, precessionQuaternion, utcToTtJulianDay} from './celestialFrame.js'


/**
 * A spacecraft's path, from a table of JPL Horizons states (js/scene/models.md,
 * "Positions"; tools/spacecraft/fetchHorizons.mjs builds the tables):
 * positions and velocities relative to the parent body, in the ecliptic and
 * equinox of J2000, km and km/s, at Julian Days (TDB).  Between two states
 * the position is their cubic Hermite, which uses both ends' velocities; the
 * table is thinned to the states that keep it within its tolerance (1 km) of
 * Horizons' dense sample.
 */


const DAY_S = 86400
const KM = 1000


/**
 * Cubic Hermite between two states.
 *
 * @param {{jd: number, r: Array<number>, v: Array<number>}} a
 * @param {{jd: number, r: Array<number>, v: Array<number>}} b
 * @param {number} jd Between a.jd and b.jd
 * @param {Array<number>} out Position, in a's and b's units
 * @param {number} [secondsPerUnit] Seconds in a unit of jd (velocities are
 *   per second)
 * @returns {Array<number>} out
 */
export function hermite(a, b, jd, out, secondsPerUnit = DAY_S) {
  const h = b.jd - a.jd
  const s = (jd - a.jd) / h
  const s2 = s * s
  const s3 = s2 * s
  const h00 = (2 * s3) - (3 * s2) + 1
  const h10 = s3 - (2 * s2) + s
  const h01 = (-2 * s3) + (3 * s2)
  const h11 = s3 - s2
  const hs = h * secondsPerUnit
  for (let i = 0; i < 3; i++) {
    out[i] = (h00 * a.r[i]) + (h10 * hs * a.v[i]) + (h01 * b.r[i]) + (h11 * hs * b.v[i])
  }
  return out
}


/**
 * A loaded table, ready to be asked for positions.
 */
export class Trajectory {
  /**
   * @param {object} table As fetchHorizons.mjs writes it: `t` (JD TDB), and
   *   flat `r` (km) and `v` (km/s), three to a state
   */
  constructor(table) {
    if (!(table?.t?.length >= 2) || table.r.length !== table.t.length * 3 || table.v.length !== table.r.length) {
      throw new Error('A trajectory needs t, r and v, at least two states')
    }
    this.name = table.name
    this.parent = table.parent
    this.t = table.t
    this.r = table.r
    this.v = table.v
    this.start = table.t[0]
    this.end = table.t.at(-1)
    this._i = 0
    this._a = {jd: 0, r: [0, 0, 0], v: [0, 0, 0]}
    this._b = {jd: 0, r: [0, 0, 0], v: [0, 0, 0]}
    this._out = [0, 0, 0]
  }


  /**
   * @param {number} jdTdb
   * @returns {boolean} Whether the table covers this time
   */
  covers(jdTdb) {
    return jdTdb >= this.start && jdTdb <= this.end
  }


  /**
   * The position at a time, in the table's frame (ecliptic J2000, km).
   *
   * @param {number} jdTdb Within the table (see covers)
   * @param {Array<number>} [out]
   * @returns {Array<number>|null} out, or null outside the table
   */
  positionAt(jdTdb, out = [0, 0, 0]) {
    if (!this.covers(jdTdb)) {
      return null
    }
    const i = this._segment(jdTdb)
    return hermite(this._state(i, this._a), this._state(i + 1, this._b), jdTdb, out)
  }


  /**
   * The position in the scene's frame: metres, scene axes, the mean ecliptic
   * and equinox of date (DESIGN.md "Frames and time"), relative to the
   * parent's centre.
   *
   * @param {number} jdUtc The simulation clock's Julian Day (UTC)
   * @param {Vector3} [target]
   * @returns {Vector3|null} target, or null outside the table
   */
  scenePositionAt(jdUtc, target = new Vector3) {
    // TT for TDB: within 2 ms.
    const jdTt = utcToTtJulianDay(jdUtc)
    const p = this.positionAt(jdTt, this._out)
    if (!p) {
      return null
    }
    // Ecliptic (x, y, z) to scene (x, z, −y), then J2000 to the date.
    target.set(p[0] * KM, p[2] * KM, -p[1] * KM)
    return target.applyQuaternion(precessionQuaternion(J2000_JD, jdTt, tmpQ))
  }


  /**
   * @param {number} jd
   * @returns {number} i, with t[i] <= jd <= t[i + 1]
   */
  _segment(jd) {
    const t = this.t
    let i = this._i
    // Time mostly moves a little each frame: start from the last segment.
    if (!(t[i] <= jd && jd <= t[i + 1])) {
      let lo = 0
      let hi = t.length - 2
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1
        if (t[mid] <= jd) {
          lo = mid
        } else {
          hi = mid - 1
        }
      }
      i = lo
    }
    this._i = i
    return i
  }


  /**
   * @param {number} i
   * @param {{jd: number, r: Array<number>, v: Array<number>}} s
   * @returns {{jd: number, r: Array<number>, v: Array<number>}} s
   */
  _state(i, s) {
    s.jd = this.t[i]
    for (let k = 0; k < 3; k++) {
      s.r[k] = this.r[(3 * i) + k]
      s.v[k] = this.v[(3 * i) + k]
    }
    return s
  }
}


const tmpQ = new Quaternion
