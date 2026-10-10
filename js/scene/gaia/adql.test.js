import {describe, expect, it} from 'bun:test'
import {chooseCut, countsQuery, parseCsv, sourceIdChunks, sourceQuery} from './adql.js'


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

  it('cuts the sky into source_id ranges by Gaia\'s HEALPix cells', () => {
    const chunks = sourceIdChunks(1)
    expect(chunks.length).toBe(48)
    expect(chunks[0].lo).toBe(0n)
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].lo).toBe(chunks[i - 1].hi)
    }
    // 12 × 4^12 order-12 cells × 2^35.
    expect(chunks[47].hi).toBe(12n * (4n ** 12n) * (2n ** 35n))
    expect(sourceIdChunks(0).length).toBe(12)
  })

  it('asks for the stars with their Hipparcos match and distances', () => {
    const q = sourceQuery({cut: 11.2, lo: 0n, hi: 144115188075855872n})
    expect(q).toContain('FROM gaiadr3.gaia_source AS g')
    expect(q).toContain('LEFT OUTER JOIN gaiadr3.hipparcos2_best_neighbour AS h ON h.source_id = g.source_id')
    expect(q).toContain('LEFT OUTER JOIN external.gaiaedr3_distance AS d ON d.source_id = g.source_id')
    expect(q).toContain('g.phot_g_mean_mag < 11.2')
    expect(q).toContain('g.source_id >= 0 AND g.source_id < 144115188075855872')
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
