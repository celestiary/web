import {readFileSync} from 'node:fs'
import {describe, expect, it} from 'bun:test'
import StarsCatalog from '../StarsCatalog.js'
import {CATALOGUE_NORTH} from '../starParams.js'
import {LIGHTYEAR_METER} from '../../shared.js'
import {toArrayBuffer} from '../../utils.js'
import {
  HIPPARCOS_EPOCH,
  J2000_EPOCH,
  KM_S_TO_PC_YR,
  PC_TO_CATALOGUE_LY,
  catalogueToEquatorial,
  equatorialToCatalogue,
  phaseSpace,
  propagate,
  radecToUnit,
  unitToRadec,
} from './astrometry.js'


const ARCSEC = 1 / 3600

// Published astrometry, ICRS, epoch J2000.0 (SIMBAD, as recalled; the
// sandbox reaches neither SIMBAD nor the Gaia archive).  Sirius from the
// Hipparcos new reduction (van Leeuwen 2007); Barnard's Star from Gaia
// DR3 carried to J2000.  Used as references for the frame and the epoch
// against the bundled catalogue, not as data.
// hipPlx is the Hipparcos-2 parallax, the catalogue's.
const SIRIUS = {hip: 32349, ra: 101.28715533, dec: -16.71611586, plx: 379.21, pmra: -546.01, pmdec: -1223.07, rv: -5.5,
  hipPlx: 379.21}
const BARNARD = {hip: 87937, ra: 269.45207511, dec: 4.69339088, plx: 546.9759, pmra: -801.551, pmdec: 10362.394,
  rv: -110.6, hipPlx: 548.31}


/** @returns {StarsCatalog} The bundled catalogue */
function catalogue() {
  const c = new StarsCatalog()
  c.read(toArrayBuffer(readFileSync('./public/data/stars.dat')))
  return c
}


/**
 * @param {Array<number>} a
 * @param {Array<number>} b
 * @returns {number} The angle between, arcsec
 */
function sepArcsec(a, b) {
  const ra = Math.hypot(...a)
  const rb = Math.hypot(...b)
  const dot = ((a[0] * b[0]) + (a[1] * b[1]) + (a[2] * b[2])) / (ra * rb)
  // Through the cross product: exact for small angles.
  const c = [(a[1] * b[2]) - (a[2] * b[1]), (a[2] * b[0]) - (a[0] * b[2]), (a[0] * b[1]) - (a[1] * b[0])]
  return Math.atan2(Math.hypot(...c) / (ra * rb), dot) * 180 / Math.PI * 3600
}


describe('astrometry', () => {
  it('round-trips RA and Dec', () => {
    const {ra, dec, r} = unitToRadec(radecToUnit(279.23473, 38.78369))
    expect(ra).toBeCloseTo(279.23473, 10)
    expect(dec).toBeCloseTo(38.78369, 10)
    expect(r).toBeCloseTo(1, 12)
  })

  it('turns the equator into the catalogue frame and back', () => {
    // The celestial pole is the catalogue's north (starParams.js).
    const pole = equatorialToCatalogue([0, 0, 1])
    for (let i = 0; i < 3; i++) {
      expect(pole[i]).toBeCloseTo(CATALOGUE_NORTH[i], 14)
    }
    // The equinox stays put; the ecliptic pole (RA 18h, Dec 66.56°) is +Y.
    expect(equatorialToCatalogue([1, 0, 0])).toEqual([1, 0, -0])
    const nep = equatorialToCatalogue(radecToUnit(270, 90 - 23.4392911))
    expect(nep[1]).toBeCloseTo(1, 12)
    const v = [0.3, -0.5, 0.81]
    const back = catalogueToEquatorial(equatorialToCatalogue(v))
    for (let i = 0; i < 3; i++) {
      expect(back[i]).toBeCloseTo(v[i], 14)
    }
  })

  it('moves a star by its proper motion and radial velocity', () => {
    // A made-up star 10 pc out, 1″/yr north, 50 km/s away.
    const a = {ra: 30, dec: 0, distPc: 10, pmra: 0, pmdec: 1000, rv: 50}
    const {vel} = phaseSpace(a)
    // Tangential speed 4.74047 km/s per (″/yr × pc).
    const vt = Math.hypot(...vel.map((c, i) => c - (50 * radecToUnit(30, 0)[i])))
    expect(vt).toBeCloseTo(47.4047, 3)
    const p = propagate(a, 100)
    // 100″ of arc at 10 pc, seen from the star's new distance.
    const across = 10 * 100 * ARCSEC * Math.PI / 180
    const along = 10 + (50 * KM_S_TO_PC_YR * 100)
    expect(p.dec).toBeCloseTo(Math.atan2(across, along) * 180 / Math.PI, 10)
    expect(p.ra).toBeCloseTo(30, 9)
    expect(p.distPc).toBeCloseTo(Math.hypot(across, along), 12)
    // No motion, no change.
    expect(propagate({ra: 10, dec: 20, distPc: 5}, -16).dec).toBeCloseTo(20, 12)
  })

  it('matches the bundled catalogue\'s frame, at its epoch, J1991.25', () => {
    // stars.dat is Hipparcos's positions at its own epoch, not J2000's:
    // Sirius and Barnard's Star carried back from J2000 land on it, and
    // left at J2000 they miss it by their 8.75 years of motion.
    const c = catalogue()
    for (const s of [SIRIUS, BARNARD]) {
      const star = c.starByHip.get(s.hip)
      const cat = [star.x, star.y, star.z]
      const astro = {ra: s.ra, dec: s.dec, distPc: 1000 / s.plx, pmra: s.pmra, pmdec: s.pmdec, rv: s.rv}
      const then = equatorialToCatalogue(propagate(astro, HIPPARCOS_EPOCH - J2000_EPOCH).pos)
      const sep = sepArcsec(then, cat)
      const moved = sepArcsec(equatorialToCatalogue(radecToUnit(s.ra, s.dec)), cat)
      // Within 0.1″ (Sirius) and 0.5″ (Barnard's, through two catalogues);
      // its motion since is 11″ and 91″.
      expect(sep).toBeLessThan(s === SIRIUS ? 0.1 : 0.5)
      expect(moved).toBeGreaterThan(10)
      // The distance: the catalogue's light-years are Celestia's
      // (3.26167 a parsec, against the IAU's 3.26156) of the
      // Hipparcos-2 parallax; ours are true parsecs in the scene's
      // light-years: 0.007% apart.
      const catPc = Math.hypot(...cat) / LIGHTYEAR_METER / PC_TO_CATALOGUE_LY
      expect(Math.abs((catPc * s.hipPlx / 1000) - 1)).toBeLessThan(2e-4)
    }
  })
})
