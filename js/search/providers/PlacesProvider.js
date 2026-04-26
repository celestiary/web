import {fetchPlaces} from '../../scene/Places.js'


/** @typedef {import('../SearchProvider.js').SearchEntry} SearchEntry */


/**
 * Surface places (cities, craters, landing sites…) on bodies with
 * `has_locations: true`.  Lazy: places can reach millions of entries for
 * Earth alone, so they're only fetched per-body when the user anchors the
 * search at the relevant body.
 *
 * collectUnder is async because the catalog may not be cached yet — the
 * SearchIndex caller awaits it once per (body) lifetime and then re-uses
 * the cached entries.
 */
export default class PlacesProvider {
  constructor() {
    this.id = 'places'
    this.lazy = true
    this._cache = new Map() // bodyName → SearchEntry[]
    this._loading = new Map() // bodyName → in-flight Promise
  }


  /**
   * Lazy load the catalog for a single body and convert to SearchEntries.
   *
   * @param {string} bodyName
   * @returns {Promise<SearchEntry[]>}
   */
  _loadBody(bodyName) {
    if (this._cache.has(bodyName)) {
      return Promise.resolve(this._cache.get(bodyName))
    }
    if (this._loading.has(bodyName)) {
      return this._loading.get(bodyName)
    }
    const p = fetchPlaces(bodyName).then((rawEntries) => {
      const out = rawEntries.map((e) => ({
        id: `loc:${bodyName}:${slug(e.n)}`,
        displayName: e.n,
        aliases: e.k ? [e.k] : [],
        kind: 'place',
        // Build path under the body's anchor; SearchIndex.inScope wants the
        // full path.  We don't know the parent chain here, so return the
        // body-relative tail and let collectUnder prefix the anchorPath.
        path: '',
        parent: bodyName,
        payload: {body: bodyName, lat: e.lat, lng: e.lng, alt: e.a ?? 0},
      }))
      this._cache.set(bodyName, out)
      this._loading.delete(bodyName)
      return out
    })
    this._loading.set(bodyName, p)
    return p
  }


  /**
   * Return all place entries for the body at the tail of `anchorPath`.
   * Empty for `'milkyway'` (places are always body-scoped).
   *
   * @param {string} anchorPath e.g. 'milkyway/sun/earth'
   * @returns {Promise<SearchEntry[]>}
   */
  async collectUnder(anchorPath) {
    if (!anchorPath || anchorPath === 'milkyway') {
      return []
    }
    const bodyName = anchorPath.split('/').pop()
    const entries = await this._loadBody(bodyName)
    // Stamp the full path now that we know the anchor.  Cached entries are
    // body-keyed, so the same body under a different anchor (rare — e.g.
    // alt scene tree) gets the right path.
    return entries.map((e) => ({...e, path: `${anchorPath}/${slug(e.displayName)}`}))
  }


  /** Force-clear the cache.  For tests. */
  invalidate() {
    this._cache.clear()
    this._loading.clear()
  }
}


/**
 * Slug a place name for use in ids and paths.
 *
 * @param {string} s
 * @returns {string}
 */
function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}
