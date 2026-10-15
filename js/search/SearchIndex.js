import Fuse from 'fuse.js'
import * as SearchRegistry from './SearchRegistry.js'


const FUSE_OPTS = {
  includeScore: true,
  ignoreLocation: true,
  threshold: 0.35,
  minMatchCharLength: 2,
  keys: [
    {name: 'displayName', weight: 0.7},
    {name: 'aliases', weight: 0.3},
  ],
}


const HIP_RE = /^(?:HIP\s*)?(\d+)$/i


/**
 * Tiered search index.
 *
 * - Tier A: single Fuse over all non-lazy providers' `collectAll()` output
 *   (~8k entries today — planets, moons, galaxy nodes, named stars).  Built
 *   once on first `ensureReady()`.
 * - Tier B: exact-match for HIP/numeric input, bypasses Fuse and is served
 *   directly by a star-exact-lookup delegate (`StarsProvider.resolveHip`).
 * - Tier C: one Fuse per body, keyed by the body's rooted path, from the
 *   `lazy` providers' output (the places on a body).  A query searches the
 *   Fuses of every body in its scope, so a place resolves from any scope
 *   that includes its body: the body's, the solar system's, the root's.
 *   `ensureScope` loads them.
 */

// A place found from a scope wider than its body ranks below the bodies and
// stars that match as well: Fuse scores run 0 (exact) to 1, and a match
// worth listing is under FUSE_OPTS.threshold.
const PLACE_WIDER_SCOPE_PENALTY = 0.1

export default class SearchIndex {
  constructor() {
    this._ready = false
    this._building = null
    this._allEntries = []
    this._fuseA = null
    this._tierCCache = new Map()
    this._hipResolver = null
    // Bumped by whatever makes Tier A stale (a provider registered, the
    // index invalidated, a body loaded): a build of an older generation
    // doesn't count as ready.
    this._generation = 0
    // Bumped when a build lands, for listeners (onChange).
    this.version = 0
    this._listeners = new Set()
    // What to load the first time something is searched for (loadOnSearch).
    this._onSearch = []
  }


  /**
   * Something to load the first time anything is searched for, not before
   * (#258): a catalogue that registers its provider when it arrives (the
   * galaxies).  Started by the first query with text in it, or by
   * `ensureSearchable`, at once if one already came; a load that fails is
   * started again by the next.
   *
   * @param {function(): Promise<any>} load
   */
  loadOnSearch(load) {
    const source = {load, promise: null}
    this._onSearch.push(source)
    if (this._searched) {
      this._startLoads()
    }
  }


  /**
   * Start what loadOnSearch holds, each once (again after a failure).
   *
   * @returns {Promise<void>} When they've all loaded or failed
   */
  async _startLoads() {
    this._searched = true
    await Promise.all(this._onSearch.map((source) => {
      // Built again once it's in (its provider registered: stale), so a
      // query already asked is answered again (onChange).
      source.promise ??= Promise.resolve().then(source.load).then(() => this.ensureReady()).catch((e) => {
        source.promise = null
        console.warn('Search: loading a catalogue failed:', e?.message ?? e)
      })
      return source.promise
    }))
  }


  /**
   * Everything a query in this scope could find, in: what loadOnSearch
   * holds, Tier A, and the places in scope.  For a query answered once
   * (the homepage's Enter before its list is up).
   *
   * @param {string} [anchorPath]
   * @returns {Promise<void>}
   */
  async ensureSearchable(anchorPath = 'milkyway') {
    await this._startLoads()
    await this.ensureReady()
    await this.ensureScope(anchorPath)
  }


  /** @returns {boolean} Tier A is built from every provider as it is now */
  get ready() {
    return this._ready
  }


  /** @param {object} provider */
  register(provider) {
    SearchRegistry.register(provider)
    if (provider.id === 'stars' && typeof provider.resolveHip === 'function') {
      this._hipResolver = (hipId) => provider.resolveHip(hipId)
    }
    this.markStale()
  }


  /**
   * Tier A no longer holds everything (a provider's data grew: a body
   * loaded).  It is rebuilt on the next query or ensureReady; until then
   * queries answer from the last build, not from nothing.
   */
  markStale() {
    this._generation++
    this._ready = false
  }


  /**
   * @param {Function} fn Called when a build lands, so a query made while
   *   the index was stale can be asked again (SearchBar)
   * @returns {Function} Stops listening
   */
  onChange(fn) {
    this._listeners.add(fn)
    return () => this._listeners.delete(fn)
  }


  /**
   * Build Tier A, again if it went stale while building.  Safe to call
   * repeatedly.
   *
   * @returns {Promise<void>}
   */
  async ensureReady() {
    while (!this._ready) {
      if (!this._building) {
        this._building = this._build().finally(() => {
          this._building = null
        })
      }
      await this._building
    }
  }


  /** @returns {Promise<void>} */
  async _build() {
    const generation = this._generation
    const providers = SearchRegistry.list()
    const entries = []
    for (const p of providers) {
      if (p.lazy) {
        continue
      }
      if (typeof p.preload === 'function') {
        await p.preload()
      }
      if (typeof p.collectAll === 'function') {
        for (const e of await p.collectAll()) {
          entries.push(e)
        }
      }
    }
    dedupeById(entries)
    this._allEntries = entries
    this._fuseA = new Fuse(entries, FUSE_OPTS)
    this._ready = generation === this._generation
    this.version++
    this._listeners.forEach((fn) => fn(this.version))
  }


  /**
   * @param {string} text
   * @param {string} anchorPath
   * @param {number} [limit]
   * @returns {object[]} array of {entry, score}
   */
  query(text, anchorPath = 'milkyway', limit = 20) {
    if (!this._ready) {
      // Stale or never built: build, and answer from the last build
      // meanwhile.  onChange says when to ask again.
      this.ensureReady().catch((e) => console.warn('Search: building the index failed:', e))
    }
    const trimmed = (text || '').trim()
    if (trimmed.length > 0) {
      // What's loaded on a search (loadOnSearch); onChange says when its
      // providers are in.
      this._startLoads()
    }
    if (!this._fuseA || trimmed.length === 0) {
      return []
    }

    const hipMatch = trimmed.match(HIP_RE)
    if (hipMatch && this._hipResolver) {
      const hipId = parseInt(hipMatch[1], 10)
      const entry = this._hipResolver(hipId)
      if (entry && inScope(entry.path, anchorPath)) {
        return [{entry, score: 0}]
      }
      return []
    }

    const results = this._fuseA.search(trimmed, {limit: limit * 4})
    const filtered = []
    const seenIds = new Set()
    for (const r of results) {
      if (inScope(r.item.path, anchorPath)) {
        filtered.push({entry: r.item, score: r.score ?? 0})
        seenIds.add(r.item.id)
        if (filtered.length >= limit) {
          break
        }
      }
    }
    // Tier C: the places on every loaded body in scope (ensureScope loads
    // them), merged in score order with the Tier A hits.
    let placed = false
    for (const [bodyPath, fuse] of this._tierCCache) {
      if (!inScope(bodyPath, anchorPath)) {
        continue
      }
      const penalty = bodyPath === anchorPath ? 0 : PLACE_WIDER_SCOPE_PENALTY
      for (const r of fuse.search(trimmed, {limit: limit * 4})) {
        if (!seenIds.has(r.item.id)) {
          filtered.push({entry: r.item, score: (r.score ?? 0) + penalty})
          placed = true
        }
      }
    }
    if (placed) {
      // Stable, so a tie keeps the Tier A hit first.
      filtered.sort((a, b) => a.score - b.score)
    }
    return filtered.slice(0, limit)
  }


  /**
   * Load what a scoped query needs from the lazy providers: the places of
   * every body inside `anchorPath` that has a catalogue, once each.  Call it
   * when the scope changes and query again when it resolves with a count.
   *
   * @param {string} [anchorPath]
   * @returns {Promise<number>} How many bodies' places were loaded just now
   */
  async ensureScope(anchorPath = 'milkyway') {
    await this.ensureReady()
    let loaded = 0
    for (const p of SearchRegistry.list()) {
      if (!p.lazy || typeof p.bodiesUnder !== 'function' || typeof p.collectUnder !== 'function') {
        continue
      }
      for (const bodyPath of p.bodiesUnder(anchorPath)) {
        if (this._tierCCache.has(bodyPath)) {
          continue
        }
        const entries = await p.collectUnder(bodyPath)
        if (entries.length > 0) {
          this.populateTierC(bodyPath, entries)
          loaded++
        }
      }
    }
    return loaded
  }


  /**
   * Build a Tier C Fuse for the body at `anchorPath` from a precomputed
   * entry list (ensureScope does this, via PlacesProvider.collectUnder).
   * Sync, so query() can stay sync.
   *
   * @param {string} anchorPath The body's rooted path, e.g. 'milkyway/sun/earth'
   * @param {Array} entries SearchEntry[]
   */
  populateTierC(anchorPath, entries) {
    if (!anchorPath || !Array.isArray(entries) || entries.length === 0) {
      return
    }
    this._tierCCache.set(anchorPath, new Fuse(entries, FUSE_OPTS))
  }


  /**
   * Resolve a raw name string (e.g. from crosshair hover) to its entry.
   * Returns the first in-scope match, or null.
   *
   * @param {string} name
   * @param {string} anchorPath
   * @returns {object|null}
   */
  resolveByName(name, anchorPath = 'milkyway') {
    if (!this._fuseA || !name) {
      return null
    }
    const hipMatch = String(name).trim().match(HIP_RE)
    if (hipMatch && this._hipResolver) {
      const entry = this._hipResolver(parseInt(hipMatch[1], 10))
      if (entry && inScope(entry.path, anchorPath)) {
        return entry
      }
    }
    const lower = String(name).toLowerCase()
    for (const e of this._allEntries) {
      if (!inScope(e.path, anchorPath)) {
        continue
      }
      if (e.displayName.toLowerCase() === lower) {
        return e
      }
      for (const a of e.aliases) {
        if (a.toLowerCase() === lower) {
          return e
        }
      }
    }
    return null
  }


  /**
   * Rebuild Tier A on the next query or `ensureReady()`, and the places
   * as they're asked for (a provider's catalogue arrived: the stars, the
   * galaxies).  Queries answer from the last build until then.
   */
  invalidate() {
    this.markStale()
    this._tierCCache.clear()
  }
}


/**
 * @param {string} entryPath
 * @param {string} anchorPath
 * @returns {boolean}
 */
export function inScope(entryPath, anchorPath) {
  if (!anchorPath || anchorPath === 'milkyway') {
    return true
  }
  return entryPath === anchorPath || entryPath.startsWith(`${anchorPath}/`)
}


/** @param {object[]} entries */
function dedupeById(entries) {
  const seen = new Set()
  for (let i = entries.length - 1; i >= 0; i--) {
    const id = entries[i].id
    if (seen.has(id)) {
      entries.splice(i, 1)
    } else {
      seen.add(id)
    }
  }
}


/** App-wide singleton.  Celestiary registers providers here; UI queries it. */
export const searchIndex = new SearchIndex()
