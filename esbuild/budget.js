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
// measurement on main (the day #262 landed, 2026-10-15) rounded up with
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
  totalMinifiedKB: 2350,
  // The same, gzipped (what crosses the wire).  Main: 661 KB.
  totalGzipKB: 730,
  // The largest single first-load file, minified.  Main: 695 KB.
  largestChunkMinifiedKB: 765,
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
  // Main on 2026-10-15: 81 requests, 2,859 KB (stars.dat is 1,848 KB of it).
  ready: {requests: 90, kb: 3150},
  // Main: 82 requests, 4,193 KB (the ephemeris chunk is 1,334 KB).
  settled: {requests: 92, kb: 4620},
}
