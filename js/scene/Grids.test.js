import {describe, expect, it} from 'bun:test'
import {bracketCrossing, edgeScore, sampleMeridian, sampleParallel} from './Grids.js'


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


describe('bracketCrossing', () => {
  it('returns null when both points are on the same side of the edge', () => {
    expect(bracketCrossing(0, 0.5, 0.3, 0.6, 'top')).toBeNull()
    expect(bracketCrossing(0, -0.5, 0.3, -0.6, 'bottom')).toBeNull()
    expect(bracketCrossing(0.5, 0, 0.6, 0, 'right')).toBeNull()
  })

  it('finds the exact midpoint crossing of a horizontal edge', () => {
    // Segment from y=0.8 to y=1.2 — bracket sits halfway, t=0.5
    const r = bracketCrossing(-0.2, 0.8, 0.2, 1.2, 'top')
    expect(r).not.toBeNull()
    expect(r.t).toBeCloseTo(0.5, 6)
    expect(r.y).toBeCloseTo(1, 6)
    // x interpolates linearly: midpoint of (-0.2, 0.2) = 0
    expect(r.x).toBeCloseTo(0, 6)
  })

  it('reports t outside (0, 1) is impossible — crossing always within segment', () => {
    // Endpoint exactly on edge: t=0 means start is on edge — but bracket
    // requires strict opposite signs, so endpoint-on-edge returns null.
    expect(bracketCrossing(0, 1, 0, 1.5, 'top')).toBeNull()
  })

  it('returns null when the crossing lies off-screen on the orthogonal axis', () => {
    // Segment crosses y=1 at x=2.5 — outside the screen window.
    const r = bracketCrossing(2, 0.8, 3, 1.2, 'top')
    expect(r).toBeNull()
  })

  it('handles bottom / left / right edges with consistent semantics', () => {
    expect(bracketCrossing(0, -0.8, 0, -1.2, 'bottom')).not.toBeNull()
    expect(bracketCrossing(-0.8, 0, -1.2, 0, 'left')).not.toBeNull()
    expect(bracketCrossing(0.8, 0, 1.2, 0, 'right')).not.toBeNull()
  })

  it('returns null for unknown edge name', () => {
    expect(bracketCrossing(0, 0.8, 0, 1.2, 'middle')).toBeNull()
  })

  it('interpolated x along a top crossing is exactly the linear-interp x', () => {
    // y goes 0 → 2, edge at y=1 ⇒ t=0.5; x goes -1 → 1 ⇒ x@t=0
    const r = bracketCrossing(-1, 0, 1, 2, 'top')
    expect(r).not.toBeNull()
    expect(r.t).toBeCloseTo(0.5, 6)
    expect(r.x).toBeCloseTo(0, 6)
  })

  it('padNDC insets the target line for the top edge', () => {
    // Edge with pad 0.1 means we anchor at y=0.9, not y=1.  A segment
    // from y=0 to y=1 (which would cross y=0.9 at t=0.9) should now
    // bracket the inset line.
    const r = bracketCrossing(0, 0, 0, 1, 'top', 0.1)
    expect(r).not.toBeNull()
    expect(r.t).toBeCloseTo(0.9, 6)
    expect(r.y).toBeCloseTo(0.9, 6)
  })

  it('padNDC of zero behaves identically to the unpadded call', () => {
    const a = bracketCrossing(-0.2, 0.8, 0.2, 1.2, 'top')
    const b = bracketCrossing(-0.2, 0.8, 0.2, 1.2, 'top', 0)
    expect(a).toEqual(b)
  })

  it('padNDC pushes the bottom edge inward symmetrically', () => {
    // Pad 0.1 on bottom moves the target from y=-1 to y=-0.9.  A segment
    // from y=-1 to y=0 must now bracket y=-0.9.
    const r = bracketCrossing(0, -1, 0, 0, 'bottom', 0.1)
    expect(r).not.toBeNull()
    expect(r.y).toBeCloseTo(-0.9, 6)
  })
})
