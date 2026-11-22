// The load budgets (#256, #262): one place to raise or tighten them.
//
// Two checks read this file:
//  - the static one, `yarn bundle-check` (part of `yarn precommit`,
//    esbuild/check.js): the first load's JS and CSS from a minified dry-run
//    build, measured from esbuild's metafile;
//  - the runtime one, `yarn load-budget` (CI's `load-budget` job,
//    tools/loadBudget/): the homepage in headless Chromium against the
//    built site served with gzip, requests and encoded (on the wire) bytes
//    from the DevTools protocol.
//
// How they were set (DESIGN.md, "Load budgets"): each limit is today's
// measurement on main (the day #262 landed, 2026-10-15; the runtime
// limits lowered with #258 and #259 on 2026-10-20) rounded up with
// about 10% headroom, so ordinary work doesn't trip it and a new
// dependency or an eagerly loaded dataset does.  They are a ratchet, not
// targets: when a change lowers a number (#258's lazy bodies, places and
// galaxies, #98's star tiers), lower the limit in that PR, to the new
// measurement plus the same headroom.  When a change must raise one, edit
// the line, say why in the PR, and let the reviewer see it.
//
// Sizes are in KB of 1,024 bytes.

/**
 * The first load, from esbuild's metafile: the entry (js/index.tsx), the App
 * route and what they import statically (esbuild/firstLoad.js), plus the CSS
 * they carry.  Measured on a minified build; gzip is zlib's default level in
 * process, close to what GitHub Pages sends.
 */
export const STATIC_BUDGET = {
  // Everything in the first load, minified.  Main on 2026-10-15: 2,130 KB.
  // 2,349 on 2026-10-28, a KB under; 2,352 with an instrument's field (#337:
  // the field range on ThreeUI, the RUBIN instrument, the Rubin panel's
  // optics switch and field readout, 3 KB minified); 2,353.4 with Rubin's pixel
  // (#339: its switch and token field, 0.4 KB minified and 0.6 KB gzipped).
  // 2,366 with the credits footer (#341: ui/CreditsFooter.jsx, credits.js
  // and their CSS, chrome mounted from the start so Cesium's credits have
  // somewhere to go; its info icon, @mui/icons-material's InfoOutlined; the
  // hand-off of what the lazy credits dialog shares with the first load,
  // CreditsFooter CREDITS_DIALOG_DEPS, passed rather than imported, which had
  // split the first load into 16 files; Cesium's credits timed to the ion
  // logo, CesiumLayers bingShown and credits.js keepsLogo; and Gaia tiles'
  // class counts, starTile.js).  The dialog and its facts are a chunk of
  // their own.  2,367 with a body opened by its path below the Sun (#336:
  // Loader fullPath, _descriptor and _pathOf, Celestiary _loadBody's full
  // path, under a KB), at the limit, so a KB of room; with a late Cesium guest
  // frame's distance scale (#344: GuestPages _sent, CesiumLayers
  // _frameDistanceScale) 2,368 and a fraction, so a KB of room again.
  // Still within 2,369 with Rubin's image (#333: its switch and token field in the
  // panel; the layer, its WCS and its manifest are in the Rubin chunk
  // and the data).  With Rubin's survey cadence (#332: the panel's switch,
  // its caption and the visit readout, the token field; under 1 KB
  // minified; the schedule and the fields' drawing are in the lazy Rubin
  // chunk) and the seat's aim (#332: Scene.rideSeat's `aim` and the panel
  // riding the telescope's pointing on the cadence, half a KB, Scene and
  // the panel both first load), 2,371.  With the camera turning with a
  // body low over its ground (#344: Scene _syncSpin, _hungOn,
  // linkCameraQuaternion), 2,372.
  // With the Suntan app's panel (ui/SuntanApp.jsx, its icon and token
  // codec, store/suntanApp.js; chrome in the drawer, as the Rubin panel is,
  // with its mission and sensors a chunk of their own: scene/suntan/), 2,382
  // (8 KB more), so 2,383; MUI's Select for its event list would have been 4
  // more, so it's a native select.  2,384 with its craft findable (the
  // `craft` target in Scene and the search, SuntanProvider, the app's search
  // view and the panel's find buttons, a KB), so 2,385.  2,448 with three.js
  // 0.187 (from 0.171: three itself grew, 776 KB to 846 KB in the build,
  // about 65 KB of it in the first load, its WebGLRenderer and core; nothing
  // of celestiary's), so 2,449 for a KB of room.  With a camera left behind
  // turning about its target (#361: Scene pivotBody, ThreeUi _updatePivot,
  // dragControls getPivot, under a KB), 2,450.  2,460 with the camera
  // control (#361 step 2: Scene cameraMode, setCameraMode and the held
  // turning, about 3 KB; ui/CameraModeControl.jsx's label 2.1 KB and
  // CameraModeMenu.jsx 2.4 KB, plain buttons: MUI's Menu, though already in
  // the first load, cost more, and loading the menu lazily split the first
  // load from 11 scripts to 14), so 2,461.
  // The HiPS sky layer (#360) is lazy but for the `?sky=` parameter in
  // Scene (showSky) and the Rubin panel's buttons to its imaged fields
  // (their list and directions are in the lazy code), half a KB: 2,462.
  // The Suntan craft's exposure (Scene.targetCraftNode and sunlitCraft,
  // asked by ThreeUI each frame) and a link that names a craft and keeps the
  // view on it (the `suntan:` path, the craft's frame and its restore in
  // Celestiary, which reads a link before anything else loads), 2 KB: 2,464,
  // so 2,465.
  // 2,476, so 2,477 (11 KB more), with the Sun's activity view (#358;
  // js/scene/Sun.md, "The activity view"): the EUV imager's and the
  // coronagraph's branches of the photosphere's and the corona's shaders,
  // which are one program each with the white-light picture, so not a chunk
  // of their own; the flares' light curves in the event model the first
  // frame already runs; and a star's activity against the Sun's
  // (sun/stellarActivity.js, 2 KB), which Star.js reads as it builds the
  // Sun.  The CMEs' particles (sun/cme/, 16 KB) are a chunk of their own,
  // loaded when a CME is first in view, with what they share with the first
  // load handed to them (SunLayers CME_DEPS): importing it had split two
  // more files out of the first load for the same bytes.
  // 2,482, so 2,483, with the colour theme (js/theme.js; design/UI.md, "The
  // theme"): every designed colour in one module, 2.3 KB minified, most of
  // it the lazy features' colours (the networks', the regimes', the orbit
  // diagram's) moving into the first load; the chrome's colours set as CSS
  // custom properties from it at App's load (applyCssColors), and index.css
  // using `var(--x)` where it had a literal; the imports across the chunks.
  // Lazy features that import nothing of the first load (Suntan, Rubin) are
  // handed their colours, and MUI's palette is set in each route
  // (ui/Palette.jsx), not in Style.jsx (the page's entry): importing the
  // theme from either had split it into a file of its own.  Folding the
  // off-palette colours into the palette will take some of it back.
  // 2,484 with the screen's calibration (js/scene/screen.js; HDR.md,
  // "Calibrated on the screen"): the dark gain, the night sky's gain and
  // its skip derived from their screen values through the tone map and
  // sRGB's encoding, 0.5 KB.
  // 2,485 and a fraction, so 2,486, with Earth's physical air
  // (composition.md, "Per-body data"): the ozone layer's tent in every table
  // and the pass (ozoneParams, OZONE_GLSL), the aerosol's extinction per
  // channel and the Mie's colour from it (mieColour), about 2 KB minified,
  // less the fallback march's ozone, left out.  Shader code the first frame
  // draws with, so not a chunk of its own.
  // 2,487, so 2,488, with a camera as the observer (#375; Sun.md, "Glare"):
  // a lens's glare function beside the eye's in the Sun's glare pass, picked
  // by a uniform, the CAMERA instrument, ThreeUi's user observer under an
  // app's instrument, and the Settings' Observer row and its `K` flag, 1.6 KB
  // minified.  Shader code and settings the first frame reads.
  // 2,488 and a fraction, so 2,490, with the disc from orbit (#375;
  // composition.md, "The ground under the air", "The Mie's colour"): the
  // coloured aerosol's second atlas and the per-channel Mie in the march,
  // about 0.5 KB, and the backtick key's hooks for the panels.
  // 2,495 and a fraction, so 2,496, with the ground lit through the air
  // (composition.md, "The ground's light"): the ground-light table's
  // precompute (Bruneton's irradiance, a shader of 2 KB), its lookup and
  // the planet material's mod (atmos/groundLight.js), and the same light in
  // the cloud shell and Cesium's decode, about 7 KB minified.  Shader code
  // the first frame of Earth draws with; loaded lazily, Earth's ground would
  // brighten when it came.  2,497 and a fraction, so 2,498, with the
  // ground's albedo by the month (groundLight.js's month and threshold,
  // ThreeUi's rebuild of the tables that read it, 1 KB).
  // 2,501, so 2,502, with the months blended by the day (Planet.md, "The
  // months blended by day": monthMaps.js and the planet material's mod, the
  // shares' easing in monthly.js, Cesium's month stacks in cesium/season.js,
  // 3 KB).  The detail over the month's colour (detailTransfer.js,
  // detailImagery.js) is a chunk of its own, loaded once ion is asked.
  // 2,502 and a fraction with the ion token, so 2,503, with the planets'
  // places kept while the date stands (Animation.setDate's copy, a few
  // hundred bytes); the detail's worker is a script of its own.  2,505 and
  // a fraction, so 2,506, with the clock's day steps at solar noon (Time's
  // steps, solarNoon.js, the time panel's toggle).  2,506 and a fraction, so
  // 2,508, with the Earth breathing app's way in (its tray entry, search view
  // and constants; its panel is a chunk of its own, breathingApp.js).
  // With the compass (#361 step 3: js/compass.js, Scene cameraHeading,
  // turnCamera and compassTap, ui/CompassControl.jsx, its dial an inline
  // SVG; and the camera menu from the ground, Scene._leaveGround), 2,512
  // (2,513 with the ion token), so 2,514.
  totalMinifiedKB: 2514,
  // The same, gzipped (what crosses the wire).  Main: 661 KB; 729 KB on
  // 2026-10-27, when the Rubin app's panel (ui/RubinApp.jsx, with its icon
  // and token codec) took it to 731.  Loading the panel lazily cost more,
  // 735 and three scripts, in the shared chunks the split made.  733 on
  // 2026-10-28: the seat the camera rides (Scene.rideSeat, its near plane
  // in ThreeUI) and the panel's seat button and shell switch; 734 the same
  // day for the search's views (ViewsProvider, store/appViews.js) and the
  // bar's places reload.  735 the same day for an instrument's field (#337:
  // 1.1 KB gzipped, from 733.3 to 734.4; the clamp has to be in ThreeUI and
  // the switch and readout in the panel, both first load); 736 for the pixel
  // marker's switch (735.03: 30 bytes over, so a KB of room, not a squeeze).
  // 739, so 740, for the credits footer (#341: its timing, each credit on
  // arrival then fading, its info icon, and Gaia's and NASA GIBS's credits;
  // credits.js, CreditsFooter.jsx, scene/gibs.js; chrome, so in the first
  // load with the footer).  741 with the seat's aim (#332: 740.2, a
  // fifth of a KB over).
  // 744, so 745, with the Suntan app's panel (2 KB: the panel and its
  // token, as the Rubin panel; loaded lazily it would split shared chunks as
  // that one's did).  760, so 761, with three.js 0.187 (from 0.171: about
  // 16 KB, three's own growth, as above).  763, so 764, with the camera
  // control (#361 step 2, as above).  764, so 765, with the Suntan craft's
  // exposure and link (as above).
  // 769, so 770 (5 KB more), with the Sun's activity view (#358, above).
  // 770 and a fraction, so 771, with the colour theme (as above).  772
  // and a fraction, so 773, with Earth's physical air (as above; over 772
  // with the ion token baked in, as CI's and the precommit hook's builds are).
  // 774 and a fraction, so 776, with the ground lit through the air and its
  // albedo by the month (as above; a fraction more with the ion token).
  // 777, so 778, with the months blended by the day (as above).  778 and a
  // fraction, so 779, with the day steps and the Earth breathing app.
  // 780 and a fraction with the ion token, so 781, with the compass (#361
  // step 3, as above).
  totalGzipKB: 781,
  // The largest single first-load file, minified.  Main: 695 KB.  759 with
  // three.js 0.187, the file three is in (758 KB of it three's).
  largestChunkMinifiedKB: 765,
}

/**
 * Layer mode's page (layer.html, js/layer/layer.js; design/LayerMode.md):
 * its entry and what it imports statically, measured as the first load is,
 * from its own build (common.js layerConfig).  2026-10-24, built on its own:
 * 591 KB minified, 164 KB gzipped, nearly all one file (three tree-shaken
 * with the rest); the snapshots load after.  Lowered from 910 / 260 / 765,
 * set when it was a second entry of the app's build and shared its chunks.
 * Raised by three.js 0.187's growth (from 0.171: 612 to 669 KB minified,
 * 171 to 185 KB gzipped, all three's), from 650 / 180 / 650, so the room
 * stays what it was.
 */
export const LAYER_BUDGET = {
  entries: ['js/layer/layer.js'],
  totalMinifiedKB: 708,
  totalGzipKB: 194,
  largestChunkMinifiedKB: 708,
}


/**
 * The homepage's load, at a bare URL, from the built site served with gzip,
 * in headless Chromium with other hosts blocked (tools/loadBudget/).
 *
 * "ready" is when the scene is in (ThreeUI.sceneReady, the reveal's trigger);
 * "settled" is when the network has then been quiet for a while, after the
 * ephemeris and whatever else the page fetches once the scene is on screen.
 * Bytes are encoded (compressed) body bytes plus headers where known.
 */
export const RUNTIME_BUDGET = {
  // After #259's star tiers (2026-10-20): 26 requests, 925 KB (the
  // catalogue's bright tier is 157 KB of it).  After #258: 25 requests,
  // 2,614 KB (stars.dat was 1,848 KB of it).  Before it: 81, 2,859 KB.
  // With three.js 0.187 (#366) main measured 1,015 to 1,019 KB from run to
  // run here, and #364's pivot took a CI run to 1,021.8: 1,024 KB, for the
  // runs' spread.  The camera control (#361 step 2) adds about 2.5 KB
  // (1,021.5 here): 1,028.  The Sun's activity view (#358) adds the 5 KB
  // its first load does gzipped (above: its branches of two shaders and
  // of the event model; a CI run took 1,029.6): 1,033.  Its CMEs' chunk
  // isn't in this: it is fetched only where a CME can show, which the
  // homepage isn't (when it was, at first, it was the 29th request here).
  // #375's physical air (the ozone in the tables), the camera's glare
  // function and the backtick key's hooks took a CI run to 1,034.4: 1,036,
  // for the runs' spread.
  // #377's month blend (two map slots in the planet shader, about 3 KB
  // minified) with #378's sprite caps took a CI run to 1,039.0: 1,041.
  ready: {requests: 28, kb: 1041},
  // After #259: 39 requests, 3,918 KB.  Raised from #258's 29 requests:
  // the catalogue's faint tiers are 12 packs where stars.dat was one file,
  // by design (a deep link needs only its field's; DESIGN.md "The star
  // catalogue's tiers"), all after the reveal.  After #258: 26, 3,948 KB
  // (the ephemeris chunk is 1,334 KB).  Before it: 82, 4,193 KB.
  settled: {requests: 43, kb: 4310},
}
