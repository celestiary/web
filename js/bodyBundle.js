/**
 * The scene's body descriptors in one file (#258; DESIGN.md "Data loading"):
 * `public/data/bodies.json`, built from `public/data/<name>.json` by `yarn
 * bodies` (tools/bodies/build.mjs).  The Loader takes a body from it when
 * it's there, so the first load fetches one file rather than thirty, and
 * fetches the body's own file when it isn't (the guide's demo descriptors,
 * `earth-as-moon`) or when the bundle can't be had.
 */


/** A small file under public/data, so a plain relative URL (DESIGN.md "Data policy"). */
export const BODIES_URL = 'data/bodies.json'

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
