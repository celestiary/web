import {describe, expect, it} from 'bun:test'
import {jacobi, propagate} from './cr3bp.js'
import {collinearDistances} from './lagrange.js'
import {
  ARENSTORF, FAMILIES, arenstorf, familyMember, familyOfCode, inertialSweep, lyapunovGuess, nrho92, placeAt,
  richardsonHalo, sampleMember,
  southern,
} from './periodicOrbits.js'
import {correctSymmetric} from './cr3bp.js'
import {PERIODIC_CODES} from '../permalink.js'
import jpl from '../../public/data/periodicOrbits.json'


const EARTH_MOON = 0.012150585609624
const MOON_KM = 384400
const MOON_DAYS = 27.321661
const DAYS = MOON_DAYS / (2 * Math.PI)
// Jupiter-Europa and Saturn-Enceladus: the same code at other pairs.
const OTHER_PAIRS = {europa: 2.528e-5, enceladus: 1.9e-7}


/**
 * @param {number} mu
 * @param {object} m a member
 * @returns {{close: number, rMin: number, rMax: number}} pair units, from
 *     the secondary
 */
function measure(mu, m) {
  let rMin = Infinity
  let rMax = 0
  const end = propagate(mu, m.state, {t: m.period, onStep: (t, s) => {
    const r = Math.hypot(s[0] - 1 + mu, s[1], s[2])
    rMin = Math.min(rMin, r)
    rMax = Math.max(rMax, r)
  }}).s
  return {close: Math.hypot(end[0] - m.state[0], end[1], end[2] - m.state[2]), rMin, rMax}
}


describe('periodic orbits', () => {
  it('has the link\'s codes', () => {
    expect(Object.values(FAMILIES).map((f) => f.code)).toEqual(PERIODIC_CODES)
    expect(familyOfCode('nrho')).toBe('nrho')
    expect(familyOfCode('l2h')).toBe('l2Halo')
    expect(familyOfCode('x')).toBeNull()
  })

  it('makes Gateway\'s 9:2 NRHO', () => {
    const m = nrho92(EARTH_MOON)
    // 2/9 of a synodic month.
    expect(m.period * DAYS).toBeCloseTo(2 * 29.530589 / 9, 6)
    const {close, rMin, rMax} = measure(EARTH_MOON, m)
    expect(close).toBeLessThan(1e-9)
    // Perilune 3,200-3,550 km and apolune about 70,000 km over the 15-year
    // Gateway ephemeris (NASA, Lee 2019); C 3.047 in the CR3BP (Davis et
    // al. 2022).
    expect(rMin * MOON_KM).toBeGreaterThan(3150)
    expect(rMin * MOON_KM).toBeLessThan(3550)
    expect(rMax * MOON_KM / 1000).toBeCloseTo(70, -1)
    expect(jacobi(EARTH_MOON, m.state)).toBeCloseTo(3.047, 3)
    // Southern: apolune under the plane.
    expect(m.state[2]).toBeLessThan(0)
  })

  it('has the small Lyapunov orbit\'s period, 2π/λ, at L1', () => {
    const {l1} = collinearDistances(EARTH_MOON)
    const g = lyapunovGuess(EARTH_MOON, 1, 0.005)
    const m = correctSymmetric(EARTH_MOON, [g[0], 0, g[2]], 'x')
    // The linear frequency λ at Earth-Moon L1 is 2.3344 (Szebehely).
    expect(m.period).toBeCloseTo(2 * Math.PI / 2.3344, 3)
    expect(Math.abs(m.state[0] - (1 - EARTH_MOON - l1)) / l1).toBeLessThan(0.01)
  })

  it('starts the halos close to where they close', () => {
    const {l1, l2} = collinearDistances(EARTH_MOON)
    for (const [point, gamma] of [[1, l1], [2, l2]]) {
      const g = richardsonHalo(EARTH_MOON, point, 0.1, -1)
      const m = correctSymmetric(EARTH_MOON, g, 'z')
      // Within 1% of the point's distance of Richardson's guess (160 km at
      // L1, 500 km at L2: the third order's error at the family's smallest
      // x amplitude, which it keeps however small z gets).
      expect(Math.abs(m.state[0] - g[0]) / gamma).toBeLessThan(0.01)
      // z0 is the one held.
      expect(m.state[2]).toBe(g[1])
    }
  })

  it('closes every family at the Earth-Moon pair and at others, by the same code', () => {
    for (const [mu, key] of [[EARTH_MOON, 'moon'], ...Object.entries(OTHER_PAIRS).map(([k, v]) => [v, k])]) {
      for (const [family, f] of Object.entries(FAMILIES)) {
        if (f.only && f.only !== key) {
          continue
        }
        const m = familyMember(mu, family)
        expect(m).not.toBeNull()
        const {close, rMin} = measure(mu, m)
        expect(close).toBeLessThan(1e-8)
        // Never through the secondary: at least a tenth of its Hill radius
        // (the NRHO, by design, comes to 3,225 km: tested above).
        if (family !== 'nrho' && family !== 'arenstorf') {
          expect(rMin).toBeGreaterThan(0.1 * Math.cbrt(mu / 3))
        }
      }
    }
  })

  it('closes Arenstorf\'s orbit as published, and continues it to the Earth-Moon pair', () => {
    // In his mass ratio, the symmetric correction from his start gives his
    // period (Hairer, Nørsett and Wanner's 17.0652165601579625) to 1e-9,
    // and one period integrated returns to the start to 1e-9.
    const m0 = correctSymmetric(ARENSTORF.mu, [ARENSTORF.x0, 0, ARENSTORF.vy0], 'x', 0.45 * ARENSTORF.period)
    expect(Math.abs(m0.period - ARENSTORF.period)).toBeLessThan(1e-9)
    expect(Math.abs(m0.state[4] - ARENSTORF.vy0)).toBeLessThan(1e-9)
    const {s} = propagate(ARENSTORF.mu, [ARENSTORF.x0, 0, 0, 0, ARENSTORF.vy0, 0], {t: ARENSTORF.period})
    expect(Math.hypot(s[0] - ARENSTORF.x0, s[1])).toBeLessThan(1e-9)
    // At the Earth-Moon pair: a cycler, 74 days round, from 676 km over the
    // Moon to a loop round the Earth 178,000 km out and back.
    const m = arenstorf(EARTH_MOON)
    expect(m.period * DAYS).toBeCloseTo(74.2, 1)
    let rE = Infinity
    let rM = Infinity
    propagate(EARTH_MOON, m.state, {t: m.period, onStep: (t, y) => {
      rE = Math.min(rE, Math.hypot(y[0] + EARTH_MOON, y[1]))
      rM = Math.min(rM, Math.hypot(y[0] - 1 + EARTH_MOON, y[1]))
    }})
    expect((rM * MOON_KM) - 1737.4).toBeGreaterThan(600)
    expect((rM * MOON_KM) - 1737.4).toBeLessThan(800)
    expect(rE * MOON_KM / 1000).toBeCloseTo(178, -1)
  })

  it('runs a DRO retrograde about the secondary', () => {
    const m = familyMember(EARTH_MOON, 'dro')
    const [x, , , , vy] = m.state
    expect(x).toBeGreaterThan(1 - EARTH_MOON)
    // Clockwise seen from the pole, in the turning frame.
    expect((x - 1 + EARTH_MOON) * vy).toBeLessThan(0)
  })

  it('samples an orbit, and sweeps it out in space', () => {
    const m = familyMember(EARTH_MOON, 'l2Halo')
    const samples = sampleMember(EARTH_MOON, m)
    // Primary-centred, closed.
    expect(samples.xyz[0]).toBeCloseTo(m.state[0] + EARTH_MOON, 6)
    expect(samples.t[samples.t.length - 1]).toBe(m.period)
    const p = placeAt(samples, m.period * 3.25)
    const q = placeAt(samples, m.period * 0.25)
    expect(Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])).toBeLessThan(1e-9)
    // The sweep starts where the body is now, and a quarter turn on it is
    // where the body will be, turned a quarter on.
    const now = 1.234
    const sweep = inertialSweep(samples, now, 5, undefined, 2 * Math.PI)
    const here = placeAt(samples, now)
    // (Float32: to 1e-6.)
    expect(sweep[0]).toBeCloseTo(here[0], 6)
    expect(sweep[1]).toBeCloseTo(here[1], 6)
    const later = placeAt(samples, now + (Math.PI / 2))
    expect(sweep[3]).toBeCloseTo(-later[1], 6)
    expect(sweep[4]).toBeCloseTo(later[0], 6)
  })
})


describe('periodic orbits against JPL\'s catalogue', () => {
  // public/data/periodicOrbits.json: the catalogue's member matching each
  // of the app's, by tools/periodic/fetchJpl.mjs, in each system's own mass
  // ratio and units.
  const EDGES = ['phobos l1Halo']
  const matched = Object.entries(jpl.systems).flatMap(([secondary, system]) =>
    Object.entries(system.families).map(([family, m]) => ({secondary, system, family, m})))

  it('has every system\'s families but one: Enceladus\'s DRO is past the catalogue\'s', () => {
    expect(Object.keys(jpl.systems)).toEqual(['moon', 'earth', 'mars', 'phobos', 'europa', 'enceladus', 'titan'])
    expect(matched).toHaveLength(35)
    expect(Object.keys(jpl.systems.enceladus.unmatched)).toEqual(['dro'])
    // And where the catalogue's family stops short of the app's member, its
    // last.
    expect(matched.filter(({m}) => m.edge).map(({secondary, family}) => `${secondary} ${family}`))
        .toEqual(EDGES)
  })

  it('closes the catalogue\'s orbits with this integrator', () => {
    for (const {system, m} of matched) {
      const end = propagate(system.mu, m.state, {t: m.period}).s
      expect(Math.hypot(...m.state.slice(0, 3).map((v, k) => end[k] - v))).toBeLessThan(1e-8)
      expect(jacobi(system.mu, m.state)).toBeCloseTo(m.jacobi, 9)
    }
  })

  it('makes the same orbits: period within 0.2%, C within 1e-4, crossing within 1.5% of γ', () => {
    // Or within twice the catalogue's own spacing there, where its members
    // are further apart than that (Phobos's, a km apart where γ is 17 km).
    for (const {system, family, m} of matched) {
      const mu = system.mu
      const ours = familyMember(mu, family)
      expect(Math.abs((ours.period / m.period) - 1)).toBeLessThan(0.002)
      expect(Math.abs(jacobi(mu, ours.state) - m.jacobi)).toBeLessThan(1e-4)
      // The catalogue's state is at one of the orbit's two crossings of the
      // xz plane; ours at one of its own.  Halos as their southern twin.
      const theirs = FAMILIES[family].halo ? southern(mu, m) : m
      const crossings = (st) => [st, propagate(mu, st, {toCrossing: true}).s]
      const ourX = crossings(ours.state)
      const near = Math.min(...crossings(theirs.state).flatMap((a) => ourX.map((b) => Math.hypot(a[0] - b[0], a[2] - b[2]))))
      // At the end of the catalogue's family, its nearest: within 10% of γ.
      const gamma = collinearDistances(mu).l1
      expect(near).toBeLessThan(m.edge ? 0.1 * gamma : Math.max(0.015 * gamma, 2 * m.spacing))
    }
  })

  it('takes the catalogue\'s southern halos as southern, but for Titan\'s L1', () => {
    const north = matched.filter(({system, family, m}) => FAMILIES[family].halo &&
      southern(system.mu, m).state[2] !== m.state[2]).map(({secondary, family}) => `${secondary} ${family}`)
    expect(north).toEqual(['titan l1Halo'])
  })

  it('has Gateway\'s 9:2 NRHO: its period 2/9 of a synodic month in units of the pair\'s turn', () => {
    const {mu, families: {nrho}} = jpl.systems.moon
    const ours = nrho92(mu)
    expect(nrho.period / ours.period).toBeCloseTo(1, 3)
    expect(nrho.jacobi).toBeCloseTo(3.0467, 4)
  })
})

