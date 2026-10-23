import {ASTRO_UNIT_METER} from '../../shared.js'


// The bodies a craft's integrator needs, where the app draws them
// (Craft.md; #11): the Moon from the lunar theory (lunarTheory.js, Meeus's
// ELP-2000/82), the Sun and the planets from VSOP87C, handed in (bodies.js
// appBodies) so this file imports nothing the first load does.  Positions
// are in metres in the mean ecliptic and equinox of date, ecliptic axes (x
// to the equinox, z to the ecliptic's north pole; the scene's are
// (x, z, −y)), and time is TT, as a Julian Ephemeris Day.
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

const DEG = Math.PI / 180
// The obliquity of J2000, celestialFrame.js's J2000_OBLIQUITY_DEG (a test
// holds them equal).
const J2000_OBLIQUITY_DEG = 84381.448 / 3600
// Points of the interpolating polynomial (its degree plus 1): even, so the
// point read is in the middle interval.
const ORDER = 8
/** Samples' spacing, days, by body. */
export const SAMPLE_DAYS = {moon: 0.25, sun: 1, planet: 1}
const HELIOCENTRIC_DAYS = 4


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
 * @param {object} bodies bodies.js appBodies'
 * @param {?function(number): object} bodies.vsop VSOP87C's function, of the
 *     UTC Julian Day, in AU; without it, no Sun or planets
 * @param {function(number, Array<number>): Array<number>} bodies.moon the
 *     Moon's place from the Earth, metres, at a JDE
 * @param {function(number): number} bodies.ttToUtc
 * @param {Array<string>} [planets] VSOP87C's names, e.g. ['venus', 'jupiter']
 * @returns {{[key: string]: SampledTrack}} by body
 */
export function geocentricTracks({vsop, moon, ttToUtc}, planets = []) {
  const tracks = {moon: new SampledTrack(moon, SAMPLE_DAYS.moon)}
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
 * The bodies about the Sun: the planets from VSOP87C, heliocentric, all from
 * one call a sample.
 *
 * @param {object} bodies bodies.js appBodies', with its vsop
 * @param {Array<string>} planets VSOP87C's names
 * @param {number} [stepDays] the samples' spacing: 4 days by default, for
 *     interplanetary arcs, where the Earth's 20 km of error there (its
 *     monthly wobble, interpolated) is nothing to a v∞ of kilometres a second
 * @returns {{[key: string]: SampledTrack}}
 */
export function heliocentricTracks({vsop, ttToUtc}, planets, stepDays = HELIOCENTRIC_DAYS) {
  const calls = new Map
  const at = (jde) => {
    if (!calls.has(jde)) {
      const all = vsop(ttToUtc(jde))
      calls.set(jde, Object.fromEntries(planets.map((p) => [p, [all[p].x, all[p].y, all[p].z]])))
    }
    return calls.get(jde)
  }
  const tracks = {}
  for (const name of planets) {
    tracks[name] = new SampledTrack((jde, out) => {
      const p = at(jde)[name]
      out[0] = p[0] * ASTRO_UNIT_METER
      out[1] = p[1] * ASTRO_UNIT_METER
      out[2] = p[2] * ASTRO_UNIT_METER
      return out
    }, stepDays)
  }
  return tracks
}
