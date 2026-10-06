import {describe, expect, it} from 'bun:test'
import {SPOT_BIAS_BASE, SPOT_BIAS_RANGE, seedUniforms, starSeed} from './starSeed.js'


describe('starSeed', () => {
  it('is the Hipparcos id where there is one, 0 for the Sun by any name', () => {
    expect(starSeed({hipId: 32349, name: 'Sirius'})).toBe(32349)
    expect(starSeed({hipId: 0, name: 'Sol'})).toBe(0)
    expect(starSeed({name: 'sun'})).toBe(0)
    expect(starSeed({name: 'Sol'})).toBe(0)
    expect(starSeed({})).toBe(0)
  })


  it('hashes the name where there is no id, apart from any id', () => {
    const a = starSeed({name: 'Kepler-452'})
    expect(a).toBe(starSeed({name: 'Kepler-452'}))
    expect(a).toBe(starSeed({name: ' kepler-452 '}))
    expect(a).not.toBe(starSeed({name: 'Kepler-186'}))
    expect(a).toBeGreaterThan(118322)
  })
})


describe('seedUniforms', () => {
  it('leaves the Sun as it was', () => {
    expect(seedUniforms(0)).toEqual({offset: [0, 0, 0], spotBias: SPOT_BIAS_BASE})
  })


  it('is deterministic', () => {
    expect(seedUniforms(91262)).toEqual(seedUniforms(91262))
  })


  it('differs between stars, and stays in range', () => {
    const seen = new Set()
    for (const hip of [8102, 32349, 91262, 11767, 21421, 24436, 27989, 30438, 37279, 49669]) {
      const {offset, spotBias} = seedUniforms(hip)
      seen.add(offset.join(','))
      offset.forEach((o) => {
        expect(o).toBeGreaterThanOrEqual(0)
        expect(o).toBeLessThan(1e3)
      })
      expect(Math.abs(spotBias - SPOT_BIAS_BASE)).toBeLessThanOrEqual(SPOT_BIAS_RANGE)
    }
    expect(seen.size).toBe(10)
    // Neighbouring ids aren't neighbouring patterns.
    const a = seedUniforms(1000).offset
    const b = seedUniforms(1001).offset
    expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeGreaterThan(10)
  })
})
