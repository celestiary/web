import {propagate, withStm} from './cr3bp.js'
import {collinearDistances} from './lagrange.js'


// The invariant manifolds of a periodic orbit about L1 or L2 (Lagrange.md,
// manifolds; #272's scope 5): the tubes of trajectories that wind onto the
// orbit (stable) or off it (unstable).  The orbit's monodromy matrix, its
// state-transition matrix over one period, has a real eigenvalue pair λ,
// 1/λ: |λ| > 1 the unstable direction, 1/λ the stable one.  Carried along
// the orbit by the state-transition matrix, each direction gives the
// manifold's first step from every point on it; a small step that way,
// integrated forward (unstable) or back (stable), traces the tube (Koon, Lo,
// Marsden and Ross, "Dynamical Systems, the Three-Body Problem and Space
// Mission Design", ch. 4 and 6; Gómez et al. 2001).
//
// The same CR3BP units and frame as cr3bp.js: the pair's separation, its
// mean motion and its total mass, barycentric and turning with the pair.

const POWER_ITERATIONS = 60
// The step off the orbit, as a share of the secondary's L1 distance γ:
// small enough that the tube starts on the linear direction, large enough
// that it leaves within a few periods (Earth-Moon: 0.0005 γ, about 30 km;
// Koon et al. use 200 km on 384,400).
export const STEP_OFF = 5e-4
// How long each trajectory runs, in the pair's turns (2π each): long enough
// for the tubes to reach across the secondary's realm and into the
// primary's, short enough that they still read as tubes.
export const DURATION = 0.75
// The integrator's bound for the tubes: they're drawn, not closed.
const TUBE_TOLERANCE = 1e-10


/**
 * The monodromy matrix: the state-transition matrix over one period, or
 * with `back` over one period back, its inverse.  Integrated back rather
 * than inverted: the matrix's condition is λ², a million and more, and an
 * inverse by elimination loses the stable direction (at Sun-Earth, all of
 * it).
 *
 * @param {number} mu
 * @param {{state: Array<number>, period: number}} member
 * @param {boolean} [back]
 * @returns {Float64Array} 36, row-major
 */
export function monodromy(mu, {state, period}, back = false) {
  const {s} = propagate(mu, withStm(state), {t: back ? -period : period})
  return s.slice(6, 42)
}


/**
 * @param {Float64Array|Array<number>} m 36, row-major
 * @param {Array<number>} v 6
 * @returns {Array<number>} m v
 */
export function mulVec(m, v) {
  const out = new Array(6).fill(0)
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 6; c++) {
      out[r] += m[(6 * r) + c] * v[c]
    }
  }
  return out
}


/**
 * The dominant eigenvalue and its eigenvector, by power iteration.  The
 * monodromy matrix's unstable eigenvalue is far larger than the rest (a
 * thousand or more about the collinear points), so it converges in a few
 * steps; the eigenvector is normalised and its sign chosen so its first
 * position component that isn't near zero is positive.
 *
 * @param {Float64Array|Array<number>} m 36, row-major
 * @returns {{lambda: number, v: Array<number>}}
 */
export function dominantEigen(m) {
  let v = [1, 0.5, 0.25, 0.125, 0.0625, 0.03125]
  let lambda = 0
  for (let i = 0; i < POWER_ITERATIONS; i++) {
    const w = mulVec(m, v)
    const n = Math.hypot(...w)
    // The sign of λ: whether m v keeps v's direction.
    let dot = 0
    for (let k = 0; k < 6; k++) {
      dot += w[k] * v[k]
    }
    const sign = Math.sign(dot) || 1
    lambda = sign * n
    v = w.map((x) => x / n * sign)
  }
  const lead = v.slice(0, 3).find((x) => Math.abs(x) > 1e-6) ?? 1
  return {lambda, v: lead < 0 ? v.map((x) => -x) : v}
}


/**
 * The orbit's unstable and stable directions at its start.
 *
 * @param {number} mu
 * @param {{state: Array<number>, period: number}} member
 * @returns {{lambda: number, lambdaStable: number, unstable: Array<number>,
 *     stable: Array<number>, monodromy: Float64Array}} λ the unstable
 *     eigenvalue, and the stable one, 1/λ (the matrix is symplectic)
 */
export function eigenDirections(mu, member) {
  const m = monodromy(mu, member)
  const u = dominantEigen(m)
  const s = dominantEigen(monodromy(mu, member, true))
  return {lambda: u.lambda, lambdaStable: 1 / s.lambda, unstable: u.v, stable: s.v, monodromy: m}
}


/**
 * The stability index ν = (|λ| + 1/|λ|) / 2: 1 for a neutrally stable
 * orbit, large for one that's left fast (Howell 1984).
 *
 * @param {number} lambda
 * @returns {number}
 */
export function stabilityIndex(lambda) {
  return (Math.abs(lambda) + (1 / Math.abs(lambda))) / 2
}


/**
 * Where a manifold's trajectories start: n points spread evenly in time
 * over one period, each with the unstable and stable directions carried
 * there by the state-transition matrix (Φ(t) v), scaled to a unit step in
 * position.  Each is carried the way it grows, so it stays clean: the
 * unstable one forward from the start, the stable one back from a period
 * on (the same orbit).  Carried the other way, a direction shrinks while
 * the integrator's error along the other grows, as e^(2σt).
 *
 * @param {number} mu
 * @param {{state: Array<number>, period: number}} member
 * @param {number} n
 * @returns {{lambda: number, points: Array<{t: number, state: Array<number>,
 *     unstable: Array<number>, stable: Array<number>}>}}
 */
export function manifoldSeeds(mu, member, n) {
  const {lambda, unstable, stable} = eigenDirections(mu, member)
  const unit = (v) => {
    const r = Math.hypot(v[0], v[1], v[2])
    return v.map((x) => x / r)
  }
  const dt = member.period / n
  const carried = (v, sign) => {
    const out = []
    let s = withStm(member.state)
    for (let i = 0; i < n; i++) {
      out.push({state: Array.from(s.slice(0, 6)), v: unit(mulVec(s.slice(6, 42), v))})
      s = propagate(mu, s, {t: sign * dt}).s
    }
    return out
  }
  const ahead = carried(unstable, 1)
  // Back from the start, point i is the orbit at phase (n − i) dt.
  const behind = carried(stable, -1)
  const points = ahead.map((p, i) => ({t: i * dt, state: p.state, unstable: p.v,
    stable: behind[(n - i) % n].v}))
  return {lambda, points}
}


/**
 * A pair's bodies, for the tubes to stop at: their radii in units of the
 * separation (0 for points).
 *
 * @typedef {{primary: number, secondary: number}} Radii
 */


/**
 * The four branches of an orbit's manifolds, each n trajectories: the
 * unstable ones integrated forward from the orbit, the stable ones back.
 * `interior` is the branch that leaves toward the primary, `exterior` away
 * from it.  A trajectory stops where it meets a body or after `duration`.
 *
 * @param {number} mu
 * @param {{state: Array<number>, period: number}} member
 * @param {object} [opts]
 * @param {number} [opts.n] trajectories per branch
 * @param {number} [opts.step] the step off the orbit, CR3BP units; STEP_OFF
 *     of the secondary's L1 distance by default
 * @param {number} [opts.duration] how long each runs, CR3BP time
 * @param {Radii} [opts.radii]
 * @returns {{lambda: number, branches: Array<{kind: string, side: string,
 *     trajectories: Array<object>}>}} each trajectory trajectory()'s
 *     each trajectory sampled at the integrator's steps, primary-centred
 *     (x + μ) as periodicOrbits.js sampleMember's; `end` 'time', 'primary'
 *     or 'secondary'
 */
export function manifolds(mu, member, {n = 24, step = STEP_OFF * collinearDistances(mu).l1,
  duration = DURATION * 2 * Math.PI, radii = {primary: 0, secondary: 0}} = {}) {
  const {lambda, points} = manifoldSeeds(mu, member, n)
  const branches = []
  for (const kind of ['unstable', 'stable']) {
    for (const side of ['interior', 'exterior']) {
      const trajectories = points.map((p) => {
        const dir = p[kind]
        // Interior: the step's x toward the primary (−x).
        const sign = (side === 'interior') === (dir[0] < 0) ? 1 : -1
        const s0 = p.state.map((x, k) => x + (sign * step * dir[k]))
        return trajectory(mu, s0, kind === 'unstable' ? duration : -duration, radii)
      })
      branches.push({kind, side, trajectories})
    }
  }
  return {lambda, branches}
}


/**
 * One trajectory, sampled at the integrator's steps.
 *
 * @param {number} mu
 * @param {Array<number>} s0
 * @param {number} t how long, either sign
 * @param {Radii} radii
 * @returns {{t: Float64Array, xyz: Float32Array, end: string, last: Float64Array}}
 *     `last` the state where it stopped
 */
export function trajectory(mu, s0, t, radii) {
  const times = []
  const xyz = []
  let end = 'time'
  const {s: last} = propagate(mu, s0, {t, tol: TUBE_TOLERANCE,
    onStep: (time, s) => {
      times.push(time)
      xyz.push(s[0] + mu, s[1], s[2])
    },
    until: (time, s) => {
      if (Math.hypot(s[0] + mu, s[1], s[2]) < radii.primary) {
        end = 'primary'
      } else if (Math.hypot(s[0] - 1 + mu, s[1], s[2]) < radii.secondary) {
        end = 'secondary'
      }
      return end !== 'time'
    }})
  return {t: Float64Array.from(times), xyz: Float32Array.from(xyz), end, last}
}
