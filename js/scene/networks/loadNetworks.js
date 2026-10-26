import DeepSpaceNetwork from './DeepSpaceNetwork.js'
import IridiumNetwork from './IridiumNetwork.js'
import {DSN_CONFIG_URL} from './dsn.js'
import {decodeElements} from './compactElements.js'
import {newSatRecord} from '../satellites/sgp4.js'
import {newStarlink} from './Starlink.js'


// The space networks' chunk (Networks.md): imported by Scene when one of
// their overlays is first shown, with satellite.js, which the first load
// does without.  Each network's data is fetched then, once.


/**
 * The snapshots: the constellations Earth's satellites' population reads
 * too (tools/satellites/fetch.mjs), and the DSN's (tools/networks/fetch.mjs).
 */
export const NETWORK_URLS = {
  S: 'data/earth/satellites/networks/starlink.json',
  I: 'data/earth/satellites/networks/iridium.json',
  D: DSN_CONFIG_URL,
}


/**
 * @param {string} url
 * @param {Function} fetchFn
 * @returns {Promise<object>}
 */
async function fetchJson(url, fetchFn) {
  const rsp = await fetchFn(url)
  if (!rsp.ok) {
    throw new Error(`networks: ${rsp.status} for ${url}`)
  }
  return rsp.json()
}


/**
 * @param {object} data a compact snapshot (compactElements.js)
 * @param {string} group
 * @returns {Array<object>} its SGP4 records
 */
export function recordsOf(data, group) {
  return decodeElements(data).map((omm) => newSatRecord(omm, group)).filter(Boolean)
}


/**
 * @param {string} key the overlay's: 'S' Starlink, 'I' Iridium, 'D' the DSN
 * @param {object} [opts] layer, camera; for the DSN also fetchFn, Sheet
 * @param {Function} [fetchFn]
 * @returns {Promise<{network: object, data: object}>} the scene object and
 *   its snapshot's header (source, fetched)
 */
export async function loadNetwork(key, opts = {}, fetchFn = (...a) => globalThis.fetch(...a)) {
  const url = NETWORK_URLS[key]
  if (!url) {
    throw new Error(`networks: no network ${key}`)
  }
  const data = await fetchJson(url, fetchFn)
  const header = {source: data.source, fetched: data.fetched}
  switch (key) {
    case 'S': return {network: newStarlink(recordsOf(data, 'starlink'), opts), data: header}
    case 'I': return {network: new IridiumNetwork(recordsOf(data, 'iridium'), opts), data: header}
    case 'D': return {network: new DeepSpaceNetwork(data, {fetchFn, ...opts}), data: header}
    default: throw new Error(`networks: no network ${key}`)
  }
}
