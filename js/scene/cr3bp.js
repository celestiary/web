// The circular restricted three-body problem (CR3BP), for the periodic
// orbits about a pair's Lagrange points (Lagrange.md, three-body orbits;
// #272's scope 3): the equations of motion in the pair's rotating frame, an
// adaptive integrator with the state-transition matrix, and the
// differential correction that closes a symmetric orbit.
//
// Units: the pair's separation, its mean motion (a period is 2π) and its
// total mass.  The frame is barycentric and turns with the pair: the
// primary at (−μ, 0, 0), the secondary at (1 − μ, 0, 0), +z the pair's
// orbit pole, +y the way the secondary moves.  A state is
// [x, y, z, vx, vy, vz].


const DP = {
  // Dormand-Prince 5(4): nodes, matrix, and the 5th- and 4th-order weights.
  c: [0, 1 / 5, 3 / 10, 4 / 5, 8 / 9, 1, 1],
  a: [
    [],
    [1 / 5],
    [3 / 40, 9 / 40],
    [44 / 45, -56 / 15, 32 / 9],
    [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
    [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656],
    [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84],
  ],
  b: [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84, 0],
  e: [71 / 57600, 0, -71 / 16695, 71 / 1920, -17253 / 339200, 22 / 525, -1 / 40],
}
const MAX_STEPS = 200000
const SAFETY = 0.9
const CROSSING_ITERATIONS = 30
const CORRECTION_ITERATIONS = 40
const CORRECTION_TOLERANCE = 1e-11


/**
 * The rates of a state, and with `stm` those of its state-transition matrix
 * (the variational equations, Φ' = A Φ), packed after it, row-major.
 *
 * @param {number} mu
 * @param {Float64Array|Array<number>} s 6, or 42 with the matrix
 * @param {Float64Array} out the same length
 */
export function rates(mu, s, out) {
  const [x, y, z, vx, vy, vz] = s
  const dx1 = x + mu
  const dx2 = x - 1 + mu
  const r1sq = (dx1 * dx1) + (y * y) + (z * z)
  const r2sq = (dx2 * dx2) + (y * y) + (z * z)
  const r1 = Math.sqrt(r1sq)
  const r2 = Math.sqrt(r2sq)
  const k1 = (1 - mu) / (r1sq * r1)
  const k2 = mu / (r2sq * r2)
  out[0] = vx
  out[1] = vy
  out[2] = vz
  out[3] = (2 * vy) + x - (k1 * dx1) - (k2 * dx2)
  out[4] = (-2 * vx) + y - (k1 * y) - (k2 * y)
  out[5] = -(k1 * z) - (k2 * z)
  if (s.length < 42) {
    return
  }
  // The pseudo-potential's Hessian.
  const q1 = 3 * k1 / r1sq
  const q2 = 3 * k2 / r2sq
  const uxx = 1 - k1 - k2 + (q1 * dx1 * dx1) + (q2 * dx2 * dx2)
  const uyy = 1 - k1 - k2 + ((q1 + q2) * y * y)
  const uzz = -k1 - k2 + ((q1 + q2) * z * z)
  const uxy = ((q1 * dx1) + (q2 * dx2)) * y
  const uxz = ((q1 * dx1) + (q2 * dx2)) * z
  const uyz = (q1 + q2) * y * z
  // A = [[0, I], [U, 2Ω]], 2Ω = [[0, 2, 0], [-2, 0, 0], [0, 0, 0]].
  for (let j = 0; j < 6; j++) {
    const p = (r) => s[6 + (6 * r) + j]
    out[6 + j] = p(3)
    out[12 + j] = p(4)
    out[18 + j] = p(5)
    out[24 + j] = (uxx * p(0)) + (uxy * p(1)) + (uxz * p(2)) + (2 * p(4))
    out[30 + j] = (uxy * p(0)) + (uyy * p(1)) + (uyz * p(2)) - (2 * p(3))
    out[36 + j] = (uxz * p(0)) + (uyz * p(1)) + (uzz * p(2))
  }
}


/**
 * @param {Array<number>} s0 6 numbers
 * @returns {Float64Array} the state with the identity matrix after it, 42
 */
export function withStm(s0) {
  const s = new Float64Array(42)
  s.set(s0.slice(0, 6))
  for (let i = 0; i < 6; i++) {
    s[6 + (7 * i)] = 1
  }
  return s
}


/**
 * Integrate from s0 for a time t (either sign), or until y next crosses zero
 * the given way after `minTime` (for a symmetric orbit's half period).
 *
 * @param {number} mu
 * @param {Array<number>|Float64Array} s0 6 numbers, or 42 with the matrix
 * @param {object} opts
 * @param {number} [opts.t] how long, if not to a crossing
 * @param {boolean} [opts.toCrossing] stop where y crosses zero
 * @param {number} [opts.minTime] ignore crossings before this
 * @param {function(number, Float64Array): void} [opts.onStep] each step's
 *     time and state
 * @returns {{t: number, s: Float64Array}} where it stopped
 */
export function propagate(mu, s0, {t = Infinity, toCrossing = false, minTime = 1e-3, onStep} = {}) {
  const n = s0.length
  let s = Float64Array.from(s0)
  const k = Array.from({length: 7}, () => new Float64Array(n))
  const tmp = new Float64Array(n)
  const next = new Float64Array(n)
  const dir = t < 0 ? -1 : 1
  const end = Math.abs(t)
  let time = 0
  let h = 1e-3
  onStep?.(0, s)
  for (let step = 0; step < MAX_STEPS; step++) {
    if (!toCrossing && time >= end) {
      break
    }
    if (!toCrossing) {
      h = Math.min(h, end - time)
    }
    const err = dpStep(mu, s, dir * h, k, tmp, next)
    if (err > 1 && h > 1e-14) {
      h *= Math.max(0.1, SAFETY * (err ** -0.2))
      continue
    }
    if (toCrossing && time + h > minTime && Math.sign(next[1]) !== Math.sign(s[1]) && s[1] !== 0) {
      // Bracketed: find the crossing by the secant on y over the step.
      return refineCrossing(mu, s, time, h * dir, k, tmp, next, onStep)
    }
    s = Float64Array.from(next)
    time += h
    onStep?.(time * dir, s)
    h *= Math.min(5, SAFETY * (Math.max(err, 1e-10) ** -0.2))
  }
  return {t: time * dir, s}
}


/**
 * One Dormand-Prince step; `next` gets the 5th-order state.
 *
 * @returns {number} the error estimate over the bound (≤ 1 to accept)
 */
function dpStep(mu, s, h, k, tmp, next) {
  const n = s.length
  for (let st = 0; st < 7; st++) {
    for (let i = 0; i < n; i++) {
      let sum = s[i]
      for (let j = 0; j < st; j++) {
        sum += h * DP.a[st][j] * k[j][i]
      }
      tmp[i] = sum
    }
    rates(mu, tmp, k[st])
  }
  let err = 0
  for (let i = 0; i < n; i++) {
    let sum = 0
    let e = 0
    for (let st = 0; st < 7; st++) {
      sum += DP.b[st] * k[st][i]
      e += DP.e[st] * k[st][i]
    }
    next[i] = s[i] + (h * sum)
    // Only the state (not the matrix) bounds the step.
    if (i < 6) {
      const scale = 1e-12 + (1e-12 * Math.max(Math.abs(s[i]), Math.abs(next[i])))
      err = Math.max(err, Math.abs(h * e) / scale)
    }
  }
  return err
}


/**
 * Find where y crosses zero within a step by bisection on the step length.
 *
 * @returns {{t: number, s: Float64Array}} the crossing
 */
function refineCrossing(mu, s, time, h, k, tmp, next, onStep) {
  let lo = 0
  let hi = h
  let best = Float64Array.from(next)
  for (let it = 0; it < CROSSING_ITERATIONS; it++) {
    const mid = (lo + hi) / 2
    dpStep(mu, s, mid, k, tmp, next)
    if (Math.sign(next[1]) === Math.sign(s[1])) {
      lo = mid
    } else {
      hi = mid
    }
    best = Float64Array.from(next)
    if (Math.abs(next[1]) < 1e-14) {
      break
    }
  }
  const tEnd = time + Math.abs((lo + hi) / 2)
  onStep?.(tEnd * Math.sign(h), best)
  return {t: tEnd * Math.sign(h), s: best}
}


/**
 * Close a symmetric periodic orbit: from (x0, 0, z0, 0, vy0, 0), adjust two
 * of x0, z0, vy0 so that at the next crossing of y = 0 the orbit crosses
 * at right angles (vx = vz = 0); it is then symmetric about the xz plane,
 * and its period is twice that time.
 *
 * @param {number} mu
 * @param {Array<number>} guess [x0, z0, vy0]
 * @param {string} fixed 'x' or 'z': the one held (a planar orbit, z0 = 0,
 *     holds both and adjusts vy0 alone)
 * @returns {?{state: Array<number>, period: number, iterations: number}}
 *     null if it doesn't converge
 */
export function correctSymmetric(mu, guess, fixed = 'z') {
  let [x0, z0, vy0] = guess
  // A planar orbit has one condition (vx = 0) and one unknown, vy0.
  const planar = z0 === 0
  for (let it = 0; it < CORRECTION_ITERATIONS; it++) {
    const {t, s} = propagate(mu, withStm([x0, 0, z0, 0, vy0, 0]), {toCrossing: true})
    if (!Number.isFinite(t) || t <= 0) {
      return null
    }
    const vxf = s[3]
    const vzf = s[5]
    if (Math.abs(vxf) < CORRECTION_TOLERANCE && (planar || Math.abs(vzf) < CORRECTION_TOLERANCE)) {
      return {state: [x0, 0, z0, 0, vy0, 0], period: 2 * t, iterations: it}
    }
    const f = new Float64Array(6)
    rates(mu, s, f)
    const phi = (r, c) => s[6 + (6 * r) + c]
    // Hold y = 0 at the end: δt = −(Φ_y · δq) / ẏ.
    const cols = fixed === 'x' ? [2, 4] : [0, 4]
    const row = (r) => cols.map((c) => phi(r, c) - (f[r] * phi(1, c) / f[1]))
    if (planar) {
      const [, d] = row(3)
      vy0 -= vxf / d
      continue
    }
    const [a, b] = row(3)
    const [c, d] = row(5)
    const det = (a * d) - (b * c)
    const dq0 = ((d * vxf) - (b * vzf)) / det
    const dq1 = ((a * vzf) - (c * vxf)) / det
    if (fixed === 'x') {
      z0 -= dq0
    } else {
      x0 -= dq0
    }
    vy0 -= dq1
  }
  return null
}


/**
 * The Jacobi constant, C = 2U − v², U = (x² + y²)/2 + (1 − μ)/r1 + μ/r2.
 *
 * @param {number} mu
 * @param {Array<number>} s
 * @returns {number}
 */
export function jacobi(mu, s) {
  const [x, y, z, vx, vy, vz] = s
  const r1 = Math.hypot(x + mu, y, z)
  const r2 = Math.hypot(x - 1 + mu, y, z)
  return (x * x) + (y * y) + (2 * (1 - mu) / r1) + (2 * mu / r2) - ((vx * vx) + (vy * vy) + (vz * vz))
}
