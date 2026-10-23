import Satellites from './Satellites.js'
import {parseCatalog} from './sgp4.js'


// The satellites' chunk (Satellites.md): imported by Scene when something
// first needs them, with satellite.js, which the first load does without.


/** The snapshot (tools/satellites/fetch.mjs). */
export const SATELLITES_URL = 'data/satellites.json'


/**
 * @param {object} [opts] As Satellites takes them
 * @param {Function} [fetchFn]
 * @returns {Promise<{satellites: Satellites, data: object}>} the snapshot,
 *   parsed and drawn; `data` its header (source, fetched, groups)
 */
export async function loadSatellites(opts = {}, fetchFn = fetch) {
  const rsp = await fetchFn(SATELLITES_URL)
  if (!rsp.ok) {
    throw new Error(`satellites: ${rsp.status} for ${SATELLITES_URL}`)
  }
  const data = await rsp.json()
  const {rows, ...header} = data
  return {satellites: new Satellites(parseCatalog({rows}), opts), data: header}
}
