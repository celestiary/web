/**
 * The passes of a frame, as `perf.begin(name)` / `perf.end(name)` name them,
 * in the order the overlay lists them.  A name that isn't here (a pass a
 * later change adds and doesn't register) is still timed and listed, after
 * these, in the order it first runs.  Dots are only naming: a pass is timed
 * without the ones inside it (sections.js), so the dotted children of
 * `cesium` are not part of `cesium`'s line.  DESIGN.md, "Perf overlay".
 *
 * @type {Array<{name: string, what: string}>}
 */
export const PASSES = [
  {name: 'update', what: `the animation callback, camera and navigation: the frame before any rendering`},
  {name: 'scene', what: `renderer.render(scene) into the scene buffer: bodies, stars, the Sun, the galaxy's composite`},
  {name: 'galaxy', what: `the Milky Way's march into its cached target, only when the view has changed`},
  {name: 'galaxies', what: `SPARC's galaxies (Galaxies.md): their levels of detail, map bakes, impostor and near marches`},
  {name: 'cesium', what: `the Cesium composite's own work: clears, the fading celestiary surface, the JS between steps`},
  {name: 'cesium.blit', what: `the copy of the scene's depth into Cesium's target, per body`},
  {name: 'cesium.shell', what: `the stencil shell: where the body shows, depth-tested against the scene's`},
  {name: 'cesium.replay', what: `Cesium's frame replayed on this context by portal-netgl: its draws, post-process, queued uploads`},
  {name: 'cesium.decode', what: `the full-screen decode of Cesium's 8-bit frame into the scene buffer's units`},
  {name: 'cesium.nightlights', what: `Earth's second Cesium frame (lights only, unlit) and its full-screen decode`},
  {name: 'cesium.ground', what: `each Cesium body's ground-sphere depth, for the atmosphere pass`},
  {name: 'clouds', what: `Earth's cloud shell`},
  {name: 'atmosphere', what: `the full-screen pass to the screen: sky, the scene through its transmittance, the one tone map`},
  {name: 'meter', what: `the exposure meter: the pass into 32x32 every few frames, read back through a pixel-pack ` +
    `buffer and taken a frame or more later (pboReads); a synchronous readPixels (readbacks) only with ?meter=sync, ` +
    `?hdr=0 or no WebGL2 sync objects, where its CPU time is the GPU stall`},
  {name: 'overlay', what: `labels, orbit lines, grids and the pick marker, over the tone-mapped frame`},
  {name: 'other', what: `GL work outside any pass above (and, in CPU time, the JS between them)`},
]


/**
 * @param {string} name A pass
 * @returns {string} What it covers ('' for one not registered)
 */
export function describePass(name) {
  return PASSES.find((p) => p.name === name)?.what ?? ''
}


/**
 * @param {Array<string>|Set<string>} names The names seen
 * @returns {Array<string>} The registered ones in their order, then the others in the order seen
 */
export function orderedPasses(names) {
  const seen = new Set(names)
  const known = PASSES.map((p) => p.name).filter((n) => seen.has(n))
  const rest = Array.from(seen).filter((n) => !PASSES.some((p) => p.name === n))
  return [...known, ...rest]
}
