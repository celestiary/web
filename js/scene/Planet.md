# Planet shader extensions

`Planet.nearShape` builds the visible planet surface from a cached
`MeshPhysicalMaterial` and patches its fragment shader via
`onBeforeCompile` for two body-specific effects.  Both are JSON-gated in
the body descriptor.

## texture_dir — per-body asset subdirectory

Optional string under `/textures/`.  When set, all the body's texture
loads (`Material.cacheMaterial`, `pathTexture(body_terrain)`,
`pathTexture(body_hydro)`, `pathTexture(body_night)`, clouds atmos
texture) prepend the prefix.  Keeps a body's many maps organized:

```json
"texture_dir": "earth/"
```

→ resolves to `/textures/earth/earth_terrain.jpg`, etc.  Bodies without
`texture_dir` keep loading from `/textures/<file>.jpg` as before.

## texture_hydrosphere — ocean roughness map

Existing surface mod (predates the night-lights feature): replaces the
`<roughnessmap_fragment>` chunk to invert the hydrosphere alpha map so
oceans render as smooth (low roughness, mirror-like reflection) and land
as rough (high roughness, diffuse).  Inherited unchanged.

## texture_night — emissive city lights on the night side

Loads `<body>_night.jpg` (NASA Black Marble or equivalent equirectangular
night-lights texture, typically public domain) and adds emissive
contribution where the surface faces away from the sun.

```json
"texture_night": true
```

### Where to get the texture

NASA Earth Observatory's Black Marble is the canonical source — public
domain, multiple resolutions: https://earthobservatory.nasa.gov/features/NightLights

Drop the file at `/textures/<body>/<body>_night.jpg` (when `texture_dir`
is set) or `/textures/<body>_night.jpg` (otherwise).  Missing file
degrades silently — texture loader logs a warning and the night side just
stays dark.

**Earth's `earth/earth_night.jpg`** (3600×1800, equirectangular, −180° at
the left edge) is NASA's VIIRS Black Marble 2016 composite (Suomi NPP, NASA
Earth Observatory, public domain), the product NASA GIBS serves as the
`VIIRS_Black_Marble` WMTS layer, which is the source of Cesium's Earth's
lights ([CESIUM.md, night lights](../../CESIUM.md#night-lights)).  Checked
against GIBS's own tiles (#93): at level 4, over six tiles from the
Americas to Asia, the two agree in mean colour to within 4% per channel (the
dark Pacific tile's red, 6.0 against 7.0, is the worst: 1 level), in the
99th percentile of brightness to within 8%, and correlate 0.94-0.98 per pixel (the rest is the texture's 11 km pixels against a
tile's 2.4 km).  So the texture stays: nothing was baked, no new data, and
the two sides of the Cesium swap show the same data.  GIBS's other layer,
`VIIRS_CityLights_2012`, is the older composite in another stretch (a
European tile's median brightness 1.6× this one's), so it wouldn't match.

If it is ever rebuilt at a higher resolution from GIBS, say for celestiary's
own Earth seen from low down (Cesium's side has the 600 m tiles; the
texture's pixel is 11 km): fetch
`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{row}/{col}.png`
at level 5 (32×32 tiles of 256 px: 8192 px of Web Mercator, ±85.05°),
resample each output row to its latitude (the Mercator row `(1 − asinh(tan
lat) / π) / 2`) into 8192×4096 equirectangular, repeating the edge rows to
the poles, and save as JPEG.  That is over the 1 MB line, so under
`public/large/` in Git LFS and loaded with `dataUrl()` ([DESIGN.md data
policy](../../DESIGN.md#data-policy)), and 4× the texture memory of this one.

### Brightness: what the texture's values are

The tiles and the texture are the Black Marble as a picture (8-bit, stretched,
the land's faint floor of moonlit snow and airglow lifted into blue), not the
calibrated radiance (nW/cm²/sr) of the VIIRS day-night band, which these
products don't carry, so the values can't be converted to physical units: a
texel is a display value in 0-1, and the radiance for a full white texel is
a scale calibrated by eye, `NIGHT_LIGHT_RADIANCE` in `exposure.js`: 3e-5 of
a sunlit white (1 cd/m², a city core seen from above, against ~3e4 cd/m² for
the white), so 4.5e-5 of the buffer at the keyed exposure, invisible beside
a day side, and under the night side's metered gain (up to 4e6) the cities
bright and the unlit ocean a dark blue.  The texel is used as stored, linearly
(no sRGB decode, as every surface texture here is read).

Both sides of the Cesium swap use the scale and the form.  Celestiary's
surface shader adds `texel × smoothstep(−0.05, 0.05, −N·L) × radiance`
before the exposure multiply; Cesium's Earth adds the GIBS texel by the same
band, the same radiance and the renderer's exposure, in a pass of its own
(`CesiumLayers._drawNightLights`).  Over Europe at night from 4,000 km the
two renders agree to 0.4% in the median pixel (R, G and B alike 1.00) and
within 3% in the mean (`earth-night-europe`).

### Shader injection

Two `onBeforeCompile` patches, chained via `shaderMods` so multiple mods
(hydrosphere + night) coexist on one material:

1. After `<common>` — declare uniforms `uNightMap` (sampler) and
   `uSunDirection` (vec3, view space).
2. Before `<tonemapping_fragment>` — sample the night map at `vMapUv`,
   compute `nightFactor = smoothstep(-0.05, 0.05, -dot(normalize(vNormal), uSunDirection))`
   (0 fully day → 1 fully night, soft 6° band around the terminator), and
   add `nightLight * nightFactor * RADIANCE` to `gl_FragColor.rgb`
   *before* tonemapping so city lights pass through the same exposure and
   tonemap chain as the rest of the surface.  `RADIANCE` is
   `NIGHT_LIGHT_RADIANCE` (`exposure.js`, 3e-5, the texture's full white as 1 cd/m²
   against a sunlit white's 3e4) times a sunlit white's radiance in three's
   units, so the lights are in exposure units like the lit surface
   ([HDR.md](HDR.md#metered-exposure)): beside a sunlit day side they are
   black, as a camera at the terminator sees them, and on the night side
   alone the metered exposure brings them to 0.6 at most.  They were a
   fixed display value (`1.5 / toneMappingExposure`), which the meter
   read as a luminance falling with its own gain, and ran away on.

Earlier versions tried `<output_fragment>` — that chunk was renamed
`<opaque_fragment>` in Three.js r155+, so the string-replace silently
failed.  `<tonemapping_fragment>` is stable across versions.

Cesium's Earth adds the same light in a pass of its own ([CESIUM.md, night
lights](../../CESIUM.md#night-lights)).

### Per-frame sun direction

`surface.onBeforeRender` recomputes `uSunDirection` each frame: sun lives
at world origin (worldGroup centre), so the direction from the planet to
the sun is `−planetWorldPos.normalize()`, then `.transformDirection`
into the camera's view matrix to match `vNormal` (which Three.js writes
in view space).

## Clouds

Earth's clouds are a layer of their own (#88), not baked into the surface:
the Blue Marble on both sides of the Cesium swap is cloud-free, so one cloud
shell is drawn over whichever surface is there.  `earth.json` turns it on
(`"clouds": "gibs"`); the code is `js/scene/clouds/`.

### Source: NASA GIBS's daily true colour

The simulation date's **Corrected Reflectance (true colour)** mosaic from
NASA GIBS (Global Imagery Browse Services), WMTS in plate carrée (EPSG:4326,
`best`), the `250m` matrix set at **level 2**: 5 × 3 tiles of 512 px (the
last row half past the south pole), a 2560 × 1280 map, about 16 km a pixel
at the equator, about 1.2 MB of JPEG a day.  Fetched from
`gibs.earthdata.nasa.gov`, which sends CORS headers; no key.  NASA imagery,
public domain; GIBS asks to be acknowledged ("imagery provided by services
from NASA's Global Imagery Browse Services (GIBS), part of NASA's Earth
Science Data and Information System (ESDIS)").

The layer, by date (`cloudSource.js`, `cloudSource`; start dates from
GIBS's GetCapabilities, 2026-10):

| Date | Primary | Fills its gaps |
|---|---|---|
| from 2018-01-05 | `VIIRS_NOAA20_CorrectedReflectance_TrueColor` | `VIIRS_SNPP_…` |
| 2015-11-24 to 2018-01-04 | `VIIRS_SNPP_CorrectedReflectance_TrueColor` | `MODIS_Aqua_…` |
| 2002-07-03 to 2015-11-23 | `MODIS_Aqua_CorrectedReflectance_TrueColor` | `MODIS_Terra_…` |
| 2000-02-24 to 2002-07-02 | `MODIS_Terra_CorrectedReflectance_TrueColor` | |
| the present (the last ~27 h) | the latest complete UTC day's, as above | |
| before 2000-02-24, or the future | the bundled texture (below) | |

A day's mosaic is one UTC day of the satellite's swaths, each place seen once
at its local overpass time (13:30 for Aqua and the VIIRS, 10:30 for Terra).
So the clouds don't move with the simulation's time of day: they are that
day's early-afternoon clouds everywhere.  VIIRS's swaths overlap, so its
gaps are polar night; MODIS's leave wedges between swaths at the equator,
which the second satellite's cross.  GIBS answers 404 for a day missing from
a layer (there are a few in each), and the secondary covers it.

**Why true colour.**  It is what NASA's photographs of Earth show (thin
cloud translucent, thick cloud white), from the same instruments as the
Blue Marble under it, at the map's full resolution, in a JPEG that needs no
colour table.  The alternatives on GIBS:

- Cloud fraction (`MODIS_*_Cloud_Fraction_Day`) and the cloud mask: a
  fraction of a 5 km cell, not an appearance (thin cirrus counts as fully
  cloudy), in a colour-mapped PNG to decode.
- Cloud-top temperature, height or pressure, and the infrared brightness
  temperature (`MODIS_*_Brightness_Temp_Band31_*`): day and night, but warm,
  low cloud reads as ground; colour-mapped.  Worth having for the night
  side, and for #169's cloud heights.
- The geostationary infrared (`GOES-East_ABI_Band13_Clean_Infrared`,
  `Himawari_AHI_…`): near real time, but each only its own disc, and only
  for recent years.
- Monthly fields (`MERRA2_ISCCP_Cloud_Albedo_Monthly`, from 1980): smooth
  50 km means, which look like haze, not clouds.

### From a picture to coverage: unmixing over the Blue Marble

Each pixel of the mosaic is taken as a white cloud of coverage `c` over the
known ground `G`, the month's Blue Marble (stored values, 0-1), scaled to the
map: `O = c·W + (1 − c)·G`, with `W` = `CLOUD_WHITE` 0.92 (a thick cloud top
in the mosaics, just short of saturating).  Each channel gives `c = (O − G) /
(W − G)` (its denominator floored at 0.05, for snow and ice); the least of the
three is taken, as a cloud brightens all three, and a shift in one (smoke,
greener vegetation than 2004's, a different stretch) isn't cloud.  Then 0.15
to 0.85 is stretched to 0-1 (`COVERAGE_CLEAR`, `COVERAGE_FULL`): over a MODIS
Aqua day (2005-08-28) and a VIIRS NOAA-20 day (2025-04-12), against the
month's Blue Marble, clear ocean unmixes to 0.05-0.15 (the mosaics' ocean is
hazier than the Blue Marble's), clear land to about 0, and thick cloud to
0.9-1.0.

Because the clouds are unmixed against the very ground they are drawn over,
cloud over ground in the scene buffer (`c × the lit cloud + (1 − c) × the lit
ground`, both stored × Lambert) gives back the mosaic, in the same stored
values as every surface (HDR.md, "Colour spaces").

- **No data** is black (every channel 3 or under, of 255), and so are the
  two pixels round it (JPEG darkens a gap's edges, which would unmix as
  clear).  It is filled from the secondary layer's tile, fetched when more
  than 0.2% of the tile is unseen; then, where the gap is under 96 px wide
  (MODIS's wedges where Aqua's and Terra's cross), from the coverage either
  side along the row, smoothed down the column; and what's left (polar
  night) from the bundled texture.  Polar night is dark, so there the fill
  shows only in the night lights it dims.
- **A tile neither layer can serve** (the network, or a day missing from
  both) has no clouds, and the load logs one warning.  Each tile is tried
  twice.
- **Known flaws.**  Sun glint over the ocean, grey streaks along the
  swaths' centres, unmixes as thin cloud (0.2-0.5).  Snow and sea ice that
  differ from 2004's unmix as cloud, and snow under cloud is hard to see
  through (the floor of 0.05).  Neither has a simple fix without the
  viewing geometry or a snow mask.

**The bundled texture**, `earth/earth_atmos.jpg` (2048 × 1024, greyscale; its
source wasn't recorded), stands in where there is no daily mosaic.  It is an
infrared cloud picture: cold, high cloud white, and the warm ground grey
(0.29-0.36 over Australia), so 0.37 to 0.65 is stretched to 0-1
(`BUNDLED_CLEAR`, `BUNDLED_FULL`).  Its mean coverage between 60° N and S
is then 0.26, against about 0.46 for a daily mosaic: the picture misses
low, warm cloud, so the fallback is the less cloudy.

**Loading** (`CloudMap.js`) never holds up a frame.  The map is a one-byte
`DataTexture` (2560 × 1280, mipmapped), empty at first; once the simulation
date has been the same for a second (a permalink sets the clock just after
start-up; a clock running at days a second passes dates by), its tiles are
fetched four at a time, decoded (`createImageBitmap`, a canvas), unmixed on
the main thread (a few ms a tile) and uploaded as each arrives, so the
clouds fill in region by region.  A new date's tiles replace the old date's
as they come; a load for a date no longer wanted stops between tiles.  The
month's Blue Marble is fetched again for its pixels (the browser's cache
has it).  Tests have no DOM, so `CloudMap` doesn't load there.

### Drawing: one shell over both sides of the swap

A sphere 6 km over the ground sphere (`CLOUD_HEIGHT_M`), a child of the
rotating planet node, outside the surface group (which a Cesium layer
hides), on its own layer (`CLOUD_LAYER`).  ThreeUi draws that layer into the
scene buffer after the Cesium composite and before the atmosphere pass
(`ThreeUi._drawClouds`), so:

- **One renderer, nothing to match.**  The same shell covers celestiary's
  surface and Cesium's globe (and the crossfade between them): `yarn
  parity`'s cloudy view reads the same on both (CESIUM.md).
- **Lit in exposure units.**  A white cloud's radiance in three's units,
  `CLOUD_WHITE × E / π × max(N·L, 0)` (E the Sun's irradiance at Earth,
  `irradianceAt`), through three's tone-mapping chunk: the scene pass's
  exposure in the HDR buffer, PBR Neutral in the LDR fallback.  So a sunlit
  cloud is 0.92 × 1.5 at the keyed exposure, as a surface of that albedo
  is, and the terminator is Lambert's, as the ground's.
- **Inside the atmosphere.**  The shell writes no depth: the atmosphere pass
  reads the ground's behind it and hazes the cloud as the ground 6 km under
  it, which from orbit is the same haze.
- **Over the night lights.**  Both sides' lights are in the buffer by then
  (celestiary's surface shader, Cesium's lights pass), and a cloud of
  coverage `c` passes `1 − c` of them: an unlit cloud is a dark patch over
  the cities.
- **Shadows.**  Per pixel, the ground behind the cloud along the view ray,
  and the cloud between that ground and the Sun; that coverage (at a coarser
  mip), times `SHADOW_STRENGTH` 0.6 (the direct beam, less the sky's light),
  darkens the ground.  From high up the shadow sits under its cloud; near the
  terminator it falls tens of km off (6 km / tan of the Sun's elevation).
- **Premultiplied-over, coverage alpha.**  Colour × coverage over the
  buffer, one minus the alpha passing what's under it: `1 − (1 − c)(1 − s)`,
  the cloud's coverage and its shadow's.  The alpha is coverage, as
  portal's alpha contract has it.
- **The far field only.**  Its texels are 16 km, a blur from close up, so the
  shell fades out as the camera comes down to the deck: fully drawn 24 km
  over it (30 km up), gone 4 km over it (10 km up), smoothstep between
  (`FAR_FIELD_FADE_M`, `farFieldOpacity`), and never drawn from below it.
  This is the seam for #169's volumetric clouds, seeded from this map,
  which cross in over that band.

Cost: a sphere of 256 × 128 segments and one more scene traversal a frame
for the layer (as the label overlay's), the coverage texture's 3.3 MB (4.4
with mips), and per pixel two texture reads and two ray-sphere solves.

## Lighting and exposure

The Sun is a `PointLight` of `SUN_LUMINOUS_INTENSITY` falling off as
1/d^`SUN_LIGHT_DECAY` (shared.js).  The renderer's tone-mapping exposure
follows the targeted body (`exposure.js`, `ThreeUI._updateExposure`):
π·d^decay / I for its distance d from the Sun, so its sunlit side renders
at its albedo — a surface facing the Sun shows its texture's colour
× `DISPLAY_GAIN` (1.5), as Cesium's layers do — easing between targets over
~0.5 s.  Over that keyed exposure a metered gain adapts to the frame
([HDR.md, metered exposure](HDR.md#metered-exposure)): 1 wherever a
sunlit surface is in view, more at a low Sun, at twilight, at night and in
deep space, less for the Sun's disc.  A body's `texture_gain` (e.g. the Moon's) scales its texture for
both, where the source mosaic's stretch is darker than its albedo.  Looking at a far
planet (targeting it) makes it the exposure target; the Sun and stars keep
the last body's.  Surfaces are non-metallic (metalness 0) except where an
ocean map adds shine.

The exposure scales, and tone-mapping waits: surfaces render into a linear,
half-float buffer in these exposure units, the atmosphere pass adds the sky
in the same units, and PBR Neutral runs once, last ([HDR.md](HDR.md)).  So a
sunlit white surface is 1.5 in the buffer (`DISPLAY_GAIN`) and shows as
`N(1.5)`, as before.  Content drawn as display values (labels, lines, grids)
goes into the buffer through the tone map's inverse (`hdr.js`
`sceneReferred`); the stars and the Sun's disc are in exposure units
([HDR.md, physical stars](HDR.md#physical-stars)).

## Small discs

A body a few pixels across (Jupiter from Earth through a telescope's
field: 9 px at 0.91° over 879 px) is drawn smooth and at its size
(`smallDisc.js`, #192).  The scene buffer has no multisampling, so the
mesh lit each pixel all or nothing by whether its centre fell inside: a
blocky octagon whose pixel count, and brightness, jumped as it moved.
Under 24 px of radius, and farther than 20 radii:

- **The mesh is grown** by 1.5 px (twice that for off the view's axis) in
  the vertex shader (`uDiscInflate`), so every pixel the disc touches gets
  a fragment.
- **Each fragment covers what the disc covers** of its pixel: the ray's
  closest approach to the body's centre against the radius, over the
  pixel's width there (`fwidth` of the ray's direction, so off the axis
  too).  The colour is scaled by it, over black (the surface stays
  opaque), and a fragment the disc misses is discarded.  So the disc's
  light is its area's, to the pixel, as it moves.
- **Each fragment is shaded where its ray meets the sphere**, or for a
  pixel the disc only partly covers, at the middle of the part it covers:
  the normal and the texture coordinate are worked out from the ray (the
  grown mesh's own are a bigger sphere's, which squeezed the texture and
  the limb inward), the texture sampled with the gradients of a seam-free
  copy of the longitude.  Jupiter's belts show at 13 px across (0.63°).
  Bump and night-light maps keep the mesh's coordinates, which at these
  sizes is a fraction of a pixel off.
- **A moon a few pixels across in transit has a dark rim** over its
  planet: what lies behind a partly covered pixel doesn't show through.
- **The mesh reaches until its disc is the far point's size** (2 CSS px;
  `farPoint.js` `meshReach`), not a fixed 500 radii: that was a 3.1 px disc
  at 45° over 640 px, but 4.2 px over 879, where Jupiter from Earth turned
  into a white 2 px square while still 4 px across, as the field widened
  past 1.9°.  Never nearer than 500 radii, which CesiumLayers' `meshRange`
  shares.

## Surface texture sources

- **Mars** (`mars.jpg`, 4096×2048): the USGS Viking MDIM2.1 colourized
  global mosaic (NASA/USGS, public domain), the imagery of Cesium's Mars,
  so the two match across the layer swap.  Equirectangular, −180° at the
  left edge.  Rebuilt from NASA Trek's WMTS tiles at level 3 (16×8 tiles of
  256 px):
  `https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/3/{row}/{col}.jpg`,
  stitched and saved as JPEG at quality 0.85.
- **Earth** (`earth/blue-marble/2004-MM.jpg`, 4096×2048, one per month):
  NASA's Blue Marble Next Generation (NASA Earth Observatory, public
  domain), the cloud-free mosaic for each month of 2004, from
  `https://eoimages.gsfc.nasa.gov/images/imagerecords/{ID rounded down to 1000}/{ID}/world.2004MM.3x21600x10800.jpg`,
  with record IDs, January to December: 73938, 73967, 73992, 74017, 74042,
  (none), 74092, 74117, 74142, 74167, 74192, 74218.  Scaled to 8192×4096, and from
  that to the 4096×2048 texture celestiary loads and to Cesium's base
  layer: geographic 512 px tiles, levels 0-3 (`2004-MM/{z}/{x}/{y}.jpg`).
  Same −180° left edge as before.  NASA has no June: it's May and July
  blended.  `earth.json` `texture_monthly` makes the map follow the
  simulation date's month (`monthly.js`, `Planet.monthlyMap`).  Earth's
  atmosphere `sunIntensity` was 30, matched to Cesium's Earth over the same
  imagery (median ratio 1.00 over the disc from 20,000 km; at 60 the haze
  made celestiary's Earth ~1.7x as bright, and the swap to Cesium darkened
  it); it is 21 since the atmosphere pass integrates multiple scattering
  (composition.md), re-fitted to hold the sky's luma.
- **Moon** (`moon.jpg`, 4096×2048): the LRO WAC global mosaic (NASA/GSFC/
  Arizona State University, via the USGS; public domain), the imagery of
  Cesium's Moon.  Same layout and recipe, from
  `https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm/3/{row}/{col}.jpg`.
  Its stretch leaves it darker than Mars's for about the same albedo
  (0.12 vs 0.15), so `moon.json` sets `texture_gain` 1.3 (mean 76/255 vs
  Mars's 121, scaled by the albedo ratio) and Cesium's Moon takes the same
  gain (`CESIUM_BODIES.moon.textureGain`), over ion's copy being stored
  0.82× as bright (`imageryScale`).
- **Moon relief** (`moon_normal.jpg`, 2048×1024, 620 KB; `moon.json`
  `texture_normal`): a tangent-space normal map from LRO LOLA's global DEM
  (NASA/GSFC; public domain), as Moon Trek serves it
  (`LRO_LOLA_DEM_Global_128ppd_v04`, an 8-bit PNG stretch, WMTS level 3,
  4096×2048), built by `tools/moon/lolaNormalMap.py public/textures/moon_normal.jpg 2048 90`.
  The stretch is linear: its 1 lands on Antoniadi's floor (70.4°S,
  172.4°W, −9.13 km) and its 255 on the Selenean summit (5.4°N, 158.6°W,
  +10.78 km), the DEM's known extremes, so a step is 78 m.  The heights
  are resampled to 2048×1024, blurred 0.6 px against the steps, and their
  slopes taken over each texel's true size on a 1,737.4 km sphere: median
  2.9°, 99th percentile 17°.  Same layout as `moon.jpg`.  See
  [Relief](#relief).

## Relief

A body with `texture_normal` has its slopes as a tangent-space normal map
(`<name>_normal.jpg`: x east, y north, z out, as three's SphereGeometry's
u and v; `Planet.nearShape` sets `normalMap`, and three takes the tangent
frame from the screen derivatives).  The Moon has one (#192): its
terminator was a smooth Lambert gradient where the real one is rough with
crater walls in light and shadow.  With the slopes, a wall facing away
from a low Sun goes dark and one facing it lights, so craters show along
the terminator in light and shade.

**Where it shows.**  From Earth the Moon is in Cesium's range, so with ion
up it is Cesium's once its tiles are in (#192's views A and B: active
`[moon]`, fade 1), and Cesium's tileset shader lights the smooth sphere
(CESIUM.md, "Tiles and lighting").  This map shows on celestiary's own
Moon: without ion, with the Cesium layer off, and while the tiles load.
Carrying it across the swap means sampling the same map in the tileset's
shader by longitude and latitude (CESIUM.md, follow-ups).

- **A normal map, not a bump map.**  three's bump map takes its slope per
  screen pixel (Mikkelsen's surface gradient over the normalized
  derivatives), so the relief flattens as the view zooms in, and Mars's
  `bumpScale` is a look, not a height.  A normal map holds the true slopes
  at the texel's size.
- **2048×1024 is the resolution of the views it's for.**  From Earth at
  0.63-0.91° (#192's views) the Moon is 520-750 px across, 4.6-6.7 km a
  pixel, against 5.3 km a texel at the equator.  Nearer, Cesium's Moon
  takes over (CESIUM.md).  4096×2048 (2.6 km a texel, 1.4 MB, so Git LFS
  under `public/large/`) would hold to a 1.3° Moon on a 1,000 px canvas.
- **No cast shadows yet.**  Slopes give each texel its own light, but a
  crater's rim doesn't shadow its floor: past the terminator's last few
  degrees of Sun, the real Moon's floors are black under lit rims, where
  here they're lit by their own slopes.  That needs a horizon map (for
  each texel, the horizon's elevation in, say, 8 azimuths, from the same
  DEM; the light is cut where the Sun is under it: Max 1988, "Horizon
  mapping"; Sloan & Cohen 2000), two RGBA textures at 2048×1024, about
  2-4 MB as PNG, so Git LFS and `dataUrl('large/moon/…')`, and a shadow
  term in the surface shader.  Proposed on #192, not added.

## Texture longitudes

Each body turns by its IAU prime meridian (#96; DESIGN.md
[body rotation](../../DESIGN.md#body-rotation-iau-prime-meridians)), so a
texture's 0° must be the IAU's 0°.  Three's sphere puts the texture's
centre column at longitude 0 (coords.js), east to the right.  A texture
centred elsewhere sets `texture_longitude`, the east longitude of its centre
column, which turns the surface mesh in the body frame (`Planet.nearShape`);
the body frame itself, and so places, permalinks and Cesium's globe, is
untouched.

Checked by marking named features at their USGS Gazetteer positions on each
texture, under 0 and under 180 (east longitude; the Galilean moons' and
Iapetus's are published as west longitude, east = −west):

| Body | `texture_longitude` | Evidence |
|---|---|---|
| Mars | 0 | Olympus Mons's caldera (18.65°N, 226.2°E) lands within 1° of its mark, Airy (5.1°S, 0°, which holds Airy-0) within 0.1° (MDIM 2.1, centred on 0° by construction) |
| Earth, Moon | 0 | The Blue Marble and LRO WAC mosaics, −180° at the left edge (above) |
| Io | 180 | Pele (18.7°S, 255.3°W), Loki (13°N, 309°W), Prometheus (1.5°S, 153°W): on the 180 marks, 105° off the 0 ones |
| Europa | 180 | Pwyll's ray crater (25.2°S, 271.4°W) at 25.6°S, 88.6°E under 180 |
| Ganymede | 180 | Galileo Regio, Osiris (38.1°S, 166.3°W), Tros (11°N, 27°W) |
| Callisto | 180 | Valhalla's rings (14.7°N, 56°W), Asgard (32.2°N, 140°W) |
| Iapetus | 180 | Cassini Regio, the dark leading hemisphere, centred on 90°W |
| Tethys | 0 | Odysseus (32.8°N, 128.9°W) |
| Dione, Rhea | 0 | The trailing hemisphere's wisps, centred near 270°W |
| Titania | 0 | Ursula (12.4°S, 45.2°E) and Messina Chasmata; Voyager's southern hemisphere only |
| Oberon | 0 | Hamlet's dark floor (46.1°S, 44.4°E) |
| Jupiter | (`texture_rotation`) | Below |
| Mercury, Venus, Saturn, Uranus, Neptune, Titan, Pluto, Charon, Triton, Phobos, Deimos, Janus, Hyperion, Proteus | 0, unverified | No identifiable feature: Mercury's map has no Caloris and looks synthetic; Venus's and Titan's are clouds and haze; the giants' are bands (Neptune's 1989 dark spot is long gone); Pluto's, Charon's and Triton's are 128 px pre-New Horizons maps; the small moons' are generic cratered textures, Phobos's in a square projection |

**Jupiter's clouds** turn with System II (W = 43.3° + 870.270° d), not the
IAU's System III (the interior's, from the radio period), 0.266°/day
faster, about 97° a year.  A texture fixed in System III would put the
Great Red Spot anywhere.  So `jupiter.json`'s `texture_rotation` turns the
surface mesh (`iauRotation.textureTurn`) to put the texture's spot, which
is at 91.7°E in the texture (the centroid of its reddest pixels, 26°S), at
its observed System II longitude: 46° + 21°/yr from 2023-10-01, which fits
216° on 2014-09-08 and 349° in 2021 January (Sky & Telescope's transit
predictions, from JUPOS) and 46° on 2023-10-01 (Stellarium's default)
within 1°.  The spot's drift isn't steady, so it's good to ~20° within a
few years of 2023, worse further out.  The body frame stays System III, so
Horizons' sub-observer longitudes, which are System III, match it.
