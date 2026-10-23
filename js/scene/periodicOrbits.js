import {collinearDistances} from './lagrange.js'
import {correctSymmetric, propagate} from './cr3bp.js'


// A pair's three-body periodic orbits (Lagrange.md, three-body orbits;
// #272's scope 3): a member of each family, made in the CR3BP from a
// classical first guess and closed by differential correction
// (cr3bp.js correctSymmetric).  The same code for every pair: only μ
// differs.
//
// - Lyapunov orbits about L1 and L2: planar, from the linear solution.
// - Halo orbits about L1 and L2: from Richardson's third-order
//   approximation (Richardson 1980, "Analytic construction of periodic
//   orbits about the collinear points"; as in Koon, Lo, Marsden and Ross,
//   "Dynamical Systems, the Three-Body Problem and Space Mission Design").
// - Distant retrograde orbits (DRO): planar, retrograde about the
//   secondary, from a two-body circle grown out by continuation.
// - The Earth-Moon 9:2 near-rectilinear halo orbit (NRHO), Gateway's: an
//   L2 southern halo whose period is 2/9 of a synodic month, from a
//   published state, its period then pinned by a secant on x0.
//
// Where JPL's three-body periodic orbit catalogue has the pair, the app
// draws the catalogue's member that matches these (PERIODIC_DATA_URL;
// Scene._periodicSamples), and these are checked against it
// (periodicOrbits.test.js).
//
// Members are chosen by size against the secondary's Hill radius γ (the
// L1 distance, collinearDistances), so a family looks alike at every pair.


/** The families, in the order the panel lists them; `code` is the link's. */
export const FAMILIES = {
  l1Lyapunov: {code: 'l1l', name: 'L1 Lyapunov', point: 1, color: 0x9fd0ff},
  l2Lyapunov: {code: 'l2l', name: 'L2 Lyapunov', point: 2, color: 0x9fb0ff},
  l1Halo: {code: 'l1h', name: 'L1 halo', point: 1, color: 0xffb0e0, halo: true},
  l2Halo: {code: 'l2h', name: 'L2 halo', point: 2, color: 0xe0a0ff, halo: true},
  dro: {code: 'dro', name: 'DRO', point: 0, color: 0xa0ffd0},
  nrho: {code: 'nrho', name: '9:2 NRHO', point: 2, only: 'moon', color: 0xffe080, halo: true},
}
/**
 * JPL's catalogue members matching these (tools/periodic/fetchJpl.mjs), by
 * the pair's secondary, which the app draws where it has them.
 */
export const PERIODIC_DATA_URL = 'data/periodicOrbits.json'
// The members' sizes, in Hill radii: a Lyapunov orbit's x amplitude, a
// halo's z amplitude, a DRO's distance from the secondary on the x axis.
const LYAPUNOV_AX = 0.2
const LYAPUNOV_SEED_AX = 0.01
const LYAPUNOV_STEPS = 20
const HALO_AZ = 0.25
const DRO_RADIUS = 1.2
const DRO_SEED_RADIUS = 0.2
const DRO_STEPS = 24
// Gateway's 9:2 NRHO, southern (Lee 2019; Zimovan-Spreen et al. 2020), at
// apolune, in Earth-Moon CR3BP units: a first guess, closed and its period
// pinned below.
const NRHO_GUESS = [1.0221, -0.1821, -0.1033]
const NRHO_PERIOD_ITERATIONS = 20


/**
 * The collinear point's place and distance, x from the barycentre.
 *
 * @param {number} mu
 * @param {number} point 1 or 2
 * @returns {{x: number, gamma: number}}
 */
function collinear(mu, point) {
  const {l1, l2} = collinearDistances(mu)
  return point === 1 ? {x: 1 - mu - l1, gamma: l1} : {x: 1 - mu + l2, gamma: l2}
}


/**
 * Richardson's coefficient c_n at L1 or L2.
 *
 * @returns {number}
 */
function cn(mu, gamma, point, n) {
  const sign = (-1) ** n
  if (point === 1) {
    return (mu + (sign * (1 - mu) * (gamma ** (n + 1)) / ((1 - gamma) ** (n + 1)))) / (gamma ** 3)
  }
  return ((sign * mu) + (sign * (1 - mu) * (gamma ** (n + 1)) / ((1 + gamma) ** (n + 1)))) / (gamma ** 3)
}


/**
 * Richardson's third-order halo orbit at its crossing of the xz plane, as
 * [x0, z0, vy0] barycentric.
 *
 * @param {number} mu
 * @param {number} point 1 or 2
 * @param {number} az the z amplitude, in units of γ
 * @param {number} north +1 for the northern family, -1 the southern
 * @returns {?Array<number>} null where the amplitude has no halo
 */
export function richardsonHalo(mu, point, az, north = 1) {
  const {x: xL, gamma} = collinear(mu, point)
  const c2 = cn(mu, gamma, point, 2)
  const c3 = cn(mu, gamma, point, 3)
  const c4 = cn(mu, gamma, point, 4)
  const lam = Math.sqrt((2 - c2 + Math.sqrt((9 * c2 * c2) - (8 * c2))) / 2)
  const k = 2 * lam / ((lam * lam) + 1 - c2)
  const delta = (lam * lam) - c2
  const l2 = lam * lam
  const d1 = (3 * l2 / k) * ((k * ((6 * l2) - 1)) - (2 * lam))
  const d2 = (8 * l2 / k) * ((k * ((11 * l2) - 1)) - (2 * lam))
  const a21 = 3 * c3 * ((k * k) - 2) / (4 * (1 + (2 * c2)))
  const a22 = 3 * c3 / (4 * (1 + (2 * c2)))
  const a23 = (-3 * c3 * lam / (4 * k * d1)) * ((3 * (k ** 3) * lam) - (6 * k * (k - lam)) + 4)
  const a24 = (-3 * c3 * lam / (4 * k * d1)) * (2 + (3 * k * lam))
  const b21 = (-3 * c3 * lam / (2 * d1)) * ((3 * k * lam) - 4)
  const b22 = 3 * c3 * lam / d1
  const d21 = -c3 / (2 * l2)
  const a31 = ((-9 * lam / (4 * d2)) * ((4 * c3 * ((k * a23) - b21)) + (k * c4 * (4 + (k * k))))) +
    ((((9 * l2) + 1 - c2) / (2 * d2)) * ((3 * c3 * ((2 * a23) - (k * b21))) + (c4 * (2 + (3 * k * k)))))
  const a32 = (-1 / d2) * (((9 * lam / 4) * ((4 * c3 * ((k * a24) - b22)) + (k * c4))) +
    ((3 / 2) * ((9 * l2) + 1 - c2) * ((c3 * ((k * b22) + d21 - (2 * a24))) - c4)))
  const b31 = (3 / (8 * d2)) * ((8 * lam * ((3 * c3 * ((k * b21) - (2 * a23))) - (c4 * (2 + (3 * k * k))))) +
    (((9 * l2) + 1 + (2 * c2)) * ((4 * c3 * ((k * a23) - b21)) + (k * c4 * (4 + (k * k))))))
  const b32 = (1 / d2) * ((9 * lam * ((c3 * ((k * b22) + d21 - (2 * a24))) - c4)) +
    ((3 / 8) * ((9 * l2) + 1 + (2 * c2)) * ((4 * c3 * ((k * a24) - b22)) + (k * c4))))
  const d31 = (3 / (64 * l2)) * ((4 * c3 * a24) + c4)
  const d32 = (3 / (64 * l2)) * ((4 * c3 * (a23 - d21)) + (c4 * (4 + (k * k))))
  const den = 2 * lam * ((lam * (1 + (k * k))) - (2 * k))
  const s1 = (1 / den) * (((3 / 2) * c3 * ((2 * a21 * ((k * k) - 2)) - (a23 * ((k * k) + 2)) - (2 * k * b21))) -
    ((3 / 8) * c4 * ((3 * (k ** 4)) - (8 * k * k) + 8)))
  const s2 = (1 / den) * (((3 / 2) * c3 * ((2 * a22 * ((k * k) - 2)) + (a24 * ((k * k) + 2)) + (2 * k * b22) +
    (5 * d21))) + ((3 / 8) * c4 * (12 - (k * k))))
  const L1c = (-3 / 2 * c3 * ((2 * a21) + a23 + (5 * d21))) - ((3 / 8) * c4 * (12 - (k * k))) + (2 * l2 * s1)
  const L2c = ((3 / 2) * c3 * (a24 - (2 * a22))) + ((9 / 8) * c4) + (2 * l2 * s2)
  const ax2 = -((L2c * az * az) + delta) / L1c
  if (!(ax2 > 0)) {
    return null
  }
  const ax = Math.sqrt(ax2)
  const omega = 1 + (s1 * ax2) + (s2 * az * az)
  // At τ1 = 0: y = 0 and the orbit crosses the xz plane at right angles.
  const xr = (a21 * ax2) + (a22 * az * az) - ax + ((a23 * ax2) - (a24 * az * az)) +
    ((a31 * (ax ** 3)) - (a32 * ax * az * az))
  const zr = north * (az + (d21 * ax * az * (1 - 3)) + ((d32 * az * ax2) - (d31 * (az ** 3))))
  const dyr = (k * ax) + (2 * ((b21 * ax2) - (b22 * az * az))) + (3 * ((b31 * (ax ** 3)) - (b32 * ax * az * az)))
  // Richardson's x points away from the primary at both points.
  return [xL + (gamma * xr), gamma * zr, gamma * omega * lam * dyr]
}


/**
 * A Lyapunov orbit's linear first guess, [x0, 0, vy0].
 *
 * @param {number} mu
 * @param {number} point
 * @param {number} ax the x amplitude, units of γ
 * @returns {Array<number>}
 */
export function lyapunovGuess(mu, point, ax) {
  const {x: xL, gamma} = collinear(mu, point)
  const c2 = cn(mu, gamma, point, 2)
  const nu = Math.sqrt((2 - c2 + Math.sqrt((9 * c2 * c2) - (8 * c2))) / 2)
  const k = ((nu * nu) + 1 + (2 * c2)) / (2 * nu)
  return [xL - (gamma * ax), 0, gamma * ax * k * nu]
}


/**
 * Close an orbit from a guess, stepping the amplitude out from a small one
 * where the guess is good (natural-parameter continuation in x0 or z0).
 *
 * @param {number} mu
 * @param {function(number): ?Array<number>} guessAt a guess at a fraction
 *     of the way, 0..1
 * @param {string} fixed as correctSymmetric's
 * @param {number} steps
 * @returns {?object} correctSymmetric's
 */
function continued(mu, guessAt, fixed, steps) {
  // The free values: x0 or z0 (whichever isn't held) and vy0.
  const free = (st) => [fixed === 'x' ? st[2] : st[0], st[4]]
  let prev = null
  let last = null
  let lastGuess = null
  for (let i = 1; i <= steps; i++) {
    const g = guessAt(i / steps)
    if (!g) {
      return last
    }
    let guess = g
    if (last) {
      // Predict from the members so far: a line through the last two, or
      // the first guess's error carried over.
      const [a, v] = free(last.state)
      let pa = a
      let pv = v * (g[2] / lastGuess[2])
      if (prev) {
        const [a0, v0] = free(prev.state)
        pa = (2 * a) - a0
        pv = (2 * v) - v0
      }
      guess = fixed === 'x' ? [g[0], pa, pv] : [pa, g[1], pv]
    }
    const next = correctSymmetric(mu, guess, fixed)
    if (!next) {
      return last
    }
    prev = last
    last = next
    lastGuess = g
  }
  return last
}


/**
 * One member of a family at a pair.
 *
 * @param {number} mu
 * @param {string} family a key of FAMILIES
 * @returns {?{state: Array<number>, period: number}} the state at the
 *     crossing of the xz plane (y = 0), in CR3BP units; null where the family
 *     has no member here
 */
export function familyMember(mu, family) {
  const {gamma: hill} = collinear(mu, 1)
  switch (family) {
    case 'l1Lyapunov':
    case 'l2Lyapunov': {
      // From a small one, where the linear guess is good, out in x0: from
      // the full size the guess converges on another orbit.
      const point = FAMILIES[family].point
      const at = (f) => lyapunovGuess(mu, point, LYAPUNOV_SEED_AX + (f * (LYAPUNOV_AX - LYAPUNOV_SEED_AX)))
      return continued(mu, at, 'x', LYAPUNOV_STEPS)
    }
    case 'l1Halo':
    case 'l2Halo': {
      const point = FAMILIES[family].point
      const g = richardsonHalo(mu, point, HALO_AZ, -1)
      const m = g ? correctSymmetric(mu, g, 'z') : null
      return m ? southern(mu, m) : null
    }
    case 'dro': {
      // A retrograde circle about the secondary, beyond it on the x axis,
      // grown out from well inside the Hill sphere.
      const at = (f) => {
        const r = hill * (DRO_SEED_RADIUS + (f * (DRO_RADIUS - DRO_SEED_RADIUS)))
        return [1 - mu + r, 0, -(Math.sqrt(mu / r) + r)]
      }
      return continued(mu, at, 'x', DRO_STEPS)
    }
    case 'nrho':
      return nrho92(mu)
    default:
      return null
  }
}


/**
 * The southern of a halo and its mirror image in the pair's plane (the
 * CR3BP is symmetric in z): the one whose crossing of the xz plane
 * farthest from the plane is below it, as JPL's catalogue's southern
 * branch.  Richardson's class sign flips between L1 and L2, so the guess's
 * doesn't say which.
 *
 * @param {number} mu
 * @param {{state: Array<number>, period: number}} m
 * @returns {{state: Array<number>, period: number}}
 */
export function southern(mu, m) {
  const other = propagate(mu, m.state, {toCrossing: true}).s
  const apex = Math.abs(other[2]) > Math.abs(m.state[2]) ? other[2] : m.state[2]
  if (apex <= 0) {
    return m
  }
  const [x, y, z, vx, vy, vz] = m.state
  return {...m, state: [x, y, -z, vx, vy, -vz]}
}


/**
 * The 9:2 NRHO: the L2 southern halo whose period is 2/9 of the synodic
 * month.  In units of the pair's period, the synodic month is 2π/(1 − n☉/n).
 *
 * @param {number} mu
 * @param {number} [synodicRatio] the synodic month over the sidereal
 *     (29.530589 / 27.321661)
 * @returns {?object}
 */
export function nrho92(mu, synodicRatio = 29.530589 / 27.321661) {
  const target = 2 * (2 * Math.PI * synodicRatio) / 9
  let a = correctSymmetric(mu, NRHO_GUESS, 'z')
  if (!a) {
    return null
  }
  // A secant on x0 for the period, z0 free.
  let b = correctSymmetric(mu, [a.state[0] + 1e-4, a.state[2], a.state[4]], 'x')
  for (let i = 0; i < NRHO_PERIOD_ITERATIONS && b; i++) {
    if (Math.abs(b.period - target) < 1e-10) {
      return b
    }
    const x = b.state[0] - ((b.period - target) * (b.state[0] - a.state[0]) / (b.period - a.period))
    a = b
    b = correctSymmetric(mu, [x, b.state[2], b.state[4]], 'x')
  }
  return b
}


/**
 * @param {string} code a family's link code
 * @returns {?string} its key in FAMILIES
 */
export function familyOfCode(code) {
  return Object.keys(FAMILIES).find((k) => FAMILIES[k].code === code) ?? null
}


/**
 * Sample one period of a member for drawing, at the integrator's own steps
 * (densest where it moves fastest: the NRHO's perilune), in the pair's
 * frame with the primary at the origin (x + μ).
 *
 * @param {number} mu
 * @param {{state: Array<number>, period: number}} member
 * @returns {{t: Float64Array, xyz: Float32Array, period: number}}
 */
export function sampleMember(mu, {state, period}) {
  const t = []
  const xyz = []
  propagate(mu, state, {t: period, onStep: (time, s) => {
    t.push(time)
    xyz.push(s[0] + mu, s[1], s[2])
  }})
  // Closed: the last point is the first.
  t.push(period)
  xyz.push(xyz[0], xyz[1], xyz[2])
  return {t: Float64Array.from(t), xyz: Float32Array.from(xyz), period}
}


/**
 * Where on a sampled orbit a body is at a time, by linear interpolation in
 * time.
 *
 * @param {{t: Float64Array, xyz: Float32Array, period: number}} samples
 * @param {number} time CR3BP time from the member's crossing, any value
 * @param {Array<number>} [out]
 * @returns {Array<number>} [x, y, z]
 */
export function placeAt({t, xyz, period}, time, out = [0, 0, 0]) {
  const phase = ((time % period) + period) % period
  let lo = 0
  let hi = t.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (t[mid] <= phase) {
      lo = mid
    } else {
      hi = mid
    }
  }
  const f = (phase - t[lo]) / ((t[hi] - t[lo]) || 1)
  for (let k = 0; k < 3; k++) {
    out[k] = xyz[(3 * lo) + k] + (f * (xyz[(3 * hi) + k] - xyz[(3 * lo) + k]))
  }
  return out
}


/**
 * The orbit as it runs in space, not in the turning frame: from now over a
 * window (one turn of the pair, 2π, by default), each place turned on about
 * the pole by the time since now, so it reads in the frame as it is now.
 * Primary-centred, as sampleMember's.
 *
 * @param {object} samples sampleMember's
 * @param {number} now CR3BP time, from the member's crossing
 * @param {number} n points
 * @param {Float32Array} [out] packed xyz, n of them
 * @param {number} [window]
 * @returns {Float32Array}
 */
export function inertialSweep(samples, now, n, out = new Float32Array(n * 3), window = 2 * Math.PI) {
  const p = [0, 0, 0]
  for (let i = 0; i < n; i++) {
    const dt = window * i / (n - 1)
    placeAt(samples, now + dt, p)
    const c = Math.cos(dt)
    const s = Math.sin(dt)
    out[3 * i] = (c * p[0]) - (s * p[1])
    out[(3 * i) + 1] = (s * p[0]) + (c * p[1])
    out[(3 * i) + 2] = p[2]
  }
  return out
}
