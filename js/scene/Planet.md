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
   add `nightLight * nightFactor * INTENSITY` to `gl_FragColor.rgb`
   *before* tonemapping so city lights pass through the same tonemap +
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
