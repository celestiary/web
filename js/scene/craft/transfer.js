import {GM, EARTH_J2, EARTH_RADIUS, SECONDS_PER_DAY, dopri5, newForceModel, ratesOf} from './integrator.js'
import {earthPole} from './ephemeris.js'
import {lambert} from './lambert.js'


// A transfer from a low Earth parking orbit to the Moon, in the full force
// model (Craft.md; #11): the Earth with its J2, the Moon from the lunar
// theory and the Sun from VSOP87C.  The two-body arc to the Moon's place at
// arrival (lambert.js) is the first guess; Newton's method on the departure velocity
// then puts the craft's perilune at the given height, in the Moon's orbit
// plane, at the given time.  Targets that are scalars of the perilune, not
// a point: aimed at a point at a fixed time, or at the perilune's place,
// Newton's method walked the craft through the Moon, where the map from
// departure to arrival is singular, and stalled.

const MOON_RADIUS = 1737400
const ITERATIONS = 30
// The Moon's sphere of influence, a (m/M)^(2/5): where a perilune is looked for.
const MOON_SOI = 66100e3
// How long past the first guess's arrival to look for the perilune, days.
const WINDOW_DAYS = 3
const BISECTIONS = 40
// Newton's largest step in the departure velocity, m/s.
const MAX_STEP = 50
// Where the burn is, from the Moon's place at arrival, round the Moon's
// orbit plane: short of 180°, where the first guess's plane would be lost.
const DEPARTURE_ANGLE = 175 * Math.PI / 180
// The Moon's mean orbital speed, m/s: weighs the perilune's time against
// its place.
const MOON_SPEED = 1022
// Finite differences of the arrival on the departure velocity, m/s.
const DV_PROBE = 1e-3
// Converged when the arrival is this close to its aim, metres.
const TOLERANCE = 10
export const TOLERANCES = {rtol: 1e-12, atol: [1e-4, 1e-4, 1e-4, 1e-7, 1e-7, 1e-7]}


/**
 * @param {Array<number>} a
 * @param {Array<number>} b
 * @returns {Array<number>} a × b
 */
function cross(a, b) {
  return [(a[1] * b[2]) - (a[2] * b[1]), (a[2] * b[0]) - (a[0] * b[2]), (a[0] * b[1]) - (a[1] * b[0])]
}


/**
 * Rodrigues' rotation of v about a unit axis k by an angle.
 *
 * @returns {Array<number>}
 */
function rotate(v, k, angle) {
  const c = Math.cos(angle)
  const sn = Math.sin(angle)
  const kv = cross(k, v)
  const kd = (k[0] * v[0]) + (k[1] * v[1]) + (k[2] * v[2])
  return v.map((x, i) => (x * c) + (kv[i] * sn) + (k[i] * kd * (1 - c)))
}


/** @returns {Array<number>} v scaled to length 1 */
function unit(v) {
  const n = Math.hypot(...v)
  return v.map((x) => x / n)
}


/**
 * The force model about the Earth, with the bodies' tracks.
 *
 * @param {object} tracks ephemeris.js geocentricTracks'
 * @param {number} epoch JDE at t = 0
 * @param {?object} [srp] newForceModel's, without the Sun's track
 * @returns {Function} newForceModel's
 */
export function earthModel(tracks, epoch, srp = null) {
  const perturbers = [{gm: GM.moon, track: tracks.moon}]
  if (tracks.sun) {
    perturbers.push({gm: GM.sun, track: tracks.sun})
  }
  return newForceModel({gm: GM.earth, j2: EARTH_J2, radius: EARTH_RADIUS, pole: earthPole(), perturbers, epoch,
    srp: srp && tracks.sun ? {...srp, sun: tracks.sun} : null})
}


/**
 * Solve a 3×3 linear system by Cramer's rule.
 *
 * @param {Array<Array<number>>} m rows
 * @param {Array<number>} b
 * @returns {Array<number>}
 */
function solve3(m, b) {
  const det = (a) => (a[0][0] * ((a[1][1] * a[2][2]) - (a[1][2] * a[2][1]))) -
    (a[0][1] * ((a[1][0] * a[2][2]) - (a[1][2] * a[2][0]))) +
    (a[0][2] * ((a[1][0] * a[2][1]) - (a[1][1] * a[2][0])))
  const d = det(m)
  return [0, 1, 2].map((c) => det(m.map((row, r) => row.map((x, k) => (k === c ? b[r] : x)))) / d)
}


/**
 * The craft's closest approach to the Moon: integrated until its distance
 * from the Moon stops falling inside the Moon's sphere of influence (or the
 * window ends), then found within that step by bisection.
 *
 * @param {Function} rates
 * @param {object} moon the Moon's track
 * @param {number} epoch JDE at t = 0
 * @param {Array<number>} s0
 * @param {number} tMax seconds
 * @param {function(number, Float64Array): void} [onStep]
 * @returns {{t: number, state: Float64Array, rel: Array<number>, relV: Array<number>, r: number}}
 *     rel the craft's place from the Moon, relV its velocity, r its distance
 */
export function perilune(rates, moon, epoch, s0, tMax, onStep) {
  const m = [0, 0, 0]
  const m2 = [0, 0, 0]
  const relOf = (t, s) => {
    const jde = epoch + (t / SECONDS_PER_DAY)
    moon.at(jde, m)
    // The Moon's velocity by a central difference over a minute.
    moon.at(jde + (30 / SECONDS_PER_DAY), m2)
    const vm = m2.map((x, k) => (x - m[k]) / 30)
    moon.at(jde - (30 / SECONDS_PER_DAY), m2)
    for (let k = 0; k < 3; k++) {
      vm[k] = (vm[k] + ((m[k] - m2[k]) / 30)) / 2
    }
    const rel = [s[0] - m[0], s[1] - m[1], s[2] - m[2]]
    const relV = [s[3] - vm[0], s[4] - vm[1], s[5] - vm[2]]
    return {rel, relV, r: Math.hypot(...rel), rdot: ((rel[0] * relV[0]) + (rel[1] * relV[1]) + (rel[2] * relV[2]))}
  }
  let last = {t: 0, y: Float64Array.from(s0)}
  let best = null
  let bracket = null
  dopri5(rates, s0, 0, tMax, {...TOLERANCES, onStep: (t, y) => {
    onStep?.(t, y)
    const here = relOf(t, y)
    if (!best || here.r < best.r) {
      best = {t, y: Float64Array.from(y), ...here}
    }
    if (!bracket && t > 0 && here.rdot > 0 && here.r < MOON_SOI) {
      const before = relOf(last.t, last.y)
      if (before.rdot <= 0) {
        bracket = {from: last, to: t}
      }
    }
    last = {t, y: Float64Array.from(y)}
  }, until: () => bracket !== null})
  if (!bracket) {
    return {t: best.t, state: best.y, rel: best.rel, relV: best.relV, r: best.r}
  }
  // Bisect on the step for where the distance stops falling.
  let lo = bracket.from.t
  let hi = bracket.to
  let at = null
  for (let i = 0; i < BISECTIONS; i++) {
    const mid = (lo + hi) / 2
    const y = dopri5(rates, bracket.from.y, bracket.from.t, mid, TOLERANCES).y
    const here = relOf(mid, y)
    at = {t: mid, state: y, ...here}
    if (here.rdot > 0) {
      hi = mid
    } else {
      lo = mid
    }
  }
  return at
}


/**
 * A transfer from a circular parking orbit to the Moon: its perilune at a
 * given height, in the Moon's orbit plane, at a given time.
 *
 * @param {object} tracks ephemeris.js geocentricTracks'
 * @param {number} departure JDE of the burn
 * @param {object} [opts]
 * @param {number} [opts.days] the time of flight to the perilune
 * @param {number} [opts.parking] the parking orbit's height, m
 * @param {number} [opts.height] the perilune's height over the Moon, m
 * @returns {?{departure: number, days: number, state: Array<number>,
 *     parking: Array<number>, dv: number, perilune: object,
 *     iterations: number}} state the craft's just after the burn, parking
 *     just before it; perilune perilune()'s; null if Newton's method
 *     doesn't converge
 */
export function lunarTransfer(tracks, departure, {days = 4.5, parking = 185e3, height = 100e3} = {}) {
  const accel = earthModel(tracks, departure)
  const rates = ratesOf(accel)
  const moonAt = tracks.moon.at(departure + days)
  const moonBefore = tracks.moon.at(departure + days - 0.01)
  // The Moon's orbit plane about then.
  const pole = unit(cross(moonBefore, moonAt))
  const toMoon = unit(moonAt)
  // The first guess: the two-body arc (Lambert's) to the Moon's place at
  // the arrival, from a point of the parking orbit DEPARTURE_ANGLE round
  // from it (at 180° the arc's plane isn't defined), prograde.
  const rp = EARTH_RADIUS + parking
  const r0 = rotate(toMoon, pole, -DEPARTURE_ANGLE).map((x) => x * rp)
  const along = unit(cross(pole, r0))
  const vCirc = Math.sqrt(GM.earth / rp)
  const tof = days * SECONDS_PER_DAY
  const guess = lambert(r0, moonAt, tof, GM.earth, pole)
  if (!guess) {
    return null
  }
  let v = guess.v1
  const tMax = (days + WINDOW_DAYS) * SECONDS_PER_DAY
  // The targets, each zero when met, in metres: the perilune's height, its
  // distance from the Moon's orbit plane, and its time (as the distance the
  // Moon's own speed covers in the difference, ~1 km/s).
  const targets = (end) => [end.r - MOON_RADIUS - height,
    (end.rel[0] * pole[0]) + (end.rel[1] * pole[1]) + (end.rel[2] * pole[2]),
    (end.t - tof) * MOON_SPEED]
  const arrive = (v0) => perilune(rates, tracks.moon, departure, [...r0, ...v0], tMax)
  for (let it = 0; it < ITERATIONS; it++) {
    const end = arrive(v)
    const miss = targets(end)
    if (Math.hypot(...miss) < TOLERANCE) {
      return {departure, days: end.t / SECONDS_PER_DAY, state: [...r0, ...v],
        parking: [...r0, ...along.map((x) => x * vCirc)],
        dv: Math.hypot(...v.map((x, k) => x - (along[k] * vCirc))), perilune: end, iterations: it}
    }
    // The targets' sensitivity to the departure velocity, by differences.
    const jac = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
    for (let c = 0; c < 3; c++) {
      const probe = v.slice()
      probe[c] += DV_PROBE
      const m2 = targets(arrive(probe))
      for (let r = 0; r < 3; r++) {
        jac[r][c] = (m2[r] - miss[r]) / DV_PROBE
      }
    }
    const dv = solve3(jac, miss)
    // Damped: a step at most MAX_STEP, the guess being far at first.
    const damp = Math.min(1, MAX_STEP / Math.hypot(...dv))
    v = v.map((x, k) => x - (damp * dv[k]))
  }
  return null
}
