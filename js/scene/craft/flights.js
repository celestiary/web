import {chain} from './cycler.js'
import {geocentricTracks, heliocentricTracks} from './ephemeris.js'
import {GM, SECONDS_PER_DAY, dopri5, newForceModel, ratesOf} from './integrator.js'
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
const MOON_RADIUS = 1737400
const KEPLER = {rtol: 1e-10, atol: [1, 1, 1, 1e-6, 1e-6, 1e-6]}
const AU = 149597870700

/** By link code (catalog.js's): how each is made, and its facts told. */
export const FLIGHTS = {
  tli: {make: transferToMoon, describe: describeTransfer},
  blt: {make: ballisticTransfer, describe: describeBlt},
  aldrin: {make: aldrinFlight, describe: describeAldrin},
}


/**
 * The first Aldrin cycler designed (aldrin.json) that starts on or after a
 * day: its arcs made again from its dates (cycler.js chain), each flown
 * about the Sun alone from its start (the arcs are Kepler's: patched
 * conics, the flybys turns at a point).
 *
 * @param {number} day JDE
 * @param {object} bodies bodies.js appBodies', with VSOP87C
 * @param {{cyclers: Array<object>}} data aldrin.json
 * @returns {?{t: Float64Array, xyz: Float64Array, facts: object}} xyz
 *     metres about the Sun, ecliptic axes of date
 */
export function aldrinFlight(day, bodies, data) {
  const design = (data?.cyclers ?? []).filter((c) => c.x[0] >= day)
      .reduce((best, c) => (!best || c.x[0] < best.x[0] ? c : best), null)
  if (!design) {
    return null
  }
  const cycles = (design.x.length - 1) / 2
  const made = chain(heliocentricTracks(bodies, ['earth', 'mars']), design.x, cycles)
  if (!made) {
    return null
  }
  const t = []
  const xyz = []
  for (const arc of made.legs) {
    const accel = newForceModel({gm: GM.sun, epoch: arc.t0})
    dopri5(ratesOf(accel), [...arc.r0, ...arc.v0], 0, (arc.t1 - arc.t0) * SECONDS_PER_DAY, {...KEPLER,
      onStep: (time, s) => {
        t.push(arc.t0 + (time / SECONDS_PER_DAY))
        xyz.push(s[0], s[1], s[2])
      }})
  }
  return {t: Float64Array.from(t), xyz: Float64Array.from(xyz), facts: {
    departure: design.x[0], end: made.flybys.at(-1).jde, cycles, flybys: made.flybys, cost: made.cost,
    aphelion: Math.max(...made.legs.map((arc) => Math.hypot(...arc.r1), 0)) / AU,
  }}
}


/**
 * @param {object} f aldrinFlight's facts
 * @returns {string}
 */
export function describeAldrin(f) {
  const [earth, mars] = f.flybys
  return `leaves the Earth ${dateOf(f.departure)} at ${(earth.vInfOut / KM).toFixed(1)} km/s, passes Mars ` +
    `${dateOf(mars.jde)} at ${(mars.vInfIn / KM).toFixed(1)} km/s, and the Earth again each 2.1 years, ` +
    `${f.cycles} cycles to ${dateOf(f.end).slice(0, 4)}: ${Math.round(f.cost).toLocaleString('en-US')} m/s ` +
    'at its flybys, where the planets\' gravity falls short'
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
    `${f.days.toFixed(1)} days to ${Math.round(f.height / KM)} km over the Moon at ${(f.arrival / KM).toFixed(2)} km/s, ` +
    `${Math.round(f.loi)} m/s into a circular orbit there`
}


/**
 * The first ballistic lunar transfer designed (blt.json) leaving on or
 * after a day, flown from its departure state to its arrival.
 *
 * @param {number} day JDE: the transfer leaves on or after it
 * @param {object} bodies bodies.js appBodies', with VSOP87C
 * @param {{designs: Array<object>}} data blt.json
 * @returns {?{t: Float64Array, xyz: Float64Array, facts: object}} as
 *     transferToMoon's; null where no design leaves on or after the day
 */
export function ballisticTransfer(day, bodies, data) {
  // The file is in order of arrival; the flights' lengths differ.
  const design = (data?.designs ?? []).filter((d) => d.departure >= day)
      .reduce((best, d) => (!best || d.departure < best.departure ? d : best), null)
  if (!design) {
    return null
  }
  const tracks = geocentricTracks(bodies)
  const t = []
  const xyz = []
  const {y} = dopri5(ratesOf(earthModel(tracks, design.departure)), design.state, 0, design.days * SECONDS_PER_DAY,
      {...TOLERANCES, onStep: (time, s) => {
        t.push(design.departure + (time / SECONDS_PER_DAY))
        xyz.push(s[0], s[1], s[2])
      }})
  // Where it arrives: its height over the Moon, and the burn into a
  // circular orbit there.
  const m = tracks.moon.at(design.arrival)
  const dt = 1e-3
  const m1 = tracks.moon.at(design.arrival + dt)
  const m0 = tracks.moon.at(design.arrival - dt)
  const r = Math.hypot(y[0] - m[0], y[1] - m[1], y[2] - m[2])
  const v = Math.hypot(...[0, 1, 2].map((k) => y[3 + k] - ((m1[k] - m0[k]) / (2 * dt * SECONDS_PER_DAY))))
  return {t: Float64Array.from(t), xyz: Float64Array.from(xyz), facts: {
    departure: design.departure, arrival: design.arrival, dv: design.dv, days: design.days, apogee: design.apogee,
    height: r - MOON_RADIUS, loi: v - Math.sqrt(GM.moon / r),
  }}
}


/**
 * @param {object} f ballisticTransfer's facts
 * @returns {string}
 */
export function describeBlt(f) {
  return `leaves ${dateOf(f.departure)} from 185 km, ${Math.round(f.dv).toLocaleString('en-US')} m/s, out to ` +
    `${(f.apogee / 1e9).toFixed(2)} million km, ${Math.round(f.days)} days to ${Math.round(f.height / KM)} km ` +
    `over the Moon, ${Math.round(f.loi)} m/s into a circular orbit there`
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
  const arrival = Math.hypot(...transfer.perilune.relV)
  const r = transfer.perilune.r
  return {t: Float64Array.from(t), xyz: Float64Array.from(xyz), facts: {
    departure, dv: transfer.dv, days: transfer.days, arrival, height: r - MOON_RADIUS,
    loi: arrival - Math.sqrt(GM.moon / r),
  }}
}
