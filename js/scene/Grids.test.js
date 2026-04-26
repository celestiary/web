import {describe, expect, it} from 'bun:test'
import {edgeScore, sampleMeridian, sampleParallel} from './Grids.js'


describe('sampleMeridian', () => {
  it('emits unit-sphere points along a constant-longitude great circle', () => {
    const samples = sampleMeridian(0) // lng=0 → samples in the +X / +Y plane (z=0)
    const N = samples.length / 3
    expect(N).toBeGreaterThan(8)
    for (let i = 0; i < N; i++) {
      const x = samples[(3 * i)]
      const y = samples[(3 * i) + 1]
      const z = samples[(3 * i) + 2]
      // Unit length within float-rounding tolerance
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 5)
      // lng=0 ⇒ z = cos(lat) * sin(0) = 0
      expect(Math.abs(z)).toBeLessThan(1e-6)
    }
  })

  it('first sample is the south pole, last is the north pole', () => {
    const samples = sampleMeridian(Math.PI / 4) // any longitude
    const N = samples.length / 3
    // South pole: y = -1
    expect(samples[1]).toBeCloseTo(-1, 5)
    // North pole: y = +1
    expect(samples[((N - 1) * 3) + 1]).toBeCloseTo(1, 5)
  })

  it('lng=π/2 ⇒ samples lie in the +Z / +Y plane (x=0)', () => {
    const samples = sampleMeridian(Math.PI / 2)
    const N = samples.length / 3
    for (let i = 0; i < N; i++) {
      expect(Math.abs(samples[(3 * i)])).toBeLessThan(1e-6)
    }
  })
})


describe('sampleParallel', () => {
  it('emits unit-sphere points at constant latitude', () => {
    const lat = Math.PI / 6 // 30°
    const samples = sampleParallel(lat)
    const N = samples.length / 3
    expect(N).toBeGreaterThan(8)
    const expectedY = Math.sin(lat)
    for (let i = 0; i < N; i++) {
      const x = samples[(3 * i)]
      const y = samples[(3 * i) + 1]
      const z = samples[(3 * i) + 2]
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 5)
      expect(y).toBeCloseTo(expectedY, 5)
    }
  })

  it('lat=0 ⇒ samples on the equator (y=0)', () => {
    const samples = sampleParallel(0)
    const N = samples.length / 3
    for (let i = 0; i < N; i++) {
      expect(Math.abs(samples[(3 * i) + 1])).toBeLessThan(1e-6)
    }
  })
})


describe('edgeScore', () => {
  it('returns Infinity for points off-screen on x', () => {
    expect(edgeScore(1.5, 0, 'top')).toBe(Infinity)
    expect(edgeScore(-1.2, 0, 'right')).toBe(Infinity)
  })

  it('returns Infinity for points off-screen on y', () => {
    expect(edgeScore(0, 1.1, 'left')).toBe(Infinity)
    expect(edgeScore(0, -1.5, 'bottom')).toBe(Infinity)
  })

  it('top edge: smaller score for higher y', () => {
    expect(edgeScore(0, 0.8, 'top')).toBeLessThan(edgeScore(0, 0.0, 'top'))
    expect(edgeScore(0, 1.0, 'top')).toBe(0)
  })

  it('bottom edge: smaller score for lower y', () => {
    expect(edgeScore(0, -0.8, 'bottom')).toBeLessThan(edgeScore(0, 0.0, 'bottom'))
    expect(edgeScore(0, -1.0, 'bottom')).toBe(0)
  })

  it('right edge: smaller score for higher x', () => {
    expect(edgeScore(0.7, 0, 'right')).toBeLessThan(edgeScore(0.0, 0, 'right'))
  })

  it('left edge: smaller score for lower x', () => {
    expect(edgeScore(-0.7, 0, 'left')).toBeLessThan(edgeScore(0.0, 0, 'left'))
  })

  it('returns Infinity for an unknown edge name', () => {
    expect(edgeScore(0, 0, 'middle')).toBe(Infinity)
  })
})
