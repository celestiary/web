/**
 * The `?perf=1` overlay's switches: each turns one pass off, so its cost can
 * be bisected by frame rate where GPU timers are missing.  A pass skipped
 * must leave the rest rendering, and a look different from the full
 * pipeline's is expected (DESIGN.md, "Perf overlay").
 *
 * `kind` is how a pass is switched off:
 * - `skip`: the pass's own `if (perf.begin(name))` doesn't run it.
 * - `gate`: the pass runs but is told to do no work (`perf.gate`): the
 *   atmosphere pass is also the frame's only trip to the screen and its one
 *   tone map, so it can't be skipped, only have its sky switched off.
 * - `hide`: the pass is an object in the scene, hidden while it is off.
 */


/**
 * One per switchable pass.  `key` is what `?off=` takes; `pass` the section
 * name the pass is timed under.
 *
 * @type {Array<{key: string, pass: string, kind: string, label: string, what: string}>}
 */
export const TOGGLES = [
  {key: 'atmosphere', pass: 'atmosphere', kind: 'gate', label: 'atmosphere',
    what: 'the sky: its rays and tables; the pass still tone-maps the scene to the screen'},
  {key: 'clouds', pass: 'clouds', kind: 'skip', label: 'clouds', what: `Earth's cloud shell`},
  {key: 'nightlights', pass: 'cesium.nightlights', kind: 'skip', label: 'night lights',
    what: `Cesium Earth's second, unlit frame and its decode`},
  {key: 'galaxy', pass: 'galaxy', kind: 'hide', label: 'galaxy',
    what: 'the Milky Way: its march and its composite'},
  {key: 'cesium', pass: 'cesium', kind: 'skip', label: 'Cesium layer',
    what: `Cesium's layers: celestiary's own bodies draw instead`},
  {key: 'meter', pass: 'meter', kind: 'skip', label: 'meter readback',
    what: `the exposure meter's pass and readPixels (the exposure stops adapting)`},
  {key: 'overlay', pass: 'overlay', kind: 'skip', label: 'overlay pass', what: 'labels, orbit lines, grids'},
]


/**
 * @param {string} search A URL's query string
 * @returns {{enabled: boolean, off: Set<string>}} Whether `perf=1` is there,
 *   and the toggle keys `off=` lists (comma-separated, e.g.
 *   `?perf=1&off=atmosphere,clouds`); an unknown key is ignored
 */
export function parsePerfParams(search) {
  const params = new URLSearchParams(search ?? '')
  const enabled = params.get('perf') === '1'
  const known = new Set(TOGGLES.map((t) => t.key))
  const off = new Set()
  for (const raw of (params.get('off') ?? '').split(',')) {
    const key = raw.trim()
    if (known.has(key)) {
      off.add(key)
    }
  }
  return {enabled, off}
}


/**
 * @param {Array<string>|Set<string>} keys Toggle keys that are off
 * @param {string} kind
 * @returns {Set<string>} The pass names switched off that way
 */
export function passesOff(keys, kind) {
  const off = new Set(keys)
  return new Set(TOGGLES.filter((t) => t.kind === kind && off.has(t.key)).map((t) => t.pass))
}
