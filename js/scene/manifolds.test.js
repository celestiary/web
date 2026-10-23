import {describe, expect, it} from 'bun:test'
import {correctSymmetric, jacobi, propagate} from './cr3bp.js'
import {collinearDistances} from './lagrange.js'
import {
  DURATION, eigenDirections, manifoldSeeds, manifolds, monodromy, mulVec, stabilityIndex,
} from './manifolds.js'
import {familyMember, lyapunovGuess} from './periodicOrbits.js'


const EARTH_MOON = 0.012150585609624
const SUN_EARTH = 3.0404234e-6
const MOON_KM = 384400
const RADII = {primary: 6371 / MOON_KM, secondary: 1737.4 / MOON_KM}


/**
 * The linear saddle rate σ at a collinear point: the real root of the
 * linearised equations, √((c2 − 2 + √(9 c2² − 8 c2)) / 2).
 *
 * @returns {number}
 */
function saddleRate(mu, gamma) {
  const c2 = (mu + ((1 - mu) * (gamma ** 3) / ((1 - gamma) ** 3))) / (gamma ** 3)
  return Math.sqrt((c2 - 2 + Math.sqrt((9 * c2 * c2) - (8 * c2))) / 2)
}


/** @returns {number} the distance of a state's position from another's */
const apart = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])


describe('manifolds', () => {
  it('takes the monodromy back as its inverse', () => {
    const member = familyMember(EARTH_MOON, 'l1Halo')
    const m = monodromy(EARTH_MOON, member)
    const back = monodromy(EARTH_MOON, member, true)
    for (let c = 0; c < 6; c++) {
      const e = Array.from({length: 6}, (_, k) => (k === c ? 1 : 0))
      mulVec(m, mulVec(back, e)).forEach((x, k) => expect(x).toBeCloseTo(e[k], 5))
    }
  })

  it('finds the small Lyapunov orbit\'s unstable eigenvalue, exp(σT), at L1', () => {
    // The linear theory: the saddle's rate σ over the period 2π/λ (Szebehely;
    // Koon et al. 2.6).  The orbit is 0.5% of γ, so it's linear to 0.1%.
    const {l1} = collinearDistances(EARTH_MOON)
    const g = lyapunovGuess(EARTH_MOON, 1, 0.005)
    const m = correctSymmetric(EARTH_MOON, [g[0], 0, g[2]], 'x')
    const sigma = saddleRate(EARTH_MOON, l1)
    expect(sigma).toBeCloseTo(2.9321, 4)
    const {lambda, unstable, stable, monodromy: phi} = eigenDirections(EARTH_MOON, m)
    expect(Math.abs((lambda / Math.exp(sigma * m.period)) - 1)).toBeLessThan(1e-3)
    // Eigenvectors: M v = λ v, and M w = w / λ (the matrix is symplectic).
    mulVec(phi, unstable).forEach((x, k) => expect(x).toBeCloseTo(lambda * unstable[k], 6))
    const back = mulVec(phi, stable)
    for (let k = 0; k < 6; k++) {
      expect(back[k]).toBeCloseTo(stable[k] / lambda, 8)
    }
  })

  it('has λ and 1/λ as an eigenvalue pair of every unstable family', () => {
    for (const mu of [EARTH_MOON, SUN_EARTH]) {
      for (const family of ['l1Lyapunov', 'l2Lyapunov', 'l1Halo', 'l2Halo']) {
        const member = familyMember(mu, family)
        const {lambda, lambdaStable} = eigenDirections(mu, member)
        // Hundreds to thousands: these orbits are left within a period or two.
        expect(stabilityIndex(lambda)).toBeGreaterThan(300)
        expect(lambda * lambdaStable).toBeCloseTo(1, 4)
      }
    }
  })

  it('finds Gateway\'s 9:2 NRHO nearly stable', () => {
    // Zimovan-Spreen, Howell and Davis 2020: the 9:2 NRHO's stability index
    // is near 1, which is why it was chosen; the app draws it no manifolds.
    const {lambda} = eigenDirections(EARTH_MOON, familyMember(EARTH_MOON, 'nrho'))
    expect(stabilityIndex(lambda)).toBeGreaterThan(1)
    expect(stabilityIndex(lambda)).toBeLessThan(2)
  })

  it('leaves along the unstable direction and arrives along the stable one', () => {
    const member = familyMember(EARTH_MOON, 'l2Halo')
    const {lambda, points} = manifoldSeeds(EARTH_MOON, member, 6)
    // Between the integrator's error (about 1e-12 a step, grown up to
    // λ-fold) and the second order's (d² grown λ-fold), so a step that
    // should shrink to d/λ can be told from one that doesn't shrink.
    const d = 1e-6
    for (const p of points) {
      // A step along the unstable direction grows λ-fold in a period; one
      // along the stable direction shrinks, to the errors' floor (about
      // 200-fold here, where a neutral direction wouldn't shrink at all).
      const out = p.state.map((x, k) => x + (d * p.unstable[k]))
      const grown = propagate(EARTH_MOON, out, {t: member.period}).s
      expect(apart(grown, p.state) / d / Math.abs(lambda)).toBeCloseTo(1, 1)
      const inward = p.state.map((x, k) => x + (d * p.stable[k]))
      const shrunk = propagate(EARTH_MOON, inward, {t: member.period}).s
      expect(apart(shrunk, p.state) / d).toBeLessThan(5 / Math.abs(lambda))
    }
  })

  it('traces four branches, on the orbit\'s energy, the interior ones toward the primary', () => {
    const member = familyMember(EARTH_MOON, 'l1Lyapunov')
    const c = jacobi(EARTH_MOON, member.state)
    const {branches} = manifolds(EARTH_MOON, member, {n: 8, radii: RADII})
    expect(branches.map((b) => `${b.kind} ${b.side}`)).toEqual(['unstable interior', 'unstable exterior',
      'stable interior', 'stable exterior'])
    const {l1} = collinearDistances(EARTH_MOON)
    const xL1 = 1 - EARTH_MOON - l1
    for (const {kind, side, trajectories} of branches) {
      expect(trajectories.length).toBe(8)
      for (const {t, xyz, last} of trajectories) {
        // Forward for the unstable, back for the stable.
        expect(Math.sign(t[t.length - 1])).toBe(kind === 'unstable' ? 1 : -1)
        // Where it first gets half the point's distance from L1 (the orbit
        // is 0.2 of it): toward the Earth for the interior branch, into the
        // Moon's realm for the exterior.  Later, an exterior branch can
        // wind about the Moon and come back.
        let i = 0
        while (i < xyz.length && Math.abs(xyz[i] - EARTH_MOON - xL1) < 0.5 * l1) {
          i += 3
        }
        expect(i).toBeLessThan(xyz.length)
        expect(Math.sign(xyz[i] - EARTH_MOON - xL1)).toBe(side === 'interior' ? -1 : 1)
        // On the orbit's energy: the step off changes the Jacobi constant
        // by under 1e-6, and the integrator holds it.
        expect(Math.abs(jacobi(EARTH_MOON, last) - c)).toBeLessThan(1e-6)
      }
    }
  })

  it('stops a trajectory at a body', () => {
    // The L1 Lyapunov's exterior branches reach the Moon within the run.
    const member = familyMember(EARTH_MOON, 'l1Lyapunov')
    const {branches} = manifolds(EARTH_MOON, member, {n: 24, radii: RADII})
    const ends = branches.flatMap((b) => b.trajectories.map((t) => t.end))
    expect(ends).toContain('secondary')
    expect(DURATION).toBeGreaterThan(0.5)
  })
})
