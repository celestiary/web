# AGENTS.md

Working norms for AI agents (Claude Code, Codex, etc.) contributing to
celestiary. `CLAUDE.md` is a symlink to this file. Read it before
starting work, and keep it current when you learn something the next
session would otherwise rediscover.

Always read these three, and [ROADMAP.md](ROADMAP.md) before picking up
new work:

- [DESIGN.md](DESIGN.md): architecture and design overview.
- [STYLE.md](STYLE.md): code style (ESLint enforces most of it).
- [PLAYBOOK.md](PLAYBOOK.md): how we plan, debug, test and collaborate.

## Where to look

Read the doc for the area you're touching before reading code. The docs
record why things are the way they are, including approaches that were
tried and dropped.

| Working on | Read first |
|---|---|
| What's planned, in what order, and cross-track decisions (data policy) | [ROADMAP.md](ROADMAP.md): [now / next / later](ROADMAP.md#now--next--later), [tracks](ROADMAP.md#tracks), [the galaxy plan](ROADMAP.md#the-galaxy-plan); epics are issues labelled [`epic`](https://github.com/celestiary/web/issues?q=is%3Aopen+label%3Aepic) |
| Class hierarchy, scene graph, animation loop | DESIGN.md: [core classes](DESIGN.md#core-class-hierarchy), [scene graph](DESIGN.md#scene-graph-structure-per-planet), [animation loop](DESIGN.md#animation-loop) |
| Units, frames, coordinates | DESIGN.md [coordinate system & scale](DESIGN.md#coordinate-system--scale); [js/permalink.md](js/permalink.md#coordinate-system) |
| Camera, navigation, targeting (`goTo`, `setTarget`, keys) | DESIGN.md: [camera controls](DESIGN.md#camera-controls), [navigation](DESIGN.md#navigation-goto-flow), [setTarget and lookAtTarget](DESIGN.md#settarget-lookattarget-c-key) |
| Rendering, overlays and the `v` visibility groups | DESIGN.md: [rendering techniques](DESIGN.md#rendering-techniques), [overlays & visibility groups](DESIGN.md#overlays--visibility-groups) |
| Cesium layers: Earth, Moon, Mars in place | [CESIUM.md](CESIUM.md): [architecture](CESIUM.md#architecture), [camera, light and ground](CESIUM.md#camera-and-light-coupling), [data](CESIUM.md#data), [atmospheres](CESIUM.md#atmospheres), [tiles and lighting](CESIUM.md#tiles-and-lighting-ion-3d-tiles), [parity check](CESIUM.md#parity-check), [follow-ups](CESIUM.md#follow-ups) |
| Planet materials, lighting and exposure, texture sources and their recipes | [js/scene/Planet.md](js/scene/Planet.md): [lighting and exposure](js/scene/Planet.md#lighting-and-exposure), [surface texture sources](js/scene/Planet.md#surface-texture-sources) |
| The HDR pipeline: the scene buffer, units, the one tone map, display-referred materials | [js/scene/HDR.md](js/scene/HDR.md); DESIGN.md [HDR pipeline](DESIGN.md#hdr-pipeline) |
| The atmosphere pass | [js/scene/atmos/composition.md](js/scene/atmos/composition.md) (what it does and its knobs); [BRUNETON.md](js/scene/atmos/BRUNETON.md) (the LUT design) |
| Permalinks (`#path@lat,lng,alt;t=…;cq=…;fov=…`) | [design/URLs.md](design/URLs.md) (the whole URL, and the state tokens for the drawer and its apps); [js/permalink.md](js/permalink.md) (the view's encoding) |
| Search | [js/search/DESIGN.md](js/search/DESIGN.md) |
| Places (surface points of interest) | [js/scene/places.md](js/scene/places.md) |
| Rings | [js/scene/rings/rings.md](js/scene/rings/rings.md) |
| Star discs and colours: temperature from class, blackbody colour, limb darkening, granulation, spots | [js/scene/Stars.md](js/scene/Stars.md) |
| The widgets drawer and dock (apps, pin, stop) | DESIGN.md [widgets drawer and dock](DESIGN.md#widgets-drawer-and-dock) |
| Human expansion (an app: BFS spread across the stars) | [js/scene/Colonization.md](js/scene/Colonization.md) |
| Social previews via the portal proxy | [portal/DESIGN.md](portal/DESIGN.md) |
| Where code lives | DESIGN.md [key files](DESIGN.md#key-files-reference) |
| Adding bundled data (Git LFS, `dataUrl`), what a PR preview copies | DESIGN.md [data policy](DESIGN.md#data-policy) |
| The compositing library under the Cesium layers (portal-netgl) | [portal AGENTS.md](https://github.com/pablo-mayrgundter/portal/blob/main/AGENTS.md), its [DESIGN.md](https://github.com/pablo-mayrgundter/portal/blob/main/packages/portal-netgl/DESIGN.md) and the [portal-layers design](https://github.com/pablo-mayrgundter/portal/blob/main/docs/portal-layers.md) |

## Working efficiently

- **Toolchain: yarn and bun, Node 22.**
  - `bun test path/to/file.test.js` runs one test file.
  - `yarn lint` runs ESLint.
  - `yarn precommit` runs lint, all tests and the bundle check. The git
    pre-commit hook runs it too, so a commit that fails it doesn't
    happen.
  - Frequent lint catches: `no-mixed-operators` (parenthesise
    `a / b + c`) and unused `catch (err)` (write `catch {`).
- **`yarn build` replaces `docs/` wholesale** (`docs/` is build output:
  never edit it). A static server started inside `docs/` then serves
  nothing, so restart it after each build, e.g.
  `(cd docs && python3 -m http.server 5400 &)`.
- **Tests run in bun with no real DOM**, and `Celestiary.test.js`
  replaces ThreeUI with a stub (`StubThreeUI`):
  - When Celestiary starts using a new ThreeUI member, add it to the
    stub.
  - Keep DOM work (image loads, element creation) out of synchronous
    paths that tests drive, such as `Scene.setTarget`. Defer it to the
    animation loop: `preAnimCb` on a scene node runs every frame.
- **Driving the app from a browser (headless Chromium on
  SwiftShader).**
  - Launch with `--use-angle=swiftshader --enable-unsafe-swiftshader`.
    Chromium is preinstalled in cloud sessions, so don't run
    `playwright install`.
  - `window.c` is the `Celestiary` instance: `c.ui` (ThreeUI: camera,
    renderer, `layers`), `c.scene` (`objects`, `setTarget`, `land`),
    `c.time` (`setTime(ms)`, `simTimeJulianDay()`).
  - Read state with `page.evaluate` rather than inferring it from
    pixels.
  - Call the function under test directly (e.g.
    `c.ui._applyAsymptoticZoom`) instead of replaying dozens of wheel
    events: SwiftShader is slow, and a screenshot of a landed view can
    take many seconds.
  - Use small viewports and few screenshots, and put long runs in the
    background.
  - `page.screenshot` times out when the machine is busy (SwiftShader,
    other agents). Instead stop the page's loop
    (`c.ui.renderer.setAnimationLoop(null)`), call
    `c.ui.renderLoop(performance.now())` yourself, and read the canvas
    with `toDataURL` in the same task (its buffer is cleared once the
    task ends). Null `c.shared.targets.tween` before each frame, or the
    `goTo` tween moves the camera off your view.
  - To see what one object adds to a frame, render with and without it
    (`material.visible = false`) and compare pixels at its projected
    spot, rather than reading absolute values off a starfield. Hide the
    label LODs and orbit lines first.
- **Earth's clouds load from NASA GIBS** a second after the date settles
  (js/scene/Planet.md#clouds). Wait on
  `c.ui.sceneManager.objects.earth.clouds.userData.map.status`
  (`tilesDone === tilesTotal`, or `loaded` for the bundled fallback)
  before reading a frame, and after `c.time.setTime(ms)` run one
  `renderLoop` before placing the camera by latitude and longitude: the
  Earth turns to the new time only when the frame animates. To compare
  with and without clouds, move the shell off its layer
  (`clouds.layers.set(31)`); its `visible` is rewritten every frame.
- **A permalink restores its time and view only with a camera
  quaternion (`cq=`).** Without one the whole fragment is ignored, and
  the app runs at the current real time. To test a date, set it with
  `c.time.setTime(ms)` after load.
- **Compare Cesium with celestiary numerically: `yarn parity`.**
  - Run `yarn build` first (with `CESIUM_ION_TOKEN` set); the script
    serves `docs/` and doesn't build. `yarn parity --out parity-out`
    also writes the image pairs and `report.json`, for PR evidence.
  - It renders each view in `tools/parity/views.json` with the body's
    layer forced fully on and off, once tiles have settled, and prints
    median pixel ratios over the lit disc and terminator brightness
    profiles against tolerances. It exits non-zero on a FAIL. What it
    measures, and how to add a view: [CESIUM.md](CESIUM.md#parity-check).
  - Views are at partial phase, not full: colour-pipeline mismatches
    hide near full phase.
  - By hand, force a layer with `c.ui.layers.fadeOf = () => 1` (or
    `() => 0`), and render the same view both ways.
  - Not in `yarn precommit`: it takes minutes and needs ion.
- **A shader edit needs a rendered check**, not only its arithmetic: a
  compile failure (e.g. a GLSL ES reserved word such as `half` as a
  variable, #153) draws nothing and fails no unit test. Collect the page's
  console errors (`THREE.WebGLProgram: Shader Error`) in any render
  probe, or read
  `c.ui.renderer.properties.get(material).currentProgram.diagnostics`
  (`undefined` when the program compiled). `c.ui.starsDebug()` logs the
  star field's state: the exposure and metered gain with the meter's last
  reading, the limiting magnitude, the GPU's point-size range and
  fragment precision, and a few stars' sprites by the shader's law.
- **A star missing on the user's GPU and not here:** `c.ui.starProbe('Name')`
  renders and reads the star's pixel as is and with each candidate group
  hidden in turn (asterisms, expansion lines, the Milky Way, the galaxy,
  labels, the bodies), and logs the sprite's law and its clip z by
  float32. Ask the user to run it at the failing view and paste the
  output, rather than guessing the occluder from here.
- **A frame can read as empty on a real GPU and not on SwiftShader:**
  half-float values under 6.1e-5 are denormals, which a GPU may flush to
  zero (a star field at the keyed exposure is all under it), and the
  32×32 meter taps under 1% of the pixels. Never decide "nothing drawn"
  from pixel values; use the scene's readiness (`frameCanBeEmpty`).
- **Known SwiftShader quirk:** `gl_PointCoord` flips in point shaders
  that `discard` or sample a depth texture. Use depth state instead.
- **Network hosts this work needs in the sandbox:**
  - `api.cesium.com` and `assets.ion.cesium.com` (Cesium ion);
  - `trek.nasa.gov` (Moon and Mars mosaics);
  - `eoimages.gsfc.nasa.gov` and `gibs.earthdata.nasa.gov` (Earth; GIBS
    is also Earth's night lights on the Cesium layer).  Headless Chromium
    doesn't trust the sandbox proxy's CA, so GIBS tiles fetched by a page
    fail with `ERR_CERT_AUTHORITY_INVALID`: route them through Node like
    ion's (`tools/parity/parity.mjs` `routeGibs`).
  - `ssd.jpl.nasa.gov` (JPL Horizons, for ephemeris reference vectors).
    Record Horizons results as offline test fixtures with the query that
    produced them; tests never hit the network.

  If one is denied, ask the user to add it to the environment's allowed
  hosts, and carry on with what doesn't need it.
- **IAU rotation constants** (`js/scene/iauRotation.json`) come from
  NAIF's `pck00011.tpc`. `naif.jpl.nasa.gov` is denied in the sandbox, but
  GitHub has byte-identical copies (e.g. `nyx-space/anise`'s
  `data/pck00011.tpc` on raw.githubusercontent.com; the table records the
  md5). `tools/iau/pckRotation.mjs` rebuilds the table and
  `tools/iau/fetchHorizons.mjs` the Horizons sub-observer fixture.
- **Parallel agents share this machine.** The shared yarn cache can
  end up corrupt when several installs run at once: if `yarn install`
  fails on a package's contents, install with a private
  `--cache-folder`. Don't `kill` browser or server processes you didn't
  start. The scratchpad directory can be shared between them too: give
  your files and directories names of your own (a prefix), not `main`
  or `before`.
- **The scene buffer is linear HDR** (js/scene/HDR.md).  Anything new
  drawn with `toneMapped: false`, whose values are meant as display
  values (a marker, a line, a label), goes through `sceneReferred()`
  (`hdr.js`), or PBR Neutral's toe will darken it.  `?hdr=0` in the URL
  forces the LDR fallback, for testing it.
- **Large assets are fine in the repo**, e.g. the Blue Marble textures
  and tile pyramids. Document how each was built in
  `js/scene/Planet.md`, so it can be rebuilt.
- **New bundled data over about 1 MB goes in Git LFS.**
  - Put it under `public/large/<dataset>/`, which `.gitattributes`
    tracks. Install git-lfs and run `git lfs install` once, or the
    files are committed as plain blobs. `git lfs ls-files` lists what's
    tracked.
  - Load it with `dataUrl('large/<dataset>/<file>')` (`js/dataUrl.js`),
    never a bare relative path. Previews load large data from
    production, so a bare path 404s there.
  - A checkout without git-lfs holds pointer files, not data. Run
    `git lfs pull`.
  - A PR that changes files under `public/textures/`,
    `public/data/stars.dat` or `public/large/` gets a full preview copy;
    any other PR previews against production's data.
  - Details: DESIGN.md [data policy](DESIGN.md#data-policy).
- **Ask early for anything only the user can supply:** tokens, dataset
  access (e.g. an ion asset not in the account), allowed hosts, account
  settings. Say exactly what's needed.

## Secrets

- **`CESIUM_ION_TOKEN`** is a build-time env var and a repository secret.
  It's restricted by Referer to `https://celestiary.github.io/`.
- Never print, log, commit or paste it, including in PR text or test
  output.
- **Ion's error bodies echo the token:** a not-found response repeats
  the request URL, access token included. Strip response bodies before
  printing them.
- **Testing ion from Playwright:** the token needs that Referer. Route
  `api.cesium.com` and `assets.ion.cesium.com` requests through Node
  with the header set (`page.route` → `route.fetch({headers: {referer,
  origin}})`), then fulfill them with
  `access-control-allow-origin: *`.
  `route.fetch({headers})` replaces the request's headers, so spread in
  `await route.request().allHeaders()`: without it ion's bearer token is
  dropped, and its asset requests (terrain, tilesets) answer 401 while
  the token is fine. `tools/parity/parity.mjs` does this.
- **A session's env holds the token from when the session started.**
  After the user rotates it, ion answers 401 here. Say so, and leave
  ion-dependent checks to the PR preview.

## Verification and reporting

- **Rendering changes need visual evidence:** screenshots, or the PR
  preview at `https://celestiary.github.io/web/pr-preview/pr-<n>/`,
  which builds with the repository's ion token.
- **Report what you couldn't verify**, and say why (no ion access, no
  real device, a host denied). Name what the user should check on the
  preview.
- **Merges to `main` deploy to production** (`deploy-prod.yml`).

## Pull requests

- **Subscribe to PR activity as soon as the PR is open**, so CI
  failures and review comments arrive in the session. In Claude Code,
  use `subscribe_pr_activity`. Where it's available, also schedule a
  check-in about an hour out, since events don't cover everything.
  Cancel it once the PR merges.
- **Handle each event as it arrives:**
  - fix small, clear issues directly;
  - ask before changes that are architecturally significant or
    ambiguous;
  - skip events that don't need action.
- **Merge only when the user says so.** A green PR waits for their
  go-ahead.
- **Keep the PR description current:** when later pushes change what the
  PR does or fixes, update the description to match.

## Recording what you learn

- **Collaboration and debugging lessons** go in PLAYBOOK.md.
- **Architecture** goes in DESIGN.md.
- **Priorities, sequencing and cross-track decisions** go in
  ROADMAP.md; the details of each piece of work go in its issue.
- **Every PR updates ROADMAP.md for its own change**, in the same PR:
  mark the issues it closes as done in the track tables, add it to
  *Done recently*, and move the *Now / Next* items it affects. No
  separate roadmap PRs.
- **Cesium layer behaviour** goes in CESIUM.md.
- **Planet rendering, and texture sources and their recipes**, go in
  `js/scene/Planet.md`.
- **Anything about the compositing library** goes in the portal repo:
  its DESIGN.md, or the gotchas in portal-layers.md.
- **Workflow tips** for future sessions go here, in *Working
  efficiently*.
