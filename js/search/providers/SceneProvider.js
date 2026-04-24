import {capitalize} from '../../utils.js'


/** @typedef {import('../SearchProvider.js').SearchEntry} SearchEntry */


const TYPE_TO_KIND = {
  galaxy: 'galaxy',
  star: 'star',
  planet: 'planet',
  moon: 'moon',
}


/**
 * Provides SearchEntries for every body tracked by the Loader (galaxy,
 * sun, planets, moons).  The SceneProvider reads the original JSON
 * descriptors from `loader.loaded`; each descriptor's optional `aliases`
 * array contributes extra search tokens ("luna" → Moon, etc).
 */
export default class SceneProvider {
  /**
   * @param {object} loader
   */
  constructor(loader) {
    this.id = 'scene'
    this.lazy = false
    this.loader = loader
  }


  /**
   * Ensure the full tree below 'milkyway' is loaded.  In typical usage
   * Celestiary has already expanded the tree at init; this is idempotent
   * coverage for edge cases (e.g. deep-linked entry to a leaf body).
   *
   * @returns {Promise<void>}
   */
  async preload() {
    // loadObj with expand=true recurses through every `system` child.
    // Already-loaded children are no-ops.  FileLoader has no promise API,
    // so we yield a microtask for any kickoffs to settle.  In the already-
    // loaded case this resolves immediately after the tick.
    this.loader.loadObj('', 'milkyway', null, true, null)
    await new Promise((resolve) => setTimeout(resolve, 0))
  }


  /** @returns {SearchEntry[]} */
  collectAll() {
    const out = []
    const loaded = this.loader.loaded
    for (const name of Object.keys(loaded)) {
      const obj = loaded[name]
      if (!obj || obj === 'pending' || typeof obj !== 'object') {
        continue
      }
      const kind = TYPE_TO_KIND[obj.type]
      if (!kind) {
        continue
      }
      const path = buildPath(name, loaded)
      if (!path) {
        continue
      }
      out.push({
        id: name,
        displayName: capitalize(obj.name || name),
        aliases: Array.isArray(obj.aliases) ? obj.aliases.slice() : [],
        kind,
        path,
        parent: obj.parent || null,
        payload: {name},
      })
    }
    return out
  }
}


/**
 * Walk parent chain up from `name` using the `parent` field on each descriptor.
 * Stops when the parent is not loaded (milkyway's parent 'universe' is not).
 *
 * @param {string} name
 * @param {object} loaded
 * @returns {string} '/'-joined rooted path, or '' if name not loaded.
 */
function buildPath(name, loaded) {
  const parts = []
  let cur = name
  const seen = new Set()
  while (cur && loaded[cur] && typeof loaded[cur] === 'object' && !seen.has(cur)) {
    parts.unshift(cur)
    seen.add(cur)
    cur = loaded[cur].parent
  }
  return parts.join('/')
}
