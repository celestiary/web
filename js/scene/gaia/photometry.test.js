import {describe, expect, it} from 'bun:test'
import {
  DEFAULT_BP_RP,
  calibrateColourTemperature,
  gMinusV,
  nonIncreasing,
  teffFromBpRp,
  vFromG,
} from './photometry.js'


describe('photometry', () => {
  it('converts G to V by Riello et al. 2021', () => {
    expect(gMinusV(0)).toBeCloseTo(-0.02704, 10)
    expect(gMinusV(1)).toBeCloseTo(-0.02704 + 0.01424 - 0.2156 + 0.01426, 10)
    // A solar-type star is about 0.15 brighter in G; a red one much more.
    expect(gMinusV(0.82)).toBeCloseTo(-0.153, 2)
    expect(gMinusV(3)).toBeLessThan(-1)
    // Held at the fitted range's ends, and the Sun's colour for none.
    expect(gMinusV(9)).toBe(gMinusV(5))
    expect(gMinusV(-2)).toBe(gMinusV(-0.5))
    expect(gMinusV(null)).toBe(gMinusV(DEFAULT_BP_RP))
    expect(vFromG(10, 0)).toBeCloseTo(10.02704, 10)
  })

  it('holds a sequence non-increasing, weighted', () => {
    expect(nonIncreasing([5, 4, 6, 2], [1, 1, 1, 1])).toEqual([5, 5, 5, 2])
    expect(nonIncreasing([3, 4], [3, 1])).toEqual([3.25, 3.25])
    expect(nonIncreasing([9, 8, 7], [1, 1, 1])).toEqual([9, 8, 7])
  })

  it('calibrates colour against temperature from matched pairs', () => {
    // Synthetic pairs from a made-up monotone law with scatter, not a
    // real relation: the calibration should recover the law.
    const law = (x) => 9000 / (1 + x)
    const pairs = []
    let seed = 1
    const r = () => {
      seed = (seed * 16807) % 2147483647
      return seed / 2147483647
    }
    for (let i = 0; i < 20000; i++) {
      const x = -0.3 + (r() * 3.3)
      pairs.push({bpRp: x, teff: law(x) * (1 + (0.06 * (r() - 0.5)))})
    }
    pairs.push({bpRp: NaN, teff: 5000}, {bpRp: 1, teff: 0})
    const table = calibrateColourTemperature(pairs, {binWidth: 0.05, minPerBin: 25})
    for (let i = 1; i < table.teff.length; i++) {
      expect(table.teff[i]).toBeLessThanOrEqual(table.teff[i - 1])
      expect(table.bpRp[i]).toBeGreaterThan(table.bpRp[i - 1])
    }
    for (const x of [0, 0.5, 0.82, 1.5, 2.5]) {
      expect(Math.abs((teffFromBpRp(table, x) / law(x)) - 1)).toBeLessThan(0.01)
    }
    // Held at the ends, 0 for no colour.
    expect(teffFromBpRp(table, -3)).toBe(table.teff[0])
    expect(teffFromBpRp(table, 9)).toBe(table.teff[table.teff.length - 1])
    expect(teffFromBpRp(table, null)).toBe(0)
  })

  it('merges thin bins until each has enough stars', () => {
    const pairs = [{bpRp: 0, teff: 10000}, {bpRp: 0.01, teff: 9000}, {bpRp: 2, teff: 3000}]
    const table = calibrateColourTemperature(pairs, {minPerBin: 2})
    expect(table.n.reduce((a, b) => a + b, 0)).toBe(3)
    expect(table.n.every((n) => n >= 2)).toBe(true)
    expect(() => calibrateColourTemperature([])).toThrow()
  })
})
