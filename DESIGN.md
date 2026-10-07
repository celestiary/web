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
                                      │     │         (surface mesh + atmosphere, places;
                                      │     │          Earth's cloud shell, on CLOUD_LAYER)
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
`planetTilt`, not its child; the levels between are unrotated, so a turn
of the spun node about its +Y is a turn about the body's pole.

`group`, `orbitPlane` and `orbitPosition` are unrotated, so the position
Animation writes is in the scene's axes relative to the primary. The orbit
line (`orbitPosition.orbitShape`) is a sibling of `orbitPosition`, in the
same frame, so a body and its line share one transform chain: see
[Orbit lines](#orbit-lines). `planetTilt` is
`rotateX(-axialInclination)` for Earth; for every other body with an IAU
rotation model (`planetTilt.poleModel`) Animation turns it to the body's
equator: +Y at the pole, +X at the equator's ascending node on the ICRF
equator, where the prime meridian is measured from. The spun node then
turns by the prime meridian W (`meridianModel`), so the body frame
(coords.js: +X longitude 0) is the IAU body-fixed frame. The surface mesh
inside it is turned by the texture's own offset, `texture_longitude`, or
for Jupiter by `texture_rotation` ([Body rotation](#body-rotation-iau-prime-meridians)).

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
   - `updateMoon(julianDay)` computes the Moon's geocentric position (lunarTheory.js)
   - the J2000 → date precession rotation, for the mean elements and the IAU rotation models (`setDate`)
   - `animateSystem()` recurses the scene graph, setting orbit positions and body orientations (IAU pole and prime meridian; Earth's GMST), and turning the orbit lines to the date (asking for a rebuild when one is due)
   - `orbitPaths.pump()` runs queued orbit-line rebuilds, a few milliseconds a frame ([Orbit lines](#orbit-lines))
   - If `targets.track` is on (`t`), calls `lookAtTarget()` each frame: the camera faces the target, whatever it is ([the target](#the-target))
7. Camera-look tween update (`targets.tween`)
8. `_applyCameraArrowKeys()` — apply held-key pitch/roll last so they always win
9. Render: the scene into `_sceneRT` (linear, half-float, in exposure units), Cesium's layers composited into it, Earth's cloud shell over both ([Planet.md, clouds](js/scene/Planet.md#clouds)), then the atmosphere pass to the screen, which adds the sky and tone-maps once (PBR Neutral), then the label overlay.  See [HDR pipeline](#hdr-pipeline).

The whole of `renderLoop()` is bracketed by `stats.begin()`/`stats.end()` while the performance panel is showing ([Performance panel](#performance-panel)); hidden, it costs nothing.  Under `?perf=1` it is bracketed again by `perf.frameBegin()`/`perf.frameEnd()`, and each pass by `perf.begin(name)`/`perf.end(name)` ([Perf overlay](#perf-overlay)); without `?perf=1` those return at their first line.

## Orbital Mechanics

- **Major planets** (Mercury–Neptune): VSOP87c theory via the `vsop87` npm package, giving high-accuracy heliocentric ecliptic coordinates
- **The Moon**: the truncated ELP-2000/82 of Meeus, *Astronomical Algorithms* ch. 47 (`js/scene/lunarTheory.js`), geocentric. Against JPL Horizons from 1950 to 2050 (offline fixture `lunarTheory.horizons.json`) it's within 4.3″ and 4.2 km. Its orientation is the IAU model's ([Body rotation](#body-rotation-iau-prime-meridians)), so the near side faces Earth with the real optical and physical libration; it used to follow Cassini's laws (Meeus ch. 53), which agree to 0.04°. Its orbit line is its path over a sidereal month ([Orbit lines](#orbit-lines)); the mean ellipse of date, which it used to be, misses the Moon by up to a few per cent (evection, variation).
- **Other moons and Pluto** (#6): Keplerian ellipses from published mean elements (`js/scene/meanElements.js`), with the source, reference plane and epoch in each body's JSON `orbit` block. Details below.
- **Body orientation**: every body but Earth is turned by its IAU WGCCRE rotation model, pole and prime meridian ([Body rotation](#body-rotation-iau-prime-meridians)), so the moons' planes and Saturn's rings agree with the drawn equator and each body's longitude 0 is where the report puts it. Before #6, `rotateX(-axialInclination)` could only lean a pole toward ecliptic longitude 90°, right for Earth alone (Jupiter's and Saturn's poles were 5° off, Mars's 37°, Neptune's 51°, Uranus's 168°); before #96, every body but Earth and the Moon turned once a day from an arbitrary meridian.

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

### Body rotation (IAU prime meridians)

Each body's orientation is the IAU WGCCRE model (#96): its north pole's
right ascension α0 and declination δ0 in ICRF and its prime meridian W,
the angle along its equator, eastward, from the equator's ascending node
on the ICRF equator to longitude 0, as functions of TDB:
W = W0 + Ẇ·d (+ a quadratic term for Phobos and the Moon) plus the
report's periodic terms in the system's angles (Mars and its moons,
Jupiter and its moons, Saturn's, Uranus's and Neptune's moons, Neptune, the
Moon, Mercury's libration).

- **Source.** `js/scene/iauRotation.json`, generated by
  `tools/iau/pckRotation.mjs` from NAIF's `pck00011.tpc`, which transcribes
  the 2015 report (Archinal et al. 2018, Celest. Mech. Dyn. Astr. 130:22),
  with its correction for Phobos and the 2009 report's Moon and Earth (the
  2015 report gives neither). The JSON's `source`, and each body's, says
  which. The bodies' JSON no longer carry a `pole`.
- **In the scene.** `iauRotation.bodyQuaternion` is
  Rz(α0 + 90°)·Rx(90° − δ0)·Rz(W) (body frame → ICRF), in scene axes and
  the ecliptic of J2000 (`meanElements.referencePlaneQuaternion` for the
  first two), and Animation premultiplies the J2000 → date precession.
  `planetTilt` takes the equator (pole and node), the spun node W
  ([Scene graph](#scene-graph-structure-per-planet)). The time argument is
  TT, within 2 ms of TDB.
- **Retrograde rotators** (Venus, Uranus, Triton, Titania, Oberon) have a
  decreasing W about the IAU north pole, and Pluto and Charon's pole is the
  one they turn prograde about, south of the ecliptic (the 2009 report's
  rule for dwarf planets). The same formula serves all of them.
- **Earth keeps GMST** (Planet.js `OWN_ORIENTATION`), with `planetTilt`'s
  rotateX(−ε): against Horizons' ITRF93 it's within 0.002° in longitude
  and 0.007° in latitude (nutation and the obliquity of date left out),
  where the IAU's own low-precision Earth (2009; its W is in TDB, while
  Earth turns with UT1) is 0.14° off. **The Moon** moved onto the IAU model:
  within 0.0024° of Horizons' mean-Earth frame, where Cassini's laws
  (its orientation before) were 0.035° off, without physical libration.
- **Checked** against JPL Horizons' sub-observer points (offline fixture
  `iauRotation.horizons.json`, `tools/iau/fetchHorizons.mjs`; tests in
  `iauRotation.test.js`) at 1950, 2000, 2026 and 2050: every modelled body
  from Earth or from its planet within 0.0025° (Horizons' `IAU_*` frames are
  the same report). The test rebuilds each point from the row's light time
  and astrometric direction, so it checks the orientation alone.
- **Light time isn't modelled**: the scene is geometric, so a body is drawn
  turned as it is at the simulation time, while from Earth it's seen as it
  was a light time earlier. Jupiter's central meridian as drawn from Earth
  runs ahead of what a telescope shows by Ẇ·τ, 20° to 30°; Mars's by 2° to 7°.
- **Synchronous moons face their planets** as a result, not by
  construction: by Horizons, every modelled moon's sub-planet longitude is
  within 6° of 0 from 1950 to 2050 (eccentricity's optical libration). As
  drawn, with the mean-element positions, the Galileans are within 4°,
  Tethys, Dione, Rhea, Titan and Iapetus 6°, Proteus 7°, Charon 2°, the Moon
  within its libration. Phobos, Deimos, Janus, Triton, Titania and Oberon
  aren't: their mean elements lose their orbital phase (Phobos and Deimos
  up to 170° by 1950 and 2050, Titania and Oberon at every date), which is
  a position error for #97, not an orientation one.
- **Textures** must put their own 0° at the prime meridian. Three's sphere
  maps the texture's centre column to longitude 0; a texture centred
  elsewhere says so with `texture_longitude` (the east longitude of its
  centre), which turns the surface mesh in the body frame. Io's, Europa's,
  Ganymede's, Callisto's and Iapetus's are centred on 180°. Jupiter's clouds
  turn with System II, not the IAU's System III, so its texture is turned by
  `texture_rotation` instead, putting the Great Red Spot at its observed
  System II longitude. Each texture's check is in
  [Planet.md](js/scene/Planet.md#texture-longitudes).
- **Hyperion** has no model (its rotation is chaotic) and keeps its
  tilt; demo descriptors without a model turn once per sidereal period
  from an arbitrary meridian.
- **Permalinks** hold the camera in the body frame (lat, lng), so a link
  to any body other than Earth and the Moon made before #96 restores to a
  different place around the body. `tools/parity/views.json`'s Mars views
  were re-timed (by under half a sol) so the body sits as it did, and the
  Sun within 0.25° of where it was.

### Orbit lines

Each orbit line is drawn from the ephemeris its body is placed by, so the
body sits on it (within 1e-5 of the orbit's size, `orbitPath.test.js`,
at 1900, 2026 and 2500). Before, every line was a flat ellipse from the
JSON's a and e, centred on the primary: the planets' had no inclination,
node or perihelion direction, and sat a·e off centre, so their points
were visibly off their lines (Mercury by ~10 px in an inner-system view).

- **Drawn as a wide line strip** (`wideLines.js`, `newWideLineStrip`), as
  the asterisms are: 1.5 px, antialiased, additive.  Its geometry keeps a
  `Line`'s `position` attribute and `setDrawRange`, which everything below
  writes as before; an instanced view of the same array draws vertex i to
  i + 1, through the ordinary model-view, so the float64-origin precision
  below carries over unchanged.  It's on the overlay layer, with the
  labels: drawn after the atmosphere pass, depth-tested against the scene
  depth that pass writes, writing none.  In the scene pass its depth told
  the atmosphere there was something at that distance, so from Earth's
  surface its own orbit (end-on, near) cut the sky's ray short: a dark
  blotch in the sky.
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
  line's centre, or jumped. Rebuilds are generators queued in
  `Animation.orbitPaths` and run by `pump()` a slice at a time (a VSOP87C
  call, or 64 vertices) within 4 ms a frame (`FRAME_BUDGET_MS`), or 12 ms
  while the next line doesn't hold its body at the latest date
  (`CATCH_UP_BUDGET_MS`: its first build, a jump, or a time rate faster
  than rebuilds), so none is on the per-frame path. A rebuild costs 20–36
  VSOP87C calls (~2 ms each, in bun and Chromium alike), 35–60 ms of work
  in Chromium; Uranus's and Neptune's ~110 and ~200 ms; the Moon's ~5 ms.
  All nine lines after a jump are ~0.6 s of work, about 50 frames.
- **A line is never hidden once built**, only before its first build.
  A path's shape changes over decades to millennia, so the last line
  stays a good picture until the next is ready, which then replaces it
  whole: a rebuild writes a scratch array and copies it into the geometry
  in one step, so a part-built line is never drawn. The first version
  hid a line whose window had passed its body; at high time rates the
  date outran the rebuilds (Mercury's is ~4 frames, and at 30 days a
  frame its 88-day window is passed in 2), so the inner planets' lines
  flickered, and worse, below.
- **Always for the latest date.** A queued rebuild takes the latest date
  asked; one the date no longer needs (time turned back into the line's
  window) is dropped. A running rebuild whose window won't hold the new
  date (a jump) restarts for it, **once**: the first version restarted
  on every such request, so at a date running faster than a rebuild
  (Mercury at 30 days a frame, any planet at a year a frame) it
  restarted every frame, never finished, and held up the queue behind
  it. Now it finishes, and Animation asks again for the date then, so
  the lines take turns, each at most a couple of rebuilds behind the
  date (`orbitPath.test.js`, *high time rates and jumps*, with a clock
  paced by VSOP87C's real cost).
- **Through the body's centre, close up** (`js/scene/bodyLine.js`,
  `BodyLine`). Within 1e-3 of the body's radius as the GPU draws it
  (`orbitPath.test.js`, *as rendered*: float32 vertices through a float32
  model-view with the camera at the body), for the planets, the Moon,
  Pluto and the mean-element moons. Two things kept the lines off by up
  to 0.8 of Neptune's radius and 24 of Pluto's:
  - **Chord sag.** 1000 segments over an orbit bow inside the curve by up
    to a·(2π/1000)²/8 ≈ 4.9e-6·a: Earth 740 km, Mars 1,100 km, Neptune
    22,000 km, Pluto 29,000 km. The 1e-5·a test allowed it. So a fine arc
    of the same curve (the sparse paths' ellipse plus interpolated
    departure, no new VSOP87C calls; the Moon's series; the unit ellipse)
    is spliced in over the body's coarse segment and one each side, at a
    spacing whose sag is under 2.5e-4 radii (`fineSteps`: Moon 3 steps a
    segment, Earth 22, Neptune 61, Pluto 256, capped). An interpolated
    path's small offset from the body's own position is added to the arc,
    faded out to nothing at its ends, where it joins the coarse vertices
    exactly.
  - **float32.** The vertices (in the geometry, and on the GPU with the
    camera offset) are good to ~6e-8 of their size: ~0.3 radii for Pluto,
    ~0.01 for Neptune. The coarse line is kept in float64 and written
    relative to an origin at the body, which the line's `position` puts
    back (three composes matrices in float64): near the body the numbers
    are small, and far vertices lose precision only where it's invisible.
    It's the same problem `rte.js` solves for the stars, solved here on
    the CPU, as a line has few vertices.
  - **Cost.** Each frame is a comparison or two per body; the arc and
    origin are redone when the body leaves its coarse segment, moves
    1000 radii from the origin, or is 5e-4 radii off the arc: a few
    hundred curve points and one upload of the drawn range. Lines that
    need neither (one step a segment, and float32 already fine: most
    moons) are left as built. For the whole solar system in Chromium
    (SwiftShader, a loaded machine): 0.06–0.09 ms a frame at real time,
    0.4–0.5 ms at a day a second, 0.7–1.0 ms at 30 days a frame. Earth's
    arc is the dearest: its monthly wobble comes from the lunar series,
    per point.
  - A new build is spliced around the body at once. Off its window (a
    stale line after a jump), a line is drawn plain until rebuilt.
  - The mean-element ellipses are redrawn when e has drifted enough to
    move them 1e-4 of the body's radius (Pluto's, by Standish's rates).
- **Non-finite input is refused:** `OrbitPaths.request` ignores a
  non-finite date, and a build whose samples aren't all finite leaves
  the last line as it was. Animation skips a frame whose date isn't
  finite and never sets a non-finite position. Time's clamp
  ([Frames and time](#frames-and-time)) keeps dates in range in the
  first place.
- **Other moons and Pluto** keep their mean-element ellipse of date, laid
  each frame (`layOrbitShape`): that ellipse is their ephemeris.
- **Bodies without elements** (demo descriptors) keep the flat ellipse.

### Frames and time

- **The scene frame is the mean ecliptic and equinox *of date*,** not J2000: VSOP87**C** is the of-date series (VSOP87A is J2000). Checked against Meeus example 25.b: VSOP87C gives the Sun's longitude as 199.9073° at 1992 Oct 13.0 (Meeus: 199.907372°), while VSOP87A gives 200.008°. Meeus ch. 47 is in the same frame, so the Moon's geocentric (λ, β, Δ) goes straight in, with no precession.
- **Axis remap**, for VSOP87C's `(x, y, z)` and any ecliptic vector: scene `(x, z, −y)`, i.e. X = equinox, Y = north ecliptic pole, Z = −ecliptic Y. A rotation about ecliptic Z is a rotation about scene Y by the same angle.
- **Body frames** (coords.js): +Y the north pole, +X the prime meridian, east longitude toward −Z. The same remap from a body's (x = longitude 0, y = 90° E, z = north), so an ecliptic rotation such as Rz(Ω)·Rx(−I)·Rz(F + 180°) becomes Ry(Ω)·Rx(−I)·Ry(F + 180°) in the scene. Since #96 the body frame is the IAU body-fixed frame of the 2015 report for every body but Earth (GMST), at TT for TDB ([Body rotation](#body-rotation-iau-prime-meridians)).
- **One scene frame, the stars included.** The catalogues are J2000: Celestia's stars.dat (and so the asterisms and star labels, placed from it) and the Milky Way and galactic grid (`galacticFrame.js`). They'd sit displaced from the planets by precession, 50.3″ a year in longitude: ~0.37° in 2026, ~28° at year 0 (#133). So they hang under `StellarFrame` (`js/scene/StellarFrame.js`), a group at the Sun (the catalogue is heliocentric) whose rotation is `celestialFrame.precessionQuaternion(J2000, date)`, Meeus 21.5's Rz(Π + p)·Rx(−η)·Rz(−Π), in scene axes.
  - The chain is `WorldGroup` (rebase) → `milkyway` → `StellarFrame` (J2000 → date) → `Stars` (catalogue positions, J2000) → points, labels, asterisms; and `StellarFrame` → `MilkyWay`. The Sun and planets are under `WorldGroup` directly, so the planets, the Moon, Earth's GMST spin, places, and Cesium's camera coupling (built from body node matrices) are untouched. The galactic grid gets the same rotation on top of its own.
  - **Updates:** Animation calls its `preAnimCb` with the Julian Day animated (so `animateAtJD`, e.g. a permalink restore, sets it too). It's rebuilt only when the date moves by more than a day (0.14″ of precession), in place.
  - **Reading star positions:** raw `star.x/y/z` and the stars' geometry are J2000, the `StellarFrame`'s local frame. Take them to the scene with `Scene.starPosition(star)` (the `WorldGroup` frame) or the stars' `matrixWorld` (world space). `goTo(star)` rebases to `-starPosition(star)`, and re-rebases when the frame turns so the star stays at the origin; picking (`Picker.queryPoints`) takes the ray into the catalogue frame instead of rebuilding its tree. The RTE shaders apply the model rotation (see [RTE interaction](#rte-interaction)).
  - **Checked** against JPL Horizons at 1900, 2026 and 2500 (`StellarFrame.test.js`, offline fixture `StellarFrame.horizons.json`): the Moon's separation from reference stars (their catalogue direction) is within 3.1″ of Horizons', and its place among them within 4.3″. Proper motion, parallax and aberration are left out; proper motion over centuries is a separate refinement.
  - The equatorial grid and Earth's pole use the J2000 obliquity about the equinox of date, i.e. the mean equator of date to within the change in obliquity (47″ a century). `celestialFrame.precessEcliptic` converts coordinates between dates, e.g. to compare with Horizons' J2000 ecliptic vectors.
- **Supported dates: J2000 ± 6000 Julian years** (JD 260045 to 4643045,
  about 4000 BC to AD 8000; `Time.SUPPORTED_YEARS_FROM_J2000`). The clock
  clamps at the source: `Time` holds the date at a bound rather than run
  past it, `setTime` clamps (and ignores NaN), the time rate is capped at
  2^40 (~35,000 years a second; 2^1024 is Infinity, and Infinity × a
  zero frame delta is NaN), and a permalink's `t=` is clamped on decode
  (a non-finite one makes it invalid). At a bound the rate readout says
  "(date limit)". Why that range:
  - VSOP87C here is the full series (the `vsop87` package), documented to
    1″ over ±4000 years for Mercury to Mars, ±2000 for Jupiter and Saturn,
    ±6000 for Uranus and Neptune. It's a series in powers of time from
    J2000 and diverges beyond: evaluated, it's still plausible at ±8000
    years, puts Jupiter at 7.6 AU at −20,000, thousands of AU out at
    ±100,000 and ~3 × 10⁹ AU (50,000 light-years) at a million years.
    Planets and their lines then agree on garbage: the light-year-sized
    "Lissajous" orbits seen before the clamp.
  - Meeus 47 (the Moon), the IAU 1976 precession, the ΔT polynomials and
    the mean elements' rates are fitted over centuries to a few millennia.
  - A JS `Date` ends at ±8.64e15 ms (±275,000 years); past it the date
    readout showed NaN, while the clock itself stayed a finite number.
- **Time:** the simulation clock is UTC. VSOP87C is fed the UTC Julian Day as it is (69 s of ΔT moves Earth ~2000 km). The Moon moves 0.01° in 69 s, so its series gets TT (`celestialFrame.utcToTtJulianDay`: 32.184 s + the leap seconds since 1972, the Espenak–Meeus ΔT polynomials before, continuous across 1972). So do the mean elements and the IAU rotation models, TT standing in for TDB (within 2 ms; Jupiter turns 0.00002° in it); Earth alone turns with the UTC clock, by GMST ([Body rotation](#body-rotation-iau-prime-meridians)). The UTC Julian Day is `Time.toJulianDay`, with the Unix epoch at JD 2440587.5 exactly (it used to run 14.6 s ahead, ~8″ of lunar motion). After 2017 TT − UTC stays at 69.184 s, right for a UTC clock, but UT1 keeps drifting: Earth rotation for future dates needs UT1 − UTC or a ΔT model.

## Camera Controls

Camera orientation and position are separated across three input modes, all accumulating independently:

| Input | Effect |
|---|---|
| Scroll wheel | Zoom (TrackballControls, asymptotic near surface) |
| Mouse drag | Free look — pitch (up/down) and yaw (left/right) around camera's local axes |
| Option+drag | Orbit — rotates camera as a rigid body around the planet center (position + orientation rotate together), slower the nearer the ground ([proximity-scaled](#proximity-scaled-orbit-drag)) |
| ↑ / ↓ arrow keys (hold) | Pitch camera nose up/down |
| ← / → arrow keys (hold) | Roll camera left/right |
| `t` | Toggle continuous tracking: the camera faces the target every frame, following a place as its body turns ([the target](#the-target)) |
| `c` | Snap look at current target |
| Click / tap a label (a star, planet, moon, asterism or place name) | Target it and do nothing else: `c` then faces it, `g` goes ([Picking labels](#picking-labels)) |
| Double-click / double-tap a label | Go to it, as `g` does |
| Double-click / double-tap elsewhere on a body | Land there |

**Touch.** Pinch zooms, through `TouchSafeTrackballControls`
(`js/TouchSafeTrackballControls.js`): TrackballControls with its list of
touching pointers kept right.  As three ships it, it captures only the
first finger, so a second one lifted over HTML (the widgets sheet, the info
panel) never sends it its pointerup; once that pointer ID is reused, every
touch move throws.  The subclass captures every pointer and lists each
once.

**Asymptotic zoom** (`js/zoom.js`): scroll zoom is remapped from distance-space to altitude-space so the camera approaches the surface asymptotically. The `camera.near` plane is dynamically scaled to `altitude * 0.1` (clamped 100 m – `SMALLEST_SIZE_METER`) so the surface remains visible without clipping.

### Proximity-scaled orbit drag

An orbit drag turns the camera about the body's centre by 0.005 rad a pixel, which carries the view over the ground by that angle times `R + alt`. Unscaled, that is 32 km a pixel at 5 km up on Earth, while the screen shows a patch about `alt` across: no way to move a few km over the ground. `rotateScale(alt, R)` (`js/zoom.js`) multiplies the speed by `1 - exp(-alt / R)`, where `alt` is the height over the *ground* (Cesium terrain where a layer knows it, as in zoom) and `R` the radius of the body the camera is at (`homeBody`, as in zoom). `ThreeUI.orbitScale()` supplies it to `dragControls` (`getOrbitScale`), read on every move.

- **Near the ground** it is `alt / R`, so a radian of drag sweeps `~alt` of ground, a similar fraction of the visible patch at every altitude. The exact ratio for that is `alt / (R + alt)`.
- **From a few radii out** it is 1 (0.95 at 3 R, 0.99 at 5 R), so far views drag as they always did. Plain `alt / (R + alt)` would still be slowed by a third at 2 R, so the saturating exponential takes its place: same slope at the ground, no tunables, smooth and monotonic.
- **Never zero**: floored at `MIN_ROTATE_SCALE` (1e-6, a few cm a pixel on Earth), so a drag at the ground still turns the view.
- **Curves ruled out**: a log of altitude is too gentle (kilometres a pixel at 5 km up), and a power above 1 crawls close in and falls out of step with the patch.
- **Only orbit drags are scaled.** Free-look drag (pan) and the arrow keys (pitch and roll) turn the camera in place and move nothing over the ground, so slowing them would only keep you from looking about the horizon.

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

The search bar's Look at button is a caller of this path: `setTarget` of the result, the
tween aimed at a body, a star's world position or a surface point.  See
[js/search/DESIGN.md](js/search/DESIGN.md#go-and-look-at).

### The target

One target, shown and used everywhere: what the breadcrumb shows, what the
link's path names, what `c` faces, `g` goes to and `t` tracks.  It is a body,
a place on one, a catalogue star or an asterism, and **`Scene.setTarget` is
the only way it changes**: a click on a label, a pick in the search, Look
at, Go, the keys (`h`, `u`, `0`-`9`), `Scene.goTo` and `Scene.land` (each
makes where it went the target; a landing at a place keeps the place), and
a link.  `setTarget(target, {look})` takes a body's name or a target as the
labels carry them (`{kind: 'place', body, name, lat, lng, alt}`,
`{kind: 'star', star, name}`, `{kind: 'asterism', name, position}`); it never
moves the camera, and turns it only with `look` (the default, for the keys
and Look at; a click passes `look: false`).  It sets:

| State | For |
|---|---|
| `Shared.targets.obj` | the targeted body, or a place's body (kept for a star or an asterism) |
| `Shared.targets.label` | a place, star or asterism; null for a body.  `c` (`lookAtTarget`), `g` (`Celestiary.goTo`) and `t` read it first |
| the store's `committedTarget` (`setCommittedTarget`), with `committedPath` and `committedStar` as views of it | the breadcrumb (Sun › Earth › Austin; a star's or asterism's name alone), the info panel, the page title |
| `onTargetChange` → `Celestiary._schedulePermalinkUpdate` | the link: its path is the target (`js/targetPath.js`, [design/URLs.md](design/URLs.md#path)) |

Nothing else writes those, so the breadcrumb, the link and `t` can't
disagree.  `Scene.getTarget()` reads it back.

The camera's frame is separate: `Shared.targets.cur`, the body its platform
hangs from (or the star it went to), set only by going and landing.  The
link's position and `cq` are in that frame, named by `from=` when it isn't
the target's, so targeting rewrites the link's path and not its view, and
the new link reloads to the same view
([js/permalink.md](js/permalink.md#the-cameras-frame)).

`t` turns tracking on and off (`Shared.targets.track`): every frame,
after the animation, the camera faces the target.  A place is placed on its
body that frame, so tracking follows it round as the body turns; a body
along its orbit; a star or an asterism holds still.  Changing the target
while tracking tracks the new one.

### Picking labels

One model for every label, on the canvas and in the search: **a click or tap
targets what the label names and does nothing else; a double click or tap
goes to it.**  The camera doesn't move or turn on a click, so `c` (face it)
and `g` (go) are the next step, as for any target.

The hit test is one for all of them (`js/scene/labelPick.js`).  A label sheet
that can be picked carries `userData.labelTargets`, what each label is of, by
label index; `labelBoxes` projects the visible sheets' labels to their text
boxes on screen, and `hitLabel` takes the one under the pointer (8 px of
slop; the nearest centre, then the nearest the camera).  A sheet of surface
labels (the places) also carries `userData.labelBody`, so the far side of
the body, where the shader discards them, isn't hit.  It's off while the star
picker is on, whose own double click picks a star.  A click on a body's disc
or on empty sky does nothing; a double click on a body's disc still lands
there.

A click is `setTarget(label, {look: false})` for every kind ([the
target](#the-target)): the breadcrumb, the link and the info panel follow,
the camera stays.

| Label | Target (a click): breadcrumb, link path | Go (`Celestiary.goToLabel`, a double click, and `g`) |
|---|---|---|
| Planet, moon, Sun (`kind: 'body'`) | Sun › Earth › Moon, `#sun/earth/moon` | the body's path in the hash, as search Go |
| Star (`'star'`) | Sirius, `#hip:32349` | `scene.goTo(star, name)` |
| Place (`'place'`, on a body) | Sun › Earth › Austin, `#sun/earth/austin`; its body is `Shared.targets.obj` | `scene.land(body, lat, lng, alt, {target: place})`: the camera lands there at the catalogue's altitude, or `DEFAULT_LAND_ALT_M` (eye height) without one, and the place stays the target |
| Asterism (`'asterism'`, named at the centroid of its stars) | Ursa Major, `#asterism:ursa-major` | `lookAtLabel`: the look tween toward the centroid, no travel (it's a direction, with nowhere to arrive) |

An asterism's name sits at the mean direction of its
stars from the Sun, at their mean distance (`Asterisms.centroid`), and is
shown with the lines (`a`).

dragControls fires `onClick` on both clicks of a double and then
`onDblClick`, so a double click targets, then goes; nothing conflicts.  It's
pointer events throughout (a tap is a click, two taps within 350 ms and 8 px
a double), so touch needs nothing of its own; `TouchSafeTrackballControls`
keeps the second finger from breaking the first's pointer ID.

The search bar follows the same model: picking a result in the dropdown
targets it (`targetEntry`), leaving the bar open; Look at targets it and
turns to it; Go and Enter travel
([js/search/DESIGN.md](js/search/DESIGN.md#picking-a-result-and-the-breadcrumb)).


## Rendering Techniques

| Object | Technique |
|---|---|
| Star field (~120k stars) | Custom GLSL shader on `Points` geometry; size/brightness from magnitude |
| Milky Way | Its integrated light: a full-screen pass at the far plane that ray-marches a published structural model (discs, bulge and bar, arms, dust) in the galactocentric frame, into a cached target re-marched when the view moves by more than it can show, less the light the star catalogue draws as points round the Sun; the atmosphere pass draws it with the rest of the night sky's light (the zodiacal light, airglow) through the eye's response to extended light ([MilkyWay.md](js/scene/MilkyWay.md), [HDR.md](js/scene/HDR.md#the-eye-and-extended-light)) |
| Star discs (the Sun, and any catalogue star travelled to) | A photosphere from physical parameters: temperature from class, blackbody colour and luminance, limb darkening by temperature, granulation at three scales, spots and faculae ([js/scene/Stars.md](js/scene/Stars.md)) |
| Planets | `MeshStandardMaterial` with optional diffuse, bump, hydrosphere, and cloud textures; a few pixels across, antialiased and shaded per fragment as the sphere ([Planet.md, small discs](js/scene/Planet.md#small-discs)) |
| Earth's clouds | A shell 6 km up on its own layer, drawn after the Cesium composite so it covers both sides: the date's NASA GIBS true colour unmixed into coverage, Lambert-lit in exposure units, shadowing the ground ([Planet.md, clouds](js/scene/Planet.md#clouds)) |
| Atmospheres | Fullscreen post-process pass over the scene buffer: Bruneton LUTs, the sky in exposure units, then the one tone map ([composition.md](js/scene/atmos/composition.md)); one body's air, the one the camera is in, else the target's ([which body's air](js/scene/atmos/composition.md#which-bodys-air)) |
| Saturn rings | Double-sided `RingGeometry` with texture |
| Orbit paths | A wide line strip (`wideLines.js`, 1.5 px, additive, on the overlay layer after the atmosphere): the body's sampled path, or its mean-element ellipse ([Orbit lines](#orbit-lines)) |
| Labels | Canvas-rendered `SpriteSheet` compiled to a single `Points` geometry |
| Asterisms | Wide lines (`wideLines.js`) between the stars of `asterisms-clean.dat` |
| Human expansion | Wide lines (`wideLines.js`), one per hop of a BFS across the catalogue, grown in the shader by a time uniform ([Colonization.md](js/scene/Colonization.md)) |
| Wide lines (`wideLines.js`) | Instanced screen-space quads: any width, antialiased, cut in front of the camera, divided through to w = 1.  Segments (RTE, optionally sorted far to near: the asterisms, the human expansion) or a strip (a Line's position attribute and draw range, through the model-view: the orbits).  GL lines are 1 px, and at light-years their w ~1e17 m ([Colonization.md, Drawing](js/scene/Colonization.md#drawing)) |

LOD (`THREE.LOD`) is used throughout to swap between detailed meshes, point sprites, and invisible placeholders based on camera distance.

### HDR pipeline

One linear brightness scale, one tone map ([js/scene/HDR.md](js/scene/HDR.md), #86):

| Pass | Target | Holds |
|---|---|---|
| Scene | `_sceneRT`, RGBA16F | lit surfaces × the exposure the frame renders with (the target-keyed exposure × the metered gain; exposure-only tone mapping); emitted sources (the stars, the Sun's disc and glow) × the same gain before the buffer, pre-exposed (`hdr.js` `absoluteUniforms`; [HDR.md, pre-exposure](js/scene/HDR.md#pre-exposure)), with nothing under half-float's smallest normal value; display-referred content (the rings, a body's far point) through the inverse of the final tone map (`hdr.js` `sceneReferred`) |
| Cesium layers | `_cesiumRT` (8-bit) → `_sceneRT` | each body's Cesium frame (stored × Lambert, one path for every body), decoded into exposure units; its terrain distance (in alpha, `cesium/distance.js`) becomes depth, from below 20 km |
| Atmosphere | screen | `PBR Neutral(sky + scene × T)`, the sky in exposure units; over it, in display values, the night sky's own light (the galaxy's march, the zodiacal light, airglow, through T) by the eye's response to extended light, while the meter reads it as light ([HDR.md, the eye and extended light](js/scene/HDR.md#the-eye-and-extended-light)) |
| Overlay | screen | display values (labels, orbit paths, asterism and expansion lines, grids, the pick marker: `shared.js` `overlay`), after the exposure meter's readback, depth-tested against the scene |

Without float render targets (`EXT_color_buffer_float`), or with `?hdr=0`, the old LDR order: an 8-bit `_sceneRT` tone-mapped in the scene pass, and the sky added in display space.

### The far point

A planet or moon is a mesh out to `POINT_AT_RADII` (500) radii and a
single point beyond (the `planet LOD`'s second level, `js/scene/farPoint.js`,
`Planet.newPlanet`).  The point is a marker, not a lit surface:

- **By apparent size, so the FOV counts.**  500 radii is 1.6 px across at a
  45° FOV over 640 px.  three's `LOD` picks a level by `distance /
  camera.zoom`, which ignores the FOV, so a body zoomed on by narrowing the
  FOV (which moves nothing: Look at Jupiter from Earth, then 1°) stayed a
  point however big it drew.  The planet and label LODs are `FovLOD`
  (`farPoint.js`): the distance is scaled by `fovScale(camera)`, the
  tangent of the half-FOV over its value at 45° (`INITIAL_FOV`), so a body
  switches where it has the same size on screen.  1 at 45°, so the choices
  there are unchanged; 0.021 at 1° (the mesh out to ~24,000 radii, which is
  1.7e12 m for Jupiter); more than 1 wider than 45°.  `CesiumLayers` scales the
  distance the same way against `meshRange`.  The planet LOD is scaled by
  the canvas too (`FovLOD({drawnSize})`, `meshReach`): the mesh until its
  disc is smaller than the point (2 CSS px), never nearer than 500 radii,
  and a few pixels across it's drawn antialiased and shaded as the sphere
  ([Planet.md, small discs](js/scene/Planet.md#small-discs), #192).  Not
  scaled: the stars' LODs
  (`Star`, `Stars.labelLOD`), whose distances are not a size threshold,
  and the places' own pixel-based LOD, which already reads the FOV.

- **Colour and size.**  A planet's is white and 2 px; a moon's is half
  brightness and also 2 px, since many sit by their planet's.  The
  colour is a *display value* (`farPointColor`): the scene is drawn
  unencoded (`outputColorSpace` is linear, `ThreeUI.initRenderer`), so a
  hex colour like `0x808080`, which three reads as sRGB and converts to
  linear, came out at 22%, not 50%, and a lone 1 px dot at 22% is lost
  among the stars.  `size` is in CSS px (three multiplies it by the
  renderer's pixel ratio), so it stays at least one drawn pixel at any
  display density.
- **Not tone mapped** (`toneMapped: false`): the exposure follows the
  targeted body (~1e-17 far out), which drew the marker black (#85).  The
  colour is a display value, so it must be made with `point()`
  (`shapes.js`), not `new Points`: `point()` is where, under the HDR
  pipeline (#141, HDR.md), a display-referred material is wrapped
  (`sceneReferred`), which keeps it the same through the final tone map,
  whose toe would otherwise darken a dim marker.
- **Depth.**  Depth-tested, no depth write, in the scene pass: three draws
  transparent objects after the opaque ones, so the planets' meshes are in
  the depth buffer by then, and a moon behind its planet is hidden.  It
  writes none, so points don't hide one another (and a body has no mesh
  where its point is drawn).  `depthTest: false` was how it began, which
  drew a point over whatever was nearer.  It stays in the scene pass, not
  the overlay one the labels use, so the atmosphere pass treats it as it
  does the stars: a bright day sky hides it.  In the overlay pass it drew
  over the day sky.
- **Depth precision.**  The depth buffer is 24-bit and standard (near is
  `dynamicNear`, at most 6e5 m; far is 6 galaxy radii), so its resolution
  at a distance z is about z² · 6e-8 / near: ~1e7 m at 1e10 m, ~1e8 m at
  3.5e10 m.  That's enough to hide a Galilean moon behind Jupiter's disc (it's
  at least 4e8 m behind the centre) while Jupiter is a mesh (out to 3.5e10
  m).  Where it runs out (the camera near a surface, where near shrinks to
  100 m, looking far), equal depths pass the test (`LessEqual`), so the
  failure is a point showing that should hide, never one hidden that
  should show; and points far beyond everything sit at the cleared depth
  (1.0), which they pass.  A logarithmic depth buffer would fix the
  precision, but changes the atmosphere pass's depth linearisation and
  the Cesium layers' depth blits, so it isn't worth it for this.
- **Cesium.**  A body drawn by its Cesium layer has no celestiary mesh in
  the scene pass (`CesiumLayers._hideSurface`), so no depth there: a point
  behind it is drawn, and then covered by Cesium's opaque globe, which
  composites over the scene after.  A point *in front of* a Cesium globe
  (the Moon's, in a lunar transit seen from beyond it) is covered too,
  which the old `depthTest: false` did as well.  Drawing it after the
  composite would fix that; the ground-sphere depths the composite
  writes are there to test against.
- **Not in the `V` groups.**  Bodies aren't annotations; the far point
  stays with the body.

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
`;` equatorial grid, `x` human expansion lines, etc.).  `V` is the union
of all the lowercase scene-annotation toggles.

**When adding a new visual feature, decide which group it belongs in and
wire it through the corresponding toggle method.**  Surface place labels,
for example, live under the `p` group: their visibility is controlled
inside `Scene.togglePlanetLabels` alongside the planet name LODs, so the
single 'p' shortcut and the global 'V' both pick them up automatically.

Failing to opt in means the user has no way to hide the new element
short of reloading the page — and `V` (presentation mode) won't be
truly bare.

## Performance panel

The `` ` `` (backtick) key toggles three's own `Stats` panel (FPS, MS, MB; click it to cycle the view), for judging frame cost, e.g. on a real GPU.  `ThreeUi.togglePerfPanel()` builds it on the first press (`three/examples/jsm/libs/stats.module.js`, no new dependency) and afterwards only shows or hides it, so startup and the tests never touch the DOM for it.  It's listed in Settings under Info as "Toggle performance panel".

- **Place:** bottom-right, above the fullscreen control: top-left is the search and info panel (its system list can run down the left side), top-right the time controls, bottom-left the settings icons, and bottom-centre the Cesium credits.  It's `position: fixed` at `z-index` 1000 above the canvas, and only its own box takes pointer events.
- **What it measures:** `Stats.begin()`/`end()` bracket `renderLoop()`, so MS is the CPU time to issue the frame (scene update and GL calls), not GPU time, and FPS is the frame rate the browser delivers.  On a GPU-bound view the FPS drops while MS stays low.  MB only exists in Chromium.
- **Outside the visibility groups:** it's a developer tool, not a scene or chrome feature, so neither `v` nor `V` hides it.
- **Typing:** `Keys.onKeyDown` ignores every key while an `INPUT`, `TEXTAREA`, `SELECT` or contenteditable element has focus, so the search box still takes a backtick.

## Perf overlay

`?perf=1` shows per-pass cost on the machine at hand ([#189](https://github.com/celestiary/web/issues/189), the measuring step of [#121](https://github.com/celestiary/web/issues/121)'s surface work).  The [performance panel](#performance-panel) says how fast the frame is; this says where its time goes, and it can tell a GPU-bound frame from a CPU-bound one, which the sandbox's SwiftShader can't.  It is instrumentation only: it changes no pass.  Code: `js/perf/`.

- **Off by default, at no cost.**  `perf.install(this)` in the `ThreeUi` constructor reads `?perf=1` (or `?perf=sync`; the app keeps the query string when it rewrites the address bar's hash, `permalinkHref`).  Without it `perf.enabled` is false and every hook returns at its first line: no timer queries, no wrapped GL calls, no DOM, `renderer.info` left alone, no `window.perf`.  A frame makes the same GL calls as before.
- **In the DOM, not the scene,** bottom-left above the settings icons (top-left is the info list, top-right the time controls, bottom-right the Stats panel), updated twice a second, so it adds nothing to the frame it measures.  Click the `-` to fold it to its title line.
- **The table.**  One row per pass, a `total`, then Cesium's shadow context and a line of the counts that aren't columns:
  - **GPU** (mean and p95 over the last 240 frames, ms) from `EXT_disjoint_timer_query_webgl2` (`GpuTimer.js`).  A query is read frames after its frame (never waited for), and `GPU_DISJOINT_EXT` drops every frame in flight.  A pass that didn't run in a frame counts as 0 in it (`runShare`, in the JSON, is the share of frames it did).
  - **CPU** (mean and p95): the time to issue the pass.  It is the GPU's only where something waits for the GPU: a `readPixels` (the `meter` row's CPU is how far the GPU is behind when the meter reads back).
  - **draws, rt, rb**: draw calls, render-target switches and readbacks into client memory, per frame, by the pass they happened in.  The line under the table adds full-screen passes, clears, blits, texture uploads (with their size), pixel-pack-buffer reads, program changes and triangles.  `renderer.info` counts only three's draws (`three` in the JSON); the wrapped GL calls (`glCounters.js`) count the replayed Cesium ones too.  "Full-screen" is a heuristic: a draw of at most six vertices into a viewport of at least a fifth of the canvas.
  - **On ANGLE Metal (Apple GPUs in Chrome) the GPU column is per encoder, not per pass**, as the first M2 measurements showed: passes recorded into one Metal encoder read the same time (`cesium`, `cesium.blit` and `cesium.shell` each about 50 ms) and the rows add up to 7-10 times the frame.  The overlay detects it (an unmasked renderer string with "Metal", or the passes' means adding up to more than 1.5 frame intervals), heads the column `GPU?`, says so, gives no GPU total, and writes `timer.granularity: "encoder"` into the JSON.  Use sync timing there.
  - Without the extension (Safari doesn't have it; a browser's privacy settings may hide it, as Brave's can) the GPU columns read `n/a`, a note says so, and the CPU times, counts and toggles remain.
- **Sections that nest.**  One `TIME_ELAPSED` query can run at a time, so a pass inside another (the galaxy's march inside the scene render, Cesium's replay inside the composite) can't have its own query running inside the outer one's.  `sections.js` makes a pass a series of segments: opening one stops the one under it, closing it starts that one again.  Each pass's time is its own, the inner ones taken out, and the rows add up to the frame (`other` is whatever runs under no pass: the base of every frame).  `TIMESTAMP` queries would do without this, but not every browser with the extension reports timestamp bits, so it isn't used.
- **Sync timing** (`?perf=sync`, or the *sync timing* checkbox; `barrier.js`): at the end of every pass (every segment, `sections.js`) the page waits for the GPU (`gl.finish()`; or with `&barrier=read`, if a browser's `finish` doesn't wait, a clear and 1x1 `readPixels` of a renderbuffer of its own) and the wall clock times the pass between those waits: each row is that pass's own cost, GPU work included, in the `CPU` column renamed `wall`.  No timer queries run then.  The frame rate is lower than real, the CPU/GPU overlap being gone, so read the rows as shares and costs, not as the frame; the title says SYNC.  Cesium's shadow context is waited on after each of its frames, and that wait is shown on its row and taken out of the pass it happened in.  The waits' own GL calls aren't counted.
- **Sync GL calls.**  Calls that round-trip to Chrome's GPU process and wait for the answer (`getError`, `getParameter`, `getProgramParameter`, `getShaderParameter`, `getUniformLocation`, `getAttribLocation`, `checkFramebufferStatus`, `getExtension`, `clientWaitSync`, `getQueryParameter`, and `readPixels` into client memory) are counted per pass as `syncCalls` (the `sync` column), on the page's context, where Cesium's replayed calls land, and on the shadow contexts, with a per-name breakdown (`syncByName`, per pass and in total, in the JSON).  The overlay's own timer polls and snapshots are muted.
- **The passes** (`passes.js` has the list, and a line for each as the row's tooltip):

  | Pass | What it is |
  |---|---|
  | `update` | The animation callback, camera and navigation, before any rendering. |
  | `scene` | `renderer.render(scene)` into the scene buffer: bodies, stars, the Sun, the galaxy's composite. |
  | `galaxy` | The Milky Way's march into its cached target (`MilkyWay.js`), only on a frame where the view changed. |
  | `cesium` | The composite's own work: clears, the fading celestiary surface, the JS between steps. |
  | `cesium.blit` | Copying the scene's depth into Cesium's target, per body. |
  | `cesium.shell` | The stencil shell: where the body shows. |
  | `cesium.replay` | Cesium's frame, replayed on this context by portal-netgl: Cesium's draws, post-process stages and queued uploads.  The GPU time of the draws, here; the JS of `widget.render()` in CPU. |
  | `cesium.decode` | The full-screen decode of Cesium's 8-bit frame into the scene buffer's units. |
  | `cesium.nightlights` | Earth's second Cesium frame (lights only, unlit), replayed and decoded: the same costs as the day frame's, in one row. |
  | `cesium.ground` | Each Cesium body's ground-sphere depth, for the atmosphere pass. |
  | `clouds` | Earth's cloud shell. |
  | `atmosphere` | The full-screen pass to the screen: sky, the scene through its transmittance, and the one tone map. |
  | `meter` | The exposure meter's render into 32x32 and its `readPixels`, every fourth frame. |
  | `overlay` | Labels, orbit lines and grids over the tone-mapped frame. |
  | `other` | GL work in no pass above. |

  The dotted `cesium.*` names are children by name only: `cesium`'s own row doesn't include them.
- **Cesium's shadow context.**  Cesium draws into a second, hidden WebGL context (the NetGL guest's shadow), and every draw runs there as well as in the replay ([#103](https://github.com/celestiary/web/issues/103)).  That context is reachable (`guest.core.shadow`), so it gets a timer of its own and its own counts, shown as `cesium.shadow.<body> (own GL context)`: the GPU time of Cesium's frames on it, which is not in the `total` (another context's clock; its work shares the GPU with the page's).  A readback there (Cesium's picking) shows in its `rb`.
- **Toggles** (`toggles.js`): `?perf=1&off=atmosphere,clouds` or the checkboxes switch a pass off, to bisect cost by frame rate where there is no GPU timer, and the numbers restart.  Each leaves the rest drawing; the picture differs while one is off.  Three kinds: `skip` (the pass's own `if (perf.begin(...))` doesn't run it: `clouds`, `nightlights`, `meter`, `overlay`), `gate` (`atmosphere`: the pass is also the frame's one trip to the screen and its tone map, so it runs with the sky off, `uAtmEnabled` 0) and `hide` (`galaxy`: the object is hidden and put back as it was).  `cesium` is `skip` at the source: with it off no body is wanted, so celestiary draws its own Earth, Moon and Mars.  With the meter off the exposure stops adapting.
- **Copy JSON** puts a snapshot on the clipboard (`snapshot.js`; where the clipboard is refused, a text box to copy from): the page's URL (the view's permalink), the viewport and drawing buffer sizes, `devicePixelRatio`, the GPU (`WEBGL_debug_renderer_info` where the browser shows it), the user agent, whether the GPU timers work, the target and active Cesium bodies, the toggles, every pass's GPU, CPU and counts, and the totals.  `window.perf.snapshot()` gives it in the console.
- **Adding a pass** (a later change's own render pass, e.g. the night sky's): bracket it, `perf.begin('name')` before and `perf.end('name')` after, one line each in the loop; and add `{name, what}` to `PASSES` in `passes.js`, which orders the rows and writes the tooltip (a pass left out is still timed and listed, after the others).  A pass that can be switched off is `if (perf.begin('name')) {...; perf.end('name')}`, with an entry in `TOGGLES`.  Nesting is fine; name a child with a dot.  An exception between `begin` and `end` is covered: the frame's end closes whatever is open.
- **What it can't see:** the compositor and the swap (the gap between the frame interval and the GPU total), a browser that rounds timer results, and work that runs between frames.  In the sandbox's headless Chromium (SwiftShader) the extension exists, so the code path runs, but its times are a CPU's emulation of a GPU: evidence of the plumbing, not of cost.

## State Management (Zustand)

`js/store/useStore.js` composes four slices:

- `AsterismsSlice` — asterisms visibility and catalog state
- `ColonizationSlice` — mirrors the `x` setting (human expansion lines) for the drawer's switch
- `WidgetsSlice` — the widgets drawer and dock: open, docked, the app showing, running and pinned apps, and the running apps' state for the permalink
- `SearchSlice` — search-bar state, anchor index, the target
  (`committedTarget`, with `committedPath` and `committedStar` as views of
  it; written only by `Scene.setTarget`), preview fields
- `StarsSlice` — star selection / filter state
- `TimeSlice` — time panel UI state

The store is passed into non-React classes (`ThreeUi`, `Stars`) to let them read/write shared state without React prop-drilling.

## Routing

Two routing layers coexist:

- **Wouter path routing** (`/`, `/guide`, `/about`, `/settings`) — controls which React panels are shown
- **URL hash** (`#sun/earth/moon`, `#sun/earth/austin`, `#hip:32349`) — names the target ([the target](#the-target)) and drives what's loaded; managed imperatively by `Celestiary` via `hashchange` events (`_navigate`)

The hash is extended with optional camera/time state to form a **permalink** — see [js/permalink.md](js/permalink.md) for the format specification — and with **state tokens** for the widgets drawer and its apps ([design/URLs.md](design/URLs.md)).

## React UI Components (`js/ui/`)

Thin MUI-based overlay panels:

- `TimePanel` — displays sim time, pause/play, time-scale controls
- `WidgetsDrawer` — the widgets drawer and dock, behind the Widgets button
  (below)
- `ColonizationApp` — the Human Expansion app's panel
  ([Colonization.md](js/scene/Colonization.md))
- `Settings` — keyboard shortcut reference
- `About` — app info and star catalog stats
- `SearchBar` — breadcrumb-anchored search (chips, MUI `Autocomplete`,
  Go / Look at buttons, crosshair picker toggle, preview + commit flow). See
  [js/search/DESIGN.md](js/search/DESIGN.md) for the index architecture.
- `DatePicker`, `NumberField`, `NumberInput` — supporting inputs
- `TooltipToggleButton`, `TooltipIconButton`, `NavToggleButton` — icon button wrappers

### Widgets drawer and dock

Optional tools ("apps") live in a drawer on the right, opened by the
Widgets button (top right).  `ui/apps.jsx` lists them: a name, an icon, a
panel, and a `stop` that removes whatever the app added to the scene.
State is `store/WidgetsSlice.js`, a pure reducer (tested without a DOM):

- **Three states.** Closed; open, the drawer over the right of the canvas,
  showing the app tray or one app; and dock, a 56 px bar of icons right of
  the canvas.  The dock shows while docked (the drawer's dock button) or
  while any app is pinned.  The canvas narrows for it
  (`Celestiary.setInsets`), and `#top-right` moves left of it
  (`--dock-width`), so it never covers the scene; an open drawer sits left
  of it.
- **Phones** (`useIsMobile`, 600 px wide or less).  The open drawer is a
  sheet over the bottom half of the screen instead, and the scene shrinks
  to the half above it (`setInsets`' bottom), so an app's effects show
  while it's used.  The bottom controls move up above the sheet
  (`--sheet-height`).
- **Sizing.**  `Celestiary` owns the scene's size: the window less the
  dock and sheet, redone on every resize (a phone rotating, its browser
  bars coming and going).  `ThreeUI.onResize` reads the container's size,
  never the window's.  The target's info panel scrolls within the scene's
  height (`--scene-height`).
- **Running.** An app runs from when it's opened until stopped.  Its
  header has a pin and an X.  X stops it (`stop`, out of the scene, back
  to the tray).  Closing the drawer stops every app that isn't pinned; a
  pinned app keeps running, panel mounted and state kept, with its icon
  in the dock to reopen it.  The dock can't be closed while an app is
  pinned.
- **Chrome.** The drawer and dock are HTML chrome: `v` hides them.
- **Permalink.** All of it is in the link: the `apps` state token, and
  each running app's state as its own `apps.<id>` token (an app reports
  its state to the slice, which drops it when the app stops;
  `store/appTokens.js` encodes it).  Spec: [design/URLs.md](design/URLs.md).

## Guide (`js/guide/`)

A separate interactive tutorial route (`/guide`) built with React Three Fiber (`@react-three/fiber`) and Drei. Each guide section is an isolated demo (Cube, Sphere, Star, Planet, Orbit, Stars, Asterisms, Atmosphere, Galaxy, VSOP, Labels, etc.) navigated via a side-drawer TOC. The guide and main app are fully independent bundles — the guide does not use the `Celestiary` class.

A guide page drives a bare `ThreeUi`, so it must supply what the app's `Scene`/`Animation` give it: a star's disc is metered only if `ui.sceneManager.objects` holds it with `props.type = 'star'` (`guide/starScene.js`; without it the Sun shader saturates white, HDR.md "Physical stars"), `ui.useStore` needs a `getState`, a planet's surface shows only once its `preAnimCb` has run, and the Sun's light is `SUN_LUMINOUS_INTENSITY` with `SUN_LIGHT_DECAY`.  Links within a page use `${window.location.pathname}#name`: with `<base href="/">` a bare `#name` resolves to the app root.

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
| `js/Time.js` | Simulation clock with time-scale control, clamped to the supported dates (J2000 ± 6000 years) |
| `js/camera.js` | Navigation tween factories (`newCameraLookTween`, `newCameraGoToTween`) |
| `js/zoom.js` | Pure zoom math: `asymptoticZoomDist`, `dynamicNear` |
| `js/permalink.js` | Permalink encode/decode: `encodePermalink`, `decodePermalink`, `pathFromFragment`; state token values (`parseTokenValue`, `formatTokenValue`) |
| `js/targetPath.js` | The target's path in the hash: `targetPath`, `parseTargetPath`, `resolvePlace` (a body or a place), `slug` |
| `js/store/appTokens.js` | The widgets drawer and its apps as state tokens (`apps`, `apps.<id>`; [design/URLs.md](design/URLs.md)) |
| `js/coords.js` | Geographic coordinate conversions: `worldToLatLngAlt`, `latLngAltToLocal` |
| `js/store/useStore.js` | Zustand store root |
| `js/dataUrl.js` | `dataUrl()`: resolves large-data paths against the build's data base URL ([Data policy](#data-policy)) |
| `js/perf/` | The `?perf=1` overlay ([Perf overlay](#perf-overlay)): `perf.js` (the hooks and the install), `GpuTimer.js`, `sections.js`, `glCounters.js`, `PerfStats.js`, `Overlay.js`, `snapshot.js`, `toggles.js`, `passes.js` |
| `public/data/*.json` | Celestial object descriptors |

### Search (`js/search/`)

| Path | Role |
|---|---|
| `js/search/SearchIndex.js` | Tiered index + app-wide singleton |
| `js/search/SearchRegistry.js` | Provider registration singleton |
| `js/search/SearchProvider.js` | JSDoc typedefs for `SearchEntry` / provider contract |
| `js/search/commitEntry.js` | Go and Look at actions for a result |
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
| `js/scene/lunarTheory.js` | The Moon: Meeus ch. 47 position, mean orbit of date (and Cassini-law orientation, now only a check) |
| `js/scene/meanElements.js` | Pluto and the moons: mean elements in their reference planes, Kepler's equation |
| `js/scene/iauRotation.js` | IAU WGCCRE rotation models: pole, prime meridian, body orientation; Jupiter's System II cloud texture turn. Data in `iauRotation.json` (`tools/iau/pckRotation.mjs`) |
| `js/scene/orbitPath.js` | Orbit lines sampled from the planets' and the Moon's ephemerides, and their budgeted rebuilds |
| `js/scene/bodyLine.js` | An orbit line as drawn: a fine arc around the body and a float64 line written relative to it, so it passes through the body's centre close up |
| `js/scene/celestialFrame.js` | GMST, TT − UTC, ecliptic precession between dates (coordinates and scene rotation) |
| `js/scene/StellarFrame.js` | Parent of the J2000 catalogues: precesses them to the simulation date |
| `js/scene/rte.js` | Relative-To-Eye camera uniforms in an object's own frame |
| `js/scene/Planet.js` | Planet/moon scene graph construction |
| `js/scene/clouds/` | Earth's clouds: `cloudSource.js` (date to GIBS layer, unmixing; pure), `CloudMap.js` (loading, the coverage texture), `CloudShell.js` (the shell and its shader) |
| `js/scene/farPoint.js` | A body's far point: its mesh range (and `FovLOD`, which scales it by the FOV), colour, size and depth state |
| `js/scene/smallDisc.js` | A body's disc a few pixels across: antialiased coverage and the sphere's shading per fragment, patched into the surface material ([Planet.md](js/scene/Planet.md#small-discs)) |
| `js/scene/atmos/atmosphereBody.js` | Which body's air the atmosphere pass draws, and how far off it can |
| `js/scene/Star.js` | A star: its light, its photosphere (`photosphere(props)`, `star-shaders.js`) and its limb glow |
| `js/scene/stellar.js` | Stars' physics: temperature from class, blackbody colour and luminance, bolometric correction, limb darkening, granulation and spot laws ([Stars.md](js/scene/Stars.md)) |
| `js/scene/starParams.js` | Every star's parameters: measured where published, else luminosity class, radius (Stefan-Boltzmann), mass and gravity from the catalogue; rotation (Roche, von Zeipel) and spots by type |
| `js/scene/Stars.js` | Star field from Celestia catalog |
| `js/scene/MilkyWay.js` | The Milky Way's integrated light: the march pass and its cache, which the atmosphere pass draws ([MilkyWay.md](js/scene/MilkyWay.md)) |
| `js/scene/galaxyModel.js` | The Milky Way's structural model: its components, the baked in-plane map, the normalisation, the share the star catalogue resolves, the JS and GLSL march |
| `js/scene/eye.js` | The dark-adapted eye's threshold against field size (Ricco, Piper), the extended response's gain, scotopic colour, surface brightness in exposure units ([HDR.md](js/scene/HDR.md#the-eye-and-extended-light)) |
| `js/scene/nightSky.js` | The night sky's own light: the interplanetary dust cloud (Kelsall et al. 1998) integrated along a ray from anywhere, for the zodiacal light and gegenschein, and airglow's path (JS and GLSL) |
| `js/scene/ZodiacalLight.js` | The zodiacal light's cache: the dust cloud's integral from the camera into a reduced-size half-float target, rendered when the view changes by more than it can show |
| `js/scene/viewCache.js` | When a cached view of something smooth (the galaxy's march, the zodiacal light) needs rendering again: moved, turned half a texel, or reprojected |
| `js/scene/Galaxy.js` | Animated galaxy particle system |
| `js/scene/Asterisms.js` | Constellation line drawings |
| `js/scene/Colonization.js` | Human expansion: kNN star graph and layered BFS spread from the Sun |
| `js/scene/ColonizationLines.js` | Human expansion lines, coloured by hop and grown over time |
| `js/scene/wideLines.js` | Wide antialiased lines: segments (asterisms, human expansion) and strips (orbits) |
| `js/scene/Orbit.js` | Orbital path visualization |
| `js/scene/StarsCatalog.js` | Celestia binary star catalog parser |
| `js/scene/AsterismsCatalog.js` | Constellation pattern definitions |
| `js/scene/object.js` | Base `Object3D` wrapper with registry tracking |
| `js/scene/shapes.js` | Geometry factory functions (sphere, rings, etc.) |
| `js/scene/material.js` | Texture/material cache |
| `js/scene/SpriteSheet.js` | Canvas-based label sprite atlas |
| `js/scene/GalaxyBufferGeometry.js` | Packed vertex data for galaxy particles |
| `js/scene/StarsBufferGeometry.js` | Packed vertex data for star catalog |
| `js/scene/Picker.js` | Star picking by ray (`queryPoints`) and the surface point under the pointer (`pickSurfaceLatLng`) |
| `js/scene/labelPick.js` | The label hit test for every label ([Picking labels](#picking-labels)) |
| `js/scene/PickLabels.js` | Label picking and marker display |
| `js/scene/atmos/Atmosphere.js` | Atmosphere mesh + fullscreen post-process pass |
| `js/scene/hdr.js` | The HDR pipeline's tone map (PBR Neutral), its inverse, `sceneReferred` for display-referred materials |
| `js/scene/exposure.js` | Target-keyed exposure; the sky's scale in exposure units |
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
