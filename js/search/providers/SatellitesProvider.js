import {aliasesOf, displayName, satelliteTarget} from '../../scene/satellites/names.js'


/** @typedef {import('../SearchProvider.js').SearchEntry} SearchEntry */


/**
 * Earth's satellites (js/scene/satellites/Satellites.md), by the names
 * people know them by ('ISS'), CelesTrak's ('ISS (ZARYA)'), their NORAD
 * number and their international designator.  Under Earth's path, so a
 * scope at Earth finds them.
 */
export default class SatellitesProvider {
  /**
   * @param {object} satellites Satellites (js/scene/satellites/Satellites.js), loaded
   */
  constructor(satellites) {
    this.id = 'satellites'
    this.lazy = false
    this.satellites = satellites
  }


  /** @returns {SearchEntry[]} */
  collectAll() {
    return this.satellites.records.map((rec) => ({
      id: `sat:${rec.id}`,
      displayName: displayName(rec),
      aliases: aliasesOf(rec),
      kind: 'satellite',
      path: `milkyway/sun/earth/sat:${rec.id}`,
      parent: 'earth',
      payload: {target: satelliteTarget(rec), group: rec.group},
    }))
  }
}
