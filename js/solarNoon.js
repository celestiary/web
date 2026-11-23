import {lowPrecisionSun} from './tonight.js'
import {subsolarPoint, wrap180} from './nightSide.js'


/**
 * Local apparent solar noon: when the Sun crosses a meridian, for the
 * clock's day steps (Time.setStepDays; design/URLs.md, the `time:` token's
 * `step=`).  The Sun's place over the ground is the app's own: its right
 * ascension from the ephemeris (VSOP87C's Earth turned round, or Meeus's
 * low-precision Sun before it loads: Celestiary._sunAt) and Greenwich by
 * GMST, which is how the scene turns Earth (Animation, celestialFrame.js
 * gmstRad), so the drawn Sun is over the meridian at the instant found.
 * Apparent, not mean, noon: a clock stepped by whole days of 86400 s
 * sees the Sun wander ±4° east and west over the year (the equation of
 * time, ±16 min); stepped from noon to noon it stays on the meridian, and
 * only its declination moves, so the terminator rocks north and south with
 * the seasons.
 */


const DAY_MS = 86400000
const TURN_DEG = 360


/**
 * The Sun's hour angle at a meridian: how far west of it the Sun has gone,
 * 0 at noon.
 *
 * @param {number} ms Unix epoch milliseconds
 * @param {number} lng Degrees east
 * @param {Function} [sunAt] The Sun from Earth at a Julian Day, ecliptic of
 *   date (tonight.js)
 * @returns {number} Degrees, -180 to 180: negative in the morning
 */
export function hourAngleDeg(ms, lng, sunAt = lowPrecisionSun) {
  return wrap180(lng - subsolarPoint(ms, sunAt).lng)
}


/**
 * The solar noon at a meridian nearest a date, within half a day of it.
 * The Sun goes round the ground once a solar day, so each pass takes the
 * hour angle off at that rate; the first two on Meeus's Sun (cheap), the
 * last on `sunAt` (the app's ephemeris, a VSOP87C call), which leaves the
 * Sun on the meridian to well under a second (solarNoon.test.js).
 *
 * @param {number} ms Unix epoch milliseconds
 * @param {number} lng Degrees east
 * @param {Function} [sunAt] As hourAngleDeg's
 * @returns {number} Unix epoch milliseconds
 */
export function solarNoonNear(ms, lng, sunAt = lowPrecisionSun) {
  let t = ms
  for (const at of [lowPrecisionSun, lowPrecisionSun, sunAt]) {
    t -= (hourAngleDeg(t, lng, at) / TURN_DEG) * DAY_MS
  }
  return t
}
