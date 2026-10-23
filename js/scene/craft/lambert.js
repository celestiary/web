// Lambert's problem (Craft.md): the two-body arc from one place to another
// in a given time, by universal variables (Bate, Mueller and White ch. 5;
// Curtis, "Orbital Mechanics for Engineering Students", algorithm 5.2).
// The first guess for the transfers (transfer.js) and the cyclers.

const MAX_ITERATIONS = 200
const TOLERANCE = 1e-10


/**
 * Stumpff's C(z) and S(z).
 *
 * @param {number} z
 * @returns {Array<number>} [C, S]
 */
export function stumpff(z) {
  if (z > 1e-8) {
    const s = Math.sqrt(z)
    return [(1 - Math.cos(s)) / z, (s - Math.sin(s)) / (s * s * s)]
  }
  if (z < -1e-8) {
    const s = Math.sqrt(-z)
    return [(Math.cosh(s) - 1) / -z, (Math.sinh(s) - s) / (s * s * s)]
  }
  // The series about 0.
  return [(1 / 2) - (z / 24) + (z * z / 720), (1 / 6) - (z / 120) + (z * z / 5040)]
}


/**
 * The velocities at both ends of the arc from r1 to r2 taking tof, the
 * short way round (under 180°) or the long way, as the motion's sense asks.
 *
 * @param {Array<number>} r1 metres
 * @param {Array<number>} r2
 * @param {number} tof seconds
 * @param {number} gm
 * @param {Array<number>} [pole] the sense of motion: the arc goes round this
 *     way (the right hand about it); the ecliptic's north by default
 * @returns {?{v1: Array<number>, v2: Array<number>}} null where it
 *     doesn't converge
 */
export function lambert(r1, r2, tof, gm, pole = [0, 0, 1]) {
  const n1 = Math.hypot(...r1)
  const n2 = Math.hypot(...r2)
  const c = [(r1[1] * r2[2]) - (r1[2] * r2[1]), (r1[2] * r2[0]) - (r1[0] * r2[2]), (r1[0] * r2[1]) - (r1[1] * r2[0])]
  const cosDth = ((r1[0] * r2[0]) + (r1[1] * r2[1]) + (r1[2] * r2[2])) / (n1 * n2)
  let dth = Math.acos(Math.max(-1, Math.min(1, cosDth)))
  if ((c[0] * pole[0]) + (c[1] * pole[1]) + (c[2] * pole[2]) < 0) {
    dth = (2 * Math.PI) - dth
  }
  const aa = Math.sin(dth) * Math.sqrt(n1 * n2 / (1 - Math.cos(dth)))
  const y = (z) => {
    const [C, S] = stumpff(z)
    return n1 + n2 + (aa * ((z * S) - 1) / Math.sqrt(C))
  }
  const tofError = (z) => {
    const [C, S] = stumpff(z)
    const yz = y(z)
    return ((((yz / C) ** 1.5) * S) + (aa * Math.sqrt(yz))) - (Math.sqrt(gm) * tof)
  }
  // Bracket a root: z from where y > 0 up, then bisect (robust where
  // Newton's method on the time can leave y's domain).
  let lo = -4 * Math.PI * Math.PI
  while (y(lo) < 0) {
    lo += 0.1
  }
  let hi = 4 * Math.PI * Math.PI
  if (tofError(lo) > 0 || tofError(hi) < 0) {
    return null
  }
  let z = 0
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    z = (lo + hi) / 2
    const f = tofError(z)
    if (Math.abs(f) < TOLERANCE * Math.sqrt(gm) * tof) {
      break
    }
    if (f < 0) {
      lo = z
    } else {
      hi = z
    }
  }
  const yz = y(z)
  const f = 1 - (yz / n1)
  const g = aa * Math.sqrt(yz / gm)
  const gdot = 1 - (yz / n2)
  const v1 = r1.map((x, k) => (r2[k] - (f * x)) / g)
  const v2 = r2.map((x, k) => ((gdot * x) - r1[k]) / g)
  return {v1, v2}
}
