// Which satellites the snapshot holds, and how a row is made from
// CelesTrak's OMM JSON (js/scene/satellites/Satellites.md, the data).  Pure,
// for fetch.mjs and its test.

import {OMM_FIELDS} from '../../js/scene/satellites/sgp4.js'


/**
 * CelesTrak's GP groups, in the order a satellite in two is filed under the
 * first: each its query and, for the big ones, how many to keep (evenly
 * by NORAD number, so the sample spreads over the launches and the planes).
 */
export const GROUP_QUERIES = [
  {group: 'stations', query: {GROUP: 'stations'}},
  // Hubble isn't in a group of its own.
  {group: 'science', query: {CATNR: '20580'}},
  {group: 'gnss', query: {GROUP: 'gnss'}},
  // CelesTrak has no Molniya group any more: the satellites by name.
  {group: 'molniya', query: {NAME: 'MOLNIYA'}},
  {group: 'weather', query: {GROUP: 'weather'}},
  {group: 'geo', query: {GROUP: 'geo'}, keep: 150},
  {group: 'starlink', query: {GROUP: 'starlink'}, keep: 300},
]


/**
 * @param {object} query
 * @returns {string} CelesTrak's GP URL for it, as OMM JSON
 */
export function gpUrl(query) {
  const q = new URLSearchParams({...query, FORMAT: 'json'})
  return `https://celestrak.org/NORAD/elements/gp.php?${q}`
}


/**
 * @param {Array<object>} records
 * @param {number} [keep]
 * @returns {Array<object>} `keep` of them, evenly spaced by NORAD number;
 *   all if fewer
 */
export function sample(records, keep = Infinity) {
  const sorted = [...records].sort((a, b) => a.NORAD_CAT_ID - b.NORAD_CAT_ID)
  if (sorted.length <= keep) {
    return sorted
  }
  const out = []
  for (let k = 0; k < keep; k++) {
    out.push(sorted[Math.floor(k * sorted.length / keep)])
  }
  return out
}


/**
 * @param {object} omm
 * @param {string} group
 * @returns {Array} [NORAD_CAT_ID, OBJECT_NAME, group, ...OMM_FIELDS]
 */
export function toRow(omm, group) {
  return [omm.NORAD_CAT_ID, omm.OBJECT_NAME, group, ...OMM_FIELDS.map((f) => omm[f])]
}


/**
 * The snapshot from each group's records, a satellite once.
 *
 * @param {Array<{group: string, records: Array<object>, keep?: number}>} fetched in GROUP_QUERIES order
 * @param {string} date ISO time of the fetch
 * @returns {object} public/data/satellites.json
 */
export function buildSnapshot(fetched, date) {
  const seen = new Set
  const rows = []
  const groups = {}
  for (const {group, records, keep, url, error} of fetched) {
    const fresh = records.filter((r) => !seen.has(r.NORAD_CAT_ID) && r.MEAN_MOTION > 0)
    const kept = sample(fresh, keep)
    kept.forEach((r) => {
      seen.add(r.NORAD_CAT_ID)
      rows.push(toRow(r, group))
    })
    groups[group] = error ? {url, of: 0, kept: 0, error} : {url, of: records.length, kept: kept.length}
  }
  return {
    source: 'CelesTrak GP data (https://celestrak.org/NORAD/elements/), OMM, ' +
      'from the US Space Force\'s public catalogue; tools/satellites/fetch.mjs',
    fetched: date,
    groups,
    columns: ['NORAD_CAT_ID', 'OBJECT_NAME', 'group', ...OMM_FIELDS],
    rows,
  }
}
