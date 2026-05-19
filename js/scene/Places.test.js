import {describe, expect, it} from 'bun:test'
import {Object3D, PerspectiveCamera, Vector3} from 'three'

// SpriteSheet (built lazily inside _buildTier) reaches for document.* —
// stub the canvas APIs it touches.  Same pattern as Celestiary.test.js.
global.document = global.document ?? {
  createElement: () => ({
    setAttribute: () => {},
    getContext: () => ({
      fillStyle: '',
      font: '',
      textBaseline: '',
      fillRect: () => {},
      fill: () => {},
      fillText: () => {},
      save: () => {},
      restore: () => {},
      translate: () => {},
      measureText: () => ({width: 100, actualBoundingBoxAscent: 10, actualBoundingBoxDescent: 2}),
    }),
    width: 0,
    height: 0,
  }),
  body: {appendChild: () => {}},
}

const Places = (await import('./Places.js')).default


// ─── helpers ──────────────────────────────────────────────────────────────
const EARTH_R = 6.371e6


/** Wrap a Places under a parent at a given world position. */
function placesAt(parentPos = new Vector3(0, 0, 0), radius = EARTH_R) {
  const parent = new Object3D
  parent.position.copy(parentPos)
  parent.updateMatrixWorld(true)
  const places = new Places('test', radius)
  parent.add(places)
  parent.updateMatrixWorld(true)
  return {parent, places}
}


// ─── tests ────────────────────────────────────────────────────────────────
describe('Places.shouldShowTier', () => {
  // Thresholds are body-diameter / viewport-height fractions; the
  // default table is DEFAULT_TIER_FRAC = [0.06, 0.75, 1.3].
  const {places} = placesAt()
  it('reveals T0 above 0.06 (~6% of screen)', () => {
    expect(places.shouldShowTier(0, 0.059)).toBe(false)
    expect(places.shouldShowTier(0, 0.06)).toBe(true)
    expect(places.shouldShowTier(0, 5)).toBe(true)
  })
  it('reveals T1 above 0.75 (planet ≥ 75% of screen)', () => {
    expect(places.shouldShowTier(1, 0.749)).toBe(false)
    expect(places.shouldShowTier(1, 0.75)).toBe(true)
  })
  it('reveals T2 above 1.3 (planet larger than screen — almost landed)', () => {
    expect(places.shouldShowTier(2, 1.299)).toBe(false)
    expect(places.shouldShowTier(2, 1.3)).toBe(true)
  })
  it('returns false for a tier with no threshold', () => {
    expect(places.shouldShowTier(99, 1e9)).toBe(false)
  })
})


describe('Places.diameterFraction', () => {
  // The metric that actually drives tier reveal — verifies it's viewport-
  // relative so a single threshold reads identically across screen sizes.
  const cam = new PerspectiveCamera(45, 16 / 9, 1, 1e12)

  it('returns 0 when viewport height is zero or negative', () => {
    const {places} = placesAt()
    expect(places.diameterFraction(cam, 0)).toBe(0)
    expect(places.diameterFraction(cam, -1)).toBe(0)
  })

  it('reads the same fraction on 1080p and 4K at the same camera distance', () => {
    // Regression: an earlier absolute-pixel threshold gave wildly different
    // visual sizes across viewports.  With the fraction-based metric,
    // the visual size at which a tier reveals is viewport-independent.
    const {places} = placesAt(new Vector3(0, 0, 0))
    cam.position.set(0, 0, EARTH_R * 3)
    cam.updateMatrixWorld(true)
    const frac1080 = places.diameterFraction(cam, 1080)
    const frac2160 = places.diameterFraction(cam, 2160)
    expect(frac1080).toBeCloseTo(frac2160, 4)
  })

  it('= 2 × screenPx / viewportH', () => {
    const {places} = placesAt(new Vector3(0, 0, 0))
    cam.position.set(0, 0, EARTH_R * 5)
    cam.updateMatrixWorld(true)
    const vph = 1080
    expect(places.diameterFraction(cam, vph)).toBeCloseTo(
        (2 * places.screenPx(cam, vph)) / vph, 6)
  })
})


describe('Places.screenPx', () => {
  // 1080p viewport, 45 deg FOV
  const cam = new PerspectiveCamera(45, 16 / 9, 1, 1e12)
  const VPH = 1080

  it('grows as the camera approaches the body', () => {
    const {places} = placesAt(new Vector3(0, 0, 0))
    cam.position.set(0, 0, EARTH_R * 100)
    cam.updateMatrixWorld(true)
    const farPx = places.screenPx(cam, VPH)

    cam.position.set(0, 0, EARTH_R * 5)
    cam.updateMatrixWorld(true)
    const nearPx = places.screenPx(cam, VPH)

    expect(nearPx).toBeGreaterThan(farPx)
  })

  it('matches the small-angle approximation when camera is far', () => {
    const {places} = placesAt(new Vector3(0, 0, 0))
    const camDist = EARTH_R * 1000 // tiny apparent disc
    cam.position.set(0, 0, camDist)
    cam.updateMatrixWorld(true)
    const px = places.screenPx(cam, VPH)
    // Small-angle: angRad ≈ R / d; pixels ≈ angRad / halfFov * (vph / 2)
    const expected = (EARTH_R / camDist) / ((45 * Math.PI) / 360) * (VPH / 2)
    expect(px).toBeCloseTo(expected, 1)
  })

  it('returns 0 when no parent', () => {
    const orphan = new Places('orphan', EARTH_R)
    expect(orphan.screenPx(cam, VPH)).toBe(0)
  })
})


describe('Places.setEntries', () => {
  it('buckets entries by tier', () => {
    const {places} = placesAt()
    places.setEntries([
      {n: 'A', t: 0, lat: 0, lng: 0},
      {n: 'B', t: 0, lat: 1, lng: 1},
      {n: 'C', t: 1, lat: 2, lng: 2},
      {n: 'D', t: 2, lat: 3, lng: 3},
    ])
    expect(places.byTier[0].length).toBe(2)
    expect(places.byTier[1].length).toBe(1)
    expect(places.byTier[2].length).toBe(1)
  })

  it('treats missing t as tier 0', () => {
    const {places} = placesAt()
    places.setEntries([
      {n: 'A', lat: 0, lng: 0},
      {n: 'B', t: 1, lat: 0, lng: 0},
    ])
    expect(places.byTier[0].length).toBe(1)
    expect(places.byTier[1].length).toBe(1)
  })

  it('does not build tier sheets eagerly', () => {
    const {places} = placesAt()
    places.setEntries([{n: 'A', t: 0, lat: 0, lng: 0}])
    // No tier groups built until LOD hook fires
    expect(places.tierGroups.length).toBe(0)
  })

  it('handles an empty catalog without error', () => {
    const {places} = placesAt()
    places.setEntries([])
    expect(places.byTier.length).toBe(0)
  })
})


describe('Places._buildTier (lazy)', () => {
  it('builds the requested tier and adds it to the scene graph', () => {
    const {places} = placesAt()
    places.setEntries([
      {n: 'Tycho', t: 0, lat: -43.31, lng: -11.36},
      {n: 'Plato', t: 0, lat: 51.62, lng: -9.38},
    ])
    places._buildTier(0)
    expect(places.tierGroups[0]).toBeDefined()
    expect(places.tierGroups[0].userData.tier).toBe(0)
    expect(places.children.includes(places.tierGroups[0])).toBe(true)
  })

  it('is a no-op for an empty tier', () => {
    const {places} = placesAt()
    places.setEntries([{n: 'A', t: 1, lat: 0, lng: 0}]) // only tier 1
    places._buildTier(0)
    expect(places.tierGroups[0]).toBeUndefined()
  })
})
