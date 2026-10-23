import {geocentricTracks} from './ephemeris.js'
import {SECONDS_PER_DAY, dopri5, ratesOf} from './integrator.js'
import {TOLERANCES, earthModel, lunarTransfer} from './transfer.js'


// How the craft the app can fly are made (Craft.md; catalog.js lists
// them), each a trajectory integrated in the full force model from a
// departure the user picks.  `make` returns the path as drawn and its
// facts, or null where it can't be flown; `describe` puts the facts in
// words for the panel.  Loaded the first time one is flown (Scene), and
// importing nothing the first load does (bodies.js says why).

const UNIX_EPOCH_JD = 2440587.5
const MS_PER_DAY = 864e5
const KM = 1000

/** By link code (catalog.js's): how each is made, and its facts told. */
export const FLIGHTS = {
  tli: {make: transferToMoon, describe: describeTransfer},
}


/**
 * @param {number} jde
 * @returns {string} its date, YYYY-MM-DD (TT, near enough)
 */
export function dateOf(jde) {
  return new Date(Math.round((jde - UNIX_EPOCH_JD) * MS_PER_DAY)).toISOString().slice(0, 10)
}


/**
 * @param {object} f transferToMoon's facts
 * @returns {string}
 */
export function describeTransfer(f) {
  return `leaves ${dateOf(f.departure)} from 185 km, ${Math.round(f.dv).toLocaleString('en-US')} m/s, ` +
    `${f.days.toFixed(1)} days to ${Math.round(f.height / KM)} km over the Moon at ${(f.arrival / KM).toFixed(2)} km/s`
}


/**
 * A transfer from a 185 km parking orbit to a 100 km perilune, 4.5 days
 * (transfer.js), sampled at the integrator's steps from the burn to the
 * perilune.
 *
 * @param {number} departure JDE of the burn
 * @param {object} bodies bodies.js appBodies', on VSOP87C or its stand-in
 * @returns {?{t: Float64Array, xyz: Float64Array, facts: object}} t JDE, xyz
 *     metres about the Earth in ecliptic axes of date
 */
export function transferToMoon(departure, bodies) {
  const tracks = geocentricTracks(bodies)
  const transfer = lunarTransfer(tracks, departure)
  if (!transfer) {
    return null
  }
  const t = []
  const xyz = []
  dopri5(ratesOf(earthModel(tracks, departure)), transfer.state, 0, transfer.perilune.t, {...TOLERANCES,
    onStep: (time, s) => {
      t.push(departure + (time / SECONDS_PER_DAY))
      xyz.push(s[0], s[1], s[2])
    }})
  return {t: Float64Array.from(t), xyz: Float64Array.from(xyz), facts: {
    departure, dv: transfer.dv, days: transfer.days,
    arrival: Math.hypot(...transfer.perilune.relV), height: transfer.perilune.r - 1737400,
  }}
}
