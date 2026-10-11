import {describe, expect, it} from 'bun:test'
import {balmerPerNm, centreTemperatureAtHalpha, flareContrast} from './emission.js'
import {
  EYE_PSF_GLSL, GLARE_FADE_DEG, GLARE_GLSL, GLARE_MAX_DEG, eyePsf, eyePsfRadiusDeg, eyePsfShare, glareFieldWeight,
  glareFunction, glareOverRadiance, glareRadiusDeg,
} from './glare.js'


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

  it('fades out at the eye\'s field\'s edge: whole to 90°, none at 100°, and the GLSL carries the fade', () => {
    expect(glareFieldWeight(GLARE_FADE_DEG)).toBe(1)
    expect(glareFieldWeight(95)).toBeCloseTo(0.5, 9)
    expect(glareFieldWeight(GLARE_MAX_DEG)).toBe(0)
    expect(glareFunction(60)).toBeGreaterThan(glareFunction(89))
    expect(glareFunction(100)).toBe(0)
    expect(glareFunction(150)).toBe(0)
    expect(GLARE_GLSL).toMatch(/smoothstep\(90\.0, 100\.0, thetaDeg\)/)
  })
})


describe('the eye\'s whole PSF (the CIE total glare equation)', () => {
  it('integrates to about 1 over the sphere: 0.95 in the optics\' two lobes, the rest scattered', () => {
    expect(eyePsfShare(GLARE_MAX_DEG)).toBeGreaterThan(0.98)
    expect(eyePsfShare(GLARE_MAX_DEG)).toBeLessThan(1.06)
    // The inner lobe (0.0046°) holds 0.37, the two lobes 0.94 by 0.5°.
    expect(eyePsfShare(0.02)).toBeGreaterThan(0.33)
    expect(eyePsfShare(0.02)).toBeLessThan(0.42)
    expect(eyePsfShare(0.5)).toBeGreaterThan(0.9)
    expect(eyePsfShare(0.5)).toBeLessThan(0.97)
  })

  it('agrees with the general equation over its range, within 40%: both are the eye\'s veil', () => {
    for (const t of [0.1, 0.3, 1, 3, 10, 30, 80]) {
      const ratio = eyePsf(t) / glareFunction(t)
      expect(ratio).toBeGreaterThan(0.7)
      expect(ratio).toBeLessThan(1.4)
    }
    // 1° off, 19 per steradian: Sirius (1e-5 lux) veils 1.9e-4 cd/m²
    // there, about a dark sky's own brightness.
    expect(eyePsf(1)).toBeGreaterThan(17)
    expect(eyePsf(1)).toBeLessThan(21)
  })

  it('falls as θ^-3 along the 0.045° lobe\'s tail and θ^-2 along the scattered light\'s', () => {
    const slope = (a, b) => Math.log(eyePsf(a) / eyePsf(b)) / Math.log(b / a)
    expect(slope(0.2, 0.4)).toBeGreaterThan(2.6)
    expect(slope(0.2, 0.4)).toBeLessThan(3.1)
    expect(slope(5, 10)).toBeGreaterThan(1.8)
    expect(slope(5, 10)).toBeLessThan(2.3)
    // Monotone, finite at 0, zero past the field's edge.
    let last = eyePsf(0)
    expect(Number.isFinite(last) && last > 9e6).toBe(true)
    for (let t = 1e-3; t <= 100; t *= 1.2) {
      expect(eyePsf(t)).toBeLessThanOrEqual(last)
      last = eyePsf(t)
    }
    expect(eyePsf(100)).toBe(0)
  })

  it('its inverse gives the radius a veil of a given value reaches', () => {
    for (const t of [0.05, 0.3, 2, 20]) {
      expect(eyePsfRadiusDeg(eyePsf(t))).toBeCloseTo(t, 4)
    }
    expect(eyePsfRadiusDeg(1e-9)).toBe(GLARE_MAX_DEG)
    expect(eyePsfRadiusDeg(1e9)).toBe(0)
  })

  it('the GLSL carries the same constants', () => {
    expect(EYE_PSF_GLSL).toMatch(/9\.2e6 \/ \(l1 \* sqrt\(l1\)\) \+ 1\.5e5 \/ \(l2 \* sqrt\(l2\)\)/)
    expect(EYE_PSF_GLSL).toMatch(/t \/ 0\.0046/)
    expect(EYE_PSF_GLSL).toMatch(/t \/ 0\.045/)
    expect(EYE_PSF_GLSL).toMatch(/400\.0 \/ q \+ 3\.0e-8 \* t \* t \+ 0\.50 \* \(1300\.0 \/ \(q \* sqrt\(q\)\) \+ 0\.8 \/ sqrt\(q\)\)/)
    expect(EYE_PSF_GLSL).toMatch(/0\.998698/)
    expect(EYE_PSF_GLSL).toMatch(/1\.026031/)
    expect(EYE_PSF_GLSL).toMatch(/\+ 0\.001250\)/)
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
