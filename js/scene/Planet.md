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
   `NIGHT_LIGHT_RADIANCE` (3e-5, the texture's full white as 1 cd/m²
   against a sunlit white's 3e4) times a sunlit white's radiance in three's
   units, so the lights are in exposure units like the lit surface
   ([HDR.md](HDR.md#metered-exposure)): beside a sunlit day side they are
   black, as a camera at the terminator sees them, and on the night side
   alone the metered exposure brings them to 0.6 at most.  They were a
   fixed display value (`1.5 / toneMappingExposure`), which the meter
   read as a luminance falling with its own gain, and ran away on.
   gamma chain as the rest of the surface.

Earlier versions tried `<output_fragment>` — that chunk was renamed
`<opaque_fragment>` in Three.js r155+, so the string-replace silently
failed.  `<tonemapping_fragment>` is stable across versions.

### Why such a large intensity multiplier (`5e15`)

The renderer's `toneMappingExposure` is `3e-16`, calibrated for the sun's
PointLight intensity (`3.7e28` lumens, roughly the absolute lumens output
of the actual Sun).  Day-side surface peaks at ~`2e16` linear (sun
illuminance × Earth albedo / π) → ~`1.0` after tonemap → white.  For city
lights to peak around 30% display brightness (visible glow without
overdrive), input × exposure ≈ 0.3 → multiplier ≈ `1e15`.  We use `5e15`
for a slight cinematic boost — somewhat brighter than physical truth but
the right tradeoff for the navigation-aid use case.

Tweak the constant in `nearShape` if your night texture is a composite
("Earth at night" with land visible as faint grey) vs. pure Black Marble
(mostly black with bright cities only) — composites need a lower scalar.

### Per-frame sun direction

`surface.onBeforeRender` recomputes `uSunDirection` each frame: sun lives
at world origin (worldGroup centre), so the direction from the planet to
the sun is `−planetWorldPos.normalize()`, then `.transformDirection`
into the camera's view matrix to match `vNormal` (which Three.js writes
in view space).

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
