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
1/d², the inverse square (shared.js; [the Sun's
light](#the-suns-light-the-inverse-square), below).  The renderer's
tone-mapping exposure follows the targeted body (`exposure.js`,
`ThreeUI._updateExposure`): π·d² / I for its distance d from the Sun, so its sunlit side renders
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

### The Sun's light: the inverse square

The Sun's light fell off as 1/d^1.01 at 3.7e28 until #192 ("so the outer
planets aren't lost"), from before the exposure followed the target.  Since
the exposure is keyed to the target and metered over it, a targeted body
shows at its albedo whatever the falloff, so the kludge did nothing for the
target.  What it did was put every other body in the frame wrong by
(d/AU)^0.99 against a body at 1 AU: Mercury 1.4 stops dim, Venus 0.5, Mars
0.6 bright, Jupiter 2.4, Saturn 3.2, Uranus 4.2, Neptune 4.9.  At #192's
occultation Jupiter's disc rendered 8.4 times the crescent's surface
brightness, where they are within a factor of 1.6 (5.48 against 5.97
mag/arcsec²), so the meter keyed on Jupiter and dimmed the Moon.

**Now the falloff is 1/d²** (`SUN_LIGHT_DECAY` 2), and the intensity is
the Sun's luminous intensity in candela, `SUN_ILLUMINANCE_LUX` × AU²
(2.84e27): three's light units are photometric, lux for the irradiance
(1.27e5 at 1 AU), cd/m² for a surface's radiance.
- **Why those units.**  Keeping the old irradiance at 1 AU (1.9e17) with d²
  would take an intensity of 3.7e28 × AU^0.99 = 4.3e39, past float32's
  3.4e38: the light's uniform would be Inf.  In lux a surface's irradiance
  runs from 8.5e5 (Mercury's perihelion) to 52 (Pluto's aphelion), and the
  shader's d² overflows only past 2^64 m (1,950 ly), where three's own
  `length()` of the light's vector already does (`sunLight.test.js`
  replays three's `getDistanceAttenuation` in float32 from 0.31 AU to
  1,000 AU, within 1e-6 of doubles; past 2^64 m the light is 0, not NaN).
- **What doesn't move.**  Every rendered value at 1 AU is what it was: the
  keyed exposure is π·`DISPLAY_GAIN` over the irradiance, in whatever
  units, and everything else reaches the buffer through it or through
  `irradianceAt` at its own body: Earth's night lights
  (`nightLightRadiance`), the clouds (`CloudShell`), the Moon's earthshine
  (`lunarSurface.js`, and CesiumLayers `_setEarthshine`, a fraction of the
  sunlight), the sky (`skyExposure`, 1 at the body's own exposure), and the
  stars, the Milky Way and the Sun's disc (`exposureRelative`, over 1 AU's
  keyed exposure).  Cesium's layers hold stored value × the lighting law
  and are decoded by the body's gain and `exposureOf`, so `DISPLAY_GAIN`,
  `imageryScale` and `textureGain` stand (CESIUM.md, [camera and light
  coupling](../../CESIUM.md#camera-and-light-coupling)).  Earth and the
  Moon are within 0.003 AU of each other, a 0.26% change in their ratio;
  Earth's keyed exposure over 1 AU's is 0.967 at perihelion where it was
  0.983, 0.02 mag on the stars.
- **What moves** is the keyed exposure away from 1 AU, (d/AU)² times
  Earth's: 0.15 at Mercury, 2.4 at Mars, 28 at Jupiter, 89 at Saturn, 1,560
  at Pluto (it was 0.38, 1.6, 5.4, 9.7, 41).  The meter's dark end and the
  stars are absolute, over Earth's keyed exposure (HDR.md, [metered
  exposure](HDR.md#metered-exposure)), so the dark-adapted gain and the
  star field are the same from any target; a targeted body still shows at
  its albedo, now from a keyed exposure 28 times Earth's at Jupiter rather
  than 5.4.

**Checked against Horizons** (`planetPhotometry.horizons.json`, fetched by
`tools/photometry/fetchHorizons.mjs`, with the queries in the fixture):
each planet and the Moon from just off Earth (13,000 km over 0° N 0° E,
out of the air's way) at 2026-10-06 09:00 UT, #192's date, framed 80 px
across at 400×300 on SwiftShader, without ion; its light summed over its
disc in the linear composite (the atmosphere pass's `uDebug` 7) less the
background, over the exposure, in V by the Sun's irradiance at 1 AU in the
same units (V −26.74), which is how the stars are scaled: a planet's
magnitude against the star field.  Horizons is taken to the camera's
distance (≤ 2e-4 mag; for the Moon, its phase law at the camera's phase).
Luma is Rec. 709's of the stored values, lit as linear (HDR.md, [colour
spaces](HDR.md#colour-spaces-stored-values)).

| Body | r, AU | Phase | Horizons V | Before | After | After − Horizons | Lambert sphere at the texture's mean | Its albedo against the real one, mag | Lambert's phase law against the real one, mag |
|---|---|---|---|---|---|---|---|---|---|
| Mercury | 0.455 | 65.3° | −0.04 | −1.60 | −2.45 | −2.41 | −2.46 | −0.98 (p 0.33 against 0.13) | −1.44 (0.64 down, against 2.07) |
| Venus | 0.726 | 142.6° | −4.67 | −3.28 | −3.62 | +1.04 | −3.32 | +0.36 (0.50 against 0.70) | +0.99 (3.87 down, against 2.88) |
| The Moon | 0.998 | 125.8° | −8.62 | −8.51 | −8.51 | +0.11 | | the lunar photometric function, below | |
| Mars | 1.565 | 36.4° | +1.01 | −0.42 | +0.06 | −0.95 | +0.19 | −0.44 (0.26 against 0.17) | −0.38 (0.20 down, against 0.58) |
| Jupiter | 5.309 | 8.6° | −1.89 | −3.56 | −1.76 | +0.13 | −1.71 | +0.21 (0.44 against 0.53) | −0.03 |
| Saturn, globe and rings | 9.433 | 0.35° | +0.34 | −1.89 | +0.52 | +0.19 | | | the rings, below |
| Saturn's globe | | | +0.55 | −1.82 | +0.59 | +0.04 | +0.56 | 0.00 (0.50 against 0.51) | 0.00 |
| Uranus | 19.44 | 2.3° | +5.64 | +2.60 | +5.79 | +0.15 | +5.78 | +0.08 (0.46 against 0.49) | +0.06 |
| Neptune | 29.88 | 0.35° | +7.68 | +4.35 | +8.00 | +0.32 | +8.06 | +0.38 (0.33 against 0.47) | 0.00 |

- **The falloff is right.**  Each body moved by 2.475·log10(r): Jupiter
  1.79 mag, Neptune 3.65, Mercury −0.85, the Moon 0.00.  With the specular
  lobe off the render is the Lambert sphere at its texture's mean within
  0.06 mag for every planet but Mars's 0.09 (Mercury −2.40, Venus −3.29,
  Mars +0.10, Jupiter −1.73, Saturn's globe +0.62, its oblate disc the last
  few hundredths, Uranus +5.82, Neptune +8.04), so what's left against
  Horizons is each body's own photometry, not the light: before, the giants
  were 1.7 to 3.3 mag bright, now 0.04 to 0.32 faint.
- **The texture's albedo**: a body's stored values are its albedo
  (Lambert's, so its geometric albedo is 2/3 of their mean), and the
  textures are pictures, stretched: Mercury's mean is 0.49, a geometric
  albedo of 0.33 where Mercury's is 0.13 (Mallama & Hilton 2018's V(1,0),
  as recalled, over its radius), so it is 1 mag bright; Mars 0.44 bright,
  Neptune 0.38 dark, Jupiter 0.21.  The giants are within the ±0.3 the
  textures' stretch allows.  The Moon has a `texture_gain` to its normal
  albedo (below); the same for the others is a follow-up.
- **The phase law**: Lambert's sphere loses 0.64 mag at Mercury's 65°
  where Mercury's regolith loses 2.07 (shadow-hiding, as the Moon's), and
  3.87 at Venus's 143° crescent where Venus's clouds, scattering forward,
  lose 2.88; at Mars's 36°, 0.20 against 0.58.  At the giants' few degrees
  they agree.  Mercury and Venus want photometric functions of their own,
  as the Moon has.
- **three's specular lobe** (MeshPhysicalMaterial's, F0 0.04 at roughness
  0.8) adds 0.02-0.05 mag at a small phase and 0.33 at Venus's crescent,
  where it is grazing.
- **Saturn's rings** add 0.22 mag to Horizons' Saturn (Mallama & Hilton's
  ring term at this tilt, the rings 7.4° open to Earth (sub-Earth latitude
  −9.04° planetodetic), two days from opposition, so the rings' opposition
  surge is in it) and 0.07 to the render's.  The rings are display values
  (`Rings.js`, through `sceneReferred`, their gain Saturn's sky
  `sunIntensity`), not lit in exposure units, so neither the falloff nor
  the exposure reaches them; physical rings belong to
  [#95](https://github.com/celestiary/web/issues/95).

**#192's occultation view, re-measured** (the user's link at 1000×597,
4.55″ a pixel, ev=10, without ion; airless, the composite over the air's
transmittance; the last two columns at EV 0, in exposure units):

| | Jupiter's disc, mag/arcsec² | The crescent's lit mean, mag/arcsec² | Jupiter over the crescent, per unit area | The meter's gain over Jupiter's keyed exposure | The crescent's mean / 90th percentile | Jupiter's centre |
|---|---|---|---|---|---|---|
| Horizons | 5.48 | 5.97 | 1.57 | | | |
| Before | 3.74 | 6.05 | 8.4 | 2.09 | 0.17 / 0.39 | 1.87 |
| After | 5.53 | 6.05 | 1.61 | 1 | 0.43 / 0.96 | 0.89 |

Jupiter is now the crescent's match, as in the photographs, and the
frame's exposure is the Moon's: the crescent comes up 2.5 times (1.3
stops) at the same EV, as the meter no longer holds the frame down for an
over-lit Jupiter.  At the user's ev=10 the crescent and Jupiter are both
saturated, as before, and the earthlit side is brighter; ev≈8.7 gives the
old balance.

**What else was checked** (every user of `SUN_LIGHT_DECAY`,
`SUN_LUMINOUS_INTENSITY`, `irradianceAt`, `exposureAt` and the light):
- the meter's anchor (`ThreeUi._sunlitBodies`, `sunlitBodyGain`) takes a
  body's keyed exposure against the target's, which is now the physical
  ratio; the dark end and the stars are absolute, so unchanged;
- the far points (a planet's and a moon's marker, `farPoint.js`) are
  display values, not lit: unchanged, and still 4-5½ mag bright for
  Jupiter's moons (#192's proposal of points of reflected light stands);
- small discs (`smallDisc.js`) are three's lighting scaled by coverage, so
  they follow the light with no constant of their own;
- the atmosphere pass's `sunIntensity` is relative to the body's own
  irradiance (`skyExposure`, 1 at its keyed exposure by any falloff), so
  the falloff never reached it.  But the outer bodies' values fall with
  distance (Jupiter 6, Saturn 4, Uranus 2.8, Neptune 2.2, Titan 1.0, Pluto
  0.7, Triton 0.6), from #55, when `sunIntensity` was the Sun's light at
  the body ("sun is dimmer than Earth (greater orbital distance)", its
  test); since the sky took the body's irradiance in exposure units (#86's
  PR A) that is counted twice.  The physical gain is π·`DISPLAY_GAIN`,
  4.71, for every body, as Mars has; Earth's 21 stands for aerosols the
  tables don't hold, and Venus's 18 is not a falloff.  Not changed here: it
  brightens those skies and hazes 1.3 to 7.9 times (Titan's 4.7) and
  Saturn's rings, which reuse its value, so it is proposed as its own
  change;
- the guide's planet page (`guide/Planet.jsx`) put its Sun 1.7 AU away,
  which the old falloff hardly noticed: it is at 1 AU now, where the
  guide's exposure is.

### The Moon's photometry

The Moon isn't a Lambert surface, and lit as one it was 3.25 stops too
bright at #192's crescent (HDR.md, [a star beside the Moon](HDR.md#a-star-beside-the-moon)).
Both Moons, celestiary's mesh (`lunarSurface.js`) and Cesium's tileset
(`sunlitShader`), now take their light from one function,
`lunarPhotometry.js` (GLSL `LUNAR_PHOTOMETRY_GLSL`, shared by the two
shaders), for `photometry: 'lunar'` in moon.json and bodies.js:

- **Lunar-Lambert** (McEwen 1991; the Moon's L(α) from McEwen 1996, as
  USGS ISIS has it): I/F = A · f(α) · [2L(α) μ0/(μ0 + μ) + (1 − L(α)) μ0].
  Lommel-Seeliger's term keeps the full Moon's disc flat to the limb and
  brightens the bright limb at partial phase; Lambert's takes over as L
  falls to 0 by 104°, so a crescent falls off to its terminator as μ0.
  μ0 and μ are taken from the normal-mapped normal, on celestiary's Moon
  (#199's relief) and on Cesium's tiles (the same map; CESIUM.md, "Relief
  on the Moon's tiles"), and α is each fragment's own phase angle.
- **f(α), the phase function**, is solved at each phase so the disc's
  light is JPL Horizons' phase law for the Moon, V(1, α) = 0.23 + 0.026α
  + 4e-9α⁴ (Allen's; Horizons' APmag over a lunation is this to 0.001
  mag: `lunarPhotometry.horizons.json`).  Each term's disc integral has a
  closed form, so f is exact at every phase; summing the function over
  the disc gives the law to 0.02 mag from 0° to 160° (the tests).  Past
  160° f is held (the law is fitted to ~150°).
- **The albedo**: the colour map's stored values are a linear stretch of
  I/F (the WAC mosaic's maria are 0.17 and its highlands 0.37, a ratio of
  2.1, as the Moon's measured albedos are; sRGB-decoded the ratio would be
  4.5, so they aren't decoded), scaled by `texture_gain` 0.4448 so the near
  side's disc at full is the geometric albedo for V(1, 0) = 0.23, 0.121
  (`MOON_TEXTURE_GAIN`: 0.121 over the map's near-side mean, 0.2716, from
  `tools/moon/textureMean.py`).  It was 1.3, on Lambert's law.
- **No specular** on the Moon (`specularIntensity` 0): the function is the
  regolith's whole reflectance, and the Fresnel sheen made this Moon's
  limb 3% brighter than Cesium's.
- **Earthshine**: the night side is lit from Earth's direction at Earth's
  geometric albedo (0.367) × its Lambert phase seen from the Moon ×
  (R⊕/d)² of the sunlight (`earthshineFraction`: 6.9e-5 at #192's
  crescent), through the same function: seen from Earth at a phase of ~1°,
  flat to the limb, where Lambert's law left out that opposition
  brightening.  Cesium's Moon had it since #203; celestiary's has it now
  too, so without ion the night side is no longer black.

At #192's view the whole Moon sums to V −8.31 (airless; Horizons −8.42),
which is what the texture predicts for the face shown: the waning crescent
is the maria's side, 0.10 mag under Horizons' uniform law, and the waxing
one at the same phase 0.10 over it (HDR.md, [a star beside the Moon](HDR.md#a-star-beside-the-moon)).

**The meter.**  A resolved sunlit body anchors the gain at which its
brightest surface is a white (HDR.md, metered exposure).  That assumed a
Lambert surface facing the Sun, 2.5 × albedo, 0.30 for the Moon at every
phase.  The Moon's brightest surface is its highlands (stored 0.366, I/F
0.163) at the function's peak on the lit disc, the limb's last 3% left out
(`lunarHighlight`: 0.163 at full, 0.066 at quarter, 0.035 at #192's
crescent), so the anchor uses that (`exposure.js` `highlightReflectance`):
at parity's 64° view the frame's brightest meter tap read 0.079 against
0.089 estimated, the gain 2.3 → 4.5 (with 0.30 the highlands would have
shown at a third of the anchor's level).  The stars and earthshine keep
their physical ratios to it.  Other bodies are unchanged: they stay
Lambert.  Mercury and the airless moons would want a photometric function
of their own (Hapke's, fitted per body); that's not done.

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
  Its stored values are a linear stretch of I/F; `moon.json` sets
  `texture_gain` 0.4448, which makes them the Moon's normal albedo
  ([the Moon's photometry](#the-moons-photometry)), and Cesium's Moon takes
  the same gain (`CESIUM_BODIES.moon.textureGain`), over ion's copy being
  stored 0.815× as bright (`imageryScale`; CESIUM.md, "The Moon's
  photometry").  (It was
  1.3 under Lambert's law: the mean 76/255 against Mars's 121, scaled by
  the albedo ratio.)
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

**Where it shows.**  On both sides of the swap to Cesium.  From Earth the
Moon is in Cesium's range, so with ion up it is Cesium's once its tiles are
in (#192's views A and B: active `[moon]`, fade 1), and Cesium's tileset
shader samples this same map by the fragment's longitude and latitude, its
tangent frame from the sphere's east, north and up there, and lights both
the Sun and earthshine by the perturbed normal, through the lunar
photometric function as here (CESIUM.md, "Relief on the Moon's tiles";
`js/scene/cesium/relief.js`).  Without ion, with the Cesium
layer off, and while the tiles load, it is celestiary's own Moon, through
three's `normalMap`.  The tileset's version fades out where the map is
magnified past 2 pixels a texel (gone by 8), since over the tiles' sharp
imagery its 5.3 km texels would show as blocks; celestiary's mesh draws it
at any range, as it has no sharper imagery than `moon.jpg`.

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
