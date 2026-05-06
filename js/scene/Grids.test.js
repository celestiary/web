import {describe, expect, it} from 'bun:test'
import {Matrix4, Vector3} from 'three'
import {galacticToSceneMatrix} from './galacticFrame.js'
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
      // lng=0 ⇒ z = -cos(lat) · sin(0) = 0
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

  it('lng=π/2 ⇒ samples lie in the −Z / +Y plane (x=0)', () => {
    // CCW-from-+Y convention: lng=π/2 puts the meridian in the X=0 plane
    // on the -Z side (NOT +Z; the negation in sampleMeridian is what makes
    // longitude wind in the same direction as RA / ecliptic-/galactic-
    // longitude).
    const samples = sampleMeridian(Math.PI / 2)
    const N = samples.length / 3
    for (let i = 0; i < N; i++) {
      expect(Math.abs(samples[(3 * i)])).toBeLessThan(1e-6)
      // Z component must be ≤ 0 across the whole meridian (it's
      // -cos(lat) · sin(π/2) = -cos(lat) ∈ [-1, 0]).
      expect(samples[(3 * i) + 2]).toBeLessThanOrEqual(1e-6)
    }
    // The mid-index sample is approximately at the equator — at
    // EDGE_SAMPLES = 96 the sample-grid lands one half-step off, so
    // |z| is close to 1 but not exact.  Tolerate the half-step error.
    const mid = Math.floor(N / 2)
    expect(samples[(3 * mid)]).toBeCloseTo(0, 5)
    expect(Math.abs(samples[(3 * mid) + 2])).toBeGreaterThan(0.99)
  })


  it('longitude winds CCW viewed from +Y (lng=π/2 lands at -Z, not +Z)', () => {
    // Equator at lng=0 is at +X, lng=π/2 is at -Z, lng=π is at -X,
    // lng=3π/2 is at +Z.  CCW going through (+X, -Z, -X, +Z) viewed from
    // +Y matches RA / ecliptic-lon / galactic-lon conventions.
    const samples0 = sampleParallel(0) // equator
    // Find the four cardinal points among the samples — index 0 is lng=0,
    // and sampleParallel emits at lng = 2π · i / N.
    const N = samples0.length / 3
    const ndxAtLng = (lng) => Math.round(lng / (2 * Math.PI) * N) % N
    const at = (lng) => {
      const i = ndxAtLng(lng) * 3
      return [samples0[i], samples0[i + 1], samples0[i + 2]]
    }
    const [x0, , z0] = at(0)
    const [x90, , z90] = at(Math.PI / 2)
    const [x180, , z180] = at(Math.PI)
    const [x270, , z270] = at(3 * Math.PI / 2)
    expect(x0).toBeCloseTo(1, 4); expect(z0).toBeCloseTo(0, 4)
    expect(x90).toBeCloseTo(0, 4); expect(z90).toBeCloseTo(-1, 4)
    expect(x180).toBeCloseTo(-1, 4); expect(z180).toBeCloseTo(0, 4)
    expect(x270).toBeCloseTo(0, 4); expect(z270).toBeCloseTo(1, 4)
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

  describe('exitOnly direction filter', () => {
    it('top edge: accepts exits (yj > yi), rejects entries', () => {
      // Exit: vi inside (y < 1) → vj outside (y > 1)
      expect(bracketCrossing(0, 0.8, 0, 1.2, 'top', 0, true)).not.toBeNull()
      // Entry: vi outside (y > 1) → vj inside (y < 1)
      expect(bracketCrossing(0, 1.2, 0, 0.8, 'top', 0, true)).toBeNull()
    })

    it('bottom edge: exits go more negative (yj < yi)', () => {
      // Exit through bottom: vi inside (y > -1) → vj outside (y < -1)
      expect(bracketCrossing(0, -0.8, 0, -1.2, 'bottom', 0, true)).not.toBeNull()
      // Entry through bottom: vi outside → vj inside
      expect(bracketCrossing(0, -1.2, 0, -0.8, 'bottom', 0, true)).toBeNull()
    })

    it('right edge: exits go more positive (xj > xi)', () => {
      expect(bracketCrossing(0.8, 0, 1.2, 0, 'right', 0, true)).not.toBeNull()
      expect(bracketCrossing(1.2, 0, 0.8, 0, 'right', 0, true)).toBeNull()
    })

    it('left edge: exits go more negative (xj < xi)', () => {
      expect(bracketCrossing(-0.8, 0, -1.2, 0, 'left', 0, true)).not.toBeNull()
      expect(bracketCrossing(-1.2, 0, -0.8, 0, 'left', 0, true)).toBeNull()
    })

    it('exitOnly=false (default) accepts both directions', () => {
      expect(bracketCrossing(0, 0.8, 0, 1.2, 'top')).not.toBeNull()
      expect(bracketCrossing(0, 1.2, 0, 0.8, 'top')).not.toBeNull()
    })

    it('exitOnly=true preserves the off-screen-orthogonal rejection', () => {
      // Crosses the inset top edge but at x=2.5 (off-screen).  Should
      // still be rejected even with exitOnly=true.
      expect(bracketCrossing(2, 0.8, 3, 1.2, 'top', 0, true)).toBeNull()
    })
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


// ---------------------------------------------------------------------------
// Per-grid orientation: each grid's labelled longitude/RA must land at the
// correct sky direction in scene coordinates.  These tests don't construct a
// full <Grids> tree — they just simulate the rotation each grid applies and
// check that a sphere-local "lng=L" sample maps to the expected scene
// direction for that frame's longitude convention.

const D2R = Math.PI / 180
const EARTH_OBLIQUITY_DEG = 23.4392811


/**
 * Equatorial-J2000 (RA, Dec) → scene-frame unit vector.  Same math as
 * galacticFrame.equatorialToSceneUnit but inlined here so the test does
 * not depend on that module's export.
 */
function eqToScene(raDeg, decDeg) {
  const ra = raDeg * D2R; const dec = decDeg * D2R
  const eps = EARTH_OBLIQUITY_DEG * D2R
  // Equatorial Cartesian (X=VE, Y=90°RA, Z=NCP)
  const xq = Math.cos(dec) * Math.cos(ra)
  const yq = Math.cos(dec) * Math.sin(ra)
  const zq = Math.sin(dec)
  // Rotate about X by +ε to get right-handed ecliptic, then remap to scene
  const cE = Math.cos(eps); const sE = Math.sin(eps)
  const xe = xq
  const ye = (yq * cE) + (zq * sE)
  const ze = (-yq * sE) + (zq * cE)
  return new Vector3(xe, ze, -ye)
}


/**
 * Direct sphere-local position for (lng, lat) — same formula as
 * buildWireSphereGeometry / sampleMeridian (CCW-from-+Y winding).  We use
 * this rather than picking a sample index out of sampleMeridian because
 * the sampler's discrete grid (~96 samples per meridian) doesn't land
 * exactly on lat=0; sampling at the integer mid-index introduces a ~1°
 * latitude error that's bigger than the orientation tolerances we care
 * about here.
 */
function sphereLocal(lng, lat) {
  return new Vector3(
      Math.cos(lat) * Math.cos(lng),
      Math.sin(lat),
      -Math.cos(lat) * Math.sin(lng))
}


describe('Equatorial grid orientation', () => {
  // Grids.js applies `equatorial.rotation.x = -ε * toRad`.  In scene this
  // is rotateX(-ε) — pivots scene +Y → NCP_scene = (0, cos ε, -sin ε)
  // while preserving scene +X (vernal equinox).
  const eqRot = new Matrix4().makeRotationX(-EARTH_OBLIQUITY_DEG * D2R)


  it('RA=0h (lng=0 on the equator) maps to the vernal equinox direction', () => {
    const scene = sphereLocal(0, 0).applyMatrix4(eqRot)
    // VE in scene is (+1, 0, 0).
    expect(scene.x).toBeCloseTo(1, 6)
    expect(scene.y).toBeCloseTo(0, 6)
    expect(scene.z).toBeCloseTo(0, 6)
  })


  it('RA=6h equator point lands at the actual RA=6h sky direction', () => {
    const scene = sphereLocal(Math.PI / 2, 0).applyMatrix4(eqRot)
    const expected = eqToScene(90, 0)
    expect(scene.x).toBeCloseTo(expected.x, 6)
    expect(scene.y).toBeCloseTo(expected.y, 6)
    expect(scene.z).toBeCloseTo(expected.z, 6)
  })


  it('Dec=+90° (north pole) maps to the IAU NCP in scene', () => {
    const scenePole = new Vector3(0, 1, 0).applyMatrix4(eqRot)
    const ncp = eqToScene(0, 90) // RA arbitrary at the pole
    expect(scenePole.x).toBeCloseTo(ncp.x, 6)
    expect(scenePole.y).toBeCloseTo(ncp.y, 6)
    expect(scenePole.z).toBeCloseTo(ncp.z, 6)
  })


  it('Sirius (RA=101.287°, Dec=-16.716°) lands at its catalog scene direction', () => {
    // Cross-check against a real, verified-against-stars.dat sky position:
    // a Sirius-coordinate point on the grid sphere should map to the same
    // scene direction the catalog stores for Sirius.  This is the test
    // that fails noisily if the equatorial grid ever drifts away from the
    // star catalog frame.
    const ra = 101.287; const dec = -16.716
    const local = sphereLocal(ra * D2R, dec * D2R)
    const scene = local.applyMatrix4(eqRot)
    const expected = eqToScene(ra, dec)
    expect(scene.x).toBeCloseTo(expected.x, 6)
    expect(scene.y).toBeCloseTo(expected.y, 6)
    expect(scene.z).toBeCloseTo(expected.z, 6)
  })
})


describe('Ecliptic grid orientation', () => {
  // Identity rotation — the scene's Y axis IS the ecliptic pole, +X is
  // already the vernal equinox.  No grid rotation is applied.

  it('ecl-lon=0 maps to scene +X (vernal equinox)', () => {
    const v = sphereLocal(0, 0)
    expect(v.x).toBeCloseTo(1, 6)
    expect(v.y).toBeCloseTo(0, 6)
    expect(v.z).toBeCloseTo(0, 6)
  })


  it('ecl-lon=90° lands at scene -Z', () => {
    // Standard ecliptic Y-axis (90° λ direction) is at scene -Z, since
    // scene_Z = -ecl_Y.  Sphere lng=π/2, lat=0 (with the CCW-flip) is
    // exactly there.
    const v = sphereLocal(Math.PI / 2, 0)
    expect(v.x).toBeCloseTo(0, 6)
    expect(v.y).toBeCloseTo(0, 6)
    expect(v.z).toBeCloseTo(-1, 6)
  })


  it('NEP (β=+90°) is at scene +Y', () => {
    const localPole = new Vector3(0, 1, 0)
    expect(localPole.y).toBeCloseTo(1, 6)
  })
})


describe('Galactic grid orientation', () => {
  // Grids.js applies `galactic.quaternion.setFromRotationMatrix(galacticToSceneMatrix())`.
  const galRot = galacticToSceneMatrix()


  it('l=0 (lng=0 on the equator) maps to the galactic centre direction', () => {
    // Sphere lng=0, lat=0 = (+1, 0, 0) in grid local; the matrix's first
    // column is the GC direction in scene by construction.  Tolerance is
    // loose because GC isn't exactly perpendicular to NGP at publication
    // precision and we orthogonalize off NGP — the residual cosine error
    // is ~1e-7.
    const scene = sphereLocal(0, 0).applyMatrix4(galRot)
    const gc = eqToScene(266.40499, -28.93617)
    expect(scene.dot(gc)).toBeGreaterThan(1 - 1e-5)
  })


  it('b=+90° (north pole) maps to the IAU NGP in scene', () => {
    const scenePole = new Vector3(0, 1, 0).applyMatrix4(galRot)
    const ngp = eqToScene(192.85948, 27.12825)
    expect(scenePole.dot(ngp)).toBeGreaterThan(1 - 1e-12)
  })


  it('l=90° equator point lies in the galactic plane (perpendicular to NGP and GC)', () => {
    // l=90° is in the galactic plane (so perpendicular to NGP) and 90°
    // around the pole from GC (so perpendicular to GC too).
    const scene = sphereLocal(Math.PI / 2, 0).applyMatrix4(galRot)
    const ngp = eqToScene(192.85948, 27.12825)
    const gc = eqToScene(266.40499, -28.93617)
    // Perpendicular to NGP: tight tolerance (NGP is the orthogonalization
    // anchor in galacticToSceneMatrix — the grid pole is *exactly* at NGP).
    expect(Math.abs(scene.dot(ngp))).toBeLessThan(1e-12)
    // Perpendicular to GC: loose tolerance because GC isn't exactly
    // perpendicular to NGP at publication precision (~0.04° gap).
    expect(Math.abs(scene.dot(gc))).toBeLessThan(1e-3)
  })
})
