import BODY_DIRS from './bodyDirs.json'


/**
 * The scene's body descriptors in one file (#258; DESIGN.md "Data loading"):
 * `public/data/bodies.json`, built from each body's
 * `public/data/<dir>/index.json` by `yarn bodies` (tools/bodies/build.mjs).
 * The Loader takes a body from it when it's there, so the first load fetches
 * one file rather than thirty, and fetches the body's own file when it isn't
 * (the guide's demo descriptors, `earth-as-moon`, in `data/demos/`) or when
 * the bundle can't be had.
 */


/** A small file under public/data, so a plain relative URL (DESIGN.md "Data policy"). */
export const BODIES_URL = 'data/bodies.json'


/**
 * @param {string} name a body's
 * @returns {?string} its directory under data/ (DESIGN.md "Data policy", by
 *   body: 'earth', 'earth/moons/moon'), from js/bodyDirs.json, which `yarn
 *   bodies` writes; null for a body that has none (a demo descriptor)
 */
export function bodyDir(name) {
  return Object.hasOwn(BODY_DIRS, name) ? BODY_DIRS[name] : null
}


/**
 * @param {string} name
 * @returns {string} its descriptor's URL: `data/<dir>/index.json`, or a
 *   demo's, `data/demos/<name>.json`
 */
export function descriptorUrl(name) {
  const dir = bodyDir(name)
  return dir ? `data/${dir}/index.json` : `data/demos/${name}.json`
}


/**
 * @param {string} name
 * @returns {string} its place catalogue's URL, `data/<dir>/places.json`
 */
export function placesUrl(name) {
  return `data/${bodyDir(name) ?? name}/places.json`
}

let shared = null


/**
 * The bundle's descriptors by name, fetched once for the page: every
 * Loader and every concurrent ask shares the one request.  A failure (no
 * response, not ok, not the bundle's shape) resolves to null, once, with a
 * warning, and the Loaders fetch each body's own file instead.
 *
 * @param {Function} [fetchFn] fetch, or like it
 * @param {string} [url]
 * @returns {Promise<?object>} Name to descriptor, or null
 */
export function loadBodyBundle(fetchFn = (...args) => globalThis.fetch(...args), url = BODIES_URL) {
  shared ??= fetchBundle(fetchFn, url)
  return shared
}


/**
 * @param {Function} fetchFn
 * @param {string} url
 * @returns {Promise<?object>}
 */
async function fetchBundle(fetchFn, url) {
  try {
    const rsp = await fetchFn(url)
    if (!rsp?.ok) {
      throw new Error(`${rsp?.status ?? 'no response'}`)
    }
    const bodies = (await rsp.json())?.bodies
    if (!bodies || typeof bodies !== 'object') {
      throw new Error('no bodies in it')
    }
    return bodies
  } catch (e) {
    console.warn(`Loader: the bodies' bundle didn't load (${e.message}); fetching each body's file`)
    return null
  }
}


/** Forget the bundle, so the next ask fetches it again.  For tests. */
export function _resetBodyBundle() {
  shared = null
}
