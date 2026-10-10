import {describe, expect, it} from 'bun:test'
import {INDEX_FILE, decodeTile, tileId} from '../points/tileFormat.js'
import {PC_TO_CATALOGUE_LY, catalogueToEquatorial, unitToRadec} from './astrometry.js'
import {buildTiles, magnitudeHistogram, mergeGaia, robustStats} from './build.js'


/**
 * A catalogue star at (ra, dec), d parsecs, of apparent magnitude m: a
 * hand-made stand-in for stars.dat's entries.
 *
 * @param {number} hipId
 * @param {number} ra
 * @param {number} dec
 * @param {number} d
 * @param {number} m
 * @param {number} teff
 * @returns {object} StarProps in light-years
 */
function star(hipId, ra, dec, d, m, teff) {
  const r = ra * Math.PI / 180
  const s = dec * Math.PI / 180
  const eq = [Math.cos(s) * Math.cos(r), Math.cos(s) * Math.sin(r), Math.sin(s)]
  // equatorial to catalogue (astrometry.js), by hand: the inverse of catalogueToEquatorial.
  const eps = 23.4392911 * Math.PI / 180
  const ye = (eq[1] * Math.cos(eps)) + (eq[2] * Math.sin(eps))
  const ze = (-eq[1] * Math.sin(eps)) + (eq[2] * Math.cos(eps))
  const ly = d * PC_TO_CATALOGUE_LY
  return {hipId, x: eq[0] * ly, y: ze * ly, z: -ye * ly, absMag: m - (5 * Math.log10(d / 10)), teff}
}


/**
 * A Gaia-shaped row (adql.js COLUMNS) for a made-up star.
 *
 * @param {object} o
 * @returns {object}
 */
function row(o) {
  return {
    source_id: 1n, ref_epoch: 2016, parallax: 1000 / o.d, parallax_error: 0.02, pmra: 0, pmdec: 0,
    radial_velocity: null, bp_rp: 0.8, hip: null, hip_sep: null, r_med_geo: null, r_med_photogeo: null,
    astrometric_params_solved: 31, ...o,
  }
}


describe('build', () => {
  // A made-up catalogue: one cool and one hot star per colour for the
  // calibration (repeated, to fill its bins), and a Gaia sample: the
  // catalogue's stars by HIP, one by position only, and new stars.
  const cat = []
  const rows = []
  for (let i = 0; i < 60; i++) {
    cat.push(star(1000 + i, 10 + i, 5, 20, 6, 4000))
    rows.push(row({source_id: BigInt(i + 1), ra: 10 + i, dec: 5, d: 20, phot_g_mean_mag: 5.6, bp_rp: 1.6, hip: 1000 + i}))
    cat.push(star(2000 + i, 10 + i, -5, 30, 5, 9000))
    rows.push(row({source_id: BigInt(i + 101), ra: 10 + i, dec: -5, d: 30, phot_g_mean_mag: 5, bp_rp: 0.0, hip: 2000 + i}))
  }
  // By position: 0.5″ from catalogue star 1000, no HIP match.
  rows.push(row({source_id: 500n, ra: 10 + (0.5 / 3600), dec: 5, d: 20, phot_g_mean_mag: 5.7, bp_rp: 1.6}))
  // New stars.
  rows.push(row({source_id: 600n, ra: 200, dec: 40, d: 100, phot_g_mean_mag: 9, bp_rp: 0.8, r_med_photogeo: 101}))
  rows.push(row({source_id: 601n, ra: 201, dec: 41, d: 500, phot_g_mean_mag: 10, bp_rp: null, parallax: null}))

  const {records, colourTable, report} = mergeGaia(rows, cat)

  it('keeps only the new stars', () => {
    expect(records.map((r) => r.id).sort()).toEqual([600n, 601n])
    expect(report.dropped).toEqual({hip: 120, position: 1})
    expect(report.distanceSources).toEqual({photogeo: 1, assumed: 1})
    expect(report.noColour).toBe(1)
  })

  it('calibrates colour on the catalogue\'s temperatures', () => {
    expect(report.colourPairs).toBe(120)
    expect(colourTable.teff[0]).toBe(9000)
    expect(colourTable.teff[colourTable.teff.length - 1]).toBe(4000)
    const rec = records.find((r) => r.id === 600n)
    expect(rec.teff).toBeGreaterThan(4000)
    expect(rec.teff).toBeLessThan(9000)
  })

  it('checks V against the catalogue over the matches', () => {
    // The made-up G and V differ by gMinusV at each colour: about 0.2 to 0.4.
    expect(report.vMinusCatalogue.n).toBe(120)
    expect(Math.abs(report.vMinusCatalogue.median)).toBeLessThan(0.5)
  })

  it('places a new star where Gaia has it', () => {
    const rec = records.find((r) => r.id === 600n)
    const {ra, dec, r} = unitToRadec(catalogueToEquatorial([rec.x, rec.y, rec.z]))
    expect(ra).toBeCloseTo(200, 9)
    expect(dec).toBeCloseTo(40, 9)
    expect(r / PC_TO_CATALOGUE_LY).toBeCloseTo(101, 9)
  })

  it('writes tiles and a manifest that read back', () => {
    const {files, manifest} = buildTiles(records, {name: 'test'}, {cap: 1})
    expect(manifest.count).toBe(2)
    expect(manifest.tileCount).toBe(manifest.tiles.length)
    expect(files.has(INDEX_FILE)).toBe(true)
    const back = JSON.parse(new TextDecoder().decode(files.get(INDEX_FILE)))
    expect(back.tiles).toEqual(manifest.tiles)
    const ids = []
    for (const [path, buf] of files) {
      if (path.endsWith('.bin')) {
        const t = decodeTile(buf)
        for (let i = 0; i < t.count; i++) {
          ids.push(tileId(t, i))
        }
      }
    }
    expect(ids.sort()).toEqual([600n, 601n])
  })

  it('summarises robustly', () => {
    expect(robustStats([1, 2, 3, 100, NaN])).toEqual({median: 2.5, mad: 1, n: 4})
    expect(magnitudeHistogram([{mag: 1.2}, {mag: 1.4}, {mag: 2.6}])).toEqual([[1, 2], [2.5, 1]])
  })
})
