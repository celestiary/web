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

**Camera platform**: the camera is a child of `camera.platform` which is reparented to the target's `orbitPosition` on each `goTo()`. This means the camera tracks the planet through its orbit automatically without requiring a per-frame `lookAt` call.

**Navigation tweens** (`js/camera.js`) — stays at root as general infrastructure:
- `newCameraLookTween` — 600 ms quaternion slerp used by `setTarget` (key navigation)
- `newCameraGoToTween` — 1500 ms combined position lerp + quaternion slerp used by `goTo`


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

## State Management (Zustand)

`js/store/useStore.js` composes three slices:

- `AsterismsSlice` — asterisms visibility and catalog state
- `StarsSlice` — star selection / filter state
- `TimeSlice` — time panel UI state

The store is passed into non-React classes (`ThreeUi`, `Stars`) to let them read/write shared state without React prop-drilling.

## Routing

Two routing layers coexist:

- **Wouter path routing** (`/`, `/guide`, `/about`, `/settings`) — controls which React panels are shown
- **URL hash** (`#sun/earth/moon`) — drives which celestial object is targeted and loaded; managed imperatively by `Celestiary` via `hashchange` events

## React UI Components (`js/ui/`)

Thin MUI-based overlay panels:

- `TimePanel` — displays sim time, pause/play, time-scale controls
- `Settings` — keyboard shortcut reference
- `About` — app info and star catalog stats
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
| `js/store/useStore.js` | Zustand store root |
| `public/data/*.json` | Celestial object descriptors |

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
