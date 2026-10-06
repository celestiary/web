import {describe, expect, it} from 'bun:test'
import {noiseTime} from './Star.js'


describe('the Sun\'s surface noise time', () => {
  it('is finite for any simulated time, before the start as after it', () => {
    // A permalink with a past t= puts the simulated time before the app
    // started: log(1 + negative) was NaN from 21 minutes back.
    for (const ms of [0, 1e3, -1e3, -1.3e6, -1e9, -1e13, 1e13, Infinity, -Infinity, NaN]) {
      expect(Number.isFinite(noiseTime(ms))).toBe(true)
    }
    expect(noiseTime(0)).toBe(0)
    expect(noiseTime(-1e9)).toBe(noiseTime(1e9))
    expect(noiseTime(1e9)).toBeGreaterThan(noiseTime(1e6))
    // The old law, where it was finite.
    expect(noiseTime(1e6)).toBeCloseTo(4 * Math.log(1 + (1e6 * 8e-7)), 9)
  })
})


describe('a star\'s photosphere from its parameters', () => {
  it('a rotator is oblate, its pole the reference, its colour its mean temperature\'s', async () => {
    const {photosphere, starAxis} = await import('./Star.js')
    const altair = photosphere({hipId: 97649, spectralType: 2, sub: 7, lumClass: 5})
    expect(altair.rotation.oblate).toBeCloseTo(2.029 / 1.636, 9)
    expect(altair.teff).toBe(8450)
    expect(altair.teffMean).toBeLessThan(8450)
    expect(altair.poleRadianceRelSun).toBeGreaterThan(altair.radianceRelSun)
    // In the guide (no position) the axis is seen from +z, north up, tipped i from the sight line.
    const axis = starAxis({}, altair.rotation)
    expect(Math.acos(axis.z) * 180 / Math.PI).toBeCloseTo(57.2, 6)
    const sun = photosphere({name: 'sun', spectralType: '4', radius: {scalar: 6.957e8}})
    expect(sun.rotation).toBeNull()
    expect(sun.granulesPerRadius).toBeCloseTo(535, 6)
    expect(sun.spots.prob).toBeGreaterThan(0)
  })
})
