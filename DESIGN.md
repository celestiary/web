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
  ├── ARController    Mobile sky view: device sensors → camera orientation
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

All celestial bodies (sun, planets, stars, asterisms) live under a single `WorldGroup` `Object3D`; the J2000 catalogues (stars, asterisms, star labels, Milky Way) sit one level further down, in the `StellarFrame`, which precesses them to the date (see [Frames and time](#frames-and-time)). Shifting `worldGroup.position` rebases the entire universe in one operation — used by star navigation to bring the current target star to world origin, so camera world coordinates stay small for float32 precision even across light-year distances. See [Navigation (goTo flow)](#navigation-goto-flow).

## Data Loading

`Loader` fetches `/data/<name>.json` files recursively along a path (e.g. `sun/earth/moon`). Each JSON descriptor includes:

- `type`: `galaxy | stars | star | planet | moon`
- `radius`, `orbit`, `axialInclination`, `siderealRotationPeriod`
- `system`: array of child names to load next
- Optional: `texture_*`, `has_locations`

Loading is cached per name; the URL hash (e.g. `#sun/earth`) drives the target path. `hashchange` events trigger re-loads.

Stars are loaded separately from the Celestia binary star catalog (`StarsCatalog`), not from JSON.

Large files (textures, `stars.dat`, anything under `public/large/`) are fetched through `dataUrl()`, not a bare relative path; see [Data policy](#data-policy).

### Data policy

Where external data goes depends on its size. The decision is recorded in [ROADMAP.md](ROADMAP.md#decisions-that-apply-across-tracks); this is the mechanism.

| Size | Where it lives |
|---|---|
| Small (JSON descriptors, places, name lists) | `public/data/`, plain git, relative URLs |
| Up to a few hundred MB (textures, DEMs, catalogues) | Bundled in the repo. Anything over about 1 MB goes under `public/large/<dataset>/`, which `.gitattributes` puts in Git LFS |
| GB and up (Gaia) | Fetched over the network at run time, never bundled |

**Git LFS.** `.gitattributes` tracks `public/large/**`. The patterns must not match files already committed as plain blobs (`public/textures/`, `public/data/stars.dat`): git would report them as modified. Those existing assets stay as they are. Moving them into LFS would not shrink history (it isn't rewritten), would add LFS bandwidth for every clone, and the Blue Marble pyramid is about 2000 small tiles, a poor fit. The policy applies to new data. To add a dataset:

1. Put the files under `public/large/<dataset>/` and commit them (`git lfs install` once per clone, so the clean filter runs; check with `git lfs ls-files`).
2. Load them through `dataUrl('large/<dataset>/<file>')` (below), never a bare relative path.
3. Document the source, licence and rebuild recipe next to the code that uses it (e.g. [Planet.md](js/scene/Planet.md#surface-texture-sources)).

**Actions and LFS.** Workflows check out with the default `lfs: false`, then run `.github/actions/lfs`. It restores `.git/lfs` from an `actions/cache` entry keyed on the hash of `git lfs ls-files -l` (each object's id) and runs `git lfs pull`, so a build downloads only the objects the cache lacks. `lfs: true` on the checkout would download everything before any cache could help, and every download counts against the repository's LFS bandwidth quota. `ci.yml` uses the action directly, and `.github/actions/build` (used by `deploy-prod.yml`, `gh-pages.yml` and `pr-preview.yml`) runs it first. A cache entry is visible only to the branch that saved it and to PRs against it, so builds on `main` warm it for PRs.

**The data base URL.** `js/dataUrl.js` is the one place large-data paths are resolved: `dataUrl('textures/mars.jpg')`. The base comes from the `DATA_BASE_URL` env var at build time (an esbuild `define`, `__DATA_BASE_URL__`, in `esbuild/common.js`). Empty, the default, leaves the path relative, so it resolves against the page's `<base href>` as before. Set, it prefixes the path (a plain string join, so `{z}/{x}/{y}` tile templates survive). It's used for textures (`material.js`, the monthly Earth map in `Planet.js`, the crosshairs in `shapes.js`), `stars.dat` (`StarsCatalog.js`) and the Blue Marble tiles Cesium loads (`CesiumLayers.js`, which needs an absolute URL). Anything under `textures/`, `data/stars.dat` or `large/` must go through it. Cross-origin images need CORS, which github.io serves (`Access-Control-Allow-Origin: *`), and three's loaders request them with `crossOrigin = 'anonymous'`.

**PR previews.** `pr-preview.yml` deploys the built site under `pr-preview/pr-N/` of the `gh-pages` branch, so every preview used to carry every bundled asset (about 90 MB of textures alone) against a Pages limit of about 1 GB. `.github/large-data-paths` lists the large-data paths under `public/`. Then:

- If the PR changes none of them (`.github/scripts/large-data.sh changed`, comparing the merge commit with its first parent), the preview is built with `DATA_BASE_URL` set to the production site (`https://celestiary.github.io/web/`, `main` as deployed by `gh-pages.yml`), the listed paths are deleted from `docs/` before the deploy, and LFS isn't fetched at all.
- If the PR changes any, or the check can't tell, the preview is a full copy with a same-origin base, as before.

So a PR that adds or changes a dataset previews its own data, and every other PR previews against the data on `main`. The catch: a preview of a PR that depends on data another unmerged PR added will 404 on it, because production doesn't have it yet. To bring a new path under this policy, add it to `.github/large-data-paths`.

## Scene Graph Structure (per planet)

```
<parent>.orbitPosition
  └── Planet (Object3D)
        └── group
              └── orbitPlane
                    ├── orbit (Line: the sampled path, or an ellipse)
                    └── orbitPosition  ← animation sets position here
                          └── planetTilt
                                └── 'new planet' (Object3D, unrotated)
                                      ├── planetLOD
                                      │     ├── [near] planet: spun node, scene.objects[name]
                                      │     │         (surface mesh + atmosphere + clouds, places)
                                      │     ├── [far]  single Point sprite
                                      │     └── [very far] FAR_OBJ (invisible)
                                      └── labelLOD
                                            ├── [near] FAR_OBJ
                                            ├── [mid]  SpriteSheet label
                                            └── [far]  FAR_OBJ
```

Moons follow the same pattern, parented to their planet's `orbitPosition`.
The node Animation spins (the one carrying `siderealRotationPeriod`, and
`scene.objects[name]`) is the LOD's near level, two levels below
`planetTilt`, not its child: code that sets a body's whole orientation
(the Moon's, in Animation) composes every rotation up to `orbitPosition`.

`group`, `orbitPlane` and `orbitPosition` are unrotated, so the position
Animation writes is in the scene's axes relative to the primary. The orbit
line (`orbitPosition.orbitShape`) is a sibling of `orbitPosition`, in the
same frame, so a body and its line share one transform chain: see
[Orbit lines](#orbit-lines). `planetTilt` is
`rotateX(-axialInclination)` for Earth, and points at the IAU pole
(`planetTilt.pole`) for bodies that have one.

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
   - `updateMoon(julianDay)` computes the Moon's geocentric position, orientation and mean orbit (lunarTheory.js)
   - the J2000 → date precession rotation, for the mean elements and IAU poles (`setDate`)
   - `animateSystem()` recurses the scene graph, setting orbit positions and sidereal rotations, and turning the orbit lines to the date (asking for a rebuild when one is due)
   - `orbitPaths.pump()` runs queued orbit-line rebuilds, a few milliseconds a frame ([Orbit lines](#orbit-lines))
   - If `targets.track` is set, calls `lookAtTarget()` each frame
7. Camera-look tween update (`targets.tween`)
8. `_applyCameraArrowKeys()` — apply held-key pitch/roll last so they always win
9. `renderer.render(scene, camera)`

## Orbital Mechanics

- **Major planets** (Mercury–Neptune): VSOP87c theory via the `vsop87` npm package, giving high-accuracy heliocentric ecliptic coordinates
- **The Moon**: the truncated ELP-2000/82 of Meeus, *Astronomical Algorithms* ch. 47 (`js/scene/lunarTheory.js`), geocentric. Against JPL Horizons from 1950 to 2050 (offline fixture `lunarTheory.horizons.json`) it's within 4.3″ and 4.2 km. Its orientation follows Cassini's laws (Meeus ch. 53: equator inclined 1.54° about the node line, prime meridian toward Earth at the mean longitude), so the near side faces Earth with the real optical libration. Its orbit line is its path over a sidereal month ([Orbit lines](#orbit-lines)); the mean ellipse of date, which it used to be, misses the Moon by up to a few per cent (evection, variation).
- **Other moons and Pluto** (#6): Keplerian ellipses from published mean elements (`js/scene/meanElements.js`), with the source, reference plane and epoch in each body's JSON `orbit` block. Details below.
- **Planet poles**: the planets with moons, and Pluto, carry an IAU WGCCRE `pole` (RA and Dec in ICRF, with linear rates) in their JSON. Animation points `planetTilt`'s +Y at it, precessed to date (`Animation.orientPole`), so the moons' planes and Saturn's rings agree with the drawn equator. Before, `rotateX(-axialInclination)` could only lean a pole toward ecliptic longitude 90°, right for Earth alone: Jupiter's and Saturn's poles were 5° off, Mars's 37°, Neptune's 51°, Uranus's 168°. The prime meridian is still the legacy one-turn-a-day spin (#96). Earth and the Moon keep their own paths.

### Mean elements (Pluto and the moons)

- **Sources.** The moons: JPL SSD's planetary satellite mean elements (https://ssd.jpl.nasa.gov/sats/elem/, epoch J2000 TDB), a precessing ellipse fitted to each JPL satellite ephemeris. Pluto: Standish's Keplerian elements for approximate positions of the planets, table 1 (1800–2050), ecliptic and equinox of J2000, with rates per century.
- **Reference planes.** The satellite elements are referred to a plane given by its pole in ICRF: the moon's **Laplace plane** (the plane its orbit precesses about, between the planet's equator and its orbit; the Galileans, Saturn's, Mars's and Neptune's moons) or the planet's **equator** (URA182's Uranian moons and Charon, with the IAU pole). The node Ω is measured from that plane's ascending node on the ICRF equator. So the orbit is Rx(−ε₀)·Rz(α + 90°)·Rx(90° − δ) (plane → ecliptic J2000) · Rz(Ω)·Rx(i)·Rz(ω) (orbit → plane), in scene axes Ry for Rz. ε₀ is 84381.448″ (`celestialFrame.J2000_OBLIQUITY_DEG`), Horizons' definition of the J2000 ecliptic. Saturn's equator is 28° from the ecliptic, so "relative to the ecliptic" against "relative to the equator" is the whole difference for Titan.
- **To date.** Everything is computed in the ecliptic of J2000 and turned into the scene's frame by `precessionQuaternion(J2000, date)`, once a frame (`Animation.setDate`), at TT. The orbit line is the same ellipse, laid with the same rotation, scale and focus offset as the body (`Animation.layOrbitShape`), so it passes through it; its unit ellipse is redrawn when e drifts (Pluto's, by Standish's rates).
- **Precession.** ω and Ω move at constant rates. The table lists the periods as magnitudes; the JSON's `apsidalPeriod` and `nodalPeriod` are signed. Nodes regress on prograde orbits and advance on Triton's retrograde one. Apsides advance, except where a resonance drives them backwards: Io and Europa (Laplace resonance, ϖ̇ = 2n(Europa) − n(Io) = −0.74°/day) and Hyperion (4:3 with Titan).
- **What the table's period means varies by ephemeris.** `period` with `periodOf`: JUP365's P is the period of the mean anomaly (Io's 1.762732 d, where its sidereal period is 1.769138 d), SAT441's is that of the mean longitude. Each reading was chosen by fitting Horizons, where the other is tens of degrees off within a decade.
- **Where the table isn't used as is** (each noted in the body's JSON):
  - Saturn's moons (SAT441): the tabulated ω and M put them 60–160° from Horizons at their own epoch, with no common origin offset, while planes and rates agree. They take e, ω and M from Horizons' osculating elements at J2000, re-referred to the table's plane (the recipe is a test in `meanElements.test.js`).
  - Triton: node period 688 yr, the rate of the argument N in the IAU model of Neptune's pole (which Triton drives), not the table's 340.379 yr, which is 3.5° off Horizons by 2050.
- **Accuracy**, against Horizons from 2000 to 2050 (offline fixture `meanElements.horizons.json`, tested in `meanElements.test.js`), as out-of-plane and along-track errors:
  - Galileans: plane ≤ 0.09°. Phase: Io 1.4°, Europa 3.1° by 2050 (mean elements can't follow the resonant moons' mutual perturbations), Ganymede and Callisto ≤ 0.16°.
  - Titan: plane ≤ 0.29°, phase ≤ 0.02°, 203 km. Tethys, Dione, Rhea, Iapetus: plane ≤ 1.5°, phase ≤ 2.9°.
  - Pluto: ≤ 0.011° (1.1 × 10⁶ km in distance, of 5 × 10⁹).
  - Planes only, since their phase drifts by tens of degrees: Phobos ≤ 1.6° (its 2.3 yr node period is printed to two figures, and 50 years is 22 turns), Hyperion 1.5° (chaotic), the rest ≤ 0.3°. The table's periods are too coarse for Phobos, Deimos and Triton over decades, URA182's epoch angles don't match Horizons, and Janus swaps orbits with Epimetheus every four years.
  - A better model per system: Lieske's E5 for the Galileans, TASS 1.7 for Saturn's moons, GUST86 for Uranus's, or the JPL ephemerides themselves.
- **Bodies without elements** (only the demo descriptors, e.g. `earth-as-moon.json`) keep the old flat ellipse in the ecliptic, centred on the primary.

### Orbit lines

Each orbit line is drawn from the ephemeris its body is placed by, so the
body sits on it (within 1e-5 of the orbit's size, `orbitPath.test.js`,
at 1900, 2026 and 2500). Before, every line was a flat ellipse from the
JSON's a and e, centred on the primary: the planets' had no inclination,
node or perihelion direction, and sat a·e off centre, so their points
were visibly off their lines (Mercury by ~10 px in an inner-system view).

- **Planets and the Moon: the sampled path** (`js/scene/orbitPath.js`,
  `OrbitPath`). One sidereal period of the body's path around its primary,
  centred on the simulation date, 1001 vertices in a `Line` whose one
  `BufferGeometry` is rewritten in place. The line is open: a perturbed
  path doesn't close, and the gap sits opposite the body. It's under 0.2%
  of the orbit for the planets (Saturn's reaches 0.8% at 2500, the great
  inequality) and ~1% for the Moon (2,500–5,000 km: evection and the
  perigee's advance).
- **Frame.** The samples are in the ecliptic of J2000: each is taken out
  of the frame of its own date with the inverse of the rotation Animation
  applies at that date. The line's group is turned by that frame's
  `this.precession` (J2000 → date), as the mean-element orbits are, so
  precession never needs a rebuild, and at any date the line passes
  through the body's position exactly where the samples do.
- **The Moon** is sampled directly: Meeus 47 costs ~10 µs a call.
- **Planets** are sparse. VSOP87C evaluates all eight planets in every
  call, ~2 ms (wasm), so a few hundred samples for eight planets would be
  seconds. A two-body ellipse osculating the path at the centre date
  (velocity by central difference) carries the shape; VSOP87C is sampled
  at even times over the period only for the departure from it, which is
  interpolated (four-point Lagrange): 17 samples for the terrestrial
  planets, 33 for Jupiter and Saturn (their mutual perturbations), and at
  least eight a Jupiter year for the Sun's wobble in heliocentric
  positions (Uranus 58, Neptune 112).
  Vertices are even in eccentric anomaly. Earth's path is the Earth–Moon
  barycentre's, which is smooth, plus its monthly ~4,700 km wobble added
  per vertex from the lunar theory.
- **The window is the JSON's `siderealOrbitPeriod`,** not the osculating
  period: the Sun's reflex velocity puts Neptune's osculating period off
  by ~1%. The planets' periods were 365-day-year values, 0.07% short;
  they're now from Standish's mean-longitude rates (JPL approximate
  positions, table 1), as Pluto's elements are.
- **Rebuilds** happen when the date has moved 1/50 of a period from the
  line's centre, or jumped. A line whose window no longer holds its body
  (a jump) is hidden until rebuilt. Rebuilds are generators queued in
  `Animation.orbitPaths` and run by `pump()` a slice at a time (a VSOP87C
  call, or 64 vertices) within 4 ms a frame (`FRAME_BUDGET_MS`), or 12 ms
  while the line being built is hidden (`HIDDEN_BUDGET_MS`: at load, or
  after a jump), so none is on the per-frame path. A rebuild costs 20–36
  VSOP87C calls (~2 ms each, in bun and Chromium alike), 40–85 ms of work;
  Uranus's and Neptune's ~120 and ~230 ms; the Moon's ~10 ms. All nine
  lines after a jump are ~0.8 s of work, about 70 frames.
- **Other moons and Pluto** keep their mean-element ellipse of date, laid
  each frame (`layOrbitShape`): that ellipse is their ephemeris.
- **Bodies without elements** (demo descriptors) keep the flat ellipse.

### Frames and time

- **The scene frame is the mean ecliptic and equinox *of date*,** not J2000: VSOP87**C** is the of-date series (VSOP87A is J2000). Checked against Meeus example 25.b: VSOP87C gives the Sun's longitude as 199.9073° at 1992 Oct 13.0 (Meeus: 199.907372°), while VSOP87A gives 200.008°. Meeus ch. 47 is in the same frame, so the Moon's geocentric (λ, β, Δ) goes straight in, with no precession.
- **Axis remap**, for VSOP87C's `(x, y, z)` and any ecliptic vector: scene `(x, z, −y)`, i.e. X = equinox, Y = north ecliptic pole, Z = −ecliptic Y. A rotation about ecliptic Z is a rotation about scene Y by the same angle.
- **Body frames** (coords.js): +Y the north pole, +X the prime meridian, east longitude toward −Z. The same remap from a body's (x = longitude 0, y = 90° E, z = north), so an ecliptic rotation such as the Moon's Rz(Ω)·Rx(−I)·Rz(F + 180°) becomes Ry(Ω)·Rx(−I)·Ry(F + 180°) in the scene.
- **One scene frame, the stars included.** The catalogues are J2000: Celestia's stars.dat (and so the asterisms and star labels, placed from it) and the Milky Way and galactic grid (`galacticFrame.js`). They'd sit displaced from the planets by precession, 50.3″ a year in longitude: ~0.37° in 2026, ~28° at year 0 (#133). So they hang under `StellarFrame` (`js/scene/StellarFrame.js`), a group at the Sun (the catalogue is heliocentric) whose rotation is `celestialFrame.precessionQuaternion(J2000, date)`, Meeus 21.5's Rz(Π + p)·Rx(−η)·Rz(−Π), in scene axes.
  - The chain is `WorldGroup` (rebase) → `milkyway` → `StellarFrame` (J2000 → date) → `Stars` (catalogue positions, J2000) → points, labels, asterisms; and `StellarFrame` → `MilkyWay`. The Sun and planets are under `WorldGroup` directly, so the planets, the Moon, Earth's GMST spin, places, and Cesium's camera coupling (built from body node matrices) are untouched. The galactic grid gets the same rotation on top of its own.
  - **Updates:** Animation calls its `preAnimCb` with the Julian Day animated (so `animateAtJD`, e.g. a permalink restore, sets it too). It's rebuilt only when the date moves by more than a day (0.14″ of precession), in place.
  - **Reading star positions:** raw `star.x/y/z` and the stars' geometry are J2000, the `StellarFrame`'s local frame. Take them to the scene with `Scene.starPosition(star)` (the `WorldGroup` frame) or the stars' `matrixWorld` (world space). `goTo(star)` rebases to `-starPosition(star)`, and re-rebases when the frame turns so the star stays at the origin; picking (`Picker.queryPoints`) takes the ray into the catalogue frame instead of rebuilding its tree. The RTE shaders apply the model rotation (see [RTE interaction](#rte-interaction)).
  - **Checked** against JPL Horizons at 1900, 2026 and 2500 (`StellarFrame.test.js`, offline fixture `StellarFrame.horizons.json`): the Moon's separation from reference stars (their catalogue direction) is within 3.1″ of Horizons', and its place among them within 4.3″. Proper motion, parallax and aberration are left out; proper motion over centuries is a separate refinement.
  - The equatorial grid and Earth's pole use the J2000 obliquity about the equinox of date, i.e. the mean equator of date to within the change in obliquity (47″ a century). `celestialFrame.precessEcliptic` converts coordinates between dates, e.g. to compare with Horizons' J2000 ecliptic vectors.
- **Time:** the simulation clock is UTC. VSOP87C is fed the UTC Julian Day as it is (69 s of ΔT moves Earth ~2000 km). The Moon moves 0.01° in 69 s, so its series gets TT (`celestialFrame.utcToTtJulianDay`: 32.184 s + the leap seconds since 1972, the Espenak–Meeus ΔT polynomials before, continuous across 1972). The UTC Julian Day is `Time.toJulianDay`, with the Unix epoch at JD 2440587.5 exactly (it used to run 14.6 s ahead, ~8″ of lunar motion). After 2017 TT − UTC stays at 69.184 s, right for a UTC clock, but UT1 keeps drifting: Earth rotation for future dates needs UT1 − UTC or a ΔT model.

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
| Star (catalog entry) | `_starAnchor` | A scene-root `Object3D` permanently fixed at world `(0, 0, 0)`, paired with `worldGroup.position = -scene.starPosition(star)` (the catalogue position precessed to the date) so the target star lands at world origin. |

### goTo flow

Six synchronous steps before any tween runs:

1. Capture pre-rebase camera world pos, world quat, and `wgOld = worldGroup.position`.
2. Rebase `worldGroup.position` to `(0, 0, 0)` for planet targets or
   `-scene.starPosition(star)` for star targets.  While a star is the target, the
   rebase follows it as the `StellarFrame` turns.
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

The camera uniforms are the camera's position in the drawn object's own frame,
`rte.js`'s `rteCameraLocal`: Rᵀ·(camera − t) from the object's `matrixWorld`.
The shaders turn the eye-relative vector by `mat3(modelViewMatrix)`, so a parent
rotation (the `StellarFrame`'s precession) reaches the GPU; the translation stays
out of float32.  An RTE object must live in the frame its positions are in (the
picked-star label is a child of `Stars` for that reason).

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
| Orbit paths | `Line` with additive blending: the body's sampled path, or its mean-element ellipse ([Orbit lines](#orbit-lines)) |
| Labels | Canvas-rendered `SpriteSheet` compiled to a single `Points` geometry |
| Asterisms | Line segments loaded from `asterisms-clean.dat` |

LOD (`THREE.LOD`) is used throughout to swap between detailed meshes, point sprites, and invisible placeholders based on camera distance.

### Cesium layers

Near Earth, a Layers control (`js/ui/LayersButton.jsx`) offers a Cesium
"data view" in place of celestiary's own Earth: Cesium runs in the page
against a shadow WebGL context, and its GL calls replay into celestiary's
scene render target through a stencil of the Earth's silhouette
(portal-netgl's same-page link).  Camera and sunlight are coupled so the
globe sits and is lit exactly where celestiary's would be.  Design, data
sources and phases: [CESIUM.md](CESIUM.md).

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

Build-time env vars: `BASE_PATH` (the URL prefix the site is served under), `CESIUM_ION_TOKEN` and `DATA_BASE_URL` (where large data is fetched from; see [Data policy](#data-policy)).

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
| `js/dataUrl.js` | `dataUrl()`: resolves large-data paths against the build's data base URL ([Data policy](#data-policy)) |
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
| `js/scene/lunarTheory.js` | The Moon: Meeus ch. 47 position, Cassini-law orientation, mean orbit of date |
| `js/scene/meanElements.js` | Pluto and the moons: mean elements in their reference planes, Kepler's equation, IAU poles |
| `js/scene/orbitPath.js` | Orbit lines sampled from the planets' and the Moon's ephemerides, and their budgeted rebuilds |
| `js/scene/celestialFrame.js` | GMST, TT − UTC, ecliptic precession between dates (coordinates and scene rotation) |
| `js/scene/StellarFrame.js` | Parent of the J2000 catalogues: precesses them to the simulation date |
| `js/scene/rte.js` | Relative-To-Eye camera uniforms in an object's own frame |
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

### AR sky view (`js/ar/`)

Pin the camera to a body surface and drive its orientation from device
sensors so the rendered sky overlays the user's real-life view.  The
heavy lifting — the rotating-body parent, the body-fixed lat/lng frame,
the sidereal-rotation animation — already exists for the landed
view; the AR module composes those with a sensor-driven camera→ENU
quaternion to close the loop.

Frame chain (per frame):

```
camera.quaternion =
    enu_to_bodyFixed(lat, lng)   // js/ar/enuFrame.js
  · q_calibration_enu             // js/ar/Calibration.js (optional)
  · q_camera_to_enu               // js/ar/PoseSource.js (sensors)
```

The body-fixed → inertial step is inherited from the scene graph
(camera.platform reparented to the rotating body via `Scene.land`).
ARController.updateFrame writes the composed quaternion AFTER all other
camera-orientation logic in `ThreeUI.renderLoop`, so AR pose always wins
while active.

Stage 1a (current): no camera-passthrough video, atmosphere disabled in
AR mode (`Scene.enterAR` sets `ui._arMode`, `ThreeUI._updateAtmUniforms`
honors it).  Stage 1b enables WebXR when supported.  Stage 1c adds
`navigator.geolocation`.  Stage 1d wires the gear-icon calibration
flow.  Stage 2 adds `<video>` passthrough behind the canvas with
premultiplied-alpha atmosphere blending.

| Path | Role |
|---|---|
| `js/ar/ARController.js` | Lifecycle (enter/exit), per-frame pose compose, calibration capture |
| `js/ar/PoseSource.js` | Pose-source contract + factory; auto-probes WebXR → DeviceOrientation → Null |
| `js/ar/NullPoseSource.js` | Identity-pose fallback (desktop / no sensors) |
| `js/ar/DeviceOrientationPoseSource.js` | W3C DeviceOrientation → camera→ENU quaternion |
| `js/ar/WebXRPoseSource.js` | WebXR `immersive-ar` / viewer-space (stub in stage 1a) |
| `js/ar/enuFrame.js` | `enuTriadAtLatLng`, `enuToBodyFixedQuat` — body-agnostic ENU↔body-fixed math |
| `js/ar/Calibration.js` | Single-vector calibration solver + per-(source, screen-angle) localStorage |
| `js/ui/ARButton.jsx` | Mobile-only entry button + gear toggle when calibration is needed |
| `js/store/ARSlice.js` | Zustand slice tracking active AR state for UI subscriptions |
