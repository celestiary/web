# Celestiary Architecture

## Overview

Celestiary is a web-based astronomical simulator — an interactive 3D solar system and star field viewer. It renders real-scale celestial objects in WebGL via Three.js, animates orbital mechanics using VSOP87 planetary theory, and presents a React/MUI UI overlay for navigation and controls.

## Technology Stack

| Concern | Library/Tool |
|---|---|
| 3D rendering | Three.js 0.171 (WebGL2) |
| React framework | React 18 + React DOM |
| UI components | MUI v5 (Material UI) |
| Routing | Wouter 3 (hash-based for celestial targets, path-based for app sections) |
| State management | Zustand 4 |
| Animation tweening | @tweenjs/tween.js |
| Orbital mechanics | vsop87 package + custom elliptical fallback |
| Build | esbuild (custom config in `esbuild/`) |
| Test runner | Bun test |
| Linting | ESLint 9 (Google style + JSDoc + jsx-a11y) |

## Top-level Entry Points

```
js/index.tsx        Root React mount: Style -> Routed
js/Routed.jsx       Path router: '/' -> App, '/guide' -> Guide (lazy-loaded)
js/App.jsx          Main simulator UI shell
js/guide/Guide.jsx  Interactive tutorial/demo sections
```

## Application Bootstrap Flow

1. `index.tsx` mounts `<Root>` → `<Style>` → `<Routed>`
2. `Routed` uses Wouter to lazy-load either `App` (simulator) or `Guide` (tutorial)
3. `App` instantiates the `Celestiary` controller on mount, passing DOM refs for the canvas container and nav panel
4. `Celestiary` wires together all subsystems and calls `load()` to fetch the initial target (defaults to `sun`)

## Core Class Hierarchy

```
Celestiary            Main controller (window.c for debug)
  ├── Time            Simulation clock (timeScale, pause, Julian Day)
  ├── Animation       Per-frame orbit/rotation updater (VSOP87 + elliptical)
  ├── ThreeUi         Three.js wrapper (renderer, camera, controls, render loop)
  │     └── Scene (three.js)
  ├── Scene           Celestiary scene manager (object registry, targeting, picking)
  │     ├── Stars     Star field (buffer geometry, shader, labels, asterisms)
  │     ├── Star      Individual named star (LOD, Perlin noise surface shader, PointLight)
  │     ├── Planet    Planet or moon (LOD, orbit shape, surface mesh, atmosphere, labels)
  │     └── Galaxy    Invisible grouping root (Milky Way container)
  ├── Loader          Async JSON fetcher for celestial object descriptors
  ├── ControlPanel    DOM-based nav display (breadcrumb path)
  └── Keys            Keyboard shortcut registry
```

All scene objects inherit from `js/scene/object.js` (a thin Three.js `Object3D` wrapper).

## Coordinate System & Scale

Distances are stored in **real SI meters**. Key constants from `js/shared.js`:

- `ASTRO_UNIT_METER = 149597870700` m (1 AU)
- `SUN_RADIUS_METER = 6.957e8` m
- `STARS_RADIUS_METER = LIGHTYEAR_METER * 1e4` m
- `SMALLEST_SIZE_METER = 6e5` m (allows zooming into Deimos)
- Camera near/far are set to `SMALLEST_SIZE_METER` … `STARS_RADIUS_METER * 2`

Three.js scene units equal meters. Planets use VSOP87 coordinates scaled by `ASTRO_UNIT_METER`; stars use Celestia binary catalog coordinates scaled by `LIGHTYEAR_METER`.

All celestial bodies (sun, planets, stars, asterisms) live under a single `WorldGroup` `Object3D`. Shifting `worldGroup.position` rebases the entire universe in one operation — used by star navigation to bring the current target star to world origin, so camera world coordinates stay small for float32 precision even across light-year distances. See [Navigation (goTo flow)](#navigation-goto-flow).

## Data Loading

`Loader` fetches `/data/<name>.json` files recursively along a path (e.g. `sun/earth/moon`). Each JSON descriptor includes:

- `type`: `galaxy | stars | star | planet | moon`
- `radius`, `orbit`, `axialInclination`, `siderealRotationPeriod`
- `system`: array of child names to load next
- Optional: `texture_*`, `has_locations`

Loading is cached per name; the URL hash (e.g. `#sun/earth`) drives the target path. `hashchange` events trigger re-loads.

Stars are loaded separately from the Celestia binary star catalog (`StarsCatalog`), not from JSON.

## Scene Graph Structure (per planet)

```
<parent>.orbitPosition
  └── Planet (Object3D)
        └── group
              └── orbitPlane
                    ├── orbit (ellipse Line)
                    └── orbitPosition  ← animation sets position here
                          └── planetTilt
                                └── planet (Object3D)
                                      ├── planetLOD
                                      │     ├── [near] surface mesh + atmosphere + clouds
                                      │     ├── [far]  single Point sprite
                                      │     └── [very far] FAR_OBJ (invisible)
                                      └── labelLOD
                                            ├── [near] FAR_OBJ
                                            ├── [mid]  SpriteSheet label
                                            └── [far]  FAR_OBJ
```

Moons follow the same pattern, parented to their planet's `orbitPosition`.

## Animation Loop

`ThreeUi.renderLoop()` runs every frame (via `renderer.setAnimationLoop`):

1. Process click events (raycasting)
2. Save `camera.quaternion` (`_savedCamQuat`)
3. `controls.update()` (TrackballControls — zoom/pan only; rotation disabled)
4. Restore `camera.quaternion` — suppresses the `lookAt` that TrackballControls applies each frame, so camera orientation is owned by navigation tweens and user input
5. `_applyAsymptoticZoom()` — remaps zoom to altitude space and adjusts `camera.near`
6. `animationCb(scene)` → `Animation.animate(scene)`:
   - `Time.updateTime()` advances simulation clock by `timeDelta * timeScale`
   - `vsop87c(julianDay)` computes heliocentric XYZ for 8 major planets
   - `animateSystem()` recurses the scene graph, setting orbit positions and sidereal rotations
   - If `targets.track` is set, calls `lookAtTarget()` each frame
7. Camera-look tween update (`targets.tween`)
8. `_applyCameraArrowKeys()` — apply held-key pitch/roll last so they always win
9. `renderer.render(scene, camera)`

## Orbital Mechanics

- **Major planets** (Mercury–Neptune): VSOP87c theory via the `vsop87` npm package, giving high-accuracy heliocentric ecliptic coordinates
- **Minor bodies / moons / Pluto**: Simple Keplerian ellipse parameterized by `semiMajorAxis`, `eccentricity`, `siderealOrbitPeriod`

## Camera Controls

Camera orientation and position are separated across three input modes, all accumulating independently:

| Input | Effect |
|---|---|
| Scroll wheel | Zoom (TrackballControls, asymptotic near surface) |
| Mouse drag | Free look — pitch (up/down) and yaw (left/right) around camera's local axes |
| Option+drag | Orbit — rotates camera as a rigid body around the planet center (position + orientation rotate together) |
| ↑ / ↓ arrow keys (hold) | Pitch camera nose up/down |
| ← / → arrow keys (hold) | Roll camera left/right |
| `t` | Toggle continuous tracking (camera auto-looks at target as it orbits) |
| `c` | Snap look at current target |

**Asymptotic zoom** (`js/zoom.js`): scroll zoom is remapped from distance-space to altitude-space so the camera approaches the surface asymptotically. The `camera.near` plane is dynamically scaled to `altitude * 0.1` (clamped 100 m – `SMALLEST_SIZE_METER`) so the surface remains visible without clipping.

**Camera platform**: the camera is a child of `camera.platform`, a scene-root `Object3D` reparented on each `goTo()`. For planet targets the new parent is `obj.orbitPosition` so the camera tracks orbital motion automatically; for star targets it's `_starAnchor`, a dedicated scene-root anchor at world origin (paired with a `WorldGroup` rebase that moves the target star to origin). See [Navigation (goTo flow)](#navigation-goto-flow) for the full flow.

**Navigation tweens** (`js/camera.js`) — stays at root as general infrastructure:
- `newCameraLookTween` — 600 ms quaternion slerp used by `setTarget` (key navigation, `'c'` key)
- `newCameraGoToTween` — 1800 ms unified tween used by `goTo`; rotation runs 0–60%, position 40–100%, with a 40–60% overlap so the camera never stops between turning and traveling. Details in [Navigation (goTo flow)](#navigation-goto-flow).


## Navigation (goTo flow)

`Scene.goTo(star)` reorients the camera onto a new target body. It has to satisfy two
competing pressures:

- **Float32 precision.** At star-scale distances the camera's world coordinates cannot
  be large — catastrophic cancellation in `(objWorld − cameraWorld)` would destroy
  positional accuracy for any non-RTE object.
- **Smooth transitions.** Users expect a visible "turn then travel" beat that animates
  from wherever the camera currently is toward the new target.

The design resolves both by rebasing the universe so the new target sits at world
origin, keeping camera world coordinates small, while preserving the camera's *position
within the `WorldGroup` frame* so the subsequent look + travel tween has meaningful
start and end poses.

### Anchors

The camera platform is parented differently depending on target type:

| Target | Parent after `goTo()` | Notes |
|---|---|---|
| Planet / sun | `obj.orbitPosition` | That group is what orbital animation writes into, so the camera follows the body's orbit automatically. |
| Star (catalog entry) | `_starAnchor` | A scene-root `Object3D` permanently fixed at world `(0, 0, 0)`, paired with `worldGroup.position = -star.xyz` so the target star lands at world origin. |

### goTo flow

Six synchronous steps before any tween runs:

1. Capture pre-rebase camera world pos, world quat, and `wgOld = worldGroup.position`.
2. Rebase `worldGroup.position` to `(0, 0, 0)` for planet targets or `-star.xyz` for
   star targets.
3. Compute `wgDelta = worldGroup.position − wgOld` and shift the captured camera world
   pos by `wgDelta`. (See Invariant below.)
4. Reparent `camera.platform` to the new anchor and reset its local transform to
   identity.
5. Restore the shifted camera world pos (via `platform.worldToLocal`) and reconstruct
   `camera.quaternion` so the camera's *world* orientation matches what was captured
   in step 1.
6. Compute the arrival pose (a point at `radius × STEP_BACK` along the camera→target
   line) and start a single `newCameraGoToTween`.

### Invariant

Across `goTo()`, the preserved quantity is **camera position in the WorldGroup frame**
(`camera_world − worldGroup.position`), not camera world position. Camera world
position deliberately shifts by `wgDelta` so the camera "moves with the universe":

- When camera is already under `WorldGroup` (via some planet's `orbitPosition`), this
  happens automatically because its parent moved during the rebase.
- When camera is under `_starAnchor` (scene-root, unaffected by the rebase), step 3
  applies the shift manually.

Without the shift, star → star travel collapses to zero distance (camera and the new
target both sit at origin because the old target was already at origin and `_starAnchor`
didn't move). Pressing `h` from any star also produces an identical "instant look back"
with no rotation animation, because the camera was coincidentally still pointing at
origin after the rebase moved the sun into origin.

With the shift, the direction from the (shifted) camera to the new target encodes where
the user started from, so the follow-up rotation depends on the starting body.

### Split-timing tween

`newCameraGoToTween` is a single 1800 ms tween with two independently eased channels:

| Channel | Active | Eased |
|---|---|---|
| Rotation (slerp to `lookAt(target)` from arrival) | 0 – 60% (0 – 1080 ms) | quadratic in-out |
| Position (lerp from start to arrival) | 40 – 100% (720 – 1800 ms) | quadratic in-out |
| **Overlap** | **40 – 60% (720 – 1080 ms, 360 ms)** | both active |

The overlap means the camera starts moving before it finishes turning — there is no
frame between the two phases where nothing is animating.

### RTE interaction

Stars, asterisms, and catalog star-name labels use Relative-To-Eye shaders that compute
camera-relative positions every frame from double-precision emulation (high + low
float32 split). They are visually stable across a `WorldGroup` rebase: the uniforms
update one frame, the rendered positions on screen don't change.

Non-RTE objects — the sun and planet meshes — are ordinary Three.js objects under
`WorldGroup`, so they *do* visibly teleport when the rebase shifts their world
positions. This teleport is the visible "warp" of star navigation: planets jump,
stars hold still.

### `setTarget`, `lookAtTarget`, `'c'` key

Out of scope for the goTo flow. These use `newCameraLookTween` (rotation-only, 600 ms)
and do not rebase or reparent. They only change `camera.quaternion` while leaving the
scene graph alone.


## Rendering Techniques

| Object | Technique |
|---|---|
| Star field (~120k stars) | Custom GLSL shader on `Points` geometry; size/brightness from magnitude |
| Named star (e.g. Sun) | Procedural Perlin noise GLSL surface shader (convection-like texture) |
| Planets | `MeshStandardMaterial` with optional diffuse, bump, hydrosphere, and cloud textures |
| Atmospheres | Semi-transparent additive-blend sphere shell |
| Saturn rings | Double-sided `RingGeometry` with texture |
| Orbit paths | `EllipseCurve` → `Line` with additive blending |
| Labels | Canvas-rendered `SpriteSheet` compiled to a single `Points` geometry |
| Asterisms | Line segments loaded from `asterisms-clean.dat` |

LOD (`THREE.LOD`) is used throughout to swap between detailed meshes, point sprites, and invisible placeholders based on camera distance.

## Overlays & visibility groups

Every visual feature in the app must opt into one of two top-level
visibility groups so the user has predictable global hide/show controls:

- **`v`** (lowercase v key) — **HTML chrome**: nav panels, search bar,
  time/target HUD, settings dialogs.  React/MUI overlays only — anything
  rendered outside the WebGL canvas.
- **`V`** (Shift+v key, "presentation mode") — **scene annotations**:
  everything drawn into the WebGL scene that isn't a celestial body or
  texture.  Labels, asterism lines, orbit ellipses, reference grids,
  surface place labels, etc.  A second `V` press restores the prior
  per-element state (snapshotted on first press) so users can flip
  between "bare" and "annotated" views without losing their
  per-element toggles.

Each scene-annotation feature also has its OWN scoped lowercase toggle
(`a` asterisms, `p` planet+moon+place labels, `s` star labels, `o` orbits,
`;` equatorial grid, etc.).  `V` is the union of all the lowercase
scene-annotation toggles.

**When adding a new visual feature, decide which group it belongs in and
wire it through the corresponding toggle method.**  Surface place labels,
for example, live under the `p` group: their visibility is controlled
inside `Scene.togglePlanetLabels` alongside the planet name LODs, so the
single 'p' shortcut and the global 'V' both pick them up automatically.

Failing to opt in means the user has no way to hide the new element
short of reloading the page — and `V` (presentation mode) won't be
truly bare.

## State Management (Zustand)

`js/store/useStore.js` composes four slices:

- `AsterismsSlice` — asterisms visibility and catalog state
- `SearchSlice` — search-bar state, anchor index, committed path / star,
  preview fields; `setCommittedPath` and `setCommittedStar` are mutually
  exclusive
- `StarsSlice` — star selection / filter state
- `TimeSlice` — time panel UI state

The store is passed into non-React classes (`ThreeUi`, `Stars`) to let them read/write shared state without React prop-drilling.

## Routing

Two routing layers coexist:

- **Wouter path routing** (`/`, `/guide`, `/about`, `/settings`) — controls which React panels are shown
- **URL hash** (`#sun/earth/moon`) — drives which celestial object is targeted and loaded; managed imperatively by `Celestiary` via `hashchange` events

The hash is extended with optional camera/time state to form a **permalink** — see [js/permalink.md](js/permalink.md) for the format specification.

## React UI Components (`js/ui/`)

Thin MUI-based overlay panels:

- `TimePanel` — displays sim time, pause/play, time-scale controls
- `Settings` — keyboard shortcut reference
- `About` — app info and star catalog stats
- `SearchBar` — breadcrumb-anchored search (chips, MUI `Autocomplete`,
  crosshair picker toggle, preview + commit flow). See
  [js/search/DESIGN.md](js/search/DESIGN.md) for the index architecture.
- `DatePicker`, `NumberField`, `NumberInput` — supporting inputs
- `TooltipToggleButton`, `TooltipIconButton`, `NavToggleButton` — icon button wrappers

## Guide (`js/guide/`)

A separate interactive tutorial route (`/guide`) built with React Three Fiber (`@react-three/fiber`) and Drei. Each guide section is an isolated demo (Cube, Sphere, Star, Planet, Orbit, Stars, Asterisms, Atmosphere, Galaxy, VSOP, Labels, etc.) navigated via a side-drawer TOC. The guide and main app are fully independent bundles — the guide does not use the `Celestiary` class.

## Build & Output

`esbuild` bundles `js/index.tsx` to `docs/` (GitHub Pages target). The `build` script:

1. `yarn clean` — resets `docs/` from `public/`
2. Copies shaders and public assets
3. Runs esbuild bundler

`yarn bundle-check` (`esbuild/check.js`) does a dry-run bundle (`write: false`) to verify all imports resolve without writing any output — used in `yarn precommit` alongside lint and tests.

Hot-reload in development: `esbuild/serve.js` calls `ctx.watch()` unconditionally; `index.tsx` opens an `EventSource('/esbuild')` that reloads on `change` events and closes itself on error (silent in production).

## Key Files Reference

### Root infrastructure (`js/`)

| Path | Role |
|---|---|
| `js/shared.js` | Global constants and `targets` state object |
| `js/Celestiary.js` | Top-level controller, keyboard bindings |
| `js/ThreeUI.js` | Three.js renderer/camera/controls wrapper |
| `js/Loader.js` | Recursive JSON asset loader |
| `js/Time.js` | Simulation clock with time-scale control |
| `js/camera.js` | Navigation tween factories (`newCameraLookTween`, `newCameraGoToTween`) |
| `js/zoom.js` | Pure zoom math: `asymptoticZoomDist`, `dynamicNear` |
| `js/permalink.js` | Permalink encode/decode: `encodePermalink`, `decodePermalink`, `pathFromFragment` |
| `js/coords.js` | Geographic coordinate conversions: `worldToLatLngAlt`, `latLngAltToLocal` |
| `js/store/useStore.js` | Zustand store root |
| `public/data/*.json` | Celestial object descriptors |

### Search (`js/search/`)

| Path | Role |
|---|---|
| `js/search/SearchIndex.js` | Tiered index + app-wide singleton |
| `js/search/SearchRegistry.js` | Provider registration singleton |
| `js/search/SearchProvider.js` | JSDoc typedefs for `SearchEntry` / provider contract |
| `js/search/providers/SceneProvider.js` | Bodies loaded by `Loader` |
| `js/search/providers/StarsProvider.js` | Named stars + exact HIP resolver |
| `js/search/providers/PlacesProvider.js` | Future surface-place stub |

See [js/search/DESIGN.md](js/search/DESIGN.md) for the full architecture:
tier structure (A/B/C), Fuse.js tuning, scoping semantics, commit flow,
and the provider extension contract.

### Scene objects and support (`js/scene/`)

| Path | Role |
|---|---|
| `js/scene/Scene.js` | Scene object registry, targeting, raycasting |
| `js/scene/Animation.js` | VSOP87 + Keplerian orbit/rotation animation |
| `js/scene/Planet.js` | Planet/moon scene graph construction |
| `js/scene/Star.js` | Named star with noise shader |
| `js/scene/Stars.js` | Star field from Celestia catalog |
| `js/scene/Galaxy.js` | Animated galaxy particle system |
| `js/scene/Asterisms.js` | Constellation line drawings |
| `js/scene/Orbit.js` | Orbital path visualization |
| `js/scene/StarsCatalog.js` | Celestia binary star catalog parser |
| `js/scene/AsterismsCatalog.js` | Constellation pattern definitions |
| `js/scene/object.js` | Base `Object3D` wrapper with registry tracking |
| `js/scene/shapes.js` | Geometry factory functions (sphere, rings, etc.) |
| `js/scene/material.js` | Texture/material cache |
| `js/scene/SpriteSheet.js` | Canvas-based label sprite atlas |
| `js/scene/GalaxyBufferGeometry.js` | Packed vertex data for galaxy particles |
| `js/scene/StarsBufferGeometry.js` | Packed vertex data for star catalog |
| `js/scene/Picker.js` | Raycasting for 3D object picking |
| `js/scene/PickLabels.js` | Label picking and marker display |
| `js/scene/atmos/Atmosphere.js` | Atmosphere mesh + fullscreen post-process pass |
| `js/scene/atmos/AtmospherePrecompute.js` | Bruneton transmittance + in-scatter LUT precomputation |
