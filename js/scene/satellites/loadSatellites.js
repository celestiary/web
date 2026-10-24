import {dataUrl} from '../../dataUrl.js'
import Satellites from './Satellites.js'
import {parseCatalog} from './sgp4.js'


// The space networks' loader (networks/Networks.md) rides in this chunk:
// Scene imports it from here, so the networks share the satellites' chunk
// and the first load's chunks stay as they were.
export {loadNetwork} from '../networks/loadNetworks.js'


// The satellites' chunk (Satellites.md): imported by Scene when something
// first needs them, with satellite.js, which the first load does without.


/** The snapshot (tools/satellites/fetch.mjs). */
export const SATELLITES_URL = 'data/satellites.json'


/**
 * @param {object} [opts] As Satellites takes them
 * @param {Function} [fetchFn]
 * @returns {Promise<{satellites: Satellites, data: object}>} the snapshot,
 *   parsed and drawn, with each group kept in a file of its own (`file` in
 *   its header: Starlink's, in Git LFS under public/large/); `data` its
 *   header (source, fetched, groups)
 */
export async function loadSatellites(opts = {}, fetchFn = fetch) {
  const data = await fetchJson(SATELLITES_URL, fetchFn)
  const {rows, ...header} = data
  const groups = header.groups ?? {}
  const parts = await Promise.all(Object.values(groups).filter((g) => g.file && !g.error)
      .map((g) => fetchJson(dataUrl(g.file), fetchFn)))
  const records = parseCatalog({rows: rows.concat(...parts.map((p) => p.rows ?? [])), known: header.known})
  return {satellites: new Satellites(records, {body: header.body ?? 'earth', groups, ...opts}), data: header}
}


/**
 * @param {string} url
 * @param {Function} fetchFn
 * @returns {Promise<object>}
 */
async function fetchJson(url, fetchFn) {
  const rsp = await fetchFn(url)
  if (!rsp.ok) {
    throw new Error(`satellites: ${rsp.status} for ${url}`)
  }
  return rsp.json()
}
