# Cesium layers — plan

A **Cesium** layer for bodies Cesium can render (Earth, and the Moon and
Mars with an ion token), and the default for them: Cesium's globe,
terrain, imagery and datasets, composited in place of celestiary's body.
Celestiary's own rendering (Bruneton atmosphere, surface textures, night
lights) stays one click away in the layers control, and is what a body
falls back to if its Cesium layer can't load.

## UX

- A Cesium-capable body is *in range* when it's the target and the camera
  is within its mesh range: as far out as celestiary draws the body as a
  mesh rather than a point (the distance of the next level in its
  `planet LOD`, Planet.newPlanet; 10 AU today).  In range, a **Layers**
  button appears in the top-right control stack, under the drag-mode
  toggle.
- Clicking it expands (Google-Maps-style) to two tiles: **Celestiary** and
  **Cesium** (default, `DEFAULT_BODY_LAYER` in LayersSlice.js). Choosing one
  applies it to that body; the choice is remembered per body for the
  session.  A body whose Cesium layer fails to load drops back to
  Celestiary, and the control shows the error.
- The layer is only *active* while in range; flying away drops back to
  celestiary's own rendering (Cesium is not rendered at all), and coming
  back re-activates it.
- The button is HTML chrome, so it follows the `v` visibility group.
- Cesium's credits (required data attribution) show as a small overlay
  while the layer is active: the active body's only.  Each body's widget
  writes its credits into its own container inside the overlay (one shared
  container stacked a copy per body visited).

## Architecture

Same-page NetGL (portal-netgl ≥ 0.2.0, `makeNetGLImmediateLink`). No
iframe: Cesium runs in celestiary's page against a *shadow* WebGL2 context
on its own hidden canvas; its GL calls are recorded and replayed into
celestiary's context at a chosen point in celestiary's frame.

```
ThreeUi.renderLoop
  layers.beforeRender()          hide/show the body's celestiary surface
  render(scene) → _sceneRT       celestiary as usual (body surface hidden)
  layers.composite()             ↓ only when a Cesium layer is active
    stencil pass → _sceneRT        WGS84-shaped shell, depth-tested against
                                   celestiary's depth: stencil = 1 where the
                                   body (or its atmosphere) is visible
    link.frame(() => {             Cesium renders synchronously; each GL call
      set Cesium camera              replays into celestiary's context now
      widget.render()              ← screen draws redirected into _sceneRT,
    })                               clipped to stencil = 1, premultiplied-
    renderer.resetState()            over blended, colour clears dropped
  _updateAtmUniforms()           celestiary atmosphere off for this body
  render(atm pass) → screen
```

Why these pieces:

- **In `_sceneRT`, not on screen.** Celestiary's depth lives in `_sceneRT`
  (its atmosphere post-pass reads it), so the stencil shell must depth-test
  there. `_sceneRT` gets a depth-*stencil* texture.
  `replay.screenFramebuffer` maps Cesium's default framebuffer onto it.
- **Stencil, not depth, decides visibility.** Cesium's depth convention
  (log depth, multi-frustum) doesn't match celestiary's; the shell pass
  resolves occlusion against celestiary's objects (the Moon in front of the
  Earth keeps its pixels; behind it, it's covered). Cesium's final pass
  then only fills stencilled pixels.
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
node's world matrix, in JS doubles) → ECEF → `camera.setView`; Cesium's
`frustum.fov` from celestiary's vertical fov (Cesium's fov spans the wider
canvas dimension).

Lighting: celestiary's Sun is at the world origin. Its direction in the
body frame, mapped to ECEF, drives a Cesium `DirectionalLight` and
`atmosphere.dynamicLighting = SCENE_LIGHT`, so Cesium's day/night
terminator matches celestiary's no matter how celestiary's sidereal phase
relates to real time.

### What changes while a Cesium layer is active

- The body's celestiary surface group (surface, clouds, atmosphere shell,
  axes) is hidden, as are its place labels (they'd sit under Cesium's
  globe; Cesium's own data layers replace them).
- Earth: celestiary's atmosphere post-pass is disabled; Cesium draws its
  own sky and ground atmosphere.  Mars keeps celestiary's (see
  Atmospheres).

### Data

- Earth: the globe always starts on the plain ellipsoid with the Natural
  Earth II imagery bundled with Cesium (offline, low-res).  With a Cesium
  ion token, ion's World Terrain and default imagery replace them as each
  loads; if the token can't reach one (no network, or a token scoped to
  other assets) the globe keeps its offline surface.  (Passing CesiumWidget
  `terrain: Terrain.fromWorldTerrain()` instead leaves the globe with no
  terrain, drawing nothing, until ion answers, and forever if it fails.)
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

- Earth: Cesium draws its own sky and ground atmosphere (`atmosphere:
  true` in bodies.js), and celestiary's atmosphere pass stands down.
- Mars: Cesium has no Mars atmosphere (its sky atmosphere is Earth's and
  its ground atmosphere needs a globe), so celestiary's Bruneton pass runs
  over the Cesium layer.  The pass reads `_sceneRT`'s depth to tell ground
  from sky (inside the atmosphere, ground-ray pixels whose depth reads as
  background are taken for mesh gaps and hazed over), and Cesium's frame
  clears that depth.  So after Cesium draws, a depth-only sphere of the
  body's radius, stencil-tested to Cesium's pixels with depth test ALWAYS,
  rewrites it: the same ground sphere the pass integrates against.
- Known gap: Cesium's depth clear also wipes celestiary's depth outside
  the stencil.  Only the gap test reads it, so an object (Phobos) in front
  of Mars while the camera is inside Mars's atmosphere can be hazed over.

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
   lit by the sphere alone, so no terrain facets; one body's credits at a
   time.
   *Checked in the sandbox (Earth, offline globe): active with no click at
   2,500 km and at 1,000,000 km (past Cesium's default far plane); one
   credits container, shown.  On the preview: on by default for all
   three, one set of credits; a first shader, which faded terrain relief
   out with distance, still showed facets on the Moon at 46 km, so relief
   lighting was dropped.*

## Follow-ups

- Picking / inspection through Cesium (click → lat/lng, entity info):
  forward celestiary's clicks to `scene.pick` on the active widget.
- Night lights on Cesium's Earth (ion Black Marble as a night layer).
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

- `js/ThreeUI.js` — depth-stencil `_sceneRT`; layer hooks in `renderLoop`;
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
