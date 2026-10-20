import {fetchPlaces} from '../../scene/Places.js'
import {slug} from '../../targetPath.js'
import {loadPlacesIndex} from '../placesIndex.js'
import {inScope} from '../SearchIndex.js'
import {buildPath} from './SceneProvider.js'


/** @typedef {import('../SearchProvider.js').SearchEntry} SearchEntry */


/**
 * Surface places (cities, craters, landing sites…) on bodies with
 * `has_locations: true`.  Lazy: they come from the places' index
 * (placesIndex.js, every body's in one file, #258), fetched the first time
 * a search asks for a body's (`SearchIndex.ensureScope`, which asks
 * `bodiesUnder` which those are, once something is typed).  Without the
 * index (it failed, or lacks the body) a body's own catalogue stands in.
 *
 * collectUnder is async because the places may not be in yet — the
 * SearchIndex caller awaits it once per (body) lifetime and then re-uses
 * the cached entries.
 */
export default class PlacesProvider {
  /**
   * @param {object} [loader] The Loader, for which bodies have places
   *   (`has_locations` in their descriptors) and where they are in the tree
   * @param {object} [opts]
   * @param {Function} [opts.loadIndex] Resolves to the index (loadPlacesIndex)
   * @param {Function} [opts.loadCatalogue] A body's name to a Promise of its
   *   catalogue's places, [] if none (fetchPlaces)
   */
  constructor(loader = null, {loadIndex = loadPlacesIndex, loadCatalogue = fetchPlaces} = {}) {
    this.id = 'places'
    this.lazy = true
    this.loader = loader
    this._loadIndex = loadIndex
    this._loadCatalogue = loadCatalogue
    this._cache = new Map() // bodyName → SearchEntry[]
    this._loading = new Map() // bodyName → in-flight Promise
  }


  /**
   * @param {string} bodyName
   * @returns {Promise<Array<object>>} The body's places from the index, else
   *   from its own catalogue
   */
  async _rawPlaces(bodyName) {
    let index = null
    try {
      index = await this._loadIndex()
    } catch (e) {
      console.warn(`Search: the places' index didn't load (${e?.message ?? e}); ${bodyName}'s own catalogue instead`)
    }
    return index?.get(bodyName) ?? this._loadCatalogue(bodyName)
  }


  /**
   * Lazy load the places of a single body and convert to SearchEntries.
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
    const p = this._rawPlaces(bodyName).then((rawEntries) => {
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
        // alt: undefined unless the catalog has one, so landing there is at
        // Scene.land's default (eye height), as a click on its label does.
        payload: {body: bodyName, lat: e.lat, lng: e.lng, alt: e.a ?? undefined},
      }))
      // None (the index and the catalogue both failed) isn't kept: the next
      // search asks again.
      if (out.length > 0) {
        this._cache.set(bodyName, out)
      }
      this._loading.delete(bodyName)
      return out
    })
    this._loading.set(bodyName, p)
    return p
  }


  /**
   * @param {string} anchorPath A search scope, e.g. 'milkyway' or 'milkyway/sun'
   * @returns {string[]} The rooted paths of the bodies with places inside it
   *   ('milkyway/sun/earth', ...), as far as the loader knows them; a scope
   *   that is a body, or inside one, has just that body, or none.  A place
   *   is searchable from every scope that includes its body, not only from
   *   the body's own.
   */
  bodiesUnder(anchorPath) {
    const loaded = this.loader?.loaded
    if (!loaded) {
      return []
    }
    const paths = []
    for (const name of Object.keys(loaded)) {
      const obj = loaded[name]
      if (!obj || typeof obj !== 'object' || !obj.has_locations) {
        continue
      }
      const path = buildPath(name, loaded)
      if (path && inScope(path, anchorPath)) {
        paths.push(path)
      }
    }
    return paths
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

