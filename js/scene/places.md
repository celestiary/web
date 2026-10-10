# Places — surface POIs on celestial bodies

Cities, craters, landing sites, and other named surface features on bodies
that opt in via `has_locations: true` in their JSON descriptor.

## Files

- `Places.js` — `class Places extends Group`, attached as a child of the
  rotating `planet` Object3D inside `Planet.newPlanet`.  Inherits axial tilt
  + sidereal rotation through the scene graph, so entries don't need
  per-frame quaternion math.
- `Places.test.js` — LOD math, tier bucketing, lazy SpriteSheet build.
- `../placeCells.js` — the smallest tiers' labels grouped by cell of the
  sphere, built when the camera can see the ground ([Tier scheme &
  LOD](#tier-scheme--lod)).
- `../labelDeclutter.js` — which labels are drawn where two touch: a place
  gives way to a larger feature's, a body's name to a larger body's, and the
  target's is never hidden ([Declutter](#declutter)).
- `../../../tools/places/` — the script that builds every catalogue below
  from the IAU Gazetteer, with the curated entries it merges
  ([The Gazetteer](#the-gazetteer)).
- `../labelPick.js` — picking: each tier's sheet carries `labelTargets` (what
  each label is of) and `labelBody`, and a click is a hit on a label's own
  text box, the far side's excluded (see below).
- `../search/providers/PlacesProvider.js` — lazy search provider for
  Tier C (a Fuse per body).  Caches per-body; loaded when a search's scope
  includes the body (see Search below).

## Catalog file format

`/data/places/<bodyName>.json`:

```json
{
  "_attribution": "IAU Gazetteer of Planetary Nomenclature, USGS Astrogeology ... Public domain. ...",
  "_body": "moon",
  "_source": "https://asc-planetarynames-data.s3.us-west-2.amazonaws.com/MOON_nomenclature_center_pts.zip",
  "_sourceModified": "2026-10-09",
  "_newestApproval": "2026-09-21",
  "_generator": "tools/places/build.mjs",
  "_lngConvention": "east-positive (+E), -180..+180",
  "_latConvention": "planetocentric",
  "places": [
    {"n": "Apollo 11", "t": 0, "lat": 0.674, "lng": 23.473, "k": "landing"},
    {"n": "Tycho", "t": 0, "lat": -43.2958, "lng": -11.2153, "k": "crater"}
  ]
}
```

Within a tier the places are in order of importance, the curated ones (landers,
poles) first and then the Gazetteer's largest first: the declutter reads that
order as the rank (see below).  Earth's file is its own, by hand (the tiers
below), and has no `_source`.

| Field | Required | Notes |
|---|---|---|
| `n` | yes | Display name (string) |
| `lat` | yes | Latitude in degrees, -90..+90 |
| `lng` | yes | Longitude in degrees, east-positive, -180..+180 |
| `t` | no | Tier 0..3 (default 0).  Lower tier = more prominent |
| `a` | no | Altitude above surface in meters (default 0) |
| `k` | no | Kind tag for UI / aliases: the Gazetteer's feature type in the singular ("crater", "mons", "planitia", "terra", …), or "city", "landing", "lander", "rover", "pole" |

Bulk numeric data — not Measure strings.  The Measure-string convention
applies to body-level scalars in the planet descriptors, not to thousands
of homogeneous coordinates.

## Tier scheme & LOD

Visibility = f(tier, planet apparent screen radius in pixels).  Computed
per-frame in `Places._installLODHook`'s `onBeforeRender`:

| Tier | diameterFraction ≥ | UX intent |
|---|---|---|
| T0 | 0.75 | planet fills ~3/4 of the screen — marquee names appear |
| T1 | 1.00 | planet fills the screen — major cities add |
| T2 | 1.50 | planet 1.5× screen — close-zoom picking, all cities |
| T3 | 1.80 | the smallest features, near the ground (a camera within 1.2 R of the centre, at 45° field of view) |

`diameterFraction` is the body's apparent diameter as a fraction of
viewport height, e.g. `0.75` means the body's screen diameter ≈ 75 %
of the viewport's vertical extent.  Viewport-relative on purpose: an
earlier absolute-pixel threshold (T1 = 400 px radius) gave a "planet
fills 74 %" reveal on 1080p but only ~18 % on 8K, so users on larger
displays saw T1 names at the initial d=10R fly-in.

The whole reveal sequence is intentionally in the "planet is large"
regime — at the default FOV (45°), the camera-distance →
diameter-fraction mapping is:

| Camera distance | diameter / vph | Visible tiers |
|---|---|---|
| 10 R (initial fly-in) | 0.25 | (none) |
| 3.3 R                 | 0.75 | T0 |
| 2.4 R                 | 1.00 | T0, T1 |
| 1.5 R                 | 1.50 | T0, T1, T2 |
| 1.2 R                 | 1.80 | T0, T1, T2, T3 |
| R (surface)           | 2.0  | T0, T1, T2, T3 |

(Where `R` is the body's surface radius.)  The mapping is independent
of viewport size — `Places.diameterFraction` divides by viewport
height, so the table holds for 720p / 1080p / 4K / 8K alike.

`Places.screenPx` is still exposed for tests and debugging (it returns
the absolute pixel-radius), but tier reveal goes through
`diameterFraction`.

Per-tier SpriteSheets are lazy-instantiated the first time their
threshold is crossed — most users browsing the solar system will never
build T2/T3 sheets.

A tier is a group of sheets of at most 192 labels each (`SHEET_LABELS`), each
its own texture, its canvas sized to its labels (`SpriteSheet.sideToPack`: the
labels longest first in rows, not the longest label times the count).  A label
is a square point sprite, so a sheet of names is mostly empty: 192 names are a
canvas of about 1,300 px a side, and the Moon's 1,500 smallest craters would be
a texture of 4,000 px if they were one sheet.  So tiers 2 and 3
(`CELL_FROM_TIER`) group their places by cell of the sphere, 30° of latitude
by 30° of longitude (`placeCells.js`), and build a cell's sheets the first
time the camera can see its ground: a surface label is seen only inside the
horizon's cap (the angle from the camera's nadir whose cosine is the body's
radius over the camera's distance, the same test the labels' shader makes), so
a cell is built and drawn while that cap, widened by the cell's own reach,
touches it.  From a height of 0.2 R a tenth of the sphere is in view; the cells
are kept once built and hidden when out of view.  The Moon's tiers 2 and 3 are
3.3 MP and 9.5 MP of canvas if built all at once, and a few of those at a time
this way.  The threshold of the last tier was 8.0, which the default field of
view reaches only by zooming the lens (a body in the camera's face is 2.0), so
a T3 never showed; it is 1.8 now, for the gazetteer's smallest features.

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

### Picking

One model for every label (DESIGN.md [Picking labels](../../DESIGN.md#picking-labels)):
a click or tap on a place name targets it (its body, and the point: `c`
faces it, `g` lands there, `t` follows it as the body turns; the breadcrumb
reads Sun › Earth › Austin and the link `#sun/earth/austin@…`, by the
name's slug), a double click or tap lands there.  The hit is
on the label's own text box on screen (`labelPick.labelBoxes`), from the
same body-fixed positions as the drawing, so click zones are what the user
sees; labels on the far side aren't hit, as the shader discards them.

It used to be a click anywhere within 100 px of a place (`Picker.queryPlaces`,
removed) that landed at the nearest one.

### Search

Every place is searchable from any scope that includes its body: Earth's
from under Earth, the Sun (the solar system) or the root, with the root's and
the Sun's ranking below bodies and stars that match as well.  The Moon's
are in Earth's scope too, as the Moon is.  Picking a result in the dropdown
targets it, Go lands there
([js/search/DESIGN.md](../search/DESIGN.md#places-in-the-index)).

## Under a Cesium layer

The labels stay on while a Cesium layer is active on Earth, the Moon or Mars:
they draw in the overlay pass after the composite, so Cesium's globe doesn't
cover them, and the shader's back-hemisphere discard hides the far side.
`CesiumLayers._hideSurface` hides only the surface group
([CESIUM.md](../../CESIUM.md#what-changes-while-a-cesium-layer-is-active),
#172).

## The Gazetteer

Every body below but Earth has its names from the IAU's Gazetteer of
Planetary Nomenclature ([#170](https://github.com/celestiary/web/issues/170)),
built by `tools/places/build.mjs` into `public/data/places/<body>.json`.  The
files are checked in (a rebuild is for when the Gazetteer adds names or the
rules below change), 8,226 places and 650 KB for the 23 bodies, so none is in
Git LFS ([data policy](../../DESIGN.md#data-policy): over about 1 MB there).

**Source.**  USGS Astrogeology's planetary nomenclature data bucket,
`https://asc-planetarynames-data.s3.us-west-2.amazonaws.com/`: the same
downloads the Gazetteer's site serves (planetarynames.wr.usgs.gov, which
this project's sandbox can't reach), one `<TARGET>_nomenclature_center_pts.zip`
per body, a shapefile whose attribute table (`.dbf`) holds each feature's
name, type, diameter, centre and bounding box, approval date and origin.  The
script reads the table only.  The Gazetteer has no release number; a
catalogue's header says what it was built from: `_source` (the URL),
`_sourceModified` (the file's last-modified date in the bucket) and
`_newestApproval` (the latest approval date in the table).  The current
catalogues are from files downloaded 2026-10-10, last modified 2026-10-09 in
the bucket; the newest approvals range from 2026-09-22 (Mercury) and 2026-09-21
(the Moon) back to 1973 (Deimos).

**Attribution.**  "IAU Gazetteer of Planetary Nomenclature, USGS
Astrogeology Science Center and the IAU Working Group for Planetary System
Nomenclature (WGPSN)."  The names are the IAU's, the data USGS's (public
domain); each file's `_attribution` says so, and credits NASA and Roscosmos
mission records for the landing sites kept from before.

**Coordinates.**  The files list `center_lat` and `center_lon`: planetocentric
latitude and east-positive longitude, 0 to 360, for every body here (the site
also offers planetographic and west-positive forms; they aren't in these
downloads).  The script wraps the longitude to -180..+180, the catalogue's
convention, and rounds to 0.0001° (10 m on the Moon).  Checked against known
places before the format was trusted: Loki Patera 13.0°N 51.2°E (308.8°W),
Pele 18.7°S 104.7°E (255.3°W), Valhalla 14.7°N 304°E (56°W), Sputnik Planitia
19.5°N 178.7°E, Xanadu 15°S 260°E (100°W), Olympus Mons 18.65°N 226.2°E,
Tycho 43.3°S 348.8°E.  And against the rendered surface, with each anchor
drawn on the body's texture (headless Chromium, 2026-10-10): Tycho's falls on
the crater's centre, Olympus Mons's in its caldera (Ascraeus Mons's on the
next volcano), and Valhalla's at the middle of its ringed bright basin.

**Which rows.**  All of a body's rows except the types that aren't names to
read on a ground: "Satellite Feature" (the Moon's 7,064 lettered satellite
craters, "Tycho A"), "Astronaut-named features" (81 metre-scale features at
Apollo sites) and "Statio" (the landing sites' own names, which the curated
landings mark).  One place to a name (a repeated name keeps its largest).

**Tiers.**  By what a feature is on the body, not by an absolute size, so each
body shows a sensible handful at tier 0 whatever its size
(`tools/places/tiers.mjs`):

- A feature's size is its diameter over the body's (celestiary's own radius
  in `public/data/<body>.json`), halved for the features that are a length
  (vallis, fossa, catena, rima, dorsum, rupes, scopulus, sulcus, serpens, linea,
  flexus, virga); with no diameter, its bounding box's longer side on the
  ground; with neither, 0.03 (tier 2).
- Tier 0: 0.2 of the body's width or more (about 100 px of a 650 px high
  view at the zoom tier 0 shows at: a name's width); the largest 12 if more
  qualify, the largest 3 if fewer.  Tier 1: 0.08 or more (50 px at tier 1's
  zoom).  Tier 2: 0.025 or more (25 px).  Tier 3: the rest, under 30 px at the
  zoom it shows at (a disc of 1.8 screens).
- A body whose features are all small beside it (Callisto's craters) still has
  its largest 20 in tiers 0-1 and its largest 80 in tiers 0-2.
- The curated entries merge in (`tools/places/curated/<body>.json`, the
  hand-picked ones the catalogues had before: the landers and rovers, the
  poles, the famous craters and maria).  One that names a Gazetteer feature
  takes the Gazetteer's position and kind and keeps its own tier if that is
  higher, so Tycho (85 km, 0.024 of the Moon) stays at tier 0 where size would
  put it in tier 3; "Gale Crater" meets the Gazetteer's "Gale".  The rest are
  kept as they were, first in their tier.
- `tools/places/promote.json` lifts Gazetteer names that are better known than
  their size says (Loki Patera, Pele, Ligeia Mare, Cassini Regio...), by name
  only, so the position stays the Gazetteer's; the script warns of one that
  isn't a name.

**The script.**  `node tools/places/build.mjs [body...]` downloads each body's
zip once into `tools/places/.cache` (git-ignored; `--cache DIR` to put it
elsewhere) and writes the catalogues, the same bytes for the same download;
`--check` writes nothing and prints each body's tier counts and its tier 0.
It needs no packages (`readers.mjs` reads the ZIP and dBase files).  The
`BODIES` table at its top maps celestiary's body to the Gazetteer's target;
adding a body is a line there (and `has_locations: true` in its descriptor).
Tests (`tools/places/places.test.js`) run on small fixtures and never touch
the network.

**Per body** (places, then by tier 0/1/2/3, tier 0 including the curated):

| Body | Places | Tiers | Body | Places | Tiers |
|---|---|---|---|---|---|
| Mercury | 608 | 13/26/217/352 | Titan | 304 | 10/30/92/172 |
| Venus | 1,991 | 18/137/369/1,467 | Titania | 18 | 3/15/0/0 |
| Moon | 1,948 | 24/40/371/1,513 | Oberon | 10 | 3/7/0/0 |
| Mars | 2,063 | 24/127/359/1,553 | Triton | 63 | 3/17/43/0 |
| Phobos | 20 | 5/15/0/0 | Proteus | 1 | 1/0/0/0 |
| Deimos | 2 | 2/0/0/0 | Pluto | 73 | 12/26/35/0 |
| Io | 260 | 9/31/96/124 | Charon | 15 | 5/10/0/0 |
| Europa | 129 | 12/55/14/48 | Dione | 95 | 11/20/58/6 |
| Ganymede | 196 | 12/30/39/115 | Rhea | 144 | 5/16/88/35 |
| Callisto | 154 | 3/17/60/74 | Tethys | 53 | 4/16/33/0 |
| Hyperion | 5 | 3/2/0/0 | Iapetus | 70 | 12/9/49/0 |
| Janus | 4 | 3/1/0/0 | | | |

**Earth** keeps its own file: 178 places, by hand.  Tier 0 (20) = world-iconic
megacities + Everest, Grand Canyon, Pyramids, poles; Tier 1 (23) = major
cities and landmarks (>1M pop); Tier 2 (135) = secondary cities (~500k-3M) and
regional capitals worldwide.  Reveal-threshold tuning means T2 only paints at
continent-scale zoom, so the from-space view stays uncluttered.  It could gain
natural features from Natural Earth.

**Not here.**  Ceres and Vesta are in the Gazetteer, but celestiary draws them
as points of the asteroid list (`asteroids.ssc`), with no body to put names
on; they, and Enceladus, Mimas, Miranda and the others the Gazetteer has for
moons celestiary doesn't model, are a line in `BODIES` once they have a
descriptor.  Spacecraft and exoplanet names are later
([ROADMAP.md](../../ROADMAP.md#shared-engines)).

## Declutter

Labels that would touch are thinned ([#207](https://github.com/celestiary/web/issues/207)):
the places' names, with tens to hundreds in view at tiers 2 and 3, and the
bodies' (Jupiter and its four Galileans at a telescope's field, a few pixels
apart).  One pass a frame, `labelDeclutter.js`, for the sheets that opt in
(`userData.declutter`: the places' and the bodies'): the target's label
first, then by rank, and a label that touches one already drawn is hidden.  A
place's rank is its tier and then its order in the tier, which the catalogue
keeps largest first; a body's is its radius.  The mechanism, the order and the
cost are in [DESIGN.md, Declutter](../../DESIGN.md#declutter).

## Currently catalogued bodies

The 23 bodies of [The Gazetteer](#the-gazetteer) (Mercury, Venus, the Moon,
Mars and its moons, the Galileans, Saturn's Dione, Hyperion, Iapetus, Janus,
Rhea, Tethys and Titan, Uranus's Titania and Oberon, Neptune's Triton and
Proteus, Pluto and Charon), and Earth's own 178.  What each has at tier 0 is
printed by `node tools/places/build.mjs --check`.

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
