/**
 * Every body's places for the search, in one file (#258; DESIGN.md "Search",
 * "Places in the index"): `public/data/places-index.json`, built from the
 * catalogues by `yarn places-index` (tools/places/index.mjs).  A place is
 * `[name, lat, lng, kind, altitude?]`, its kind an index into `kinds`: what
 * the search shows, matches and lands on, without the tiers the labels
 * need.  Fetched on the first search, once.
 */


/** A small file under public/data, so a plain relative URL (DESIGN.md "Data policy"). */
export const PLACES_INDEX_URL = 'data/places-index.json'

let shared = null


/**
 * The index, fetched once for the page; concurrent asks share the request.
 * A failure rejects, and the next ask fetches it again.
 *
 * @param {Function} [fetchFn] fetch, or like it
 * @param {string} [url]
 * @returns {Promise<Map<string, Array<{n: string, lat: number, lng: number, a?: number, k?: string}>>>}
 *   A body's name to its places, as its catalogue has them (less the tier)
 */
export function loadPlacesIndex(fetchFn = (...args) => globalThis.fetch(...args), url = PLACES_INDEX_URL) {
  if (!shared) {
    const p = (async () => {
      const rsp = await fetchFn(url)
      if (!rsp?.ok) {
        throw new Error(`places index: ${rsp?.status ?? 'no response'}`)
      }
      return parsePlacesIndex(await rsp.json())
    })()
    shared = p
    p.catch(() => {
      if (shared === p) {
        shared = null
      }
    })
  }
  return shared
}


/**
 * @param {any} json places-index.json's
 * @returns {Map<string, Array<object>>} A body's name to its places
 */
export function parsePlacesIndex(json) {
  const kinds = Array.isArray(json?.kinds) ? json.kinds : ['']
  const bodies = json?.bodies && typeof json.bodies === 'object' ? json.bodies : null
  if (!bodies) {
    throw new Error('places index: no bodies in it')
  }
  const out = new Map()
  for (const [body, rows] of Object.entries(bodies)) {
    if (!Array.isArray(rows)) {
      continue
    }
    out.set(body, rows.filter((r) => Array.isArray(r) && typeof r[0] === 'string').map(([n, lat, lng, k, a]) => {
      const place = {n, lat, lng}
      if (a !== undefined) {
        place.a = a
      }
      if (kinds[k]) {
        place.k = kinds[k]
      }
      return place
    }))
  }
  return out
}


/** Forget the index, so the next ask fetches it again.  For tests. */
export function _resetPlacesIndex() {
  shared = null
}
