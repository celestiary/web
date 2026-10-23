import {GM, EARTH_RADIUS, SECONDS_PER_DAY, dopri5, ratesOf} from './integrator.js'
import {earthModel} from './transfer.js'


// A ballistic lunar transfer (Craft.md; #272's scope 5): from a low Earth
// parking orbit out to about 1.5 million km, where the Sun's tide turns the
// orbit and raises its perigee to the Moon's distance, and back to the Moon
// three to four months later at almost no speed relative to it, as GRAIL
// (2011) and CAPSTONE (2022) flew.  In the circular restricted problems it
// rides the manifolds of the Sun-Earth L1 or L2 orbits outward and the
// Earth-Moon ones inward (Lagrange.md, manifolds); here it is made directly
// in the full force model, the Sun's pull from VSOP87C.
//
// Designed backward, as Parker and Anderson do ("Low-Energy Lunar
// Trajectory Design", JPL DESCANSO 2014, ch. 3): fix the arrival (its date,
// the perilune's height and the craft's energy about the Moon, near zero),
// scan where on the Moon the perilune is, integrate each back about five
// months, and keep those that fall back to a low perigee; then Newton's
// method on the perilune's place and the tilt of its velocity puts that
// perigee at the parking orbit.

const MOON_RADIUS = 1737400
// The scan: the perilune's place round the Moon, in the Moon's orbit plane,
// every SCAN_STEP; the backward run's length.
const SCAN_STEP = 2 * Math.PI / 180
const BACK_DAYS = 170
// A perigee counts once the craft has been this far out (it starts at the
// Moon, 384,000 km): the BLT's way out is past 1 million km.
const OUT_RADIUS = 800e6
// The Earth is a point mass here, so a path through it has a perigee (its
// least distance, smooth in the arrival's parameters, which Newton's method
// needs: stopped at the surface, the least distance is the surface's).  A
// path within this of the centre is stopped, short of the singularity.
const CORE = 1000e3
const SCAN_TOLERANCES = {rtol: 1e-10, atol: [1e-2, 1e-2, 1e-2, 1e-5, 1e-5, 1e-5]}
const TOLERANCES = {rtol: 1e-12, atol: [1e-4, 1e-4, 1e-4, 1e-7, 1e-7, 1e-7]}
const ITERATIONS = 40
// Newton's differences in the perilune's angles, radians, and its largest
// step.
const PROBE = 1e-6
const MAX_STEP = 0.03
// Newton's method runs at the scan's tolerance until the perigee is this
// near its target, m: then at the full one.
const FINE_MISS = 100e3
// Converged when the perigee is this close to the parking orbit, m.
const PERIGEE_TOLERANCE = 100
// How many of the scan's candidates to try.
const CANDIDATES = 6


/**
 * @param {Array<number>} a
 * @param {Array<number>} b
 * @returns {Array<number>} a × b
 */
function cross(a, b) {
  return [(a[1] * b[2]) - (a[2] * b[1]), (a[2] * b[0]) - (a[0] * b[2]), (a[0] * b[1]) - (a[1] * b[0])]
}


/** @returns {Array<number>} v scaled to length 1 */
function unit(v) {
  const n = Math.hypot(...v)
  return v.map((x) => x / n)
}


/**
 * The arrival's frame: the Moon's place and velocity at the arrival, and
 * axes X toward the Moon from the Earth, Z its orbit's pole, Y its way.
 *
 * @param {object} moon its track
 * @param {number} jde
 * @returns {{m: Array<number>, vm: Array<number>, X: Array<number>, Y: Array<number>, Z: Array<number>}}
 */
export function arrivalFrame(moon, jde) {
  const dt = 1e-3
  const m = moon.at(jde)
  const m1 = moon.at(jde + dt)
  const m0 = moon.at(jde - dt)
  const vm = m1.map((x, k) => (x - m0[k]) / (2 * dt * SECONDS_PER_DAY))
  const X = unit(m)
  const Z = unit(cross(m, vm))
  return {m, vm, X, Y: cross(Z, X), Z}
}


/**
 * The craft's state at the perilune, geocentric: the perilune at an angle
 * round the Moon in its orbit plane, the velocity at right angles to it,
 * prograde or retrograde about the Moon and tilted out of the plane by
 * `tilt`, its speed from the energy about the Moon.
 *
 * @param {object} frame arrivalFrame's
 * @param {{angle: number, tilt: number, sense: number}} p
 * @param {number} rp the perilune's radius, m
 * @param {number} c3 the energy about the Moon, v∞², m²/s²
 * @returns {Array<number>}
 */
export function periluneState({m, vm, X, Y, Z}, {angle, tilt, sense}, rp, c3) {
  const dir = X.map((x, k) => (Math.cos(angle) * x) + (Math.sin(angle) * Y[k]))
  const along = cross(Z, dir).map((x) => x * sense)
  const v = along.map((x, k) => (Math.cos(tilt) * x) + (Math.sin(tilt) * Z[k]))
  const speed = Math.sqrt(c3 + (2 * GM.moon / rp))
  return [...dir.map((x, k) => m[k] + (rp * x)), ...v.map((x, k) => vm[k] + (speed * x))]
}


/**
 * Integrate back from the perilune and find the perigee before the craft
 * came out to the Moon: the least distance from the Earth after it was past
 * OUT_RADIUS, through the Earth if need be (a point mass).
 *
 * @param {Function} rates
 * @param {Array<number>} s0
 * @param {object} [tol]
 * @returns {?{t: number, state: Float64Array, r: number, apogee: number}}
 *     t seconds (negative: before the arrival); null where it never went
 *     out, was still falling at the run's end, or came within CORE
 */
export function perigeeBefore(rates, s0, tol = SCAN_TOLERANCES) {
  let out = false
  let best = null
  let apogee = 0
  let last = null
  dopri5(rates, s0, 0, -BACK_DAYS * SECONDS_PER_DAY, {...tol, onStep: (t, y) => {
    const r = Math.hypot(y[0], y[1], y[2])
    apogee = Math.max(apogee, r)
    if (r > OUT_RADIUS) {
      out = true
    }
    if (out && (!best || r < best.r)) {
      // The farthest between this perigee and the arrival: not past it,
      // where the run goes on out before the departure.
      best = {t, state: Float64Array.from(y), r, apogee}
    }
    last = {t, r}
  }, until: (t, y) => Math.hypot(y[0], y[1], y[2]) < CORE})
  if (!best || best.t === last?.t) {
    // Still falling when the run ended, or deep in the Earth: no perigee.
    return null
  }
  return best
}


/**
 * The parameters at the Moon, scanned, whose backward runs reach low
 * perigees, lowest first.
 *
 * @param {Function} rates
 * @param {object} frame arrivalFrame's
 * @param {number} rp
 * @param {number} c3
 * @param {number} [below] perigee radius, m
 * @returns {Array<{angle: number, tilt: number, sense: number, perigee: object}>}
 */
export function scanArrivals(rates, frame, rp, c3, below = 60000e3) {
  const found = []
  for (const sense of [1, -1]) {
    for (let angle = 0; angle < 2 * Math.PI; angle += SCAN_STEP) {
      const p = {angle, tilt: 0, sense}
      const perigee = perigeeBefore(rates, periluneState(frame, p, rp, c3))
      if (perigee && perigee.r < below) {
        found.push({...p, perigee})
      }
    }
  }
  return found.sort((a, b) => a.perigee.r - b.perigee.r)
}


/**
 * The least-norm solution of one equation in n unknowns, g · x = r:
 * x = g r / |g|².
 *
 * @param {Array<Array<number>>} jac one row, g
 * @param {Array<number>} r one value
 * @returns {Array<number>}
 */
export function leastNorm([g], [r]) {
  const k = r / g.reduce((sum, x) => sum + (x * x), 0)
  return g.map((x) => x * k)
}


/**
 * A ballistic lunar transfer arriving at a given time.
 *
 * @param {object} tracks ephemeris.js geocentricTracks', with the Sun
 * @param {number} arrival JDE of the perilune
 * @param {object} [opts]
 * @param {number} [opts.height] the perilune's height over the Moon, m
 * @param {number} [opts.parking] the parking orbit's height, m
 * @param {number} [opts.c3] the energy about the Moon at arrival, m²/s²
 * @param {number} [opts.departure] JDE: of the transfers the scan's
 *     candidates converge on, the one leaving nearest it, not the first
 *     found.  Not a target: the perigee's time jumps between passes (the
 *     arc is long, and chaotic), and Newton's method on it didn't converge.
 * @returns {?{departure: number, arrival: number, state: Array<number>,
 *     dv: number, c3: number, apogee: number, days: number,
 *     perilune: Array<number>, iterations: number}} state the craft's at
 *     the perigee just after the burn, geocentric; dv the burn from the
 *     circular parking orbit; c3 its energy about the Earth then, m²/s²;
 *     perilune the craft's state at arrival; null where none was found
 */
export function designBlt(tracks, arrival, {height = 100e3, parking = 185e3, c3 = -2e4, departure} = {}) {
  const rates = ratesOf(earthModel(tracks, arrival))
  const frame = arrivalFrame(tracks.moon, arrival)
  const rp = MOON_RADIUS + height
  const target = EARTH_RADIUS + parking
  // The unknowns: the perilune's angle and its velocity's tilt, radians.
  const stateOf = (u, sense) => periluneState(frame, {angle: u[0], tilt: u[1], sense}, rp, c3)
  // At the scan's tolerance until near (FINE_MISS), then the full one.
  let fine = false
  const perigeeOf = (u, sense) => perigeeBefore(rates, stateOf(u, sense), fine ? TOLERANCES : SCAN_TOLERANCES)
  let best = null
  for (const {angle, sense} of scanArrivals(rates, frame, rp, c3).slice(0, CANDIDATES)) {
    let u = [angle, 0]
    fine = false
    let at = perigeeOf(u, sense)
    for (let it = 0; it < ITERATIONS && at; it++) {
      let miss = at.r - target
      if (!fine && Math.abs(miss) < FINE_MISS) {
        fine = true
        at = perigeeOf(u, sense)
        if (!at) {
          break
        }
        miss = at.r - target
      }
      if (fine && Math.abs(miss) < PERIGEE_TOLERANCE) {
        const s = at.state
        const v = Math.hypot(s[3], s[4], s[5])
        const found = {departure: arrival + (at.t / SECONDS_PER_DAY), arrival, state: Array.from(s),
          dv: v - Math.sqrt(GM.earth / at.r), c3: (v * v) - (2 * GM.earth / at.r), apogee: at.apogee,
          days: -at.t / SECONDS_PER_DAY, perilune: stateOf(u, sense), iterations: it, angle: u[0], tilt: u[1], sense}
        if (departure === undefined) {
          return found
        }
        if (!best || Math.abs(found.departure - departure) < Math.abs(best.departure - departure)) {
          best = found
        }
        break
      }
      // The least step in (angle, tilt) that moves the perigee to the
      // target, to first order: one equation, two unknowns.
      const da = perigeeOf([u[0] + PROBE, u[1]], sense)
      const dt = perigeeOf([u[0], u[1] + PROBE], sense)
      if (!da || !dt) {
        break
      }
      let step = leastNorm([[(da.r - at.r) / PROBE, (dt.r - at.r) / PROBE]], [miss]).map((x) => -x)
      const n = Math.hypot(...step)
      if (n > MAX_STEP) {
        step = step.map((x) => x * MAX_STEP / n)
      }
      u = [u[0] + step[0], u[1] + step[1]]
      at = perigeeOf(u, sense)
    }
  }
  return best
}
