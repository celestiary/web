import {INDEX_FILE, HAS_IDS, HAS_VELOCITY, encodeTile, tilePath} from '../points/tileFormat.js'
import {buildTileTree, manifestRow} from '../points/tileTree.js'
import {catalogueIndex, matchCatalogue} from './dedup.js'
import {calibrateColourTemperature} from './photometry.js'
import {catalogueApparentMag, gaiaRecord} from './records.js'


/**
 * The tile build, from rows to tiles (js/scene/Gaia.md, "Rebuilding"),
 * without the file system: tools/gaia/gaia.mjs reads the rows and writes
 * what this returns.
 */


/** Points a tile holds before passing the rest to its children (tileTree.js). */
export const TILE_CAP = 4096
/** The deepest HEALPix order; 9 is cells of 7′, which no sky to G 12 fills. */
export const MAX_ORDER = 9


/**
 * @param {Array<number>} values
 * @returns {{median: number, mad: number, n: number}} The median and the
 *   median absolute deviation
 */
export function robustStats(values) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (v.length === 0) {
    return {median: NaN, mad: NaN, n: 0}
  }
  const med = (a) => (a.length % 2 ? a[a.length >> 1] : (a[(a.length >> 1) - 1] + a[a.length >> 1]) / 2)
  const median = med(v)
  const mad = med(v.map((x) => Math.abs(x - median)).sort((a, b) => a - b))
  return {median, mad, n: v.length}
}


/**
 * Gaia rows to the population's point records, merged with the bundled
 * catalogue: its stars dropped from Gaia's, its temperature scale taken
 * for Gaia's colours, and the conversions checked against it.
 *
 * @param {Array<object>} rows Gaia rows (adql.js COLUMNS)
 * @param {Array<object>} catalogueStars StarProps, x, y, z in light-years
 * @returns {{records: Array<object>, colourTable: object, report: object}}
 */
export function mergeGaia(rows, catalogueStars) {
  const stars = []
  const byHip = new Map()
  for (const s of catalogueStars) {
    if (s.hipId === 0) {
      continue
    }
    const star = {...s, mag: catalogueApparentMag(s)}
    stars.push(star)
    byHip.set(s.hipId, star)
  }
  const index = catalogueIndex(stars)
  // Gaia's colour against the catalogue's Teff, over the stars in both.
  const pairs = []
  for (const row of rows) {
    const star = Number.isFinite(row.hip) ? byHip.get(row.hip) : null
    if (star && Number.isFinite(row.bp_rp)) {
      pairs.push({bpRp: row.bp_rp, teff: star.teff})
    }
  }
  const colourTable = calibrateColourTemperature(pairs)
  const records = []
  const dropped = {hip: 0, position: 0}
  const separations = []
  const vMinusCatalogue = []
  const distSources = {}
  let noColour = 0
  for (const row of rows) {
    const rec = gaiaRecord(row, colourTable)
    if (!rec) {
      continue
    }
    const match = matchCatalogue(rec, index)
    if (match) {
      dropped[match.by]++
      if (match.by === 'position') {
        separations.push(match.sepArcsec)
      }
      const star = byHip.get(match.hip)
      if (match.by === 'hip' && star) {
        vMinusCatalogue.push(rec.v - star.mag)
      }
      continue
    }
    distSources[rec.distSource] = (distSources[rec.distSource] ?? 0) + 1
    if (!Number.isFinite(row.bp_rp)) {
      noColour++
    }
    records.push(rec)
  }
  // The light the kept stars add over the catalogue's, from the Sun (the
  // Milky Way's double counting, MilkyWay.md, scales with it).
  const flux = (m) => (Number.isFinite(m) ? 10 ** (-0.4 * m) : 0)
  const keptLight = records.reduce((a, r) => a + flux(r.mag), 0)
  const catalogueLight = stars.reduce((a, st) => a + flux(st.mag), 0)
  const sepBins = [0.25, 0.5, 1, 1.5, 2].map((edge) => [edge, separations.filter((s) => s <= edge).length])
  return {
    records,
    colourTable,
    report: {
      rows: rows.length,
      kept: records.length,
      dropped,
      positionMatchesWithin: Object.fromEntries(sepBins.map(([e, n]) => [`${e}arcsec`, n])),
      distanceSources: distSources,
      noColour,
      colourPairs: pairs.length,
      lightOverCatalogue: catalogueLight > 0 ? keptLight / catalogueLight : NaN,
      // Gaia's V (Riello et al. 2021) against the catalogue's, over the
      // Hipparcos matches: the conversion's check.
      vMinusCatalogue: robustStats(vMinusCatalogue),
    },
  }
}


/**
 * Point records to tile files and a manifest.
 *
 * @param {Array<object>} records PointRecords
 * @param {object} meta The manifest's description of the population
 * @param {object} [opts]
 * @param {number} [opts.cap]
 * @param {number} [opts.maxOrder]
 * @param {number} [opts.flags]
 * @returns {{files: Map<string, ArrayBuffer>, manifest: object}} files by
 *   path under the population's directory, the manifest among them
 */
export function buildTiles(records, meta, {cap = TILE_CAP, maxOrder = MAX_ORDER, flags = HAS_IDS | HAS_VELOCITY} = {}) {
  const tiles = buildTileTree(records, {cap, maxOrder})
  const files = new Map()
  let bytes = 0
  const byOrder = {}
  for (const t of tiles) {
    const buf = encodeTile(t.points, flags)
    bytes += buf.byteLength
    files.set(tilePath(t.order, t.pix), buf)
    byOrder[t.order] = (byOrder[t.order] ?? 0) + 1
  }
  const manifest = {
    format: 'celestiary-points',
    version: 1,
    ...meta,
    count: records.length,
    tileCap: cap,
    maxOrder,
    flags,
    tileCount: tiles.length,
    tilesByOrder: byOrder,
    bytes,
    columns: ['order', 'pix', 'count', 'magBright', 'magFaint', 'distMinLy', 'distMinSubLy', 'hasChildren'],
    tiles: tiles.map(manifestRow),
  }
  files.set(INDEX_FILE, new TextEncoder().encode(`${JSON.stringify(manifest)}\n`).buffer)
  return {files, manifest}
}


/**
 * Star counts by magnitude bin, for the build's report and the doc's
 * check against the archive's own counts.
 *
 * @param {Array<object>} records With mag
 * @param {number} [binWidth]
 * @returns {Array<Array<number>>} [bin's lower edge, count]
 */
export function magnitudeHistogram(records, binWidth = 0.5) {
  const h = new Map()
  for (const r of records) {
    const b = Math.floor(r.mag / binWidth) * binWidth
    h.set(b, (h.get(b) ?? 0) + 1)
  }
  return [...h.entries()].sort((a, b) => a[0] - b[0])
}
