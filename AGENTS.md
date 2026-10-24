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
| Changing Cesium itself: the fork (celestiary/cesium), the patches in `patches/`, upstreaming | [CESIUM.md, patching Cesium](CESIUM.md#patching-cesium) |
| The Sun's activity by date, spots, flares, prominences, corona, CMEs, eclipses, glare, solar wind | [js/scene/Sun.md](js/scene/Sun.md); the photosphere and every star: [js/scene/Stars.md](js/scene/Stars.md) |
| Planet materials, lighting and exposure, texture sources and their recipes | [js/scene/Planet.md](js/scene/Planet.md): [lighting and exposure](js/scene/Planet.md#lighting-and-exposure), [surface texture sources](js/scene/Planet.md#surface-texture-sources) |
| The HDR pipeline: the scene buffer, units, the one tone map, display-referred materials | [js/scene/HDR.md](js/scene/HDR.md); DESIGN.md [HDR pipeline](DESIGN.md#hdr-pipeline) |
| The atmosphere pass | [js/scene/atmos/composition.md](js/scene/atmos/composition.md) (what it does and its knobs); [BRUNETON.md](js/scene/atmos/BRUNETON.md) (the LUT design) |
| Earth's clouds: the far-field shell from the day's map, and the volumetric clouds up close | [js/scene/Planet.md, clouds](js/scene/Planet.md#clouds) (the map and the shell); [js/scene/atmos/clouds.md](js/scene/atmos/clouds.md) (the volumetric model, its sources, the seeding, the hand-off, cost, other bodies) |
| Permalinks (`#path@lat,lng,alt;t=…;cq=…;fov=…`) | [design/URLs.md](design/URLs.md) (the whole URL, and the state tokens for the drawer and its apps); [js/permalink.md](js/permalink.md) (the view's encoding) |
| The changelog: `CHANGELOG.md`, its entry format, `changelog.json`, drafting from merged PRs | [tools/changelog/README.md](tools/changelog/README.md); [What's new epic #244](https://github.com/celestiary/web/issues/244) |
| What's new on the homepage, the changelog tour, the `#;news:tour` link | DESIGN.md [what's new](DESIGN.md#whats-new-and-the-changelog-tour); [design/URLs.md](design/URLs.md#news-token); [tools/changelog/README.md](tools/changelog/README.md) (the entries) |
| Social post drafts from the changelog (`yarn posts`), the first campaign, what to attach and how to publish | [tools/posts/README.md](tools/posts/README.md); [What's new epic #244](https://github.com/celestiary/web/issues/244) |
| The interface's look: the design system, its tokens, the info panel's tiers, the phone sheet, and the redesign's phases | [design/UI.md](design/UI.md); DESIGN.md [the info panel](DESIGN.md#the-info-panel) |
| Search | [js/search/DESIGN.md](js/search/DESIGN.md) |
| Lagrange points, Hill spheres, synchronous orbits (every pair), orbital regimes (LEO, MEO, GPS, Molniya, sun-synchronous, cislunar space), three-body orbits (halo, Lyapunov, DRO, NRHO; the CR3BP), and the rest of #272's orbital structure | [js/scene/Lagrange.md](js/scene/Lagrange.md); DESIGN.md [orbital elements](DESIGN.md#orbital-elements) |
| A craft's integrator (#11): the force model on the ephemerides, the integrators and their energy drift, Lambert, the transfer to the Moon, the `craft:` flights | [js/scene/Craft.md](js/scene/Craft.md) |
| Places (surface points of interest) | [js/scene/places.md](js/scene/places.md) |
| Earth satellites: CelesTrak's GP data, SGP4, the TEME frame, old elements, targeting and riding one | [js/scene/satellites/Satellites.md](js/scene/satellites/Satellites.md) |
| The space networks: Starlink's whole constellation, Iridium and its crosslinks, the Deep Space Network and DSN Now's live links; the compact elements, the propagation in slices | [js/scene/networks/Networks.md](js/scene/networks/Networks.md) |
| Populations round a body (satellites, orbiters, the Deep Space Network's): groups, the names budget, the panel's section, the `pop:` token, adding one | [js/scene/population/Population.md](js/scene/population/Population.md) |
| 3D models (glTF, `loadModel`), spacecraft at their JPL Horizons positions (Webb), their sources and licences | [js/scene/models.md](js/scene/models.md) |
| Rings | [js/scene/rings/rings.md](js/scene/rings/rings.md) |
| Gaia's stars and the point-population engine (tiles, budget, epoch, photometry, merge, rebuilding) | [js/scene/Gaia.md](js/scene/Gaia.md) |
| The Milky Way: its structural model, its light in exposure units, the march, the meter's galaxy anchor | [js/scene/MilkyWay.md](js/scene/MilkyWay.md) |
| Star discs and colours: temperature from class, blackbody colour, limb darkening, granulation, spots | [js/scene/Stars.md](js/scene/Stars.md) |
| The widgets drawer and dock (apps, pin, stop) | DESIGN.md [widgets drawer and dock](DESIGN.md#widgets-drawer-and-dock) |
| Human expansion (an app: BFS spread across the stars) | [js/scene/Colonization.md](js/scene/Colonization.md) |
| Other galaxies: SPARC's 175 discs from their parameters, their data and cross-match, levels of detail, rotation curves | [js/scene/Galaxies.md](js/scene/Galaxies.md); the model they share with the Milky Way, [js/scene/MilkyWay.md](js/scene/MilkyWay.md) |
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
- **`python3 -m http.server` answers a missing path with its own 404**,
  not the site's `404.html` as GitHub Pages does, so deep routes and
  the `/web/` redirect stub can't be tried with it. `yarn serve`'s proxy
  serves `public/404.html` for its misses; for a build, use a server that
  answers misses with the top-level `404.html` of the site they fall
  under. `esbuild/notFound.test.js` runs the page's script directly.
- **Tests run in bun with no real DOM**, and `Celestiary.test.js`
  replaces ThreeUI with a stub (`StubThreeUI`):
  - When Celestiary starts using a new ThreeUI member, add it to the
    stub.
  - The homepage tour, and anything that starts at "now", runs at the
    real clock. A test that depends on where the tour or the bodies are
    pins it with `setSystemTime` (bun:test) and resets it after, or it
    passes at some hours and fails at others.
  - A test that counts what a load fetches awaits the load's promise
    (`scene._satellitesPending`, `scene._networksPending[key]`), not a
    fixed sleep: those loads are a dynamic import first, and under a busy
    machine the import outlasted a 20 ms wait and its fetch was counted in
    the next test (`Celestiary.test.js`, "what a load fetches").
  - Keep DOM work (image loads, element creation) out of synchronous
    paths that tests drive, such as `Scene.setTarget`. Defer it to the
    animation loop: `preAnimCb` on a scene node runs every frame.
- **`mock.module` is process-global in bun**: `Celestiary.test.js` mocks
  `./scene/SpriteSheet`, so in `bun test` (all files together) a test
  that needs the real class gets the stub.  Import it by a name the
  mock doesn't take (`SpriteSheet.test.js` imports `'./SpriteSheet.js?real'`
  through a variable, which lint lets through), and in tests of code that
  builds sheets (Places) assert on `userData` (`labelTargets`,
  `labelRank`), not on the sheet's fields.
  - The `./vsop` mock (Earth fixed at 1 AU on +X) is just as global, and
    doesn't reach a module that loaded the real VSOP87C first: in some
    file orders (`bun test --randomize --seed 1`) Celestiary's own tests
    run on the real ephemeris.  So a test that needs the real one reads
    the package (`tonight.test.js`), and code shouldn't be slow on it:
    a VSOP87C call is about 2 ms (PR #249's tour plan asked once per
    aim, 4 s a plan, and timed out in CI's order only).
- **`bun test` follows symlinks, and walks `docs/`.**  Don't link a
  scratch directory into the worktree while running it (a link to a
  shared scratchpad ran other sessions' files and took 84 s), and rebuild
  `docs/` with `CESIUM_ION_TOKEN=` after `yarn precommit`, whose bundle
  check rebuilds it with whatever token the session holds.
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
  - Open a body other than the Sun by its path (`#earth`) and the bodies can
    load out of order on a local `python3 -m http.server` build ("No parent
    obj ... for earth", on main too, 2026-10-23), and the reveal never ends.
    Open `#sun`, wait for `c._reveal.done`, then `c.scene.setTarget('earth')`
    and `c.scene.goTo()`, and wait for `c.shared.targets.tween` to be null.
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
  - Before reading a metered view, wait for `c.ui._meterGainGoal` to
    hold for ~30 s, not a few polls. A view loaded far from its gain
    (a link with a high `ev=` starts at the dark gain) can bounce: a
    late reading of a frame whose lit pixels were clamped at 6e4 sends
    the goal up ~16× for several seconds.
  - The HDR scene buffer reads back as floats: bind
    `c.ui.renderer.properties.get(c.ui._sceneRT).__webglFramebuffer` and
    `gl.readPixels(x, y, w, h, gl.RGBA, gl.FLOAT, new Float32Array(...))`.
    It holds the frame before the atmosphere pass, pre-exposed, in
    exposure units, and it survives the task (a texture), where the
    canvas doesn't. A star's light is the sum over its pixels there.
  - A permalink's arrival tween can turn the camera seconds after you
    set a view: re-apply `lookAt` when the camera's quaternion drifts,
    and record the pose with the numbers. The Sun's glare pass veils any
    frame within 100° of the Sun from anywhere, and `_glareView` resets
    its `visible` each frame: to measure the sprites alone set
    `c.scene.objects.sun.sunLayers.enabled.glare = false`.
  - To see what one object adds to a frame, render with and without it
    (`material.visible = false`) and compare pixels at its projected
    spot, rather than reading absolute values off a starfield. Hide the
    label LODs and orbit lines first.
  - To show a change to the Cesium layers leaves a frame unchanged, A/B
    it in one page: override the method that decides (e.g.
    `c.ui.layers._lightsShow`) and render both ways. Freeze Cesium's
    tiles first (`c.ui.layers.bodies.earth.Cesium.RequestScheduler`
    `.maximumRequests = 0`, then wait for requests to drain), and render
    each side twice: low over the ground the tiles never settle on
    SwiftShader, and between two renders they otherwise change more than
    the rules do. A body whose tiles never read loaded stays warming; set
    its `shown` to measure it active.
  - Reading a half-float render target back
    (`renderer.readRenderTargetPixels`) needs a `Uint16Array`, decoded
    from half floats; a `Float32Array` comes back all zeros, silently.
  - Where a shader has a JS mirror (the Milky Way's march,
    `galaxyModel.js` `integrateRay`), iterate on its look with a CPU
    render of the mirror in bun, tone-mapped with `hdr.js` `neutral`: a
    200 px frame takes seconds, against minutes through SwiftShader.
- **Earth's clouds load from NASA GIBS** a second after the date settles
  (js/scene/Planet.md#clouds). Wait on
  `c.ui.sceneManager.objects.earth.clouds.userData.map.status`
  (`tilesDone === tilesTotal`, or `loaded` for the bundled fallback)
  before reading a frame, and after `c.time.setTime(ms)` run one
  `renderLoop` before placing the camera by latitude and longitude: the
  Earth turns to the new time only when the frame animates. To compare
  with and without clouds, move the shell off its layer
  (`clouds.layers.set(31)`); its `visible` is rewritten every frame.
- **Overlays and the chrome come in with the first load's reveal**
  (DESIGN.md [the first load](DESIGN.md#the-first-load)): held hidden
  until the scene is in, then faded in over about 1.3 s.  A probe that
  wants them drawn waits for `c._reveal.done`, and after a toggle calls
  `c.scene.overlays.finish()` (or steps frames) rather than reading
  `visible` mid-fade.  A probe that drives `renderLoop` by hand drives the
  fades too: they step on the time it passes.
- **The bare URL is the homepage** (DESIGN.md [homepage](DESIGN.md#homepage)):
  a tour plays, the overlays and chrome are held, and Cesium is suspended.
  A probe that wants the plain app opens a path (`#sun`) or calls
  `c.leaveHome()`; to see a tour frame, set `c.tour.playing = false` and
  `c.tour.t = ms`, and give the meter a few seconds after a jump.  The
  cards' images re-render with `node tools/home/cards.mjs` (after a build;
  `--gpu` on a real GPU).
- **Post drafts: `yarn posts`** adds a draft for each new *featured*
  CHANGELOG entry (`- Featured: yes`) to `posts/drafts.md`, and checks every
  post against X's 280 (a link counts 23) and Facebook's 300 to 500 target;
  the platforms are a table in `tools/posts/text.mjs`.
  It never changes a post already in the file, so the maintainer's edits
  and statuses stay, and nothing is posted for you. The images are the
  homepage cards' or `node tools/home/cards.mjs --gpu --hash <fragment>
  --id <name> --png posts/images`, which needs a real GPU: list those for the
  maintainer to render. When the maintainer marks a post `posted` and
  pastes its URLs into its `X:` and `Facebook:` fields, `yarn changelog`
  (not `yarn posts`) joins them onto the entry in `changelog.json`, which
  is how What's new links to them. [tools/posts/README.md](tools/posts/README.md).
- **Measuring a page's requests (Playwright):**
  - `page.route` turns the HTTP cache off, so a repeat fetch shows as a
    network request. Block hosts with `--host-resolver-rules="MAP *
    ~NOTFOUND, EXCLUDE 127.0.0.1"` or CDP `Network.setBlockedURLs`, and read
    requests from CDP `Network.*` events (`fromDiskCache`, `encodedDataLength`).
  - Chromium doesn't trust the agent proxy's CA, so GIBS (allowed) fails with
    `ERR_CERT_AUTHORITY_INVALID`. Launch with `--proxy-server=$HTTPS_PROXY
    --proxy-bypass-list=127.0.0.1` and `--ignore-certificate-errors-spki-list=`
    the base64 SHA-256 of the CA's public key
    (`openssl x509 -in /root/.ccr/agent-proxy-ca.crt -pubkey -noout | openssl
    pkey -pubin -outform der | openssl dgst -sha256 -binary | openssl enc
    -base64`). That trusts that CA only; never `--ignore-certificate-errors`.
  - For before/after renders, pause the clock once the permalink is applied
    (`c.time.setTime(ms); c.time.isPaused = true`): two renders of one build
    then match bit for bit, so any difference is the change's.
- **The star catalogue loads as brightness tiers**
  ([Stars.md](js/scene/Stars.md#brightness-tiers)): only the naked-eye
  sky and the named stars are in at scene-ready, the rest after the
  reveal.  A browser check that needs every star waits for
  `c.scene.stars.whenComplete()` (which also asks for them);
  `?starTiers=0` reads stars.dat whole, as before.  After editing
  stars.dat or starnames.dat, run `yarn stars`.
- **A permalink restores its time and view only with a camera
  quaternion (`cq=`).** Without one the whole fragment is ignored, and
  the app runs at the current real time. To test a date, set it with
  `c.time.setTime(ms)` after load.
- **A permalink's `s=` letters flip settings from their defaults**
  (`permalink.js` `SETTINGS_DEFAULTS`): `U` in `s=` turns the Milky Way
  *off*, as `a`, `l`, `p`, `o` turn the overlays off. Harnesses that hide
  the overlays with `s=alpoU…` hide the galaxy too; use `s=alpo`, and add
  `G` to hide the galaxies' names (on by default, shown by magnitude).
- **Cesium is patched on install** (`patches/`, applied by patch-package
  from `postinstall`; [CESIUM.md](CESIUM.md#patching-cesium)).  A fix to
  Cesium goes on a branch of celestiary/cesium with its Cesium specs, then
  into the patch; never edit `node_modules` and leave it there.  `yarn
  install --ignore-scripts` skips the patches, and
  `cesiumPatches.test.js` then fails.
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
  - `--abort regex` refuses matching ion URLs, for an asset over its
    quota (the account's Bing imagery, asset 2:
    `--abort 'api\.cesium\.com/v1/assets/2/'`).
- **Build for testing without the ion token**, `CESIUM_ION_TOKEN= yarn
  build` (an empty value overrides one in your environment; the build
  then bakes in no token), unless the task is about ion rendering.
  - ion bills its imagery (Bing, asset 2) by *sessions*, and the monthly
    quota ran out once (1038 sessions of 1000 in a week). A page with the token asks
    for one whenever the camera comes near Earth's ground, so each
    headless run, smoke test and `yarn parity` view that goes there
    costs one. Distant views don't ([CESIUM.md](CESIUM.md#cesium-ion-sessions)).
  - Without the token Earth's Cesium layer runs on the bundled Blue
    Marble and the ellipsoid, and the Moon and Mars aren't offered:
    enough for everything but terrain, detail imagery and those two.
  - `yarn parity` and the narrow-field script need the token: run them
    for a PR that changes Cesium rendering, not routinely. To test ion
    paths without spending anything, build with a dummy token
    (`CESIUM_ION_TOKEN=dummy yarn build`) and answer `api.cesium.com` in
    Playwright with a stub (`page.route`), counting the requests to
    `/v1/assets/2/endpoint`.
  - To keep Bing out of your own Playwright, abort `/v1/assets/2/` and
    let the rest of ion through (`route.abort()`).  Earth's World Terrain
    isn't deferred: without it the globe's lighting is the ellipsoid's,
    Lambert on its smooth normal, with no slopes
    ([CESIUM.md](CESIUM.md#earths-lighting-needs-the-terrain)).
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
- **Real-GPU cost: ask the user for a `?perf=1` snapshot.** SwiftShader
  has the timer extension but its times are a CPU's emulation, so
  frame-rate questions (#189) go to the user's machine.  The overlay is
  in the PR preview: `https://celestiary.org/web/pr-preview/pr-<n>/?perf=1#<permalink>`
  (design: DESIGN.md [Perf overlay](DESIGN.md#perf-overlay)).
  - **Ask:** give the preview URL for each view that matters (e.g.
    Earth's surface looking down, the day sky with time running, space),
    and say: load it, wait about ten seconds, press **Copy JSON**, paste
    it back, one paste per view.  On an Apple GPU (ANGLE Metal) the GPU
    timer queries are per encoder, not per pass, so ask for **sync
    timing**: `?perf=sync` in place of `?perf=1`, which waits for the GPU
    after every pass and times each by the wall clock (FPS is lower;
    that's expected).  If the sum of the rows' `wall` is far under the
    frame interval, `finish` doesn't wait there: ask again with
    `&barrier=read`.  For a bisect add `&off=a,b` (keys: `atmosphere`,
    `clouds`, `nightlights`, `galaxy`, `cesium`, `meter`, `overlay`) and
    ask for the FPS in the title line with each switched off in turn.
  - **Read it:** `timer.mode` is `query` or `sync`.  In `query` mode,
    `timer.granularity` `encoder` means the GPU column is per encoder:
    don't read passes from it, nor add it up (there is no total).
    `timer.host` false means no GPU timer: use the CPU columns, the
    counts and the toggles' FPS.  Otherwise
    `timings.passes[].gpu.mean` and `.p95` are ms per frame, a pass that
    didn't run counting 0 (`runShare`); `timings.total.gpu.mean` against
    `timings.frame.intervalMs.mean` says GPU-bound (close) or something
    else (the gap: CPU, vsync, the compositor).  In `sync` mode
    (`timings.clock` `wall-synced`) `timings.passes[].cpu` is each pass's
    wall-clock cost, GPU included.  Otherwise `cpu` is the time to issue
    the pass; the meter reads back through a pixel-pack buffer
    (`pboReads`) and waits for nothing, so a big `meter` CPU time with
    `readbacks` on its row is the synchronous fallback (`?meter=sync`,
    `?hdr=0`, no WebGL2 sync objects) stalling on the GPU's backlog.  `counts.syncCalls` and `syncByName` are the calls that
    round-trip to the GPU process (`getError`, `getParameter`,
    `readPixels` ...), where the CPU waits without GPU work.
    `cesium.shadow.<body>` is the second GL context, outside the total
    (in sync mode, how long it was waited on).  `counts` are per frame,
    by pass.  `gpu.unmaskedRenderer` and `devicePixelRatio` say which GPU
    and how many pixels.
  - **Add a pass's marker** when you add a pass: `perf.begin('name')` /
    `perf.end('name')` in the loop and a line in `js/perf/passes.js`.
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
  - `services.swpc.noaa.gov` (NOAA SWPC's solar-cycle series, to refresh
    `js/scene/sun/sunspots.json`: `tools/sun/sunspots.mjs`).  SILSO's
    `www.sidc.be` answers too, but its data's licence (CC BY-NC) keeps it
    out of the repo ([Sun.md](js/scene/Sun.md#activity-by-date)).
  - `gea.esac.esa.int` (the ESA Gaia archive's TAP service, for
    `yarn gaia`; its band queries take seconds, a whole-sky async job
    hours: [Gaia.md](js/scene/Gaia.md#the-query)).
  - `ssd.jpl.nasa.gov` (JPL Horizons, for ephemeris reference vectors).
    Record Horizons results as offline test fixtures with the query that
    produced them; tests never hit the network.
  - `celestrak.org` (CelesTrak's GP data, for the satellites' snapshot,
    `public/data/satellites.json`: `yarn satellites`;
    [Satellites.md](js/scene/satellites/Satellites.md#the-data)).  Fetch a
    group at most once every two hours: CelesTrak blocks clients that ask
    more.  Horizons takes a TLE too (`COMMAND='TLE'`, `TLE=` the lines),
    which `tools/satellites/fetchHorizons.mjs` uses to check the frame.
    `yarn networks` (Starlink's and Iridium's snapshots,
    [Networks.md](js/scene/networks/Networks.md#the-data)) asks the same
    way: pass `--cache DIR` and `--only` so a rerun asks for nothing it has.
  - `eyes.nasa.gov` (NASA's DSN Now: `config.xml` for `yarn networks`, and
    `dsn/data/dsn.xml`, the live feed the DSN overlay polls from the page,
    CORS `*`).  A page in headless Chromium reaches it through the proxy
    with the CA pinned, as below.  `deepspace.jpl.nasa.gov` (the DSN
    handbook, 810-005, with each antenna's coordinates) is refused.
  - `ssd-api.jpl.nasa.gov` (JPL's three-body periodic orbit catalogue, for
    `public/data/periodicOrbits.json`: `bun tools/periodic/fetchJpl.mjs`;
    [Lagrange.md](js/scene/Lagrange.md#three-body-orbits)).
  - `asc-planetarynames-data.s3.us-west-2.amazonaws.com` (the IAU
    Gazetteer's per-body downloads, for `tools/places/build.mjs`; the
    site itself, `planetarynames.wr.usgs.gov`, is refused).

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
- **Keep the first load lean.** `yarn bundle-check` (in `yarn precommit`)
  fails if `vsop87` is in a file the entry or the App route imports
  statically (`esbuild/firstLoad.js`), or if the first load, minified or
  gzipped, or its largest file is over its budget (`esbuild/budget.js`),
  listing the biggest contributors. A big dependency or dataset that
  the first frame can do without gets a dynamic `import()` after it, and a
  stand-in meanwhile with a hand-over that doesn't jump (the planets:
  DESIGN.md [before the ephemeris loads](DESIGN.md#before-the-ephemeris-loads)).
  In tests, `new Animation(time, null)` is "no ephemeris yet" and
  `setEphemeris(fn)` its arrival; read VSOP87C from
  `vsop87/dist/vsop87c-wasm`, since `Celestiary.test.js` mocks `./vsop`.
  A PR that lowers a number lowers its limit too, in the same PR
  (DESIGN.md [load budgets](DESIGN.md#load-budgets)).
- **Some data is built from other data and committed, with a test that
  fails when it drifts**: after editing a body's descriptor
  (`public/data/<name>.json`) run `yarn bodies`; a place catalogue,
  `yarn places-index`; `CHANGELOG.md`, `yarn changelog`. Nothing but the
  page, its scripts, the bodies' bundle and the stars loads with the page:
  a body's places, the galaxies and the changelog wait until something
  needs them (DESIGN.md [what loads when](DESIGN.md#what-loads-when)), so
  new data should too.
- **Measure the homepage's load with `yarn load-budget`** (CI's
  `load-budget` job runs it). After `yarn build` it serves `docs/` with
  gzip, loads the homepage in headless Chromium with other hosts blocked,
  and prints the requests and bytes when the scene is ready and when it has
  settled, the 15 biggest requests and the folders with the most, against
  the budget. `--no-budget` just reports. It records through a CDP session,
  not `page.route`, which switches the HTTP cache off.
- **Measuring the live site or a PR preview from here** (headless
  Chromium, `https://celestiary.org/` and
  `https://celestiary.org/web/pr-preview/pr-<n>/`):
  `yarn load-budget --url <url> --no-budget` with
  `--chromium /opt/pw-browsers/chromium-1194/chrome-linux/chrome
  --trust-ca /root/.ccr/agent-proxy-ca.crt`. The sandbox's proxy re-signs
  TLS, and Chromium's own certificate store can be stale after a container
  restart (`ERR_CERT_AUTHORITY_INVALID`), so `--trust-ca` passes
  `--ignore-certificate-errors-spki-list=<base64 SHA-256 of the CA's
  public key>`, which pins exactly that CA and leaves verification on
  for everything else. By hand, in your own Playwright script,
  `openssl x509 -in /root/.ccr/agent-proxy-ca.crt -pubkey -noout | openssl
  pkey -pubin -outform der | openssl dgst -sha256 -binary | base64` gives
  the value; never `--ignore-certificate-errors`. Record with a CDP
  session (`Network.requestWillBeSent`, `loadingFinished`'s
  `encodedDataLength`) and the on-the-wire sizes are the real ones.
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
    `git lfs pull`.  Some tests read LFS data (`tools/stars/stars.test.js`
    reads Gaia's `index.json`) and fail on a pointer.
  - git-lfs writes its hooks (`post-checkout`, `post-commit`,
    `post-merge`, `pre-push`) into `hooks/`, the repo's `core.hooksPath`,
    whenever it runs (`git lfs install`, `git lfs pull`). They're
    untracked: never commit them. Keep `pre-push` if you commit LFS
    data, since it uploads the objects; otherwise they can be deleted.
  - A PR that changes files under `public/textures/`,
    `public/data/stars.dat` or `public/large/` gets a full preview copy;
    any other PR previews against production's data.
  - Details: DESIGN.md [data policy](DESIGN.md#data-policy).
- **Ask early for anything only the user can supply:** tokens, dataset
  access (e.g. an ion asset not in the account), allowed hosts, account
  settings. Say exactly what's needed.

## Secrets

- **`CESIUM_ION_TOKEN`** is a build-time env var and a repository secret.
  It's restricted by Referer to `https://celestiary.org/` and
  `https://celestiary.github.io/` (the site moved to celestiary.org; the
  old host redirects).  `tools/parity` and `tools/narrow-fov` send the
  github.io Referer, which the token still allows.
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
  preview at `https://celestiary.org/web/pr-preview/pr-<n>/`,
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
  go-ahead, which comes one of two ways; either is enough:
  - **In a session:** the user tells the session they're talking to to
    merge it ("merge 274"), whether that's the planning session or the
    one that wrote the PR. That session merges, then leaves a one-line
    comment on the PR saying who approved it and where, so the PR's
    record is complete.
  - **On the PR:** a comment from @pablo-mayrgundter, "lgtm", "ok to
    merge" or the like. This is for approving asynchronously while lots
    of work is in flight: the decision is recorded where the change is,
    and the user doesn't merge PRs directly. Check the comment's author
    before acting on it; a comment from anyone else, a bot or an agent
    is not approval.
  - **Neither is a gate on the other:** a session told to merge doesn't
    also wait for a PR comment, and a PR comment doesn't need repeating
    in a session.
  - **Who merges an approved PR:** the session the user told to, or, for
    an approval on the PR, the session that dispatched the work. The
    dispatching session can order the merges, merge `main` into each PR
    in turn, resolve the conflicts (keep both sides of ROADMAP.md's
    *Done recently*), and wait for CI on the merged head before merging.
  - **The approval covers the PR as reviewed.** Merging `main` in and
    resolving conflicts doesn't need a new one. A later push that
    changes what the PR does does: say so on the PR and wait.
  - **An agent never merges on its own initiative**, its own PR or any
    other. Without one of the go-aheads above it says in its report that
    the PR is ready and waits.
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
- **A PR that changes what users see adds its CHANGELOG.md entry**, in
  the same PR, as it adds its *Done recently* paragraph to ROADMAP.md.
  *Done recently* stays the planning record; CHANGELOG.md is the
  user-facing one, and they shouldn't drift.
  - An entry says what you can now see or do, in plain words: a
    one-line headline, a sentence or two, the PR and issue links, its
    epic, and a permalink that shows it (`Permalink: none` if you
    haven't found and opened one: don't guess). Housekeeping,
    refactors, CI and doc-only PRs get no entry, or a link in the
    month's "Behind the scenes" line.
  - **Decide whether it is featured** (`- Featured: yes`): a new thing to
    see or do, with a view to open, worth announcing. What's new shows
    only the featured entries by default ("Featured only" turns off to
    show the lesser features and fixes), the "new" count counts them, and
    `yarn posts` drafts social posts only from them. Leave it out for a
    polish or a lesser feature; a major fix can be featured.
  - **State its kind** (`- Kind: fix`): a fix is something that was
    broken, wrong or a regression, and now isn't. Anything that adds or
    improves what users can see or do is a feature, the default when the
    field is absent (`Kind: feature` is accepted; any other value is a
    build error). Kind is independent of featured, and What's new's
    "Features" and "Fixes" buttons filter on it, so a PR's entry says
    which it is: classify it deliberately, don't leave a fix without the
    field.
  - The entry links its own PR, so open the PR first and add the entry
    in a follow-up commit to it. Its `Date` is the day you write it
    (the merge day, if you know it); the entry goes at the top of its
    month.
  - The format is in [tools/changelog/README.md](tools/changelog/README.md)
    and the header of `CHANGELOG.md`.
  - Run `yarn changelog` after editing it: it rebuilds
    `public/data/changelog.json`, which the app reads. A test fails when
    the JSON is stale, so `yarn precommit` catches a forgotten rebuild.
- **Cesium layer behaviour** goes in CESIUM.md.
- **Planet rendering, and texture sources and their recipes**, go in
  `js/scene/Planet.md`.
- **Anything about the compositing library** goes in the portal repo:
  its DESIGN.md, or the gotchas in portal-layers.md.
- **Workflow tips** for future sessions go here, in *Working
  efficiently*.
