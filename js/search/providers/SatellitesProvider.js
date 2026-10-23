import {aliasesOf} from '../../scene/satellites/names.js'
import {satellitePath} from '../../targetPath.js'


/** @typedef {import('../SearchProvider.js').SearchEntry} SearchEntry */


/**
 * A population's objects (js/scene/population/Population.md), Earth's
 * satellites first among them (js/scene/satellites/Satellites.md): by the
 * names people know them by ('ISS'), the catalogue's ('ISS (ZARYA)'), their
 * number and their international designator.  Under their body's path, so
 * a scope at the body finds them.
 */
export default class SatellitesProvider {
  /**
   * @param {object} population a Population, loaded
   * @param {Function} [bodyPath] a body's name → its path ('milkyway/sun/earth')
   */
  constructor(population, bodyPath = (name) => `milkyway/sun/${name}`) {
    this.id = `population:${population.body}`
    this.lazy = false
    this.population = population
    this.bodyPath = bodyPath
  }


  /** @returns {SearchEntry[]} */
  collectAll() {
    const pop = this.population
    const base = this.bodyPath(pop.body)
    return pop.records.map((rec) => {
      const target = pop.targetOf(rec)
      const id = satellitePath(target)
      return {
        id,
        displayName: target.name,
        aliases: aliasesOf(rec),
        kind: 'satellite',
        path: `${base}/${id}`,
        parent: pop.body,
        payload: {target, group: rec.group},
      }
    })
  }
}
