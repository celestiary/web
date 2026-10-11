import {
  GAIA_DR3_EPOCH,
  HIPPARCOS_EPOCH,
  J2000_EPOCH,
  PC_TO_CATALOGUE_LY,
  equatorialToCatalogue,
  propagate,
} from './astrometry.js'
import {teffFromBpRp, vFromG} from './photometry.js'


/**
 * One Gaia row to the tiles' point record (js/scene/Gaia.md).
 */


/**
 * Where a star's distance came from, by preference:
 * - photogeo: Bailer-Jones et al. 2021's photogeometric median, which adds
 *   the star's colour and magnitude to its parallax, and is the more
 *   precise where a parallax is poor;
 * - geo: their geometric median, from the parallax and a prior on the
 *   Galaxy's distribution of stars;
 * - parallax: 1/ϖ, where neither is given and the parallax is over 5σ;
 * - assumed: none of these (a position-only solution, or a parallax under
 *   5σ with no Bailer-Jones entry): DEFAULT_DIST_PC.  Its magnitude from
 *   the Sun is right whatever the distance (its absolute magnitude is
 *   taken from it); only a view from far off misplaces it.
 */
export const DISTANCE_SOURCES = ['photogeo', 'geo', 'parallax', 'assumed']
/** The distance given a star with none, parsecs. */
export const DEFAULT_DIST_PC = 1000
/** The parallax over its error that 1/ϖ needs. */
export const MIN_PARALLAX_SNR = 5


/**
 * @param {object} row A Gaia row (adql.js COLUMNS)
 * @returns {{distPc: number, source: string}}
 */
export function chooseDistance(row) {
  if (row.r_med_photogeo > 0) {
    return {distPc: row.r_med_photogeo, source: 'photogeo'}
  }
  if (row.r_med_geo > 0) {
    return {distPc: row.r_med_geo, source: 'geo'}
  }
  if (row.parallax > 0 && row.parallax_error > 0 && row.parallax / row.parallax_error >= MIN_PARALLAX_SNR) {
    return {distPc: 1000 / row.parallax, source: 'parallax'}
  }
  return {distPc: DEFAULT_DIST_PC, source: 'assumed'}
}


/**
 * @param {object} row
 * @returns {object} The row's astrometry for astrometry.js
 */
export function rowAstrometry(row) {
  const {distPc} = chooseDistance(row)
  return {ra: row.ra, dec: row.dec, distPc, pmra: row.pmra, pmdec: row.pmdec, rv: row.radial_velocity}
}


/**
 * @typedef {object} GaiaRecord A PointRecord (tileFormat.js) with what the
 *   build reports and the merge needs
 * @property {bigint} id source_id
 * @property {number} x Light-years, catalogue frame, J2000.0
 * @property {number} y Light-years
 * @property {number} z Light-years
 * @property {number} vx km/s, catalogue frame
 * @property {number} vy km/s
 * @property {number} vz km/s
 * @property {number} absMag V
 * @property {number} teff K, 0 if no colour
 * @property {number} mag V from the Sun at J2000.0
 * @property {number} v V as observed (at Gaia's epoch)
 * @property {?number} hip The Hipparcos-2 best neighbour
 * @property {Array<number>} dirHip The unit vector at the bundled
 *   catalogue's epoch (J1991.25), catalogue frame, for the merge
 * @property {string} distSource Where its distance came from (DISTANCE_SOURCES)
 * @property {boolean} positionOnly A 2-parameter solution: position only
 */


/**
 * @param {object} row A Gaia row
 * @param {object} colourTable photometry.js calibrateColourTemperature's
 * @returns {?GaiaRecord} null for a row with no G or no position
 */
export function gaiaRecord(row, colourTable) {
  if (!Number.isFinite(row.phot_g_mean_mag) || !Number.isFinite(row.ra) || !Number.isFinite(row.dec)) {
    return null
  }
  if (Number.isFinite(row.ref_epoch) && row.ref_epoch !== GAIA_DR3_EPOCH) {
    throw new Error(`source ${row.source_id}: ref_epoch ${row.ref_epoch}, expected ${GAIA_DR3_EPOCH}`)
  }
  const {distPc, source} = chooseDistance(row)
  const astro = {ra: row.ra, dec: row.dec, distPc, pmra: row.pmra, pmdec: row.pmdec, rv: row.radial_velocity}
  const at2000 = propagate(astro, J2000_EPOCH - GAIA_DR3_EPOCH)
  const atHip = propagate(astro, HIPPARCOS_EPOCH - GAIA_DR3_EPOCH)
  const v = vFromG(row.phot_g_mean_mag, row.bp_rp)
  // The absolute magnitude from the distance at Gaia's epoch, when G was
  // measured; the magnitude at J2000 from the distance then.
  const absMag = v - (5 * Math.log10(distPc / 10))
  const mag = absMag + (5 * Math.log10(at2000.distPc / 10))
  const [x, y, z] = equatorialToCatalogue(at2000.pos).map((c) => c * PC_TO_CATALOGUE_LY)
  const [vx, vy, vz] = equatorialToCatalogue(at2000.vel)
  const hipVec = equatorialToCatalogue(atHip.pos)
  const r = Math.hypot(...hipVec)
  return {
    id: row.source_id, x, y, z, vx, vy, vz, absMag,
    teff: colourTable ? teffFromBpRp(colourTable, row.bp_rp) : 0,
    mag, v, hip: Number.isFinite(row.hip) ? row.hip : null,
    dirHip: hipVec.map((c) => c / r), distSource: source,
    // A position-only (2-parameter) solution: no parallax or proper motion,
    // and for the brightest, saturated stars a position arcseconds off.
    positionOnly: row.astrometric_params_solved === 3 || !Number.isFinite(row.pmra),
  }
}


/**
 * A bundled catalogue star's apparent magnitude from the Sun, as the scene
 * renders it: its absolute magnitude and its distance in true parsecs
 * (its light-years times LIGHTYEAR_METER are metres).
 *
 * @param {object} star StarProps (StarsCatalog.js), x, y, z in light-years
 * @returns {number} NaN for the Sun
 */
export function catalogueApparentMag(star) {
  const pc = Math.hypot(star.x, star.y, star.z) / PC_TO_CATALOGUE_LY
  return pc > 0 ? star.absMag + (5 * Math.log10(pc / 10)) : NaN
}


/**
 * A bundled catalogue star as a point record: what the tile pipeline is
 * checked with, with no Gaia data (Gaia.md, "Checks").
 * Not Gaia's: no velocity, and its HIP number for an id.
 *
 * @param {object} star StarProps, x, y, z in light-years (StarsCatalog
 *   gives metres; divide by LIGHTYEAR_METER first)
 * @returns {object} A PointRecord
 */
export function catalogueRecord(star) {
  return {
    id: BigInt(star.hipId), x: star.x, y: star.y, z: star.z, vx: 0, vy: 0, vz: 0,
    absMag: star.absMag, teff: star.teff ?? 0, mag: catalogueApparentMag(star),
  }
}
