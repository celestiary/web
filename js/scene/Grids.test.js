import {describe, expect, it} from 'bun:test'
import {
  bracketCrossing,
  edgeScore,
  refineSubSample,
  sampleMeridian,
  sampleParallel,
} from './Grids.js'


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


describe('refineSubSample', () => {
  // Small synthetic three-sample setup: scores 4, 1, 4 → symmetric
  // parabola, vertex at offset 0 (no movement); scores 4, 1, 9 → vertex
  // shifted toward the smaller side (prevI).  Sample positions shape the
  // 3D output via lerp toward the neighbour the vertex points at.
  const samples = new Float32Array([
    -1, 0, 0, // prevI (idx 0)
    0, 1, 0, // bestI (idx 1)
    1, 0, 0, // nextI (idx 2)
  ])
  const front = new Uint8Array([1, 1, 1])

  it('returns the bestI sample when both neighbours have equal scores', () => {
    // Score function: |edgeScore(top)| = 1 - y.  Pick top edge with
    // ndcY values that give scores (4, 1, 4) → vertex at offset 0.
    const ndcX = new Float32Array([0, 0, 0])
    const ndcY = new Float32Array([-3, 0, -3]) // top scores: 4, 1, 4
    const r = refineSubSample(1, samples, ndcX, ndcY, front, 'top', false)
    // Vertex at t=0 ⇒ no shift ⇒ bestI position
    expect(r.x).toBeCloseTo(0, 6)
    expect(r.y).toBeCloseTo(1, 6)
  })

  it('shifts toward the lower-score neighbour', () => {
    // ndcY=(0.5, 0.9, 0.3) ⇒ top scores (0.5, 0.1, 0.7).  edgeScore for
    // top requires y ∈ [-1, 1] (strict < threshold), so all on-screen.
    //   denom = 0.5 + 0.7 − 0.2 = 1.0
    //   t = (0.5 − 0.7) / 2 = −0.1  → shift 10% toward prevI = (-1,0,0)
    const ndcX = new Float32Array([0, 0, 0])
    const ndcY = new Float32Array([0.5, 0.9, 0.3])
    const r = refineSubSample(1, samples, ndcX, ndcY, front, 'top', false)
    const w = 0.1 // |t|
    // lerp(bestI=(0,1,0) → prevI=(-1,0,0), w)
    expect(r.x).toBeCloseTo(((1 - w) * 0) + (w * -1), 4)
    expect(r.y).toBeCloseTo(((1 - w) * 1) + (w * 0), 4)
  })

  it('returns bestI position when a neighbour is off-screen', () => {
    const ndcX = new Float32Array([0, 0, 0])
    const ndcY = new Float32Array([-3, 0, -3])
    const frontMissing = new Uint8Array([0, 1, 1]) // prevI off-screen
    const r = refineSubSample(1, samples, ndcX, ndcY, frontMissing, 'top', false)
    expect(r.x).toBeCloseTo(0, 6)
    expect(r.y).toBeCloseTo(1, 6)
  })

  it('returns bestI position when bestI is at the open-loop boundary', () => {
    // bestI at idx 0 with closed=false has no real prevI — should fall
    // back to bestI directly without crashing.
    const ndcX = new Float32Array([0, 0, 0])
    const ndcY = new Float32Array([-3, -3, -3])
    const r = refineSubSample(0, samples, ndcX, ndcY, front, 'top', false)
    expect(r.x).toBeCloseTo(-1, 6) // samples[0] = (-1, 0, 0)
    expect(r.y).toBeCloseTo(0, 6)
  })

  it('wraps at the open-loop boundary when closed=true', () => {
    // bestI=0; closed=true wraps prevI → idx 2.  Asymmetric ndcY values
    // (scores 1.5, 0, 1) shift the parabolic vertex toward nextI by t≈0.1.
    // closed=false would hit the prevI===bestI guard and return bestI
    // directly; closed=true should produce a non-zero lerp.
    const ndcX = new Float32Array([0, 0, 0])
    const ndcY = new Float32Array([1, 0, -0.5]) // top scores: 0, 1, 1.5
    const closedR = refineSubSample(0, samples, ndcX, ndcY, front, 'top', true)
    const openR = refineSubSample(0, samples, ndcX, ndcY, front, 'top', false)
    // Closed: sa=1.5 (prevI=idx2), sb=0, sc=1 → denom=2.5, t=+0.1 → toward
    // nextI by 10%.  Expected: lerp((-1,0,0)→(0,1,0), 0.1) = (-0.9, 0.1, 0)
    expect(closedR.x).toBeCloseTo(-0.9, 4)
    expect(closedR.y).toBeCloseTo(0.1, 4)
    // Open: prevI clamps to bestI ⇒ returns bestI's sample directly.
    expect(openR.x).toBeCloseTo(-1, 4)
    expect(openR.y).toBeCloseTo(0, 4)
  })

  it('clamps the vertex offset to [-1, +1] for extreme score asymmetry', () => {
    // edgeScore for top is in [0, 2] for on-screen y in [1, -1].  Choose
    // scores sa=0 (y=1), sb=0.9 (y=0.1), sc=2 (y=-1).
    //   denom = 0 + 2 − 1.8 = 0.2,  t = (0 − 2) / 0.4 = −5  → clamped to −1.
    const ndcX = new Float32Array([0, 0, 0])
    const ndcY = new Float32Array([1, 0.1, -1])
    const r = refineSubSample(1, samples, ndcX, ndcY, front, 'top', false)
    // t = −1 ⇒ lerp fully to prevI = samples[0] = (-1, 0, 0)
    expect(r.x).toBeCloseTo(-1, 4)
    expect(r.y).toBeCloseTo(0, 4)
  })
})
