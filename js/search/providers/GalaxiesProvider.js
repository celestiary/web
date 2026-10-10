/** @typedef {import('../SearchProvider.js').SearchEntry} SearchEntry */


/**
 * SPARC's galaxies (Galaxies.js; js/scene/Galaxies.md), by their names: the
 * one people write ('NGC 2403'), SPARC's ('NGC2403'), NED's, SIMBAD's and
 * RC3's ('WLM' for UGCA 444, 'M 63' for NGC 5055).  They're under the
 * root's path, so the default scope finds them; a scope under the Sun
 * doesn't.
 */
export default class GalaxiesProvider {
  /**
   * @param {object} galaxies Galaxies (js/scene/Galaxies.js), loaded
   */
  constructor(galaxies) {
    this.id = 'galaxies'
    this.lazy = false
    this.galaxies = galaxies
  }


  /** @returns {SearchEntry[]} */
  collectAll() {
    return this.galaxies.records.map((galaxy) => ({
      id: `galaxy:${galaxy.id}`,
      displayName: galaxy.name,
      aliases: galaxy.aliases,
      kind: 'galaxy',
      path: `milkyway/galaxy:${galaxy.id}`,
      parent: 'milkyway',
      payload: {galaxy},
    }))
  }
}
