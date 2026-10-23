import Population, {ARRIVAL_DIST} from '../population/Population.js'
import {SATELLITES_LOAD_DIST} from './names.js'
import {temePosition, temeToEquator} from './sgp4.js'


// Earth's satellites (Satellites.md): a population (population/Population.js)
// whose positions are SGP4's, from CelesTrak's mean elements, TEME taken to
// Earth's equator under its planetTilt (sgp4.js temeToEquator).  The
// drawing, the groups, the names and the targets' nodes are the
// population's.


export {ARRIVAL_DIST}
// The names show nearer than this to Earth's centre, m.
const LABEL_DIST = 2e8


/** */
export default class Satellites extends Population {
  /**
   * @param {Array<import('./sgp4.js').SatRecord>} records parseCatalog's
   * @param {object} [opts] as Population takes them; `body` defaults to
   *   Earth, the distances to the satellites'
   */
  constructor(records, opts = {}) {
    super(records, {body: 'earth', title: 'Satellites', showDist: SATELLITES_LOAD_DIST, labelDist: LABEL_DIST,
      ...opts})
    this.name = 'satellites'
  }


  /**
   * @param {import('./sgp4.js').SatRecord} rec
   * @param {number} jd Julian Day (UTC)
   * @param {object} out a Vector3
   * @returns {boolean} whether SGP4 has a position then (within the
   *   elements' window, sgp4.js inWindow)
   */
  positionAt(rec, jd, out) {
    const p = rec && temePosition(rec, jd)
    if (p) {
      temeToEquator(p, out)
    }
    return Boolean(p)
  }
}
