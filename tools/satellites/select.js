// Which satellites the snapshot holds, and how a row is made from
// CelesTrak's OMM records (js/scene/satellites/Satellites.md, the data; read
// from its CSV by celestrak.mjs).  Pure, for fetch.mjs and its test.

import {OMM_FIELDS} from '../../js/scene/satellites/sgp4.js'


/**
 * CelesTrak's GP groups, in the order a satellite in two is filed under the
 * first, which is also the order the info panel lists them in: each its
 * query, how it's shown (its label in the panel, what one of it is, its
 * colour), and for the big ones either how many to keep (evenly by NORAD
 * number, so the sample spreads over the launches and the planes) or, kept
 * whole, an order and how many show to start (`order`, `count`: the panel
 * gives the group a slider for how many, from the first), in a file of its
 * own (`file`, under public/: over a megabyte, in Git LFS).  The labels and
 * colours go into the snapshot's header, so the app has no table of its
 * own: a population of any body brings its own (Satellites.md).
 */
export const GROUP_QUERIES = [
  {group: 'stations', query: {GROUP: 'stations'}, label: 'Space stations', kind: 'space station', color: '#fff2c0'},
  // Hubble isn't in a group of its own.
  {group: 'science', query: {CATNR: '20580'}, label: 'Hubble', kind: 'science', color: '#ffd0a0'},
  {group: 'gnss', query: {GROUP: 'gnss'}, label: 'Navigation (GNSS)',
    kind: 'navigation (GPS, GLONASS, Galileo, BeiDou)', color: '#9fe09f'},
  // CelesTrak has no Molniya group any more: the satellites by name.
  {group: 'molniya', query: {NAME: 'MOLNIYA'}, label: 'Molniya', kind: 'Molniya orbit', color: '#ff9f9f'},
  {group: 'weather', query: {GROUP: 'weather'}, label: 'Weather', kind: 'weather', color: '#fff07f'},
  {group: 'iridium', query: {GROUP: 'iridium-NEXT'}, label: 'Iridium', kind: 'Iridium', color: '#c9a0ff'},
  {group: 'geo', query: {GROUP: 'geo'}, keep: 150, label: 'Geostationary (a sample)', kind: 'geostationary',
    color: '#d0d0d0'},
  {group: 'starlink', query: {GROUP: 'starlink'}, label: 'Starlink', kind: 'Starlink', color: '#7fd0ff',
    order: 'serial', count: 300, file: 'large/satellites/starlink.json'},
]


/**
 * The orders a group kept whole can be in (`order`): each a comparison of
 * two OMM records, and how the panel says it.
 */
export const ORDERS = {
  // STARLINK-1008 before STARLINK-30930: the number in the name, about the
  // order they were built; then by NORAD number.
  serial: {
    label: 'serial number',
    compare: (a, b) => (serialOf(a.OBJECT_NAME) - serialOf(b.OBJECT_NAME)) || (a.NORAD_CAT_ID - b.NORAD_CAT_ID),
  },
}


/**
 * @param {string} name e.g. 'STARLINK-1008'
 * @returns {number} the number in it, or Infinity if none (last)
 */
export function serialOf(name) {
  const m = (/(\d+)/).exec(name ?? '')
  return m ? Number(m[1]) : Infinity
}


/**
 * The names people know some by, where CelesTrak's OBJECT_NAME is a
 * module's or a catalogue's: the scene names these, and the search finds
 * them by the aliases too.  In the snapshot's header (`known`).
 */
export const KNOWN = {
  25544: {name: 'ISS', aliases: ['International Space Station', 'ISS (Zarya)', 'Zarya']},
  48274: {name: 'Tiangong', aliases: ['Chinese Space Station', 'CSS', 'Tianhe', 'CSS (Tianhe)']},
  20580: {name: 'Hubble Space Telescope', aliases: ['Hubble', 'HST']},
}


/**
 * @param {object} query
 * @returns {string} CelesTrak's GP URL for it, as OMM CSV (celestrak.mjs
 *   reads it into the records its JSON would give)
 */
export function gpUrl(query) {
  const q = new URLSearchParams({...query, FORMAT: 'CSV'})
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
 * @returns {object} public/data/satellites.json, and in `files` (not
 *   written into it) each group's own file by its path under public/
 */
export function buildSnapshot(fetched, date) {
  const seen = new Set
  const rows = []
  const groups = {}
  const files = {}
  const columns = ['NORAD_CAT_ID', 'OBJECT_NAME', 'group', ...OMM_FIELDS]
  for (const {group, records, keep, url, error, label, kind, color, order, count, file} of fetched) {
    const fresh = records.filter((r) => !seen.has(r.NORAD_CAT_ID) && r.MEAN_MOTION > 0)
    const kept = order ? [...fresh].sort(ORDERS[order].compare) : sample(fresh, keep)
    const into = file ? [] : rows
    kept.forEach((r) => {
      seen.add(r.NORAD_CAT_ID)
      into.push(toRow(r, group))
    })
    const shown = {label: label ?? group, kind: kind ?? group, color: color ?? '#c8c8c8'}
    if (order) {
      Object.assign(shown, {orderedBy: ORDERS[order].label, count})
    }
    if (file) {
      shown.file = file
      files[file] = {group, fetched: date, columns, rows: into}
    }
    groups[group] = error ? {...shown, url, of: 0, kept: 0, error} : {...shown, url, of: records.length, kept: kept.length}
  }
  return {
    source: 'CelesTrak GP data (https://celestrak.org/NORAD/elements/), OMM, ' +
      'from the US Space Force\'s public catalogue; tools/satellites/fetch.mjs',
    fetched: date,
    // The body they orbit, whose planetTilt they hang from (Scene.addPopulation).
    body: 'earth',
    groups,
    known: KNOWN,
    columns,
    rows,
    files,
  }
}
