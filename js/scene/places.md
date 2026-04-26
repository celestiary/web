# Places — surface POIs on celestial bodies

Cities, craters, landing sites, and other named surface features on bodies
that opt in via `has_locations: true` in their JSON descriptor.

## Files

- `Places.js` — `class Places extends Group`, attached as a child of the
  rotating `planet` Object3D inside `Planet.newPlanet`.  Inherits axial tilt
  + sidereal rotation through the scene graph, so entries don't need
  per-frame quaternion math.
- `Places.test.js` — LOD math, tier bucketing, lazy SpriteSheet build.
- `Picker.queryPlaces` — O(N) screen-projection pick with back-hemisphere
  culling.  N is small (10s..few-thousand per body); a yaot2 spatial tree
  buys nothing at this size and would require transforming the ray into the
  body's rotated frame.
- `../search/providers/PlacesProvider.js` — lazy search provider for
  Tier C (per-anchor Fuse).  Caches per-body.

## Catalog file format

`/data/places/<bodyName>.json`:

```json
{
  "_attribution": "...",
  "_body": "moon",
  "_lngConvention": "east-positive (+E), -180..+180",
  "places": [
    {"n": "Tycho", "t": 0, "lat": -43.31, "lng": -11.36, "k": "crater"},
    {"n": "Apollo 11", "t": 0, "lat": 0.674, "lng": 23.473, "k": "landing"}
  ]
}
```

| Field | Required | Notes |
|---|---|---|
| `n` | yes | Display name (string) |
| `lat` | yes | Latitude in degrees, -90..+90 |
| `lng` | yes | Longitude in degrees, east-positive, -180..+180 |
| `t` | no | Tier 0..3 (default 0).  Lower tier = more prominent |
| `a` | no | Altitude above surface in meters (default 0) |
| `k` | no | Kind tag for UI / aliases ("city", "crater", "landing", …) |

Bulk numeric data — not Measure strings.  The Measure-string convention
applies to body-level scalars in the planet descriptors, not to thousands
of homogeneous coordinates.

## Tier scheme & LOD

Visibility = f(tier, planet apparent screen radius in pixels).  Computed
per-frame in `Places._installLODHook`'s `onBeforeRender`:

| Tier | screenPx ≥ | UX intent |
|---|---|---|
| T0 | 30 | small recognizable disc → only marquee names |
| T1 | 200 | planet fills ~20% of screen |
| T2 | 1500 | continent-scale view |
| T3 | (Phase 2 lazy chunks) | — |

Per-tier SpriteSheets are lazy-instantiated the first time their
threshold is crossed — most users browsing the solar system will never
build T2/T3 sheets.

## Label rendering: surface visibility mode

Places use `SpriteSheet(..., surfaceVisibility=true)` — a body-anchored
shader variant that:

- **Discards back-hemisphere labels per-vertex.** The vertex shader treats
  the sprite's body-local position as the surface normal at that point
  (since labels sit on the sphere, position / radius ≈ outward normal),
  computes view-space normal vs view direction, and the fragment shader
  discards if not front-facing.
- **Disables depth testing.** With visibility handled in shader, depth
  testing isn't needed — and would in fact re-introduce limb clipping.
  When the camera is close, a sprite extends in screen space at the
  anchor's depth, but the sphere there can be much closer to the camera
  than the anchor (curvature delta `(1 − cos Δθ) · camDist` exceeds 100 km
  for big labels at limb).  Without depth testing, labels render cleanly.

Picking (`Picker.queryPlaces`) reads body-fixed XYZ at the same un-lifted
altitude as the visual, so click zones match what the user sees.

## Currently catalogued bodies

- **moon** — 33 entries: Apollo/Luna/Chang'e landings, major maria,
  prominent craters, poles.  Source: IAU Gazetteer + NASA mission records.
- **earth** — ~40 entries: top global cities + landmarks.  Tier 0 = world-
  iconic (15 megacities + Everest, Grand Canyon, Pyramids); Tier 1 = ~30
  cities and landmarks.
- **mars** — 25 entries: every successful surface mission + named features
  (Olympus Mons, Valles Marineris, Hellas, all Tharsis volcanoes).
- **mercury** — 12 entries: Caloris and named craters.
- **venus** — 14 entries: Venera/Vega landers + Aphrodite/Ishtar Terrae.

Larger catalogs (Earth's full T2 ~5k cities, full IAU Gazetteer per body)
are planned for a follow-up via a build-script that filters source CSVs.
