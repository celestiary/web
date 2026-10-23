import {Quaternion, Vector3} from 'three'
import {moonEcliptic} from '../lunarTheory.js'
import {J2000_JD, J2000_OBLIQUITY_DEG, precessionQuaternion, ttMinusUtcSeconds} from '../celestialFrame.js'
import {ASTRO_UNIT_METER} from '../../shared.js'


// The bodies a craft's integrator needs, where the app draws them
// (Craft.md; #11): the Moon from the lunar theory (lunarTheory.js, Meeus's
// ELP-2000/82), the Sun and the planets from VSOP87C.  Positions are in
// metres in the mean ecliptic and equinox of date, ecliptic axes (x to the
// equinox, z to the ecliptic's north pole; the scene's are (x, z, −y)), and
// time is TT, as a Julian Ephemeris Day.
//
// VSOP87C costs about 2 ms a call and the Moon's series 11 µs, against an
// integrator's tens of thousands of force evaluations, so each body is
// sampled once on an even grid in time, as the integrator first asks for
// it, and read between samples by Lagrange interpolation of degree 7.
// Interpolation error, against the series called directly: under a metre
// for the Moon at a quarter day, and for the Sun at a day (Craft.md).  The
// Sun's is set by the Earth's monthly wobble about the Earth-Moon
// barycentre, 4,700 km, which VSOP87C's Earth carries: at two days it was
// 80 m.

const SECONDS_PER_DAY = 86400
const METERS_PER_KM = 1000
const DEG = Math.PI / 180
// Points of the interpolating polynomial (its degree plus 1): even, so the
// point read is in the middle interval.
const ORDER = 8
/** Samples' spacing, days, by body. */
export const SAMPLE_DAYS = {moon: 0.25, sun: 1, planet: 1}


/**
 * The Moon's place from the Earth's centre: the lunar theory's longitude,
 * latitude and distance (TT), in ecliptic axes.
 *
 * @param {number} jde
 * @param {Array<number>} [out]
 * @returns {Array<number>} metres
 */
export function moonGeocentric(jde, out = [0, 0, 0]) {
  const {lambda, beta, distanceKm} = moonEcliptic(jde)
  const r = distanceKm * METERS_PER_KM
  const cb = Math.cos(beta * DEG)
  out[0] = r * cb * Math.cos(lambda * DEG)
  out[1] = r * cb * Math.sin(lambda * DEG)
  out[2] = r * Math.sin(beta * DEG)
  return out
}


const tmpQ = new Quaternion
const tmpV = new Vector3


/**
 * A vector in the ecliptic and equinox of J2000 (JPL Horizons'), in the
 * ecliptic of date: turned by the precession (celestialFrame.js), whose
 * quaternion is in the scene's axes, (x, z, −y).
 *
 * @param {Array<number>} v
 * @param {number} jde
 * @param {Array<number>} [out]
 * @returns {Array<number>}
 */
export function j2000ToDate(v, jde, out = [0, 0, 0]) {
  precessionQuaternion(J2000_JD, jde, tmpQ)
  tmpV.set(v[0], v[2], -v[1]).applyQuaternion(tmpQ)
  out[0] = tmpV.x
  out[1] = -tmpV.z
  out[2] = tmpV.y
  return out
}


/**
 * The Earth's pole in the ecliptic of date: tilted by the obliquity from the
 * ecliptic's pole, away from the equinox's +90° (the mean equator of date,
 * to the change in obliquity, as the app has it: DESIGN.md, frames and time).
 *
 * @returns {Array<number>}
 */
export function earthPole() {
  const e = J2000_OBLIQUITY_DEG * DEG
  return [0, -Math.sin(e), Math.cos(e)]
}


/**
 * @param {number} jde TT
 * @returns {number} the UTC Julian Day, as the app feeds VSOP87C
 *     (Animation.setDate)
 */
export function ttToUtc(jde) {
  return jde - (ttMinusUtcSeconds(jde) / SECONDS_PER_DAY)
}


/**
 * A body's place sampled on an even grid in time, made as it's asked for
 * and read by Lagrange interpolation.
 */
export class SampledTrack {
  /**
   * @param {function(number, Array<number>): Array<number>} fn the place at a
   *     JDE, metres
   * @param {number} stepDays
   */
  constructor(fn, stepDays) {
    this.fn = fn
    this.step = stepDays
    /** Samples by their index, k: at JDE k × step. */
    this.samples = new Map
    this._w = new Float64Array(ORDER)
  }


  /**
   * @param {number} k
   * @returns {Array<number>}
   */
  _sample(k) {
    let s = this.samples.get(k)
    if (!s) {
      s = this.fn(k * this.step, [0, 0, 0])
      this.samples.set(k, s)
    }
    return s
  }


  /**
   * @param {number} jde TT
   * @param {Array<number>} [out]
   * @returns {Array<number>} metres
   */
  at(jde, out = [0, 0, 0]) {
    const u = jde / this.step
    const k0 = Math.floor(u) - ((ORDER / 2) - 1)
    const x = u - k0
    // Lagrange weights on the nodes 0..ORDER-1, at x.
    const w = this._w
    for (let i = 0; i < ORDER; i++) {
      let num = 1
      let den = 1
      for (let j = 0; j < ORDER; j++) {
        if (j !== i) {
          num *= x - j
          den *= i - j
        }
      }
      w[i] = num / den
    }
    out[0] = 0
    out[1] = 0
    out[2] = 0
    for (let i = 0; i < ORDER; i++) {
      const s = this._sample(k0 + i)
      out[0] += w[i] * s[0]
      out[1] += w[i] * s[1]
      out[2] += w[i] * s[2]
    }
    return out
  }
}


/**
 * The bodies about the Earth: the Moon and the Sun, and the planets if
 * asked, each geocentric.
 *
 * @param {object} [opts]
 * @param {?function(number): object} [opts.vsop] VSOP87C's function, of the
 *     UTC Julian Day, in AU; without it, no Sun or planets
 * @param {Array<string>} [opts.planets] VSOP87C's names, e.g. ['venus', 'jupiter']
 * @returns {{[key: string]: SampledTrack}} by body
 */
export function geocentricTracks({vsop = null, planets = []} = {}) {
  const tracks = {moon: new SampledTrack(moonGeocentric, SAMPLE_DAYS.moon)}
  if (vsop) {
    // The Sun from the Earth is the Earth from the Sun, reversed.
    tracks.sun = new SampledTrack((jde, out) => {
      const e = vsop(ttToUtc(jde)).earth
      out[0] = -e.x * ASTRO_UNIT_METER
      out[1] = -e.y * ASTRO_UNIT_METER
      out[2] = -e.z * ASTRO_UNIT_METER
      return out
    }, SAMPLE_DAYS.sun)
    for (const name of planets) {
      tracks[name] = new SampledTrack((jde, out) => {
        const all = vsop(ttToUtc(jde))
        out[0] = (all[name].x - all.earth.x) * ASTRO_UNIT_METER
        out[1] = (all[name].y - all.earth.y) * ASTRO_UNIT_METER
        out[2] = (all[name].z - all.earth.z) * ASTRO_UNIT_METER
        return out
      }, SAMPLE_DAYS.planet)
    }
  }
  return tracks
}


/**
 * The bodies about the Sun: the planets from VSOP87C, heliocentric.
 *
 * @param {function(number): object} vsop
 * @param {Array<string>} planets VSOP87C's names
 * @returns {{[key: string]: SampledTrack}}
 */
export function heliocentricTracks(vsop, planets) {
  const tracks = {}
  for (const name of planets) {
    tracks[name] = new SampledTrack((jde, out) => {
      const p = vsop(ttToUtc(jde))[name]
      out[0] = p.x * ASTRO_UNIT_METER
      out[1] = p.y * ASTRO_UNIT_METER
      out[2] = p.z * ASTRO_UNIT_METER
      return out
    }, SAMPLE_DAYS.planet)
  }
  return tracks
}
