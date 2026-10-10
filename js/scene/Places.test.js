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
  // default table is DEFAULT_TIER_FRAC = [0.75, 1.0, 1.5].
  const {places} = placesAt()
  it('reveals T0 above 0.75 (planet ≥ 75% of screen)', () => {
    expect(places.shouldShowTier(0, 0.749)).toBe(false)
    expect(places.shouldShowTier(0, 0.75)).toBe(true)
    expect(places.shouldShowTier(0, 5)).toBe(true)
  })
  it('reveals T1 above 1.0 (planet just fills the screen)', () => {
    expect(places.shouldShowTier(1, 0.999)).toBe(false)
    expect(places.shouldShowTier(1, 1.0)).toBe(true)
  })
  it('reveals T2 above 1.5 (planet 1.5× screen — close zoom)', () => {
    expect(places.shouldShowTier(2, 1.499)).toBe(false)
    expect(places.shouldShowTier(2, 1.5)).toBe(true)
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
    expect(places.tierGroups[0].children.length).toBe(1) // one sheet
  })

  it('is a no-op for an empty tier', () => {
    const {places} = placesAt()
    places.setEntries([{n: 'A', t: 1, lat: 0, lng: 0}]) // only tier 1
    places._buildTier(0)
    expect(places.tierGroups[0]).toBeUndefined()
  })
})


describe('Places labels as pick targets', () => {
  it('tags each tier\'s sheet with what its labels are of, in sheet order, and the body they are on', () => {
    const {places} = placesAt()
    places.setEntries([
      {n: 'Tycho', t: 0, lat: -43.31, lng: -11.36},
      {n: 'Plato', t: 0, lat: 51.62, lng: -9.38, a: 2000},
    ])
    places._buildTier(0)
    const {labelTargets, labelBody} = places.tierGroups[0].children[0].userData
    expect(labelTargets).toEqual([
      {kind: 'place', body: 'test', name: 'Tycho', lat: -43.31, lng: -11.36, alt: undefined},
      {kind: 'place', body: 'test', name: 'Plato', lat: 51.62, lng: -9.38, alt: 2000},
    ])
    expect(labelBody).toBe(places)
  })
})


describe('Places label sheets and the declutter', () => {
  const catalog = (n, t = 0) => Array.from({length: n}, (_, i) => ({
    n: `Place ${t}-${String(i).padStart(4, '0')}${'x'.repeat(i % 7)}`, t, lat: (i % 160) - 80, lng: ((i * 7) % 360) - 180,
  }))

  it('splits a big tier into sheets of a few hundred labels, each its own pick targets', () => {
    const {places} = placesAt()
    places.setEntries(catalog(450))
    places._buildTier(0)
    const sheets = places.tierGroups[0].children
    expect(sheets.map((g) => g.userData.labelTargets.length)).toEqual([192, 192, 66])
    // Every place is on exactly one sheet, and its target says which.
    const names = sheets.flatMap((g) => g.userData.labelTargets.map((t) => t.name))
    expect(new Set(names).size).toBe(450)
    for (const g of sheets) {
      expect(g.userData.labelRank.length).toBe(g.userData.labelTargets.length)
    }
  })

  it('opts its sheets into the declutter, the catalogue\'s larger features ranking higher', () => {
    const {places} = placesAt()
    places.setEntries(catalog(300))
    places._buildTier(0)
    const ranks = new Map
    for (const g of places.tierGroups[0].children) {
      expect(g.userData.declutter).toBe(true)
      g.userData.labelTargets.forEach((t, i) => ranks.set(t.name, g.userData.labelRank[i]))
    }
    const first = ranks.get(`Place 0-0000`)
    const later = ranks.get(`Place 0-0299${'x'.repeat(299 % 7)}`)
    expect(first).toBeGreaterThan(later)
    // A tier-1 place ranks below any tier-0 one.
    places.setEntries(catalog(10, 1))
    places._buildTier(1)
    const t1 = places.tierGroups[1].children[0].userData.labelRank
    expect(Math.max(...t1)).toBeLessThan(Math.min(...ranks.values()))
  })

  it('reveals the smallest tier near the ground, which a camera at the surface reaches', () => {
    const {places} = placesAt()
    expect(places.shouldShowTier(3, 1.79)).toBe(false)
    expect(places.shouldShowTier(3, 1.8)).toBe(true)
    // A camera in a body's face is a fraction of 2.0 at the default field.
    const cam = new PerspectiveCamera(45, 1, 0.1, 1e9)
    cam.position.set(0, 0, EARTH_R * 1.01)
    cam.updateMatrixWorld(true)
    expect(places.diameterFraction(cam, 600)).toBeGreaterThan(1.8)
  })

  it('frees every sheet it built', () => {
    const {places} = placesAt()
    places.setEntries(catalog(300))
    places._buildTier(0)
    expect(places.children.some((c) => c.userData.tier === 0)).toBe(true)
    places.setEntries([])
    expect(places.children.some((c) => c.userData.tier === 0)).toBe(false)
    expect(places.tierGroups.length).toBe(0)
  })
})


describe('Places builds the smallest tiers by cell, as the camera comes to see them', () => {
  const R = 1.7374e6
  const catalog = () => {
    const out = []
    for (let lat = -80; lat <= 80; lat += 10) {
      for (let lng = -170; lng <= 170; lng += 10) {
        out.push({n: `P${lat}/${lng}`, t: 2, lat, lng})
      }
    }
    return out
  }
  const camAt = (dist, lat = 0, lng = 0) => {
    const cam = new PerspectiveCamera(45, 1, 0.1, 1e10)
    const x = dist * Math.cos((lat * Math.PI) / 180) * Math.cos((lng * Math.PI) / 180)
    const y = dist * Math.sin((lat * Math.PI) / 180)
    const z = -dist * Math.cos((lat * Math.PI) / 180) * Math.sin((lng * Math.PI) / 180)
    cam.position.set(x, y, z)
    cam.updateMatrixWorld(true)
    return cam
  }
  const sheetsBuilt = (places, t) => places.tierGroups[t].children.flatMap((g) => g.children)
      .reduce((a, s) => a + s.userData.labelTargets.length, 0)

  it('builds no sheet for the tier until a camera sees the ground, then only that ground\'s', () => {
    const {places} = placesAt(new Vector3(0, 0, 0), R)
    places.setEntries(catalog())
    places._buildTier(2)
    expect(places.tierGroups[2].children.length).toBe(0)
    places._showCells(2, camAt(R * 1.15))
    const built = sheetsBuilt(places, 2)
    expect(built).toBeGreaterThan(0)
    expect(built).toBeLessThan(places.byTier[2].length / 4)
    // The place under the camera is there; the one opposite isn't.
    const names = places.tierGroups[2].children.flatMap((g) => g.children)
        .flatMap((s) => s.userData.labelTargets.map((t) => t.name))
    expect(names).toContain('P0/0')
    expect(names).not.toContain('P0/170')
  })

  it('hides cells it has built when the camera leaves them, and builds each only once', () => {
    const {places} = placesAt(new Vector3(0, 0, 0), R)
    places.setEntries(catalog())
    places._buildTier(2)
    places._showCells(2, camAt(R * 1.15, 0, 0))
    const first = places.tierGroups[2].children.slice()
    places._showCells(2, camAt(R * 1.15, 0, 180))
    expect(first.every((g) => g.visible === false)).toBe(true)
    expect(places.tierGroups[2].children.length).toBeGreaterThan(first.length)
    places._showCells(2, camAt(R * 1.15, 0, 0))
    expect(first.every((g) => g.visible === true)).toBe(true)
    // Back where it began: nothing new built.
    const count = places.tierGroups[2].children.length
    places._showCells(2, camAt(R * 1.15, 0, 0))
    expect(places.tierGroups[2].children.length).toBe(count)
  })

  it('takes the hemisphere in view from far off, and just the ground under a camera at the surface', () => {
    const {places} = placesAt(new Vector3(0, 0, 0), R)
    places.setEntries(catalog())
    places._buildTier(2)
    places._showCells(2, camAt(R * 50))
    expect(places.tierGroups[2].children.filter((g) => g.visible).length)
        .toBeGreaterThan(places.tierGroups[2].userData.cells.length * 0.45)
    places._showCells(2, camAt(R + 2, 45, 45))
    const visible = places.tierGroups[2].children.filter((g) => g.visible)
    expect(visible.length).toBeLessThanOrEqual(3)
  })

  it('is driven by the LOD hook: tier 2 appears from 1.5 body widths of screen', () => {
    const {places} = placesAt(new Vector3(0, 0, 0), R)
    places.setEntries(catalog())
    const renderer = {domElement: {clientHeight: 600}}
    places._lodHook.onBeforeRender(renderer, null, camAt(R * 3))
    expect(places.tierGroups[2]).toBeUndefined()
    places._lodHook.onBeforeRender(renderer, null, camAt(R * 1.2))
    expect(places.tierGroups[2].visible).toBe(true)
    expect(places.tierGroups[2].children.filter((g) => g.visible).length).toBeGreaterThan(0)
  })
})
