/** @typedef {import('../SearchProvider.js').SearchEntry} SearchEntry */


/**
 * Stub for future surface-place search (cities, craters, regions on planets
 * with `has_locations`).  Lazy by design: places can reach millions of entries
 * for Earth alone, so they're only materialized when the user anchors the
 * search at the relevant body.
 */
export default class PlacesProvider {
  constructor() {
    this.id = 'places'
    this.lazy = true
  }


  /**
   * @param {string} anchorPath
   * @returns {SearchEntry[]}
   */
  collectUnder(anchorPath) {
    return []
  }
}
