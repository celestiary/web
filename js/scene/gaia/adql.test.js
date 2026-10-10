import {describe, expect, it} from 'bun:test'
import {chooseCut, countsQuery, magnitudeBands, parseCsv, sourceQuery} from './adql.js'


describe('adql', () => {
  it('counts by G in bins, and picks the cut that reaches the target', () => {
    const q = countsQuery({maxMag: 13, binsPerMag: 20})
    expect(q).toContain('FLOOR(phot_g_mean_mag * 20)')
    expect(q).toContain('phot_g_mean_mag < 13')
    // Made-up counts.
    const rows = [{bin: 200, n: 400000}, {bin: 199, n: 300000}, {bin: 201, n: 500000}]
    expect(chooseCut(rows, 1000000, 20)).toEqual({cut: 10.1, count: 1200000})
    expect(chooseCut(rows, 600000, 20)).toEqual({cut: 10.05, count: 700000})
    expect(chooseCut(rows, 1e9, 20)).toEqual({cut: 10.1, count: 1200000})
  })

  it('cuts the stars into bands of G of at most so many', () => {
    // Made-up counts per 0.05 mag bin.
    const rows = [{bin: 180, n: 50}, {bin: 181, n: 60}, {bin: 182, n: 70}, {bin: 183, n: 200}, {bin: 184, n: 10},
      {bin: 185, n: 999}]
    const bands = magnitudeBands(rows, 9.25, 120, 20)
    expect(bands).toEqual([
      {lo: null, hi: 9.1, n: 110},
      {lo: 9.1, hi: 9.15, n: 70},
      {lo: 9.15, hi: 9.2, n: 200},
      {lo: 9.2, hi: 9.25, n: 10},
    ])
    // Every star under the cut is in one band.
    expect(bands.reduce((a, b) => a + b.n, 0)).toBe(390)
  })

  it('asks for the stars with their Hipparcos match and distances', () => {
    const q = sourceQuery({lo: 10.2, hi: 10.8})
    expect(q).toContain('FROM gaiadr3.gaia_source AS g')
    expect(q).toContain('LEFT OUTER JOIN gaiadr3.hipparcos2_best_neighbour AS h ON h.source_id = g.source_id')
    expect(q).toContain('LEFT OUTER JOIN external.gaiaedr3_distance AS d ON d.source_id = g.source_id')
    expect(q).toContain('WHERE g.phot_g_mean_mag >= 10.2 AND g.phot_g_mean_mag < 10.8')
    expect(sourceQuery({lo: null, hi: 8})).toContain('WHERE g.phot_g_mean_mag < 8')
    for (const col of ['g.bp_rp', 'g.pmra', 'g.radial_velocity', 'r_med_photogeo', 'original_ext_source_id AS hip']) {
      expect(q).toContain(col)
    }
  })

  it('parses the archive\'s CSV', () => {
    // A hand-written sample in the service's shape, not archive output.
    const csv = 'source_id,ra,dec,bp_rp,hip,note\r\n' +
      '4295806720,45.1,-2.5,0.82,1234,\r\n' +
      '6917528997577384320,0,0,,,"a, b ""c"""\r\n'
    const rows = parseCsv(csv)
    expect(rows.length).toBe(2)
    expect(rows[0]).toEqual({source_id: 4295806720n, ra: 45.1, dec: -2.5, bp_rp: 0.82, hip: 1234, note: null})
    expect(rows[1].source_id).toBe(6917528997577384320n)
    expect(rows[1].bp_rp).toBeNull()
    expect(rows[1].note).toBe('a, b "c"')
    expect(parseCsv('')).toEqual([])
  })
})
