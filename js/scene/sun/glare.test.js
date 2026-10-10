import {describe, expect, it} from 'bun:test'
import {balmerPerNm, centreTemperatureAtHalpha, flareContrast} from './emission.js'
import {glareFunction, glareOverRadiance, glareRadiusDeg} from './glare.js'


describe('the eye\'s veiling glare (CIE 135/1999)', () => {
  it('at 1° and 10°: 15.2 and 0.068 per steradian, Stiles-Holladay\'s 10/θ² between', () => {
    expect(glareFunction(1)).toBeCloseTo(10 + (5.05 * 1.0256) + 0.00125, 3)
    expect(glareFunction(10)).toBeCloseTo(0.068, 3)
    // The middle term dominates from a few degrees: within a factor of 2
    // of Stiles-Holladay's 10/θ².
    for (const t of [3, 5, 10, 20]) {
      expect(glareFunction(t) / (10 / (t * t))).toBeGreaterThan(0.5)
      expect(glareFunction(t) / (10 / (t * t))).toBeLessThan(2)
    }
  })


  it('the Sun\'s veil 1° off is 1e-3 of its disc: the corona there (1e-8) can\'t show', () => {
    const sunSr = 6.8e-5
    const veil = glareOverRadiance(1, sunSr)
    expect(veil).toBeGreaterThan(5e-4)
    expect(veil).toBeLessThan(2e-3)
  })


  it('its reach for a floor is the inverse of the function', () => {
    const t = glareRadiusDeg(glareFunction(7))
    expect(t).toBeCloseTo(7, 3)
  })
})


describe('the Sun\'s line emission and flares, over its disc', () => {
  it('the disc centre\'s continuum at Hα is a 6,143 K blackbody\'s', () => {
    expect(centreTemperatureAtHalpha()).toBeCloseTo(6143, -1)
  })


  it('a prominence of 0.1 Å of Hα is ~1e-5 of the disc, and pink: red over blue over green', () => {
    const [r, g, b] = balmerPerNm()
    const y = (0.2126 * r) + (0.7152 * g) + (0.0722 * b)
    expect(y * 0.01).toBeGreaterThan(5e-6)
    expect(y * 0.01).toBeLessThan(3e-5)
    expect(r).toBeGreaterThan(b)
    expect(b).toBeGreaterThan(g)
  })


  it('white-light flare kernels: a few percent for an M flare, under 20% at X10, invisible at C1', () => {
    expect(flareContrast(5e-5)).toBeGreaterThan(0.05)
    expect(flareContrast(5e-5)).toBeLessThan(0.1)
    expect(flareContrast(1e-3)).toBeLessThan(0.2)
    expect(flareContrast(1e-6)).toBeLessThan(0.03)
  })
})
