// A constellation's mean elements, compact (Networks.md, the data): the OMM
// fields SGP4 starts from, as columns of integers at fixed scales, so a
// whole constellation (Starlink's ~11,000) fits the data policy's plain-git
// line, and gzips well.  Pure, no dependencies: tools/networks/fetch.mjs
// encodes, the networks' chunk decodes.


/** The format's name, in the file, so a reader can refuse another. */
export const COMPACT_FORMAT = 'celestiary-compact-omm-1'

/**
 * Each column's OMM field and its scale: the integer stored is the value
 * times the scale, rounded.  The precision is the elements' own (TLE's
 * digits), except the epoch, kept to the millisecond (as satellite.js
 * reads it), and MEAN_MOTION_DOT and _DDOT, left out: SGP4 doesn't use
 * them (they're SGP's), so they decode as 0.
 */
export const COLUMNS = [
  {key: 'n', field: 'MEAN_MOTION', scale: 1e8},
  {key: 'e', field: 'ECCENTRICITY', scale: 1e7},
  {key: 'i', field: 'INCLINATION', scale: 1e4},
  {key: 'raan', field: 'RA_OF_ASC_NODE', scale: 1e4},
  {key: 'argp', field: 'ARG_OF_PERICENTER', scale: 1e4},
  {key: 'ma', field: 'MEAN_ANOMALY', scale: 1e4},
  {key: 'bstar', field: 'BSTAR', scale: 1e9},
]


/**
 * @param {string} epoch OMM's EPOCH, UTC, with or without the Z
 * @returns {number} Unix ms
 */
export function epochMs(epoch) {
  return Date.parse(epoch.endsWith('Z') ? epoch : `${epoch}Z`)
}


/**
 * @param {Array<object>} records CelesTrak's OMM JSON
 * @param {object} [opts]
 * @param {boolean} [opts.names] keep OBJECT_NAME (Iridium's; Starlink's
 *   are left out, a number each, for size)
 * @returns {object} the columns: `id` (NORAD numbers ascending, each after
 *   the first as its difference from the one before), `epochBase` (ISO, the
 *   earliest epoch's day) and `epoch` (ms after it), and COLUMNS
 */
export function encodeElements(records, {names = false} = {}) {
  const sorted = [...records].sort((a, b) => a.NORAD_CAT_ID - b.NORAD_CAT_ID)
  const base = Math.floor(Math.min(...sorted.map((r) => epochMs(r.EPOCH))) / 86400e3) * 86400e3
  const out = {format: COMPACT_FORMAT, count: sorted.length, epochBase: new Date(base).toISOString()}
  let last = 0
  out.id = sorted.map((r) => {
    const d = r.NORAD_CAT_ID - last
    last = r.NORAD_CAT_ID
    return d
  })
  if (names) {
    out.name = sorted.map((r) => r.OBJECT_NAME)
  }
  out.epoch = sorted.map((r) => epochMs(r.EPOCH) - base)
  for (const {key, field, scale} of COLUMNS) {
    out[key] = sorted.map((r) => Math.round(Number(r[field]) * scale))
  }
  return out
}


/**
 * @param {object} data encodeElements'
 * @returns {Array<object>} OMM records, as json2satrec takes them, in
 *   NORAD order; OBJECT_NAME the file's, or `NORAD <id>`
 */
export function decodeElements(data) {
  if (data?.format !== COMPACT_FORMAT) {
    throw new Error(`compactElements: not ${COMPACT_FORMAT}: ${data?.format}`)
  }
  const base = Date.parse(data.epochBase)
  const out = new Array(data.id.length)
  let id = 0
  for (let k = 0; k < data.id.length; k++) {
    id += data.id[k]
    const omm = {
      NORAD_CAT_ID: id,
      OBJECT_NAME: data.name?.[k] ?? `NORAD ${id}`,
      EPOCH: new Date(base + data.epoch[k]).toISOString(),
      MEAN_MOTION_DOT: 0,
      MEAN_MOTION_DDOT: 0,
    }
    for (const {key, field, scale} of COLUMNS) {
      omm[field] = data[key][k] / scale
    }
    out[k] = omm
  }
  return out
}
