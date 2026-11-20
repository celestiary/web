import {describe, expect, it} from 'bun:test'
import {SUN_TEFF} from '../stellar.js'
import {flareContrast} from './emission.js'
import {
  CME_SCALE_MAX,
  REGIME_DEGENERATE,
  REGIME_RADIATIVE,
  REGIME_SOLAR,
  REGIME_WIND,
  SATURATED_RX,
  SUN_ROSSBY,
  SUN_ROTATION_DAYS,
  SUN_RX,
  activityLifetimeGyr,
  activityRegime,
  stellarActivity,
  turnoverDays,
  xrayFraction,
} from './stellarActivity.js'


const SUN = {teff: SUN_TEFF, logg: 4.44, mass: 1, radius: 1, rotationDays: SUN_ROTATION_DAYS}


describe('stellarActivity', () => {
  it('has the Sun as its reference: every scale is 1', () => {
    const sun = stellarActivity(SUN)
    expect(sun.has).toBe(true)
    expect(sun.regime).toBe(REGIME_SOLAR)
    expect(sun.lxRelSun).toBeCloseTo(1, 12)
    expect(sun.flareScale).toBeCloseTo(1, 12)
    expect(sun.cmeScale).toBeCloseTo(1, 12)
    expect(sun.coronaScale).toBeCloseTo(1, 12)
  })

  it('gives the Sun its Rossby number and X-ray share (Wright et al. 2011: log L_X/L_bol = −6.24)', () => {
    expect(turnoverDays(1)).toBeCloseTo(14.45, 1)
    expect(SUN_ROSSBY).toBeGreaterThan(1.7)
    expect(SUN_ROSSBY).toBeLessThan(1.8)
    expect(Math.log10(SUN_RX)).toBeGreaterThan(-6.4)
    expect(Math.log10(SUN_RX)).toBeLessThan(-6.0)
  })

  it('saturates at 10^−3.13 under a Rossby number of 0.13, and falls as Ro^−2.7 above', () => {
    expect(xrayFraction(0.01)).toBeCloseTo(SATURATED_RX, 12)
    expect(xrayFraction(0.13)).toBeCloseTo(SATURATED_RX, 12)
    expect(xrayFraction(1.3) / xrayFraction(0.13)).toBeCloseTo(10 ** -2.7, 6)
  })

  it('finds the kind of activity by class', () => {
    // G2 V, K2 V, M5 V: convective envelopes.
    expect(activityRegime(5772, 4.44)).toBe(REGIME_SOLAR)
    expect(activityRegime(5000, 4.6)).toBe(REGIME_SOLAR)
    expect(activityRegime(3000, 5.0)).toBe(REGIME_SOLAR)
    // A0 V and B: radiative envelopes.
    expect(activityRegime(9800, 4.3)).toBe(REGIME_RADIATIVE)
    expect(activityRegime(20000, 4.0)).toBe(REGIME_RADIATIVE)
    // G8 III (4,900 K) is on the corona's side of the dividing line, K5 III
    // and an M supergiant past it.
    expect(activityRegime(4900, 2.6)).toBe(REGIME_SOLAR)
    expect(activityRegime(3950, 1.6)).toBe(REGIME_WIND)
    expect(activityRegime(3600, 0)).toBe(REGIME_WIND)
    expect(activityRegime(12000, 8)).toBe(REGIME_DEGENERATE)
    for (const [teff, logg] of [[9800, 4.3], [3600, 0], [12000, 8]]) {
      const star = stellarActivity({teff, logg, mass: 2, radius: 2})
      expect(star.has).toBe(false)
      expect(star.flareScale).toBe(0)
      expect(star.cmeScale).toBe(0)
    }
  })

  it('makes a young Sun more active and an old one less', () => {
    const at = (ageGyr) => stellarActivity({...SUN, rotationDays: undefined, ageGyr})
    expect(at(4.57).lxRelSun).toBeCloseTo(1, 6)
    // Ro ∝ t^0.566 and L_X ∝ Ro^−2.7: t^−1.53.
    expect(at(1).lxRelSun).toBeCloseTo(4.57 ** (0.566 * 2.7), 6)
    expect(at(1).flareScale).toBeGreaterThan(8)
    expect(at(9).flareScale).toBeLessThan(0.5)
  })

  it('keeps a red dwarf saturated for its activity lifetime', () => {
    expect(activityLifetimeGyr(0.6)).toBeCloseTo(0.8, 6)
    expect(activityLifetimeGyr(0.16)).toBeCloseTo(7, 6)
    expect(activityLifetimeGyr(0.05)).toBe(8)
    const dwarf = {teff: 3100, logg: 5.0, mass: 0.16, radius: 0.2}
    const young = stellarActivity({...dwarf, ageGyr: 2})
    const old = stellarActivity({...dwarf, ageGyr: 9.5})
    expect(young.rx).toBeCloseTo(SATURATED_RX, 12)
    expect(old.rx).toBeLessThan(young.rx / 100)
    // Its CMEs are held at the cap; its flares aren't.
    expect(young.flareScale).toBeGreaterThan(3)
    expect(young.cmeScale).toBeLessThanOrEqual(CME_SCALE_MAX)
  })

  it('draws the age from the seed where none is known', () => {
    const a = stellarActivity({...SUN, rotationDays: undefined, seed: 0})
    const b = stellarActivity({...SUN, rotationDays: undefined, seed: 1})
    expect(a.ageGyr).toBe(1)
    expect(b.ageGyr).toBe(10)
    expect(a.flareScale).toBeGreaterThan(b.flareScale)
  })

  it('tapers the corona away toward the radiative stars', () => {
    const f = (teff) => stellarActivity({teff, logg: 4.3, mass: 1.3, radius: 1.3, ageGyr: 2}).rx
    expect(f(6900)).toBeLessThan(f(6200) * 0.2)
    expect(f(6900)).toBeGreaterThan(0)
  })
})


describe('a white-light flare against another photosphere', () => {
  it('is the Sun\'s own against the Sun', () => {
    expect(flareContrast(5e-5, SUN_TEFF)).toBeCloseTo(flareContrast(5e-5), 12)
    expect(flareContrast(5e-5)).toBeCloseTo(0.072, 2)
  })

  it('stands out sixty times more on a red dwarf at 3,000 K', () => {
    const ratio = flareContrast(5e-5, 3000) / flareContrast(5e-5)
    expect(ratio).toBeGreaterThan(40)
    expect(ratio).toBeLessThan(100)
    expect(flareContrast(5e-5, 6500)).toBeLessThan(flareContrast(5e-5))
  })
})
