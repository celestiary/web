import {ASTRO_UNIT_METER, SUN_LIGHT_DECAY, SUN_LUMINOUS_INTENSITY} from '../shared.js'
import {easeExposure, exposureAt} from './exposure.js'


describe('exposureAt', () => {
  it('renders a surface facing the Sun at its albedo', () => {
    for (const d of [0.39, 1, 1.52, 5.2, 30].map((au) => au * ASTRO_UNIT_METER)) {
      const irradiance = SUN_LUMINOUS_INTENSITY / Math.pow(d, SUN_LIGHT_DECAY)
      const albedo = 0.25
      expect(irradiance * albedo / Math.PI * exposureAt(d)).toBeCloseTo(albedo, 10)
    }
  })

  it('grows with distance from the Sun', () => {
    expect(exposureAt(5.2 * ASTRO_UNIT_METER)).toBeGreaterThan(exposureAt(ASTRO_UNIT_METER))
  })
})


describe('easeExposure', () => {
  it('snaps to the goal on the first step', () => {
    expect(easeExposure(1, 8, Infinity)).toBe(8)
    expect(easeExposure(0, 8, 0.1)).toBe(8)
  })

  it('moves evenly in stops, ~63% of the way per time constant', () => {
    const e = easeExposure(1, 8, 0.5, 0.5)
    expect(Math.log2(e)).toBeCloseTo(3 * (1 - Math.exp(-1)), 10)
  })

  it('stays put with no time elapsed', () => {
    expect(easeExposure(2, 8, 0)).toBe(2)
  })
})
