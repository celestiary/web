# Cesium layers — plan

An optional **Cesium** layer for bodies Cesium can render (Earth; later the
Moon and Mars). Celestiary's own rendering stays the default: tuned to look
right from orbit (Bruneton atmosphere, surface textures, night lights). The
Cesium layer is the *data view*: Cesium's globe, terrain, imagery and
datasets, composited in place of celestiary's body, for inspecting the
planet up close.

## UX

- When the camera is near a Cesium-capable body (target is that body and
  camera distance < `LAYER_NEAR_RADII` × its radius), a **Layers** button
  appears in the top-right control stack, under the drag-mode toggle.
- Clicking it expands (Google-Maps-style) to two tiles: **Celestiary**
  (default) and **Cesium**. Choosing one applies it to that body; the
  choice is remembered per body for the session.
- The layer is only *active* while near; flying away drops back to
  celestiary's own rendering (Cesium is not rendered at all), and coming
  back re-activates it.
- The button is HTML chrome, so it follows the `v` visibility group.
- Cesium's credits (required data attribution) show as a small overlay
  while the layer is active.

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
- Celestiary's atmosphere post-pass is disabled for that body; Cesium draws
  its own sky and ground atmosphere.

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
- Cesium is dynamically imported the first time a Cesium layer is chosen,
  so the default app pays nothing. Its static assets (Workers, Assets,
  ThirdParty) are copied into `docs/cesium/` by the build;
  `window.CESIUM_BASE_URL` points there.

### Tiles and lighting (ion 3D tiles)

- Celestiary's bodies turn under its camera, so Cesium's camera moves
  every frame.  The tilesets' `foveatedScreenSpaceError` and
  `cullRequestsWhileMoving` optimizations wait for the camera to stop
  before requesting detail, so they're off: detail loads at any distance.
- The tilesets are unlit.  A custom shader lights them by celestiary's
  Sun (Cesium's `scene.light`): Lambert on the sphere (terminator) blended
  with Lambert on screen-space-derivative normals (crater and ridge relief;
  the tilesets have no normals).

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

## Follow-ups

- Picking / inspection through Cesium (click → lat/lng, entity info):
  forward celestiary's clicks to `scene.pick` on the active widget.
- Night lights on Cesium's Earth (ion Black Marble as a night layer).
- Celestiary's atmosphere over Cesium's Mars.  Cesium's sky atmosphere is
  Earth's and its ground atmosphere needs a globe, so Mars in the Cesium
  layer has none.  Celestiary's Bruneton post-pass could run over it
  instead: it reads `_sceneRT`'s depth, so after Cesium draws, write the
  depth of a body-radius sphere (depth only, within the stencil) where
  Cesium's pixels are, and keep the pass on for Mars.  Needs Cesium's
  draws kept out of that depth (its log depth doesn't match).
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
- `js/scene/cesium/CesiumLayer.js` — lazy Cesium + NetGL link, stencil
  shell, per-frame coupling, activation.
- `js/store/LayersSlice.js` — `layerBody` (nearby capable body or null),
  `bodyLayers` (per-body choice).
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
- In a browser: near Earth the button appears; far away it doesn't.
  Choosing Cesium swaps the globe in place with no visible offset or lag
  while orbiting; the Moon occludes/is occluded correctly; the terminator
  matches celestiary's; switching back restores celestiary's Earth and
  atmosphere exactly.
