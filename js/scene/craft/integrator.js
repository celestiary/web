// A craft's motion among the bodies the app draws (Craft.md; #11): the
// force model, the integrators, and the energy they keep.
//
// Units are SI: metres, seconds, m³/s².  A state is [x, y, z, vx, vy, vz]
// about the central body, in ecliptic axes of date (ephemeris.js); time is
// seconds from an epoch, a JDE (TT).
//
// Two kinds of integrator:
// - Adaptive Dormand-Prince 5(4) (dopri5), for transfers: its steps shrink
//   at a flyby and grow on the way out.  It drifts in energy, slowly, at
//   its tolerance.
// - Symplectic, fixed-step leapfrog (velocity Verlet, order 2) and Yoshida's
//   order-4 composition of it, as #17 discussed: for an orbit that goes
//   round and round, their energy error stays bounded over any time instead
//   of drifting, at the cost of a fixed step.

/** GM, m³/s² (DE440 and its constants; IERS 2010 for the Earth). */
export const GM = {
  sun: 1.32712440041279e20,
  mercury: 2.2031868551e13,
  venus: 3.24858592e14,
  earth: 3.986004418e14,
  moon: 4.902800118e12,
  mars: 4.282837362e13,
  jupiter: 1.26712764e17,
  saturn: 3.7940585e16,
  uranus: 5.794556e15,
  neptune: 6.836527e15,
}
/** The Earth's J2 and the equatorial radius it's referred to (EGM2008). */
export const EARTH_J2 = 1.0826267e-3
export const EARTH_RADIUS = 6378137
export const SECONDS_PER_DAY = 86400
/** The Sun's light pressure at 1 AU on a black surface, N/m² (1361 W/m² / c). */
export const SOLAR_PRESSURE = 4.54e-6
const AU = 149597870700

const DP = {
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
const SAFETY = 0.9
const MAX_GROWTH = 5
const MIN_SHRINK = 0.1
const MAX_STEPS = 2000000
// Yoshida's order-4 weights: w1, w0, w1, with w0 + 2 w1 = 1.
const CBRT2 = Math.cbrt(2)
const Y_W1 = 1 / (2 - CBRT2)
const Y_W0 = -CBRT2 / (2 - CBRT2)


/**
 * The acceleration on a craft: the central body (with its J2, if given),
 * and each perturbing body's pull less its pull on the central body (the
 * frame's acceleration: the indirect term).
 *
 * @param {object} model
 * @param {number} model.gm the central body's
 * @param {number} [model.j2] its oblateness, J2
 * @param {number} [model.radius] the radius J2 is referred to
 * @param {Array<number>} [model.pole] its pole, a unit vector in these axes
 * @param {Array<{gm: number, track: object}>} [model.perturbers] each with a
 *     track (ephemeris.js SampledTrack, or any {at(jde, out)}) about the
 *     central body
 * @param {?{areaToMass: number, cr: number, sun: object}} [model.srp] the
 *     Sun's light pressure on a sphere ("cannonball"): area over mass, m²/kg,
 *     the reflectivity coefficient (1 black, 2 a mirror) and the Sun's track
 *     about the central body; no shadow
 * @param {number} model.epoch the JDE at t = 0
 * @returns {function(number, Array<number>, Array<number>): Array<number>}
 *     the acceleration at t seconds and a position, m/s²
 */
export function newForceModel({gm, j2 = 0, radius = 0, pole = [0, 0, 1], perturbers = [], srp = null, epoch}) {
  const p = [0, 0, 0]
  const srpK = srp ? SOLAR_PRESSURE * srp.cr * srp.areaToMass * AU * AU : 0
  return (t, r, out = [0, 0, 0]) => {
    const [x, y, z] = r
    const r2 = (x * x) + (y * y) + (z * z)
    const rn = Math.sqrt(r2)
    const k = -gm / (r2 * rn)
    out[0] = k * x
    out[1] = k * y
    out[2] = k * z
    if (j2) {
      // The J2 term about the pole: zeta = r · pole / r.
      const s = ((x * pole[0]) + (y * pole[1]) + (z * pole[2])) / rn
      const f = 1.5 * j2 * gm * radius * radius / (r2 * r2)
      const radial = f * ((5 * s * s) - 1) / rn
      const axial = -2 * f * s
      out[0] += (radial * x) + (axial * pole[0])
      out[1] += (radial * y) + (axial * pole[1])
      out[2] += (radial * z) + (axial * pole[2])
    }
    const jde = epoch + (t / SECONDS_PER_DAY)
    for (const body of perturbers) {
      body.track.at(jde, p)
      const dx = p[0] - x
      const dy = p[1] - y
      const dz = p[2] - z
      const d2 = (dx * dx) + (dy * dy) + (dz * dz)
      const d3 = d2 * Math.sqrt(d2)
      const p2 = (p[0] * p[0]) + (p[1] * p[1]) + (p[2] * p[2])
      const p3 = p2 * Math.sqrt(p2)
      out[0] += body.gm * ((dx / d3) - (p[0] / p3))
      out[1] += body.gm * ((dy / d3) - (p[1] / p3))
      out[2] += body.gm * ((dz / d3) - (p[2] / p3))
    }
    if (srp) {
      // Away from the Sun, as the inverse square of the distance.
      srp.sun.at(jde, p)
      const dx = x - p[0]
      const dy = y - p[1]
      const dz = z - p[2]
      const d2 = (dx * dx) + (dy * dy) + (dz * dz)
      const k2 = srpK / (d2 * Math.sqrt(d2))
      out[0] += k2 * dx
      out[1] += k2 * dy
      out[2] += k2 * dz
    }
    return out
  }
}


/**
 * A state's rates from an acceleration.
 *
 * @param {function(number, Array<number>, Array<number>): Array<number>} accel
 * @returns {function(number, Float64Array, Float64Array): void}
 */
export function ratesOf(accel) {
  const a = [0, 0, 0]
  return (t, s, out) => {
    accel(t, s, a)
    out[0] = s[3]
    out[1] = s[4]
    out[2] = s[5]
    out[3] = a[0]
    out[4] = a[1]
    out[5] = a[2]
  }
}


/**
 * Integrate with adaptive Dormand-Prince 5(4), from t0 to t1 (either way),
 * or until `until` says.  The step is bounded by the error estimate per
 * component: rtol × |value| + atol, with atol per component (position and
 * velocity have different units).
 *
 * @param {function(number, Float64Array, Float64Array): void} rates
 * @param {Array<number>} y0
 * @param {number} t0
 * @param {number} t1
 * @param {object} [opts]
 * @param {number} [opts.rtol]
 * @param {Array<number>|number} [opts.atol]
 * @param {number} [opts.h] the first step's size
 * @param {number} [opts.hMax] the largest step
 * @param {function(number, Float64Array): void} [opts.onStep] each step's
 *     time and state, from the start's
 * @param {function(number, Float64Array): boolean} [opts.until] stop after
 *     the step for which this is true
 * @returns {{t: number, y: Float64Array, steps: number, evaluations: number}}
 */
export function dopri5(rates, y0, t0, t1, {rtol = 1e-11, atol = [1e-3, 1e-3, 1e-3, 1e-6, 1e-6, 1e-6],
  h = 10, hMax = Infinity, onStep, until} = {}) {
  const n = y0.length
  const tolA = typeof atol === 'number' ? new Array(n).fill(atol) : atol
  const dir = t1 >= t0 ? 1 : -1
  const k = Array.from({length: 7}, () => new Float64Array(n))
  const tmp = new Float64Array(n)
  const next = new Float64Array(n)
  let y = Float64Array.from(y0)
  let t = t0
  let step = Math.abs(h)
  let steps = 0
  let evaluations = 0
  onStep?.(t, y)
  rates(t, y, k[0])
  evaluations++
  for (let i = 0; i < MAX_STEPS && (t1 - t) * dir > 0; i++) {
    step = Math.min(step, Math.abs(t1 - t), hMax)
    const hs = dir * step
    // First same as last: k[0] is the rates at (t, y).
    for (let st = 1; st < 7; st++) {
      for (let j = 0; j < n; j++) {
        let sum = y[j]
        for (let m = 0; m < st; m++) {
          sum += hs * DP.a[st][m] * k[m][j]
        }
        tmp[j] = sum
      }
      rates(t + (DP.c[st] * hs), tmp, k[st])
    }
    evaluations += 6
    let err = 0
    for (let j = 0; j < n; j++) {
      let e = 0
      for (let st = 0; st < 7; st++) {
        e += DP.e[st] * k[st][j]
      }
      // Stage 6's input is the 5th-order solution.
      next[j] = tmp[j]
      const scale = tolA[j] + (rtol * Math.max(Math.abs(y[j]), Math.abs(next[j])))
      err = Math.max(err, Math.abs(hs * e) / scale)
    }
    if (err > 1) {
      step *= Math.max(MIN_SHRINK, SAFETY * (err ** -0.2))
      continue
    }
    t += hs
    y = Float64Array.from(next)
    k[0].set(k[6])
    steps++
    onStep?.(t, y)
    if (until?.(t, y)) {
      break
    }
    step *= Math.min(MAX_GROWTH, SAFETY * (Math.max(err, 1e-10) ** -0.2))
  }
  return {t, y, steps, evaluations}
}


/**
 * Integrate with a fixed-step symplectic integrator: leapfrog (velocity
 * Verlet, kick-drift-kick, order 2) or Yoshida's order-4 composition of
 * three leapfrogs.  The span is cut into the fewest equal steps no longer
 * than h.
 *
 * @param {function(number, Array<number>, Array<number>): Array<number>} accel
 * @param {Array<number>} y0
 * @param {number} t0
 * @param {number} t1
 * @param {number} h the step, seconds
 * @param {object} [opts]
 * @param {number} [opts.order] 2 or 4
 * @param {function(number, Float64Array): void} [opts.onStep]
 * @returns {{t: number, y: Float64Array, steps: number, evaluations: number}}
 */
export function symplectic(accel, y0, t0, t1, h, {order = 4, onStep} = {}) {
  const y = Float64Array.from(y0)
  const a = [0, 0, 0]
  const weights = order === 4 ? [Y_W1, Y_W0, Y_W1] : [1]
  // A whole number of equal steps, each ending on t0 + i × span exactly:
  // summed, the substeps' times drift by rounding, which far from t0 is
  // more than any tolerance on the end.
  const n = Math.max(1, Math.ceil((Math.abs(t1 - t0) / Math.abs(h)) - 1e-9))
  const span = (t1 - t0) / n
  let t = t0
  let evaluations = 0
  // The acceleration at the start of a leapfrog: its end's, from the last.
  accel(t, y, a)
  evaluations++
  onStep?.(t, y)
  for (let i = 1; i <= n; i++) {
    for (const w of weights) {
      const dt = w * span
      for (let j = 0; j < 3; j++) {
        y[3 + j] += 0.5 * dt * a[j]
        y[j] += dt * y[3 + j]
      }
      t += dt
      accel(t, y, a)
      evaluations++
      for (let j = 0; j < 3; j++) {
        y[3 + j] += 0.5 * dt * a[j]
      }
    }
    t = i === n ? t1 : t0 + (i * span)
    onStep?.(t, y)
  }
  return {t, y, steps: n, evaluations}
}


/**
 * The two-body specific orbital energy, v²/2 − GM/r.
 *
 * @param {number} gm
 * @param {Array<number>} s
 * @returns {number} J/kg
 */
export function orbitalEnergy(gm, s) {
  return (((s[3] * s[3]) + (s[4] * s[4]) + (s[5] * s[5])) / 2) - (gm / Math.hypot(s[0], s[1], s[2]))
}
