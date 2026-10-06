# Cesium layers — plan

A **Cesium** layer for bodies Cesium can render (Earth, and the Moon and
Mars with an ion token), and the default for them: Cesium's globe,
terrain, imagery and datasets, composited in place of celestiary's body.
Celestiary's own rendering (Bruneton atmosphere, surface textures, night
lights) stays one click away in the layers control, and is what a body
falls back to if its Cesium layer can't load.

## UX

- A Cesium-capable body is *in range* when the camera is within its mesh
  range: as far out as celestiary draws the body as a mesh rather than a
  point (the distance of the next level in its `planet LOD`,
  Planet.newPlanet; 500 radii, where it's ~1.6 px across).  Every body
  in range and on screen (at least a pixel across) shows its layer,
  target or not: at the Moon with Earth targeted, both are Cesium's.
- When the target is in range, a **Layers** button for it appears in the
  top-right control stack, under the drag-mode toggle.
- Clicking it expands (Google-Maps-style) to two tiles: **Celestiary** and
  **Cesium** (default, `DEFAULT_BODY_LAYER` in LayersSlice.js). Choosing one
  applies it to that body; the choice is remembered per body for the
  session.  A body whose Cesium layer fails to load drops back to
  Celestiary, and the control shows the error.
- A body's layer is only *active* while it's in range and on screen;
  otherwise celestiary draws it (Cesium is not rendered for it at all).
- Loading (Cesium's import, the body's widget) starts when the body, or a
  moon of it, is targeted, not only once it's in range.  So does loading
  celestiary's own surface (Planet `preloadNear`), which is otherwise
  built when the camera first comes within its mesh range; until its
  colour map is in, neither the surface nor its atmosphere is drawn (a
  black ground under the haze read as a blue disc first).  In range, Cesium
  first renders unseen (no stencil) until its tiles for the view are
  loaded, and celestiary's surface and atmosphere show meanwhile; only
  then does the layer go active.  Tiles can't be fetched ahead of that:
  Cesium requests them from its render loop, for the view it renders.
- Going active, the layer crossfades in over a second (`FADE_MS`):
  celestiary's surface is drawn again over Cesium's, fading out (on its
  own three.js layer, `FADE_LAYER`, with the scene's lights).  A body whose
  Cesium layer drew its own atmosphere (`atmosphere: true` in bodies.js;
  none now) would also fade celestiary's atmosphere pass out
  (`uAtmStrength`) as Cesium's sky fades in (its `brightnessShift`).
- The button is HTML chrome, so it follows the `v` visibility group.
- Cesium's credits (required data attribution) show as a small overlay
  while a layer is active: the nearest active body's only.  Each body's
  widget writes its credits into its own container inside the overlay (one
  shared container stacked a copy per body visited).  Every widget carries
  the same ion logo and links; with two bodies on screen, the farther
  one's data attribution isn't shown.  The overlay is HTML chrome too:
  `v` hides it with the other panels.

## Architecture

Same-page NetGL (portal-netgl ≥ 0.2.0, `makeNetGLImmediateLink`). No
iframe: Cesium runs in celestiary's page against a *shadow* WebGL2 context
on its own hidden canvas; its GL calls are recorded and replayed into
celestiary's context at a chosen point in celestiary's frame.

```
ThreeUi.renderLoop
  layers.beforeRender()          pick the active bodies; hide/show their
                                 celestiary surfaces
  render(scene) → _sceneRT       celestiary as usual (body surfaces hidden);
                                 linear, half-float, exposure units (HDR.md)
  layers.composite()             ↓ per active body, far to near
    depth _sceneRT → _cesiumRT     a copy of celestiary's depth; _cesiumRT's
                                   colour and stencil cleared
    stencil pass → _cesiumRT       WGS84-shaped shell, depth-tested against
                                   celestiary's depth: stencil = 1 where the
                                   body is visible
    link.frame(() => {             Cesium renders synchronously; each GL call
      set Cesium camera              replays into celestiary's context now
      widget.render()              ← screen draws redirected into _cesiumRT,
    })                               clipped to stencil = 1, premultiplied-
    renderer.resetState()            over blended, colour clears dropped
    decode → _sceneRT              Cesium's 8-bit frame into exposure units
                                   (decodeOf), premultiplied-over
  ground-sphere depths           each active body, depth-tested
  _updateAtmUniforms()
  render(atm pass) → screen      sky + scene × T, tone-mapped once
```

Why these pieces:

- **In `_cesiumRT`, then decoded into `_sceneRT`.** Celestiary's depth
  lives in `_sceneRT` (its atmosphere post-pass reads it), so the stencil
  shell depth-tests against a copy of it in `_cesiumRT`, which has its own
  depth-stencil texture; `replay.screenFramebuffer` maps Cesium's default
  framebuffer onto `_cesiumRT`.  Cesium's frames reach celestiary through
  Cesium's own 8-bit buffers (with `highDynamicRange` off, its globe-depth
  framebuffer is `UNSIGNED_BYTE`, and its final draw is a copy of it), so
  they can't hold exposure units above 1: each body's frame holds its
  imagery's stored values × Lambert, at most 1, with its distance in alpha,
  and a fullscreen pass decodes it into `_sceneRT`'s linear HDR units
  ([HDR.md](js/scene/HDR.md#cesium-in-the-same-units)).
- **One path for every body.** What Cesium loads is the data's fork: Earth
  is a globe (terrain and imagery layers), the Moon and Mars are ion 3D
  tilesets with their imagery baked in, so a globe is lit by Cesium's own
  lighting with its extras off (`litSurfaceOnly`, and
  `depthTestAgainstTerrain` for its depth), a tileset by `sunlitShader`.
  After that every body is the same: stored × Lambert, the distance stage,
  one decode (× `bodyGain`: `DISPLAY_GAIN` × `textureGain` /
  `imageryScale`, times the renderer's exposure over the body's keyed one,
  `ThreeUi.exposureOf`, so the metered gain and the easing between
  targets move Cesium's side with celestiary's; HDR.md), the terrain's
  depth from below 20 km, and celestiary's atmosphere pass where the body
  has an atmosphere.  The per-body
  differences are data in `bodies.js` (`textureGain`, `imageryScale`,
  `nightFloor`, `atmosphere`, `shellScale`).  Until #141's review the
  tilesets returned PBR Neutral of their exposure-unit value and the decode
  inverted it, and only Earth carried its distance; the Neutral round trip
  through 8 bits lost highlights, and Mars's horizon kept the bugs Earth's
  had lost.
- **Stencil, not depth, decides visibility.** Cesium's depth convention
  (log depth, multi-frustum) doesn't match celestiary's; the shell pass
  resolves occlusion against celestiary's objects (the Moon in front of the
  Earth keeps its pixels; behind it, it's covered). Cesium's final pass
  then only fills stencilled pixels.
- **No OIT.** Premultiplied-over needs Cesium's alpha to be coverage.
  Cesium's order-independent translucency composite sets alpha to 1 on
  every non-background pixel, so the faint upper sky atmosphere (alpha
  ≈ 0.01) went opaque and blacked out celestiary's stars. The widgets are
  built with `orderIndependentTranslucency: false`; they draw nothing
  translucent.
- **Zero lag.** `link.frame` renders Cesium in the same frame, from the same
  camera, as the stencil shell. A postMessage/iframe guest lags a frame and
  slides against its stencil.
- **State.** The guest's state checkpoint restores Cesium's GL state at the
  start of each frame; celestiary calls `renderer.resetState()` after.

### Camera and light coupling

Celestiary body frame (see `coords.js`): +Y north pole, +X prime meridian,
east longitude toward −Z. Cesium ECEF: +Z north, +X prime meridian, +Y 90°E.
So `ecef = (x, −z, y)`, a proper rotation. Both are in metres, scale 1.

Per frame: camera world pose → body frame (inverse of the rotating planet
node's world matrix, in JS doubles) → ECEF → Cesium's camera `position`,
`direction`, `up` and `right`, set directly; Cesium's `frustum.fov` from
celestiary's vertical fov (Cesium's fov spans the wider canvas dimension).
Cesium's globe therefore takes its position and orientation from
celestiary's body and computes neither itself: the Moon's (Meeus ch. 47
position, Cassini-law orientation; DESIGN.md
[orbital mechanics](DESIGN.md#orbital-mechanics)) carries straight over.

- Not `camera.setView`: it converts direction and up to heading, pitch
  and roll in the local east-north-up frame and back, and near pitch −90°
  (looking at the body's centre, as on arrival with `g`) that turned the
  camera several degrees.  Cesium's body then sat off the stencil shell
  and celestiary's atmosphere: a halo off to one side of Mars, and the
  Moon clipped to a lens when off-centre on screen.
- The camera's position keeps its direction from the body's centre, at the
  same height over Cesium's ellipsoid as over celestiary's sphere
  (`frames.ellipsoidCameraPosition`).  Placing it by the sphere's latitude,
  longitude and altitude instead (`Cartesian3.fromRadians`, geodetic) put
  it up to ~16 km off on the flattened Earth and Mars, about a pixel from
  orbit.

Ground: Cesium's terrain rises kilometres over celestiary's sphere (Earth's
mountains ~9 km, Olympus Mons ~21 km over Mars's datum), and zoom used to
approach the sphere, taking the camera into the ground.  While a layer is
active, the terrain height under the camera (Earth's `globe.getHeight`,
the Moon's and Mars's `tileset.getHeight`, from loaded tiles) is sampled
every 200 ms within 100 km of the surface (`groundHeight`).  Zoom
approaches that ground instead (zoom.js `groundRadius`), and after every
camera move (pan, tween, keys) the camera is lifted back to 1 m over it
(ThreeUI `_keepAboveGround`), so it rides over hills rather than through
them.  Landing on a place adds the terrain height there
(`groundHeightAt`).  The height over the sphere is the height over
Cesium's ellipsoid, since the camera keeps the same height over both
(`frames.ellipsoidCameraPosition`).  While the height is still to come
(the layer is wanted and loading, or loaded but without tiles for the
view yet: `groundPending`), the floor waits rather than lift the camera
to the sphere: a permalink from under a datum (Valles Marineris is 4-7 km
under Mars's, the Dead Sea 430 m under Earth's) was lifted to the sphere
before the tiles were in and stayed there, hundreds of metres over the
ground, so the user's below-datum views never restored (they zoomed back
down each time).  Until the tiles are in, a camera under the sphere sees
celestiary's sky over the horizon's haze (composition.md).

Lighting: celestiary's Sun is at the world origin. Its direction in the
body frame, mapped to ECEF, drives a Cesium `DirectionalLight` and
`atmosphere.dynamicLighting = SCENE_LIGHT`, so Cesium's day/night
terminator matches celestiary's no matter how celestiary's sidereal phase
relates to real time.

### What changes while a Cesium layer is active

- The body's celestiary surface group (surface, clouds, atmosphere shell,
  axes) is hidden.  Its place labels stay: they draw in the overlay pass
  after the composite (no depth test, a back-hemisphere discard in the
  shader), so they sit over Cesium's globe and drop off its far side
  ([#172](https://github.com/celestiary/web/issues/172); `_hideSurface`
  hid them until then, from when they drew in the main pass, under
  Cesium's globe).
- Earth and Mars keep celestiary's atmosphere post-pass, over Cesium's
  surface (see Atmospheres).

### Data

- Earth: the globe always starts on the plain ellipsoid with the
  simulation month's Blue Marble as its base imagery, tiles bundled with
  celestiary and cut from the same mosaics as its own Earth texture
  (bodies.js `monthlyImagery`; Planet.md), so the two match across the
  swap; when the month changes, the new month's layer goes in above the
  old, which is dropped once its tiles are in.  With a Cesium ion token,
  ion's World Terrain loads, and ion's world imagery (Bing) adds detail
  from globe tile level 5 (`detailFromLevel`), below which the base's
  ~5 km texels would show: from orbit the Earth is Blue Marble.  If the
  token can't reach one (no network, or a token scoped to other assets)
  the globe keeps its offline surface.  (Sentinel-2 was the choice for the
  detail layer, but isn't in ion's asset depot for this account.)  (Passing CesiumWidget
  `terrain: Terrain.fromWorldTerrain()` instead leaves the globe with no
  terrain, drawing nothing, until ion answers, and forever if it fails.)
- Earth's city lights: NASA GIBS's VIIRS Black Marble (the 2016 composite),
  WMTS in Web Mercator, levels 0-8 of 256 px PNG tiles (~600 m a pixel at
  the equator), as a Cesium imagery layer on the globe (bodies.js
  `nightImagery`).  Needs no token, and is public domain (NASA); fetched
  from `gibs.earthdata.nasa.gov`, which sends CORS headers.  Drawn by a
  pass of its own, not through the globe's lighting: see Night lights.
- Moon, Mars: Cesium ion 3D-tiles datasets, token only (see Phases).
- Token: build-time `CESIUM_ION_TOKEN` env var → `__CESIUM_ION_TOKEN__`,
  set from the repository secret of the same name.  It ships in the page,
  so restrict it on ion to celestiary's URLs, with World Terrain, the
  default imagery, Moon Terrain and Cesium Mars in its assets.
- Cesium is dynamically imported the first time a Cesium layer comes into
  range, so views away from Earth, the Moon and Mars don't load it. Its static assets (Workers, Assets,
  ThirdParty) are copied into `docs/cesium/` by the build;
  `window.CESIUM_BASE_URL` points there.

### Atmospheres

- Earth: celestiary's Bruneton pass runs over Cesium's globe, as it does
  over Mars's tiles: one atmosphere, in celestiary's exposure units, on both
  sides of the swap ([HDR.md](js/scene/HDR.md#cesium-in-the-same-units)).
  Cesium's globe draws only its lit surface: stored value × Lambert
  (`litSurfaceOnly`: light intensity 1, `lambertDiffuseMultiplier` 1,
  `vertexShadowDarkness` 0), no ground atmosphere, fog or water effect,
  and the composite applies `DISPLAY_GAIN`.
- **Terrain depth.**  The pass needs to know where Cesium's terrain is and
  how far: its terrain rises over celestiary's sphere, and a ridge seen
  from a valley sits above the sphere's horizon, where the pass took it
  for sky and painted it over (the first cut of #141 did, with a straight
  "horizon" across the mountains).  Cesium's depth doesn't reach
  celestiary (its frames arrive through its 8-bit colour buffer), so a
  Cesium post-process stage (public API, with the scene's depth texture)
  writes each pixel's distance from the camera into alpha, which is
  otherwise always 1 on the opaque globe or tileset, for the bodies under
  celestiary's atmosphere (Earth's globe, Mars's tileset; bodies.js
  `terrainDistance`), encoded as 1 − e^(−d/D) in 8
  bits and dithered (`cesium/distance.js`; D grows with the camera's
  height).  The composite's decode pass turns it back into celestiary's
  depth (written whatever the depth buffer holds: the stencil shell has
  already admitted only pixels where nothing celestiary drew is nearer; a
  real depth test there let lines and points behind Earth show through
  the globe), and the atmosphere pass hazes the terrain for that
  distance (aerial perspective; composition.md), with the camera below
  20 km: from higher up the ridges that matter are a pixel or two, and 8
  bits over the ground in view are too coarse (from 37 km, the first cut
  drew rings of speckle in the ground's haze), so the ground sphere's
  exact depth serves, as before.  The globe needs
  `depthTestAgainstTerrain`: without it Cesium clears the globe's depth
  once drawn and draws the ellipsoid's instead (its depth plane), so the
  stage read the ellipsoid below the horizon and the cleared far plane
  above it, and every ridge came out at the encoding's limit (7 D, ~310 km
  from 6.5 km up, where they were 3 to 25 km off).  Not during the
  crossfade, while celestiary's own surface, at the sphere, is drawn over
  it: a ridge above the sphere's horizon shows as sky until the crossfade
  ends (1 s), then as terrain.  While the terrain's depth is written, the
  body's ground sphere's isn't (`_writeGroundDepths`): Mars's terrain lies
  mostly below its datum, and the sphere's depth, nearer, had covered it,
  and the band between the terrain's horizon and the sphere's, where
  Cesium draws nothing, read as ground with the stars through it.  Left
  without depth, the pass takes that band for a gap in the ground and
  draws the horizon's haze there.  A pixel whose terrain is too far to
  encode (the top two levels, 5.5 D and up: 220 km from the ground) is a
  surface 5.5 D away, hazed as one, which at that distance is the
  horizon's haze.  The first cut gave it the ground sphere's depth where
  the ray met it: from 6 m up a ray under the sphere's horizon meets it
  170 m off, so mountains 150-280 km away on Mars's horizon were drawn
  dark and near, in fragments with dithered edges where the code crossed
  into the top level, and more of them as the camera dropped (D shrinks
  with height; `horizon-terrain-far` in the parity views).  A camera below
  the datum is the atmosphere pass's to handle: it marches the ray to
  where it leaves the sphere and takes the tables from there, and the
  band between the terrain's horizon and the sphere's is the horizon's
  haze on the sky side of the tables by construction, not by rounding
  (composition.md, "The tables' domain"; on a real GPU it flickered black
  while that was rounding).  A float or 16-bit depth from Cesium would do better than 8 bits:
  portal-netgl could expose the host object a guest texture replays to
  (Cesium's globe depth texture), or give screen draws a depth attachment
  of their own (its "guest-private depth" roadmap item).
- Until #86's PR A, Earth used
  Cesium's own sky and ground atmosphere (`atmosphere: true`): from orbit it
  applied `1 − e^(−2x)` to the lit surface plus its haze, and below
  `lightingFadeOutDistance` (10,000 km from the centre) it faded its ground
  atmosphere out altogether, so from 400 km the ground showed unhazed and
  brown where celestiary's was blue; and its translucent sky covered the
  daytime Moon.  The mechanism was already checked on Earth for Mars
  (Phase 4, below).
- Mars: Cesium has no Mars atmosphere (its sky atmosphere is Earth's and
  its ground atmosphere needs a globe), so celestiary's Bruneton pass runs
  over the Cesium layer, as over Earth's globe (one path, above).
- The pass reads `_sceneRT`'s depth: where each ray ends (an object in
  front of the atmosphere, like Phobos before Mars, gets none of it), and,
  inside the atmosphere, ground from sky (ground-ray pixels whose depth
  reads as background are taken for mesh gaps and hazed over).
- Each Cesium frame clears its target's whole depth buffer: `_cesiumRT`'s,
  a copy of celestiary's, so `_sceneRT` keeps celestiary's depth.  Then
  each active body's ground sphere (its celestiary radius, the sphere the
  pass integrates against) is drawn into `_sceneRT` depth-only,
  depth-tested: whatever celestiary drew in front of the body keeps its
  depth.
- Active bodies still composite far to near: a body's own pixels hold no
  depth until the ground spheres go in at the end, so a nearer body is
  drawn after, and over, a farther one.
- The pass's lookup-table path used to ignore where the ray ends, so
  Phobos in front of Mars was hazed by Mars's atmosphere, over
  celestiary's Mars too.  It now passes the scene through when the pixel
  is nearer than the ray's atmosphere entry, with the linearised depth
  (view-space z) divided by the ray's cosine off the view axis to compare
  distances along the ray.

### Night lights

Earth's city lights are the same data as celestiary's, NASA's Black Marble
(Planet.md, texture_night), at the same scale, as emitted light in exposure
units: `NIGHT_LIGHT_RADIANCE` (`exposure.js`) of a sunlit white for a texel
of full white, times the renderer's exposure, times `smoothstep(−0.05, 0.05,
−N·L)`.  Celestiary adds them in its surface shader; Cesium's side is its
own frame (`CesiumLayers._drawNightLights`).

**Why not Cesium's `nightAlpha`.**  The plan was a night layer shown only
by dark: `dayAlpha` 0, `nightAlpha` 1.  It can't work here, for two reasons
(GlobeFS.glsl):

- Cesium blends the imagery, choosing between a layer's day and night alpha by
  `1 − clamp(5·N·L, 0, 1)`, and then multiplies the *blend* by its lighting:
  `clamp(N·L · lambertDiffuseMultiplier + vertexShadowDarkness, 0, 1)`
  (0.3 more on the plain ellipsoid).  The night alpha only picks which
  imagery is there to be lit; and the lit surface here is `stored × Lambert`
  with no ambient (`litSurfaceOnly`), 0 on the night side.  The lights are
  multiplied away, or, with an ambient to carry them, tinted and capped by
  it, and the day side's Lambert is bent with them.
- Cesium's frame reaches celestiary through 8 bits ([HDR.md](js/scene/HDR.md#cesium-in-the-same-units)),
  the lit surface up to 1, where the lights are 4.5e-5 of a lit white: a
  light that is bright after the night's gain (up to 4e6) is under a level
  of the day's.  They can't share the frame's channels, and the alpha holds the
  terrain's distance.

**What it does.**  The Black Marble is an imagery layer on the globe at
alpha 0 (`addNightLights`): the day frame skips it (Cesium draws no layer at
alpha 0), and its tiles load all the same.  After the body's day frame is
decoded into the scene buffer, a second Cesium frame renders the globe with
lighting off, every other layer at alpha 0 and the night layer at 1, on a
black base: the layer's stored values, opaque where the globe is.  Only its
colour clears from `_cesiumRT`, so the day frame's stencil still limits it,
and it runs after the day decode, not before: the decode wrote the terrain's
depth, which the stencil shell's depth test would otherwise hit from inside
the shell (below 64 km).  A second decode adds it to `_sceneRT`
(`newLightsMaterial`, blending One, One, no depth): `texel × nightFactor ×
nightLightRadiance() × toneMappingExposure`, with the stored value read as
celestiary reads it (no sRGB decode), and `nightFactor` from the same
smoothstep on each pixel's N·L, taken from the view ray against the body's
sphere, as celestiary's surface does from its sphere's normal.  So the lights
join the scene before the atmosphere pass, which dims them by the same
transmittance on both sides, and before the meter, which reads them as scene
luminance.

**When.**  Only when some of the surface in view can be on the night side
(`frames.nightVisible`: the camera's angle to the Sun plus the angle of the
cap it sees, against the band's edge at N·L 0.05); the pass is a second
render of the globe, and from a day-side view it is skipped.  And only while
Cesium's layer is on: during the crossfade the surface fading over it
carries celestiary's lights, and the blend does the rest.

**Resolution.**  GIBS's level 8 is ~600 m a pixel; celestiary's texture is
3600×1800 (11 km).  From 4,000 km they agree pixel for pixel; from 400 km
Cesium's lights are sharp (Rome, Naples) where celestiary's are a blur, and
the two agree in the region's mean (`earth-night-dusk`) and not in its
pixels' median (0.69).

**Not done.**  Clouds should dim the lights beneath them (#88); the layer
isn't offline (GIBS is a network host, like ion's imagery, and a failed tile
is black: no lights there, a warning logged once); GIBS's imagery is a
picture, not calibrated radiance, so the scale is calibrated by eye
(Planet.md, brightness).

### Tiles and lighting (ion 3D tiles)

- Celestiary's bodies turn under its camera, so Cesium's camera moves
  every frame.  The tilesets' `foveatedScreenSpaceError` and
  `cullRequestsWhileMoving` optimizations wait for the camera to stop
  before requesting detail, so they're off: detail loads at any distance.
- `maximumScreenSpaceError` 8 (Cesium's default is 16): sharper imagery
  and terrain, for about four times the tiles.
- The tilesets are unlit.  A custom shader lights them by celestiary's
  Sun (Cesium's `scene.light`): Lambert on the smooth sphere, for the
  terminator.  Not on the terrain: the tilesets have no normals, and
  normals from screen-space derivatives of position are flat per triangle.
  The terrain meshes are much coarser than their imagery, so lighting them
  outlined every triangle, from orbit (worst at the terminator) down to
  46 km on the Moon, while the imagery already carries the craters'
  shading.
- From out of range down to the surface, Cesium's camera far plane is
  raised past the body (its default, 5e8 m, would clip the Earth beyond
  ~80 radii).

## Phases

1. **Earth** — layer infrastructure, UI, Earth. *Done; verified in
   headless Chromium without an ion token (Natural Earth II imagery):
   in-place composite, coastlines coincide with celestiary's texture,
   terminator matches, works from orbit down to 150 km, switching back
   restores celestiary's Earth and atmosphere.*
2. **Moon, Mars** — `Ellipsoid.MOON` / `Ellipsoid.MARS` with the Cesium
   ion Moon Terrain (asset 2684829) and Cesium Mars (asset 3644333)
   3D-tiles datasets, no globe. These need an ion token; without one the
   layer control doesn't appear for them. *Done; seen running on the PR
   preview with the production token, as was Earth's ion path.*
3. **Fixes after first use** — Earth's globe no longer goes empty when ion
   can't serve World Terrain; tiles load full detail while the camera
   moves; Moon and Mars lit by the Sun.
4. **Mars atmosphere** — celestiary's Bruneton pass over Cesium's Mars
   (see Atmospheres).  *The mechanism is checked on Earth in the sandbox
   (Cesium's offline globe under celestiary's atmosphere): from orbit and at
   20 km it matches celestiary's own Earth; without the depth rewrite, at
   20 km the ground is hazed white.  Seen on Mars on the PR preview.*
5. **Cesium by default** — the Cesium layer is the default for Earth, the
   Moon and Mars, in range out to celestiary's mesh range; Moon and Mars
   lit by the sphere alone, so no terrain facets; every body in range and
   on screen shows its layer, not only the target; one body's credits at
   a time.
   *Checked in the sandbox (Earth, offline globe): active with no click at
   2,500 km and at 1,000,000 km (past Cesium's default far plane); one
   credits container, shown.  On the preview: on by default for all
   three, one set of credits; a first shader, which faded terrain relief
   out with distance, still showed facets on the Moon at 46 km, so relief
   lighting was dropped.  The Moon went back to celestiary's with Earth
   targeted; in the sandbox, at the Moon, Earth is now Cesium's with
   either the Moon or Earth targeted.  Mars arriving with a halo off to
   one side, and the Moon clipped to a lens off-centre: reproduced in the
   sandbox with a local Moon tileset (Cesium's Moon centre 65 px off
   three's); with the camera set directly, both centres project to the
   same pixel.*

## Follow-ups

- Picking / inspection through Cesium (click → lat/lng, entity info):
  forward celestiary's clicks to `scene.pick` on the active widget.
- Night lights: done in #93 (Night lights, above).  Left: a bundled low-level
  copy of the Black Marble for offline use, and clouds dimming the lights
  (#88).
- Persist the layer choice in the permalink.
- Perf: the shadow context executes every Cesium draw as well as the
  replay (2× GPU for the globe). Cesium needs the shadow's pixels only
  for readback (picking, camera collision); a no-draw shadow mode in
  portal-netgl would halve the cost when those aren't in use.

## Files

New:

- `js/scene/cesium/frames.js` (+ test) — body frame ↔ ECEF, camera/light
  conversion. Pure.
- `js/scene/cesium/bodies.js` — per-body config (ellipsoid radii, data).
- `js/scene/cesium/CesiumLayers.js` (+ test) — lazy Cesium + NetGL link, stencil
  shell, per-frame coupling, activation.
- `js/store/LayersSlice.js` — `layerBody` (in-range capable body or
  null), `bodyLayers` (per-body choice; `bodyLayer()` applies the
  default).
- `js/ui/LayersButton.jsx` — the control.

Changed:

- `js/ThreeUI.js` — depth-stencil, half-float `_sceneRT`; layer hooks in `renderLoop`;
  atmosphere disabled for a Cesium-layered body; publish `layerBody`.
- `js/App.jsx` — mount `LayersButton`.
- `js/store/useStore.js` — add the slice.
- `esbuild/build.js`, `esbuild/common.js`, `esbuild/serve.js` — copy
  Cesium assets, define the token.
- `package.json` — `cesium`, `@pablo-mayrgundter/portal-netgl`.
- CI workflows — Node 22 (Cesium requires it; yarn enforces engines).

## Verification

- `yarn precommit` (lint, bun tests, bundle check).
- frames.test.js: round trips, known points (lat/lng → ECEF matches Cesium's
  `Cartesian3.fromDegrees` on a sphere), handedness.
- In a browser: with Earth targeted the button appears and the Cesium
  layer is on without a click; targeting a body Cesium can't render, it
  doesn't.
  Choosing Cesium swaps the globe in place with no visible offset or lag
  while orbiting; the Moon occludes/is occluded correctly; the terminator
  matches celestiary's; switching back restores celestiary's Earth and
  atmosphere exactly.

## Parity check

`yarn parity` compares celestiary's rendering of a body with its Cesium
layer, numerically, for a list of permalink views.  It's the by-hand
procedure of AGENTS.md as one command, and what the "done when" of the
Earth-appearance issues (#92 imagery, #93 night lights, and #86 exposure,
#88 clouds) cite.

Not part of `yarn precommit`: it takes minutes (30 to 80 s a view on
SwiftShader, four cores) and needs the network (ion).  The arithmetic is in
`tools/parity/measure.mjs`, with bun tests that do run in precommit.

### Running it

```
CESIUM_ION_TOKEN=... yarn build     # the Moon and Mars need the token, Earth's terrain too
yarn parity                         # every view in tools/parity/views.json
yarn parity --only moon-quarter --out parity-out
```

- It serves `docs/` itself and doesn't build: without a build it says so
  and exits 2.  The token is read at build time, so it isn't needed to run
  the script.  Never print it: ion's error bodies echo it, and the script
  logs ion answers by status only.
- ion is fetched through Node with celestiary's production Referer, the
  token being restricted to it (AGENTS.md, Secrets), and answered to the
  page with CORS open.  If ion answers 401 the token in the build is stale
  or not scoped to the site; the Moon and Mars then never load and their
  views fail as "not settled", saying so.
- NASA GIBS (Earth's night lights) is fetched through Node too, with no
  headers: a sandbox's Chromium doesn't trust its egress proxy's CA
  (`ERR_CERT_AUTHORITY_INVALID`), so direct, the tiles never load and the
  night views show Cesium's Earth black.
- Options: `--only id,id`, `--out dir` (a PNG pair per view and
  `report.json`; `parity-out/` is gitignored), `--views file`, `--docs dir`,
  `--viewport WxH`, `--timeout seconds` (per view, default 1800), `--list`.
- Exit code: 0 all pass, 1 a check failed, 2 couldn't run.

### What it does

Per view, in headless Chromium (SwiftShader), in a fresh page:

1. Loads the view's permalink, forces the layer on
   (`c.ui.layers.fadeOf = () => 1`), and waits, with no fixed sleep, until
   the app has restored the view, the body's layer is `ready`, `shown` and
   in `layers.active` (its tiles were in: `tilesReady`), Cesium's tiles read
   loaded, no request is in flight, and six more frames have gone by.
2. Pauses the simulation clock, then renders twice in one task with
   `c.ui.renderLoop` and reads the frame back with `readPixels`: the layer
   forced fully on (`fadeOf = () => 1`), then fully off (`() => 0`, so
   celestiary's own surface and atmosphere draw over Cesium's).
3. Measures, over the lit part of the body's disc (its inner 90%, so the
   limb, where silhouettes and atmospheres differ, is left out; pixels
   under luma 12 of 255 in the off render, the night side, are left out):
   - the median per-pixel ratio on/off of the luma, and of R, G and B.  Per
     pixel first, then the median, so coastlines, craters and a pixel of
     misregistration don't move it.
   - a brightness profile across the terminator: 40 samples (each a 5-pixel
     strip) along the Sun's direction on screen through the disc's centre,
     dark side to lit, on both renders; the max and the mean of the
     absolute difference, in luma levels of 255.
4. Prints a table of view, metric, value, tolerance and PASS/FAIL, and adds
   a check that the layer was active when the frames were read.

The values are display values (sRGB, after tone mapping), as a viewer sees
them.  Ratios are Cesium over celestiary: below 1 is Cesium darker.

### Views and tolerances

`tools/parity/views.json`: `defaults` (viewport, region, profile) and a list
of `views`, each:

| Field | Meaning |
|---|---|
| `id`, `description` | name in the table and `--only`; what the view exercises |
| `body` | `earth`, `moon` or `mars`: the layer to force and the disc to measure |
| `hash` | the permalink, with `cq=` (js/permalink.md; without it the time and view aren't restored).  Include `s=alpoU` to turn off labels, lines and the Milky Way, which are drawn on both renders and dilute the ratios |
| `region` | `{"disc": true, "inner": 0.9}` (the body's disc, computed from the camera) or `{"box": [x0, y0, x1, y1]}` in fractions of the image; `minLuma` (default 12) |
| `profile` | `{"across": "terminator", "samples": 40, "band": 5, "reach": 0.9}`, or `{"from": [x, y], "to": [x, y]}` in fractions of the image; omit for none |
| `labels` | `true` for a view that checks the body's place labels draw over Cesium's render: parity renders it once more with the body's `places` hidden and counts the pixels that differ (`label pixels`, tolerance `labelPixels` `{min}`).  Its hash leaves `p` out of `s=` (the places' toggle, on by default), as the `*-labels` views do (`s=aloU`: no star labels, asterisms, orbits or Milky Way).  Such a view has no ratio tolerance, as it checks the labels, not the surface.  It exists because the other views' `s=alpoU` turns the labels off, so none of them could see the layer hiding them (#172) |
| `freeze` | `true` stops the simulation clock as soon as the app is up, not once the tiles have settled: for views low over relief, where the ground turning under the camera while tiles load (hundreds of m/s) would frame different mountains each run |
| `reference` | optional `{"box": [x0, y0, x1, y1]}`: a second region of the same render, for what has no counterpart in celestiary's render (Cesium's terrain above celestiary's sphere), measured against the ground beside it in Cesium's render |
| `tolerance` | `ratio` `[lo, hi]`; `channelRatio` `[lo, hi]` or `{r, g, b}`; `meanRatio` `[lo, hi]` (the ratio of the region's mean luma and of each channel's mean, on/off: for views where the two renders differ in resolution, which moves the per-pixel medians but not the energy); `profileMax`, `profileMean` (luma levels); `luma` `[lo, hi]` (each render's own median luma, on and off: for views where both sides could go wrong alike, as they share the atmosphere pass); `reference` `{luma, blueRed}`, each `[lo, hi]` (the on render's median luma, and median blue/red, over the region over the same over `reference`: the ridge looks like ground, not sky); `labelPixels` `{min}` (a `labels` view: the pixels the place labels add); `minPixels` (default 200) |

To add a view: fly to it in the app (the URL follows the camera, one second
after it settles) and copy the hash; pick a **partial phase**, as colour
mismatches hide near full; check the body's Cesium layer is engaged there
(in range, above); add an entry with loose tolerances, run `yarn parity
--only <id> --out parity-out`, look at the images, and set the tolerances
from the numbers.  The camera should be about 90 degrees from the Sun for a
half-lit disc; the app's Sun direction is at the origin, so the phase is the
angle between the camera's and the Sun's directions from the body.

The tolerances are **baselines, not targets**: each is the measured value
with margin (runs differ by about 0.002 in ratio and a few levels in the
profile max, which sits at the limb), so a change that moves the two
renderings apart fails, and one that brings them together shows as a value
well inside its range.  When #92, #93 or #86 close a gap, tighten that
view's tolerance to the new value with the same margin.  Ratios ought to
come to about 1 (0.95 to 1.05); since #86's PR A all four views are within
that, see below.

### Baselines and what they show

SwiftShader, 480x300, `t=9233.1234jd`, ion token from the repository
secret.  Cesium over celestiary; runs repeat to about 0.002 in ratio.

| View | Luma | R / G / B | Profile max / mean (of 255) |
|---|---|---|---|
| `earth-orbit-gibbous` | 0.990 | 0.976 / 0.988 / 1.000 | 29.5 / 2.4 |
| `moon-quarter` | 0.967 | 0.967 / 0.967 / 0.967 | 19.4 / 5.5 |
| `mars-gibbous` | 0.988 | 1.000 / 0.985 / 0.986 | 9.5 / 1.8 |
| `earth-low-dusk` | 1.001 | 1.000 / 1.000 / 1.000 | 3.2 / 1.2 |
| `earth-night-europe` | Europe at night from 4,000 km (#93; `t=9851.4722jd`): median ratio 1.004 over the lit land (pixels of 6 or more), 1.000 / 1.000 / 1.000 per channel, mean 0.983 / 0.974 / 0.985 / 0.997 (luma, R, G, B); median luma 54.4 on, 54.3 off.  Cesium's side was black (0.000) before | (no profile) |
| `earth-night-dusk` | Italy from 400 km straight down, Sun 16° under the horizon (#93): mean ratio 0.973 luma, 0.946 (0.894 once) / 0.979 / 1.006 (R, G, B) over the whole frame, GIBS's 600 m tiles sharp against celestiary's 11 km texture (the median pixel ratio there is 0.69, which is why the view is judged by the mean).  Before: 0.918 and 0.672 (red), Cesium's frame showing the twilight glow and no lights | (no profile) |
| `earth-low-land-day` | 0.938-0.972 | median luma 80 on, 85 off since the surface's segment is marched (73-75 and 77-78 with the table's; 55, washed out, before #141's fix) | (no profile) |
| `earth-ridge-day` | ridge over valley ground, on: luma 0.971, blue/red 0.992 (was 0.69 and 2.24, sky over the ridge) | (no off comparison) | (no profile) |
| `mars-low-horizon` | 0.952 over the ground; median luma 42.0 on, 43.8 off | (no profile) | (no profile) |
| `mars-low-horizon-band` | horizon band over the sky above it, on: luma 0.801, blue/red 1.038 (was 0.484 and 0.901, ground with the stars through it) | (no off comparison) | (no profile) |
| `mars-near-ridge` | the rows on the sphere's horizon line across a near ridge, over the ridge below them, on: luma 1.069, blue/red 1.040 (was 1.114 and 1.093, a seam through the ridge); 1.078 / 1.038 since the exact step integral (#145) | (no off comparison) | (no profile) |
| `mars-below-datum-band` | from 658 m under the datum, away from the Sun: the band between the terrain's horizon and the horizontal over the sky above it, on: luma 0.792, blue/red 1.113 (#145; the band flickered black on a real GPU before it) | (no off comparison) | (no profile) |
| `mars-below-datum-sunward` | the same spot facing the Sun, the band on the right over the sky above it, on: 0.996 / 1.000 (#145) | (no off comparison) | (no profile) |
| `earth-dead-sea-band` | from 16 m under the datum at the Dead Sea, the band (two rows) over the sky above it, on: 0.985 / 0.914 (#145) | (no off comparison) | (no profile) |
| `horizon-terrain-far` | from 6 m on Mars, mountains 150-280 km off on the horizon (past the distance code's range) over the sky above them, on: 0.992 / 0.996 (#145; before it, dark fragments at the sphere's depth, ~0.2); 0.835 / 0.958 with the new Mars sky (#147: the mountains' haze is tan and thinner, the sky above it less bright) | (no off comparison) | (no profile) |
| `mars-sky-zenith` | Mars's day sky looking up, the zenith over the sky 35° lower: luma 0.277, blue/red 0.897 (#147; tan, with a gradient) | (no off comparison) | (no profile) |
| `mars-sky-antisolar` | the sky over the anti-solar horizon over the sky 30° up: 1.643 / 1.078 (#147; before it the anti-solar sky was nearly black) | (no off comparison) | (no profile) |
| `mars-sky-aureole` | the aureole within 10° of the Sun over the sky 40° off: 2.418 / 1.768 (#147: bluer, as the rovers see it; before, white across the frame) | (no off comparison) | (no profile) |

The `*-labels` views (#172) measure no ratio: label pixels (what the
place labels add over Cesium's render; the tolerance is at least 400) read
`earth-labels` 3280, `moon-labels` 3614, `mars-labels` 1939 at 480x300,
and 0 with the layer hiding the places, as `_hideSurface` did.

With #147 (multiple scattering for every body; Earth's gain 30 → 21):
`earth-orbit-gibbous` 0.991, `mars-gibbous` 0.995 (profile max 5.1),
`earth-low-land-day` 0.940 with luma 71 on and 76 off (77.9 / 80.8 before),
`mars-low-horizon` 0.949 (42.8 / 44.0), `mars-low-horizon-band` 0.903 /
1.001, `mars-near-ridge` 1.054 / 1.028, `mars-below-datum-band` 0.928 /
1.016, `mars-below-datum-sunward` 0.846 / 0.977, `earth-dead-sea-band`
1.006 / 0.897; nothing re-baselined.

With #96 (the IAU prime meridians) Mars turns differently at every date,
and a permalink holds the camera in the body frame, so the Mars views'
`t` moved back by under half a sol (0.011 d for `mars-gibbous`, 0.41-0.44 d
for the rest), to where the new orientation matches the old one to
0.001°: the same ground, the same camera, the Sun within 0.25° of where it
was.  The Moon's orientation moved to the IAU model, 0.04° from Cassini's
laws, and its view kept its `t`.  Measured then: `moon-quarter` 0.967
(profile 18.8 / 5.6), `mars-gibbous` 0.995 (4.9 / 1.1), `mars-low-horizon`
0.948 (42.3 / 43.8), `mars-low-horizon-band` 0.918 / 1.001,
`mars-near-ridge` 1.050 / 1.024, `mars-below-datum-band` 0.907 / 1.016,
`mars-below-datum-sunward` 0.847 / 0.977, `horizon-terrain-far` 0.836 /
0.958, `mars-sky-zenith` 0.271 / 0.896, `mars-sky-antisolar` 1.643 / 1.086,
`mars-sky-aureole` 2.396 / 1.768; nothing re-baselined.

Measured after #86's PR A (one HDR buffer; Earth under celestiary's
atmosphere pass on both sides), with #137's IAU poles (Mars's turned the
view: its profile max went from 5.5 to 9.5).  Earth's orbit profile max
ranged 29.5 to 36.6 over runs.  Before it, on the same machine:

| View | Luma | R / G / B | Profile max / mean |
|---|---|---|---|
| `earth-orbit-gibbous` | 0.975 | 1.125 / 0.973 / 0.736 | 23.1 / 9.4 |
| `moon-quarter` | 0.967 | 0.967 / 0.967 / 0.967 | 19.4 / 5.5 |
| `mars-gibbous` | 0.992 | 1.000 / 0.991 / 1.000 | 5.9 / 1.1 |
| `earth-low-dusk` | 0.899 | 1.198 / 0.866 / 0.511 | 25.0 / 8.8 |

(The Moon measured 0.905 when the check was written; by the time #134
merged, #130's new lunar orientation had turned a different face to this
view, and it read 0.967 on main, outside its first tolerance.)

- **Mars matches**: its Cesium tiles under celestiary's atmosphere pass are
  within 1.5% and 5 levels of celestiary's own.
- **The Moon is 3% darker** in Cesium, equally in all channels, and the
  whole difference is at the bright limb (the profile agrees to 1-3% from
  the terminator to the disc's middle, then falls to 0.75 at the limb).  It
  is celestiary's specular: its Moon is a `MeshPhysicalMaterial` (F0 0.04,
  roughness 0.8), whose Fresnel term brightens grazing views, while
  `sunlitShader` is Lambert only.  With the Moon's `specularIntensity` set to
  0, celestiary's lit disc is 4.5% darker and Cesium's is 1.4% brighter
  than it.  Whether the Moon should have that sheen is a lighting question,
  separate from #86.
- **Earth matches**, since #86's PR A put its Cesium globe under
  celestiary's atmosphere pass: within 1% in luma, 2.4% in red, from orbit
  and from 400 km; profile means of 1-2.5 levels.  Before, Cesium drew its own sky and ground atmosphere:
  from orbit, its `1 − e^(−2x)` curve over the lit surface plus its haze
  made the disc 12% redder and 26% less blue than celestiary's; from 400 km
  its ground atmosphere had faded out (Cesium's `lightingFadeOutDistance`,
  10,000 km from the centre), leaving the lit imagery unhazed and brown
  where celestiary's Bruneton pass gives a blue haze.  Neither was
  celestiary's atmosphere failing to reach Cesium's ground: the pass stood
  down for Earth by design (`atmosphere: true`).  The remaining profile
  maximum, from orbit, is one sample where the coast meets the lit limb,
  and moves by several levels between runs.
- **Earth at twilight, metered** (`earth-twilight-metered`, 3 km over the
  outback, Sun 5° under the horizon, landed): the metered exposure lifts
  the frame about 14× with Cesium's terrain in it (#86's PR B), and the
  decode, scaled by the exposure over Earth's keyed one, keeps Cesium's
  side with celestiary's: the sky band on against off 1.000.  Rendered
  before the exposure had settled, the two sides differed by a third, so
  parity now waits for the gain to reach its goal before its two renders;
  and the view's `cq` is in the landed frame (the `L` in `s=`), without
  which the restore looked up at the zenith.  The ground under the band
  is left out: at night it is two models, Cesium's night floor against an
  unlit sphere.
- **Earth low over land by day** (`earth-low-land-day`, 7.5 km, Sun 8° up):
  Cesium's ground is 3-6% darker than celestiary's (its imagery and terrain
  Lambert against celestiary's texture), under the same haze.  Until #141's
  fix the atmosphere pass washed the day ground out on both sides alike,
  which the ratio (1.0) couldn't see, so the view also bounds each render's
  own median luma (`luma`, 65-90; it read 55).  The eye-adaptation boost,
  since removed (#86 PR B),
  covered the ground (T 0.094 over it from 7.5 km), and below 1.3 km the
  in-scatter table's ground slice gave the ground the horizon's glow; see
  [composition.md](js/scene/atmos/composition.md).  A 16 m view isn't in
  the list: at ground level Cesium's tiles never all read loaded, so it
  never settles.
- **Terrain over the sphere's horizon** (`earth-ridge-day`, 6.5 km near
  Everest, looking up a valley at a ridge): celestiary's sphere has no
  ridge there, so the view checks Cesium's ridge against the valley ground
  below it in the same render (`reference`).  Before #141's terrain depth
  the atmosphere pass drew sky over the ridge (luma 0.69 of the ground's,
  blue/red 2.24 of it); now 0.97 and 0.99.  The view stops the clock at
  load (`freeze`): with the clock running while tiles load, the ground
  turned under the camera and each run framed different mountains.
- **Mars low** (`mars-low-horizon`, 232 m in Valles Marineris, Sun low on the
  left): Cesium's Mars terrain lies mostly below the datum, under
  celestiary's sphere.  Over the ground both sides get the table's haze to
  the sphere (0.942, Cesium's imagery a little darker); the band on the
  right between the terrain's horizon and the sphere's
  (`mars-low-horizon-band`) read as ground with the stars through it until
  #141's Mars fix, and is now the horizon's haze.
- The night side is left out of the ratios (under luma 12), so #93's city
  lights, which only celestiary draws, don't enter them; only the
  profile's dark end sees them.

### Caveats

- Numbers are SwiftShader's; a real GPU may differ a little.  Keep
  baselines from one machine, and re-measure them if the environment
  changes.
- The views are at 20,000 km and below, where Blue Marble is Earth's whole
  surface: ion's world imagery (Bing) only comes in from globe tile level 5.
  In the sandbox `dev.virtualearth.net` is also denied, so that path is
  unchecked here.  Add a low, terrain-level Earth view (with Bing reachable)
  when #92 lands.
- At low altitude the disc fills the frame, so the "disc" region is the
  whole image and the profile runs to the image's edge, not the limb.
- The page's own time is paused, so both renders are the same instant;
  celestiary's animation frames carry on around the two forced ones.
