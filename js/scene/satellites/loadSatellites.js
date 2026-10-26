import Satellites from './Satellites.js'
import {ORDERS} from './names.js'
import {decodeElements} from '../networks/compactElements.js'
import {newSatRecord, parseCatalog, withKnown} from './sgp4.js'


// The space networks' loader (networks/Networks.md) rides in this chunk:
// Scene imports it from here, so the networks share the satellites' chunk
// and the first load's chunks stay as they were.
export {loadNetwork} from '../networks/loadNetworks.js'


// The satellites' chunk (Satellites.md): imported by Scene when something
// first needs them, with satellite.js, which the first load does without.


/** The snapshot (tools/satellites/fetch.mjs). */
export const SATELLITES_URL = 'data/earth/satellites/index.json'


/**
 * The snapshot's records, its groups' own files with them (`file` in a
 * group's header: the constellations the space networks draw, whole, in
 * compactElements.js's columns), each such group in its order (`order`,
 * names.js ORDERS), whose first its slider counts.
 *
 * @param {Function} fetchFn
 * @param {object} [opts]
 * @param {Set<string>} [opts.skip] groups left out (layer mode's, drawn by
 *   their networks)
 * @returns {Promise<{records: Array<object>, header: object}>} the records,
 *   and the snapshot's header (source, fetched, groups: those kept)
 */
export async function loadSatelliteRecords(fetchFn, {skip = new Set} = {}) {
  const {rows, ...header} = await fetchJson(SATELLITES_URL, fetchFn)
  const groups = Object.fromEntries(Object.entries(header.groups ?? {}).filter(([key]) => !skip.has(key)))
  const records = parseCatalog({rows: rows.filter((r) => groups[r[2]]), known: header.known})
  const own = Object.entries(groups).filter(([, g]) => g.file && !g.error)
  const parts = await Promise.all(own.map(([, g]) => fetchJson(g.file, fetchFn)))
  own.forEach(([key, g], i) => {
    const omms = decodeElements(parts[i])
    if (ORDERS[g.order]) {
      omms.sort(ORDERS[g.order].compare)
    }
    for (const omm of omms) {
      const rec = newSatRecord(omm, key)
      if (rec) {
        records.push(withKnown(rec, header.known))
      }
    }
  })
  return {records, header: {...header, groups}}
}


/**
 * @param {object} [opts] As Satellites takes them
 * @param {Function} [fetchFn]
 * @returns {Promise<{satellites: Satellites, data: object}>} the snapshot,
 *   parsed and drawn, with its groups' own files; `data` its header
 *   (source, fetched, groups)
 */
export async function loadSatellites(opts = {}, fetchFn = fetch) {
  const {records, header} = await loadSatelliteRecords(fetchFn)
  return {satellites: new Satellites(records, {body: header.body ?? 'earth', groups: header.groups, ...opts}),
    data: header}
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
