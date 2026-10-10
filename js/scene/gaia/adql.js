/**
 * The Gaia archive queries the tile build runs (js/scene/Gaia.md, "The
 * query"; tools/gaia/gaia.mjs).  ADQL against the ESA Gaia archive's TAP
 * service, gaiadr3 schema.
 */


/** The ESA Gaia archive's TAP service. */
export const TAP_URL = 'https://gea.esac.esa.int/tap-server/tap'

/**
 * The columns, and why each:
 * - source_id: the star's identity (and its order-12 HEALPix cell, in
 *   equatorial coordinates, in its top bits), kept in the tiles.
 * - ra, dec, ref_epoch: the position, at J2016.0 (checked).
 * - parallax, parallax_error: the distance where Bailer-Jones has none.
 * - pmra, pmdec (and errors): the proper motion, to J2000 and the date.
 * - radial_velocity (and error): the rest of the space motion, for the 34
 *   million stars that have it (most of these: G_RVS < 14).
 * - phot_g_mean_mag, bp_rp: V and the colour (photometry.js).
 * - astrometric_params_solved: 31 (5-parameter) or 95 (6), or 3 for a
 *   position-only solution with no parallax or proper motion.
 * - h.original_ext_source_id: the Hipparcos-2 number of the star's best
 *   neighbour (gaiadr3.hipparcos2_best_neighbour, Gaia's own cross-match,
 *   by the algorithm of Marrese et al. 2019, A&A 621, A144), for the merge
 *   with the bundled catalogue.
 * - h.angular_distance: the match's separation, arcsec.
 * - d.r_med_geo, d.r_med_photogeo: Bailer-Jones et al. 2021 (AJ 161, 147)
 *   distances, parsecs, for EDR3 sources (DR3's astrometry is EDR3's, by
 *   the same source_id).
 */
export const COLUMNS = [
  'g.source_id', 'g.ra', 'g.dec', 'g.ref_epoch',
  'g.parallax', 'g.parallax_error',
  'g.pmra', 'g.pmra_error', 'g.pmdec', 'g.pmdec_error',
  'g.radial_velocity', 'g.radial_velocity_error',
  'g.phot_g_mean_mag', 'g.bp_rp', 'g.astrometric_params_solved',
  'h.original_ext_source_id AS hip', 'h.angular_distance AS hip_sep',
  'd.r_med_geo', 'd.r_med_photogeo',
]


/**
 * Star counts by G magnitude, the archive's own, to choose the cut: bins
 * of 1/binsPerMag magnitude brighter than maxMag.
 *
 * @param {object} [opts]
 * @param {number} [opts.maxMag]
 * @param {number} [opts.binsPerMag]
 * @returns {string} ADQL
 */
export function countsQuery({maxMag = 13, binsPerMag = 20} = {}) {
  return [
    `SELECT FLOOR(phot_g_mean_mag * ${binsPerMag}) AS bin, COUNT(*) AS n`,
    'FROM gaiadr3.gaia_source',
    `WHERE phot_g_mean_mag < ${maxMag}`,
    'GROUP BY bin',
    'ORDER BY bin',
  ].join('\n')
}


/**
 * The magnitude cut that gives about `target` stars, from countsQuery's
 * rows: the upper edge of the first bin where the running count reaches
 * the target.
 *
 * @param {Array<{bin: number, n: number}>} rows
 * @param {number} target
 * @param {number} [binsPerMag]
 * @returns {{cut: number, count: number}} The cut (G < cut) and the stars under it
 */
export function chooseCut(rows, target, binsPerMag = 20) {
  const sorted = [...rows].sort((a, b) => a.bin - b.bin)
  let total = 0
  for (const {bin, n} of sorted) {
    total += n
    if (total >= target) {
      return {cut: (bin + 1) / binsPerMag, count: total}
    }
  }
  const last = sorted[sorted.length - 1]
  return {cut: last ? (last.bin + 1) / binsPerMag : 0, count: total}
}


/**
 * Bands of G to fetch the stars in, from countsQuery's rows, each of at
 * most `maxRows` stars (a bin bigger than that is a band of its own): a
 * query on a band of the magnitude, which the archive indexes, returns in
 * seconds to a minute, where one job for the whole sky (or for a range of
 * source_id, which isn't the magnitude's order) ran for hours.  The
 * brightest band has no lower edge.
 *
 * @param {Array<{bin: number, n: number}>} rows
 * @param {number} cut G: the faintest band ends here
 * @param {number} [maxRows]
 * @param {number} [binsPerMag]
 * @returns {Array<{lo: ?number, hi: number, n: number}>} G from lo (null:
 *   no lower edge) to under hi, and the archive's count in it
 */
export function magnitudeBands(rows, cut, maxRows = 150000, binsPerMag = 20) {
  const sorted = [...rows].filter((r) => (r.bin + 1) / binsPerMag <= cut + 1e-9).sort((a, b) => a.bin - b.bin)
  const bands = []
  let lo = null
  let n = 0
  for (let i = 0; i < sorted.length; i++) {
    const {bin, n: count} = sorted[i]
    if (n > 0 && n + count > maxRows) {
      const edge = bin / binsPerMag
      bands.push({lo, hi: edge, n})
      lo = edge
      n = 0
    }
    n += count
  }
  bands.push({lo, hi: cut, n})
  return bands
}


/**
 * The stars in one band of G, with their Hipparcos cross-match and
 * Bailer-Jones distances.
 *
 * @param {object} opts
 * @param {?number} opts.lo G from (null: no lower edge)
 * @param {number} opts.hi G under
 * @returns {string} ADQL
 */
export function sourceQuery({lo, hi}) {
  return [
    `SELECT ${COLUMNS.join(', ')}`,
    'FROM gaiadr3.gaia_source AS g',
    'LEFT OUTER JOIN gaiadr3.hipparcos2_best_neighbour AS h ON h.source_id = g.source_id',
    'LEFT OUTER JOIN external.gaiaedr3_distance AS d ON d.source_id = g.source_id',
    lo === null || lo === undefined ? `WHERE g.phot_g_mean_mag < ${hi}` :
      `WHERE g.phot_g_mean_mag >= ${lo} AND g.phot_g_mean_mag < ${hi}`,
  ].join('\n')
}


/**
 * Parse the archive's CSV (the TAP service's FORMAT=csv): a header row of
 * column names, then values, empty for null, strings quoted where they
 * need it.  Numbers come back as numbers, null as null, and source_id as
 * a BigInt (it passes 2^53).
 *
 * @param {string} text
 * @returns {Array<object>}
 */
export function parseCsv(text) {
  const lines = splitCsvRows(text)
  if (lines.length === 0) {
    return []
  }
  const header = lines[0]
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i]
    if (cells.length === 1 && cells[0] === '') {
      continue
    }
    const row = {}
    for (let j = 0; j < header.length; j++) {
      const name = header[j]
      const raw = cells[j] ?? ''
      if (raw === '' || raw === 'null' || raw === 'NaN') {
        row[name] = null
      } else if (name === 'source_id') {
        row[name] = BigInt(raw)
      } else {
        const num = Number(raw)
        row[name] = Number.isNaN(num) ? raw : num
      }
    }
    rows.push(row)
  }
  return rows
}


/**
 * @param {string} text
 * @returns {Array<Array<string>>} Rows of cells, quotes undone
 */
function splitCsvRows(text) {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        cell += ch
      }
    } else if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') {
        i++
      }
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else {
      cell += ch
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}
