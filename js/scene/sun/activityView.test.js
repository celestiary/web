import {describe, expect, it} from 'bun:test'
import {
  EUV_VIEW,
  RADIAL_FIRST,
  RADIAL_SAMPLES,
  VIEWS,
  VIEW_EUV,
  VIEW_EYE,
  VIEW_GLSL,
  euvFlareLevel,
  euvFlareRadiusMm,
  viewColor,
} from './activityView.js'
import {baumbachK, radialReference} from './corona.js'
import {CORONA_RADII} from './sun-shaders.js'
import {softXrayPhase} from './solarEvents.js'


describe('the activity view\'s colour table', () => {
  it('runs dark red, orange, yellow, white', () => {
    const [r1, g1, b1] = viewColor(1)
    expect(r1).toBeCloseTo(0.58, 1)
    expect(g1).toBeLessThan(0.1)
    expect(b1).toBeLessThan(0.01)
    const [r8, g8, b8] = viewColor(8)
    expect(r8).toBeGreaterThan(1)
    expect(g8).toBeGreaterThan(0.8)
    expect(b8).toBeLessThan(0.3)
    const white = viewColor(500)
    expect(Math.min(...white)).toBeGreaterThan(1)
    expect(Math.max(...white)).toBeLessThan(1.2)
    expect(viewColor(0)).toEqual([0, 0, 0])
    expect(viewColor(-1)).toEqual([0, 0, 0])
  })

  it('never falls as the level rises', () => {
    let last = [0, 0, 0]
    for (let level = 0.01; level < 2000; level *= 1.3) {
      const c = viewColor(level)
      for (let i = 0; i < 3; i++) {
        expect(c[i]).toBeGreaterThanOrEqual(last[i])
      }
      last = c
    }
  })

  it('has its GLSL', () => {
    expect(VIEW_GLSL).toContain('vec3 viewColor(float level)')
    expect(VIEWS).toEqual([VIEW_EYE, VIEW_EUV])
  })
})


describe('a flare in the EUV view', () => {
  it('is 30 times the quiet disc at C1 and ~500 at X1, over 4 to 16 Mm', () => {
    expect(euvFlareLevel(1e-6)).toBeCloseTo(EUV_VIEW.flareAtC1, 9)
    expect(euvFlareLevel(1e-5)).toBeCloseTo(119.4, 0)
    expect(euvFlareLevel(1e-4)).toBeCloseTo(475.5, 0)
    expect(euvFlareRadiusMm(1e-6)).toBeCloseTo(4, 9)
    expect(euvFlareRadiusMm(1e-4)).toBeCloseTo(15.9, 1)
  })

  it('follows the soft X-ray light curve: up over the rise, 5% left at the decay\'s end', () => {
    expect(softXrayPhase(-1, 100, 300)).toBe(0)
    expect(softXrayPhase(0, 100, 300)).toBe(0)
    expect(softXrayPhase(50, 100, 300)).toBeCloseTo(0.5, 9)
    expect(softXrayPhase(100, 100, 300)).toBeCloseTo(1, 9)
    expect(softXrayPhase(400, 100, 300)).toBeCloseTo(Math.exp(-3), 9)
    expect(softXrayPhase(401, 100, 300)).toBe(0)
  })
})


describe('the coronagraph\'s radial filter', () => {
  it('is the mean corona\'s brightness, falling by six orders over the field', () => {
    const ref = radialReference(RADIAL_SAMPLES, RADIAL_FIRST, CORONA_RADII)
    expect(ref.length).toBe(RADIAL_SAMPLES)
    for (let i = 1; i < ref.length; i++) {
      expect(ref[i]).toBeLessThan(ref[i - 1])
    }
    // Baumbach's K-corona near the limb (over the disc centre's; the mean
    // disc is 0.8 of it), within the corona test's 13% and that factor.
    const near = (10 ** ref[0]) / baumbachK(RADIAL_FIRST)
    expect(near).toBeGreaterThan(0.8)
    expect(near).toBeLessThan(1.6)
    expect(ref[0] - ref[ref.length - 1]).toBeGreaterThan(5)
  })
})
