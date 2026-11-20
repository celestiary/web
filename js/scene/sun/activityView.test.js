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
import {ERUPTION_MAX_HEIGHT, ERUPTIVE_SHARE, cmesAt, eruptionOf, softXrayPhase} from './solarEvents.js'


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


describe('an erupting prominence', () => {
  const cme = (front, launch = 1.7e12) => ({launch, front, speed: 450, width: 0.5, mass: 1e15, source: {lat: 10, lon: 20}})

  it('goes with the observed share of CMEs', () => {
    let n = 0
    const total = 4000
    for (let i = 0; i < total; i++) {
      n += eruptionOf(cme(2, 1.7e12 + (i * 3.7e6))) ? 1 : 0
    }
    expect(n / total).toBeGreaterThan(ERUPTIVE_SHARE - 0.04)
    expect(n / total).toBeLessThan(ERUPTIVE_SHARE + 0.04)
  })

  it('rises from a prominence\'s height to the CME\'s core, widening and fading', () => {
    let launch = 1.7e12
    while (!eruptionOf(cme(1, launch))) {
      launch += 3.7e6
    }
    const at = (front) => eruptionOf(cme(front, launch))
    expect(at(1).height).toBeCloseTo(0.03, 6)
    // Past a few radii its top is the core, 0.55 of the front.
    expect(1 + at(8).height).toBeCloseTo(0.55 * 8, 2)
    let last = at(1)
    for (const front of [1.5, 2, 3, 5, 8]) {
      const e = at(front)
      expect(e.height).toBeGreaterThan(last.height)
      expect(e.halfLength).toBeGreaterThan(last.halfLength)
      expect(e.thickness).toBeGreaterThan(last.thickness)
      expect(e.halpha).toBeLessThan(last.halpha)
      expect(e.seed).toBe(last.seed)
      expect(e.tilt).toBe(last.tilt)
      last = e
    }
    expect(eruptionOf(cme((ERUPTION_MAX_HEIGHT + 1.5) / 0.55, launch))).toBe(null)
  })

  it('is the same for a date in every session', () => {
    const ms = Date.UTC(2024, 3, 17, 22, 15)
    const a = cmesAt(ms).map((c) => eruptionOf(c))
    const b = cmesAt(ms).map((c) => eruptionOf(c))
    expect(a).toEqual(b)
    expect(a.some(Boolean)).toBe(true)
  })
})
