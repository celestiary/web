import {describe, expect, it} from 'bun:test'
import {
  RING_ALBEDO_SCALE,
  RING_PHOTOMETRY_GLSL,
  ringPhase,
  ringReflectance,
  ringSlabFactor,
  ringTau,
} from './ringPhotometry.js'
import {FRAG} from './rings-frag.js'


describe('the ring particles\' phase function', () => {
  it('has a mean of 1 over the sphere', () => {
    let sum = 0
    const n = 20000
    for (let i = 0; i < n; i++) {
      const a = (i + 0.5) / n * Math.PI
      sum += ringPhase(Math.cos(a)) * Math.sin(a) * (Math.PI / n)
    }
    expect(sum / 2).toBeCloseTo(1, 4)
  })

  it('scatters back, toward the Sun: the lit rings dim away from opposition', () => {
    expect(ringPhase(1)).toBeCloseTo(2 * (Math.PI ** 3) / ((Math.PI ** 3) - (6 * Math.PI)), 9)
    expect(ringPhase(Math.cos(Math.PI / 6))).toBeLessThan(ringPhase(1))
    expect(ringPhase(0)).toBeLessThan(ringPhase(Math.cos(Math.PI / 6)))
    expect(ringPhase(-1)).toBe(0)
  })
})


describe('the slab', () => {
  it('reflects ϖP/8 from a thick layer seen from the Sun\'s direction', () => {
    // μ = μ₀: μ₀/(μ + μ₀) = 1/2, and no light gets through.
    expect(ringSlabFactor(50, 0.3, 0.3, true)).toBeCloseTo(0.5, 9)
    expect(ringReflectance(0.5, 50, 0.3, 0.3, 1, true)).toBeCloseTo(0.5 * ringPhase(1) / 8, 9)
  })

  it('is τ/μ for a thin layer, from either face, at μ = μ₀', () => {
    const tau = 1e-6
    for (const mu of [0.1, 0.5, 1]) {
      expect(ringSlabFactor(tau, mu, mu, true) / (tau / mu)).toBeCloseTo(1, 3)
      expect(ringSlabFactor(tau, mu, mu, false) / (tau / mu)).toBeCloseTo(1, 3)
    }
  })

  it('is continuous on the unlit face through μ = μ₀', () => {
    const at = ringSlabFactor(0.5, 0.4, 0.4, false)
    expect(ringSlabFactor(0.5, 0.4, 0.4 + 2e-3, false)).toBeCloseTo(at, 2)
    expect(ringSlabFactor(0.5, 0.4, 0.4 - 2e-3, false)).toBeCloseTo(at, 2)
  })

  it('lets no light through an opaque layer to the unlit face', () => {
    expect(ringSlabFactor(30, 0.3, 0.5, false)).toBeLessThan(1e-20)
  })

  it('reads the opacity map as the share a normal ray loses', () => {
    for (const tau of [0.05, 0.5, 2]) {
      expect(ringTau(1 - Math.exp(-tau))).toBeCloseTo(tau, 9)
    }
    expect(ringTau(1)).toBeCloseTo(-Math.log(1e-3), 9)
  })

  it('takes albedos within the ring particles\' measured range from its colour map', () => {
    // The map's stored values reach 1; the B ring's band has a median of
    // 0.55 (rings.md), so its particles' albedo is about 0.5, Cuzzi et al.'s
    // 0.4-0.6 for the B ring.
    expect(RING_ALBEDO_SCALE).toBeGreaterThan(0.4)
    expect(RING_ALBEDO_SCALE).toBeLessThan(1)
    expect(RING_ALBEDO_SCALE * 0.55).toBeGreaterThan(0.4)
    expect(RING_ALBEDO_SCALE * 0.55).toBeLessThan(0.6)
  })
})


describe('the rings\' shader', () => {
  it('carries the photometry\'s GLSL and its exposure-unit radiance', () => {
    expect(FRAG).toContain(RING_PHOTOMETRY_GLSL)
    expect(FRAG).toContain('uSunRadiance')
    expect(FRAG).toContain('#include <tonemapping_fragment>')
    expect(FRAG).not.toContain('uSunIntensity')
  })
})
