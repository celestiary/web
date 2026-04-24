/** @typedef {import('../SearchProvider.js').SearchEntry} SearchEntry */


/**
 * Provides SearchEntries for every named star in the StarsCatalog.  The
 * ~120k unnamed HIP stars are NOT fuzzy-indexed (would make as-you-type
 * unusable); they are reachable only via exact numeric/`HIP N` input,
 * served by `resolveHip()`.
 *
 * Skips hipId=0 (Sun) because the Sun is already contributed by the
 * SceneProvider as a first-class planet-level body.
 */
export default class StarsProvider {
  /**
   * @param {object} catalog StarsCatalog
   */
  constructor(catalog) {
    this.id = 'stars'
    this.lazy = false
    this.catalog = catalog
  }


  /** @returns {SearchEntry[]} */
  collectAll() {
    const out = []
    const namesByHip = this.catalog.namesByHip
    namesByHip.forEach((names, hipId) => {
      if (hipId === 0 || !names || names.length === 0) {
        return
      }
      const star = this.catalog.starByHip.get(hipId)
      if (!star) {
        return
      }
      const displayName = names[0]
      const aliases = names.slice(1)
      aliases.push(`HIP ${hipId}`, String(hipId))
      out.push({
        id: `hip:${hipId}`,
        displayName,
        aliases,
        kind: 'star',
        path: `milkyway/hip:${hipId}`,
        parent: 'milkyway',
        payload: {hipId, star},
      })
    })
    return out
  }


  /**
   * Exact-match resolver for numeric/`HIP N` input.  Named and unnamed
   * stars alike are reachable this way.
   *
   * @param {number} hipId
   * @returns {SearchEntry|null}
   */
  resolveHip(hipId) {
    if (hipId === 0) {
      return null
    }
    const star = this.catalog.starByHip.get(hipId)
    if (!star) {
      return null
    }
    const names = this.catalog.namesByHip.get(hipId) || []
    const displayName = names.length > 0 ? names[0] : `HIP ${hipId}`
    const aliases = names.slice(1)
    aliases.push(`HIP ${hipId}`, String(hipId))
    return {
      id: `hip:${hipId}`,
      displayName,
      aliases,
      kind: 'star',
      path: `milkyway/hip:${hipId}`,
      parent: 'milkyway',
      payload: {hipId, star},
    }
  }
}
