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
 * - Tier C: per-anchor Fuse cache populated from `lazy` providers' output
 *   when a scoped query arrives.  Reserved for the future PlacesProvider.
 */
export default class SearchIndex {
  constructor() {
    this._ready = false
    this._building = null
    this._allEntries = []
    this._fuseA = null
    this._tierCCache = new Map()
    this._hipResolver = null
  }


  /** @param {object} provider */
  register(provider) {
    SearchRegistry.register(provider)
    if (provider.id === 'stars' && typeof provider.resolveHip === 'function') {
      this._hipResolver = (hipId) => provider.resolveHip(hipId)
    }
    this._ready = false
  }


  /**
   * Build Tier A once.  Safe to call repeatedly.
   *
   * @returns {Promise<void>}
   */
  async ensureReady() {
    if (this._ready) {
      return
    }
    if (this._building) {
      await this._building
      return
    }
    this._building = this._build()
    try {
      await this._building
    } finally {
      this._building = null
    }
  }


  /** @returns {Promise<void>} */
  async _build() {
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
    this._ready = true
  }


  /**
   * @param {string} text
   * @param {string} anchorPath
   * @param {number} [limit]
   * @returns {object[]} array of {entry, score}
   */
  query(text, anchorPath = 'milkyway', limit = 20) {
    if (!this._ready) {
      return []
    }
    const trimmed = (text || '').trim()
    if (trimmed.length === 0) {
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
    // Tier C: per-anchor lazy provider entries (e.g. PlacesProvider).
    // Caller seeds the cache via populateTierC; we just merge the matches
    // here in score order alongside Tier A hits.
    const tierC = this._tierCCache.get(anchorPath)
    if (tierC && filtered.length < limit) {
      const cResults = tierC.search(trimmed, {limit: limit * 4})
      for (const r of cResults) {
        if (seenIds.has(r.item.id)) {
          continue
        }
        filtered.push({entry: r.item, score: r.score ?? 0})
        if (filtered.length >= limit) {
          break
        }
      }
      // Re-sort so Tier C entries interleave by score with Tier A results.
      filtered.sort((a, b) => a.score - b.score)
    }
    return filtered
  }


  /**
   * Build a Tier C Fuse for `anchorPath` from a precomputed entry list.
   * Caller (typically Celestiary, via PlacesProvider.collectUnder) is
   * responsible for the await; this method is sync so query() can stay sync.
   *
   * @param {string} anchorPath
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
    if (!this._ready || !name) {
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


  /** Force full rebuild on next `ensureReady()`.  Used by tests or refreshes. */
  invalidate() {
    this._ready = false
    this._allEntries = []
    this._fuseA = null
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
