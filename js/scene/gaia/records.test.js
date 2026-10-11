import {describe, expect, it} from 'bun:test'
import {PC_TO_CATALOGUE_LY, radecToUnit} from './astrometry.js'
import {vFromG} from './photometry.js'
import {DEFAULT_DIST_PC, catalogueApparentMag, catalogueRecord, chooseDistance, gaiaRecord} from './records.js'


// Hand-written rows in the archive's shape (adql.js COLUMNS): made-up
// stars for the arithmetic, not Gaia's data.
const ROW = {
  source_id: 123456789012345678n, ra: 0, dec: 0, ref_epoch: 2016, parallax: 100, parallax_error: 0.1,
  pmra: 0, pmdec: 0, radial_velocity: null, phot_g_mean_mag: 5, bp_rp: 0.82, astrometric_params_solved: 31,
  hip: null, hip_sep: null, r_med_geo: null, r_med_photogeo: null,
}
const TABLE = {bpRp: [0, 1, 2], teff: [9600, 5500, 3900], n: [1, 1, 1]}


describe('records', () => {
  it('takes the best distance there is', () => {
    expect(chooseDistance({...ROW, r_med_photogeo: 12, r_med_geo: 11})).toEqual({distPc: 12, source: 'photogeo'})
    expect(chooseDistance({...ROW, r_med_geo: 11})).toEqual({distPc: 11, source: 'geo'})
    expect(chooseDistance(ROW)).toEqual({distPc: 10, source: 'parallax'})
    expect(chooseDistance({...ROW, parallax_error: 30})).toEqual({distPc: DEFAULT_DIST_PC, source: 'assumed'})
    expect(chooseDistance({...ROW, parallax: null})).toEqual({distPc: DEFAULT_DIST_PC, source: 'assumed'})
  })

  it('places a still star at 10 pc on the equinox', () => {
    const rec = gaiaRecord(ROW, TABLE)
    expect(rec.x).toBeCloseTo(10 * PC_TO_CATALOGUE_LY, 9)
    expect(rec.y).toBeCloseTo(0, 12)
    expect(rec.z).toBeCloseTo(0, 12)
    expect(rec.absMag).toBeCloseTo(vFromG(5, 0.82), 12)
    expect(rec.mag).toBeCloseTo(rec.absMag, 12)
    expect(rec.teff).toBeGreaterThan(5500)
    expect(rec.teff).toBeLessThan(9600)
    expect(rec.id).toBe(123456789012345678n)
    expect(Math.hypot(rec.vx, rec.vy, rec.vz)).toBe(0)
    expect(rec.distSource).toBe('parallax')
  })

  it('carries a moving star to J2000, and to J1991.25 for the merge', () => {
    // 1″/yr north, at the equator: 16″ south of Gaia's place at J2000,
    // 24.75″ at J1991.25.
    const rec = gaiaRecord({...ROW, pmdec: 1000}, TABLE)
    const toArcsec = (v) => Math.atan2(v, 1) * 180 / Math.PI * 3600
    const dirNow = [rec.x, rec.y, rec.z].map((c) => c / Math.hypot(rec.x, rec.y, rec.z))
    // In the catalogue frame north is mostly +Y (and a little -Z).
    const north = [0, Math.cos(23.4392911 * Math.PI / 180), -Math.sin(23.4392911 * Math.PI / 180)]
    const along = (d) => (d[0] * north[0]) + (d[1] * north[1]) + (d[2] * north[2])
    expect(toArcsec(along(dirNow))).toBeCloseTo(-16, 4)
    expect(toArcsec(along(rec.dirHip))).toBeCloseTo(-24.75, 4)
    // The velocity: 4.74 km/s north.
    expect(Math.hypot(rec.vx, rec.vy, rec.vz)).toBeCloseTo(4.7405 * 10, 2)
  })

  it('refuses a row at another epoch, and skips one with no G', () => {
    expect(() => gaiaRecord({...ROW, ref_epoch: 2015.5}, TABLE)).toThrow(/ref_epoch/)
    expect(gaiaRecord({...ROW, phot_g_mean_mag: null}, TABLE)).toBeNull()
    expect(gaiaRecord({...ROW, bp_rp: null}, TABLE).teff).toBe(0)
  })

  it('reads a catalogue star\'s magnitude as the scene renders it', () => {
    // A star 10 pc out shows its absolute magnitude.
    const ly = 10 * PC_TO_CATALOGUE_LY
    const [x, y, z] = radecToUnit(40, 10).map((c) => c * ly)
    const star = {hipId: 7, x, y, z, absMag: 3.5, teff: 6000}
    expect(catalogueApparentMag(star)).toBeCloseTo(3.5, 12)
    const rec = catalogueRecord(star)
    expect(rec.id).toBe(7n)
    expect(rec.mag).toBeCloseTo(3.5, 12)
    expect(Number.isNaN(catalogueApparentMag({x: 0, y: 0, z: 0, absMag: 4.83}))).toBe(true)
  })
})
