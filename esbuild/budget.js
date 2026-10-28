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
  // optics switch and field readout, 3 KB minified).
  totalMinifiedKB: 2353,
  // The same, gzipped (what crosses the wire).  Main: 661 KB; 729 KB on
  // 2026-10-27, when the Rubin app's panel (ui/RubinApp.jsx, with its icon
  // and token codec) took it to 731.  Loading the panel lazily cost more,
  // 735 and three scripts, in the shared chunks the split made.  733 on
  // 2026-10-28: the seat the camera rides (Scene.rideSeat, its near plane
  // in ThreeUI) and the panel's seat button and shell switch; 734 the same
  // day for the search's views (ViewsProvider, store/appViews.js) and the
  // bar's places reload.  735 the same day for an instrument's field (#337:
  // 1.1 KB gzipped, from 733.3 to 734.4; the clamp has to be in ThreeUI and
  // the switch and readout in the panel, both first load).
  totalGzipKB: 735,
  // The largest single first-load file, minified.  Main: 695 KB.
  largestChunkMinifiedKB: 765,
}

/**
 * Layer mode's page (layer.html, js/layer/layer.js; design/LayerMode.md):
 * its entry and what it imports statically, measured as the first load is,
 * from its own build (common.js layerConfig).  2026-10-24, built on its own:
 * 591 KB minified, 164 KB gzipped, nearly all one file (three tree-shaken
 * with the rest); the snapshots load after.  Lowered from 910 / 260 / 765,
 * set when it was a second entry of the app's build and shared its chunks.
 */
export const LAYER_BUDGET = {
  entries: ['js/layer/layer.js'],
  totalMinifiedKB: 650,
  totalGzipKB: 180,
  largestChunkMinifiedKB: 650,
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
  ready: {requests: 28, kb: 1020},
  // After #259: 39 requests, 3,918 KB.  Raised from #258's 29 requests:
  // the catalogue's faint tiers are 12 packs where stars.dat was one file,
  // by design (a deep link needs only its field's; DESIGN.md "The star
  // catalogue's tiers"), all after the reveal.  After #258: 26, 3,948 KB
  // (the ephemeris chunk is 1,334 KB).  Before it: 82, 4,193 KB.
  settled: {requests: 43, kb: 4310},
}
