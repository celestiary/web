import {aliasesOf} from '../../scene/satellites/names.js'
import {satellitePath} from '../../targetPath.js'


/** @typedef {import('../SearchProvider.js').SearchEntry} SearchEntry */


// Scores of `search`'s matches, on Fuse's scale (0 exact, worse up to the
// threshold, 0.35): a name or alias that is the query, starts with it, has
// a word that does, or has it anywhere.
const EXACT = 0
const PREFIX = 0.05
const WORD = 0.1
const ANYWHERE = 0.2


/**
 * A population's objects (js/scene/population/Population.md), Earth's
 * satellites first among them (js/scene/satellites/Satellites.md): by the
 * names people know them by ('ISS'), the catalogue's ('ISS (ZARYA)'), their
 * number and their international designator.  Under their body's path, so
 * a scope at the body finds them.
 *
 * Two ways in (js/search/DESIGN.md, Populations):
 * - `collectAll`, Tier A's fuzzy index: the groups shown whole (a few
 *   hundred), so 'tiangog' finds Tiangong.
 * - `search`, every object, Starlink's eleven thousand too, by the
 *   characters of its names (case, spaces and dashes aside): exact, then
 *   prefix, then a word's prefix, then anywhere.  A catalogue name
 *   'STARLINK-30930' is matched by what's typed of it, which fuzzy matching
 *   can't do over thousands that differ by a digit, and it's a millisecond
 *   where Fuse over them is a tenth of a second a keystroke.
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
    // `search`'s scope: the body's path.
    this.scopePath = bodyPath(population.body)
    this._keys = null
    this._entries = new Map
  }


  /** @returns {SearchEntry[]} the groups shown whole, for Tier A */
  collectAll() {
    const pop = this.population
    return pop.records.filter((rec) => !pop.groupLimits?.has(rec.group)).map((rec) => this.entry(rec))
  }


  /**
   * @param {object} rec a record of the population
   * @returns {SearchEntry}
   */
  entry(rec) {
    let e = this._entries.get(rec.id)
    if (!e) {
      const target = this.population.targetOf(rec)
      const id = satellitePath(target)
      e = {
        id,
        displayName: target.name,
        aliases: aliasesOf(rec),
        kind: 'satellite',
        path: `${this.scopePath}/${id}`,
        parent: this.population.body,
        payload: {target, group: rec.group},
      }
      this._entries.set(rec.id, e)
    }
    return e
  }


  /**
   * @param {string} text
   * @param {number} [limit]
   * @returns {Array<{entry: SearchEntry, score: number}>} the objects whose
   *   names have what's typed, best first: by how they match, then the best
   *   known, then the shorter name, then the data's order
   */
  search(text, limit = 20) {
    const q = squash(text)
    if (q.length < 2) {
      return []
    }
    const pop = this.population
    this._keys ??= pop.records.map((rec) => [pop.displayName(rec), rec.name, ...aliasesOf(rec)].map((k) => ({
      whole: squash(k),
      words: String(k).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean),
    })))
    const hits = []
    this._keys.forEach((keys, i) => {
      let best = Infinity
      for (const {whole, words} of keys) {
        if (whole === q) {
          best = EXACT
          break
        }
        if (whole.startsWith(q)) {
          best = Math.min(best, PREFIX)
        } else if (best > WORD && words.some((w) => w.startsWith(q))) {
          best = WORD
        } else if (best > ANYWHERE && whole.includes(q)) {
          best = ANYWHERE
        }
      }
      if (best < Infinity) {
        hits.push({i, score: best})
      }
    })
    const recs = pop.records
    hits.sort((a, b) => (a.score - b.score) ||
      (Number(Boolean(recs[b.i].known)) - Number(Boolean(recs[a.i].known))) ||
      (this._keys[a.i][0].whole.length - this._keys[b.i][0].whole.length) || (a.i - b.i))
    return hits.slice(0, limit).map(({i, score}) => ({entry: this.entry(recs[i]), score}))
  }
}


/**
 * @param {string} s
 * @returns {string} lower case, letters and digits only: 'Starlink 3093' and
 *   'STARLINK-3093' alike
 */
function squash(s) {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')
}
