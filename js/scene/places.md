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
| T1 | 400 | one step past the initial fly-in — major cities |
| T2 | 700 | "almost landed" zoom — secondary cities |
| T3 | (Phase 2 lazy chunks) | — |

`screenPx` is the body's apparent *radius* in viewport pixels (see
`Places.screenPx`).  At the default FOV (45°) and a 1080-px-tall
viewport, the camera distance → screenPx mapping is roughly:

| Camera distance | screenPx | Visible tiers |
|---|---|---|
| 10 R (initial fly-in) | 137 | T0 |
| 3.3 R | 400 | T0, T1 |
| 1.8 R | 700 | T0, T1, T2 |
| R (surface)            | 1080 | T0, T1, T2 |

(Where `R` is the body's surface radius.)  Earlier T1 was 200 which let
the T1 sheet fire at the initial fly-in on 4K displays (screenPx≈274 at
d=10R); T1=400 keeps the initial view clean across all common
viewports.

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
- **earth** — ~165 entries.  Tier 0 = 15 world-iconic megacities + Everest,
  Grand Canyon, Pyramids, poles; Tier 1 = ~30 major cities and landmarks
  (>1M pop); Tier 2 = ~115 secondary cities (~500k-3M) and regional
  capitals worldwide — Austin, Denver, Madrid, São Paulo, Shanghai,
  Melbourne, etc.  Reveal-threshold tuning means T2 only paints at
  continent-scale zoom, so the from-space view stays uncluttered.
- **mars** — 25 entries: every successful surface mission + named features
  (Olympus Mons, Valles Marineris, Hellas, all Tharsis volcanoes).
- **mercury** — 12 entries: Caloris and named craters.
- **venus** — 14 entries: Venera/Vega landers + Aphrodite/Ishtar Terrae.

Larger catalogs (full IAU Gazetteer per body) are planned for a follow-up
via a build-script that filters source CSVs.

## Double-click to land anywhere

`Scene.onDblClick` complements the named-place catalog by letting the user
land at *any* surface point on the currently-targeted body.  Implementation
in `Picker.pickSurfaceLatLng`: ray-sphere intersection against the body's
implicit sphere (center = body world position, radius = `props.radius.scalar`),
then `worldToLatLngAlt` to recover (lat, lng) in the body-fixed frame.

The picked spot gets a temporary lat/lng marker (a one-entry SpriteSheet
attached to the rotating body so it inherits sidereal rotation, stashed on
`bodyNode._tempMarker` for replacement on the next dblclick).  The marker
respects the 'p' visibility group like the named places.
