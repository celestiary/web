import {J2000_OBLIQUITY_DEG} from '../celestialFrame.js'
import {ASTRO_UNIT_METER, LIGHTYEAR_METER} from '../../shared.js'


/**
 * Gaia's astrometry into the catalogue's frame (js/scene/Gaia.md, "Frame
 * and epoch").  Gaia DR3 gives ICRS positions at epoch J2016.0; the scene's
 * star catalogue is the mean ecliptic of J2000 with the scene's axes
 * (StellarFrame's local frame), and the tiles hold positions at epoch
 * J2000.0 and each star's space velocity, so the renderer can move it to
 * the simulation date.
 *
 * - **Frame.**  ICRS is the J2000 mean equator and equinox to within the
 *   frame bias (17-23 mas), which is left out, as it was for the bundled
 *   catalogue: Celestia's stars.dat is Hipparcos's ICRS positions turned
 *   by the J2000 obliquity, 23.4392911° (celestialFrame.js
 *   J2000_OBLIQUITY_DEG, 84381.448″), into the ecliptic, with the scene's
 *   axes (X the equinox, Y the north ecliptic pole, Z minus ecliptic Y).
 *   Checked against stars.dat in astrometry.test.js.
 * - **Epoch.**  Uniform space motion (ESA 1997, The Hipparcos Catalogue,
 *   vol. 1, §1.2.8; Butkevich & Lindegren 2014, A&A 570, A62): the star's
 *   position r = d·u and velocity v = d·(μα*·p + μδ·q) + vr·u, carried
 *   linearly, r(t) = r + v·Δt.  Taken in full, so the proper motion,
 *   the radial velocity where Gaia measured it and the perspective
 *   acceleration they make together are all in; the light-time factor
 *   (vr·Δt/c, under 1e-6 here) is not.  A star with no radial velocity is
 *   given none, which over 16 years misses its perspective acceleration:
 *   at most a few mas, for the nearest fast stars.
 */


/** One parsec, metres (IAU 2015 B2: 648000/π au). */
export const PARSEC_METER = 648000 / Math.PI * ASTRO_UNIT_METER
/** One parsec, km. */
export const PARSEC_KM = PARSEC_METER / 1e3
/** One Julian year, seconds. */
export const JULIAN_YEAR_S = 365.25 * 86400
/** km/s to pc per Julian year. */
export const KM_S_TO_PC_YR = JULIAN_YEAR_S / PARSEC_KM
/** Milliarcseconds to radians. */
export const MAS_RAD = Math.PI / (180 * 3600 * 1000)
/**
 * Parsecs to the catalogue's light-years: its positions times the scene's
 * LIGHTYEAR_METER are metres (StarsCatalog.js), so a parsec is this many.
 */
export const PC_TO_CATALOGUE_LY = PARSEC_METER / LIGHTYEAR_METER
/** Gaia DR3's reference epoch, Julian years (TCB). */
export const GAIA_DR3_EPOCH = 2016.0
/** The tiles' epoch, Julian years. */
export const J2000_EPOCH = 2000.0
/** The epoch of the bundled catalogue's positions: Hipparcos's (stars.dat; Gaia.md). */
export const HIPPARCOS_EPOCH = 1991.25

const EPS = J2000_OBLIQUITY_DEG * Math.PI / 180
const COS_EPS = Math.cos(EPS)
const SIN_EPS = Math.sin(EPS)
const DEG = Math.PI / 180


/**
 * @param {number} raDeg
 * @param {number} decDeg
 * @returns {Array<number>} The unit vector, equatorial (x to the equinox, z the pole)
 */
export function radecToUnit(raDeg, decDeg) {
  const ra = raDeg * DEG
  const dec = decDeg * DEG
  return [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)]
}


/**
 * @param {Array<number>} v Equatorial, any length
 * @returns {{ra: number, dec: number, r: number}} Degrees, and the length
 */
export function unitToRadec([x, y, z]) {
  const r = Math.hypot(x, y, z)
  let ra = Math.atan2(y, x) / DEG
  if (ra < 0) {
    ra += 360
  }
  return {ra, dec: Math.asin(Math.max(-1, Math.min(1, z / r))) / DEG, r}
}


/**
 * Equatorial (ICRS ≈ J2000) to the catalogue frame: turn by the obliquity
 * into the ecliptic, then the scene's axes, (X, Z, −Y).
 *
 * @param {Array<number>} v
 * @returns {Array<number>}
 */
export function equatorialToCatalogue([x, y, z]) {
  const ye = (y * COS_EPS) + (z * SIN_EPS)
  const ze = (-y * SIN_EPS) + (z * COS_EPS)
  return [x, ze, -ye]
}


/**
 * The inverse of equatorialToCatalogue.
 *
 * @param {Array<number>} v
 * @returns {Array<number>}
 */
export function catalogueToEquatorial([sx, sy, sz]) {
  const ye = -sz
  const ze = sy
  return [sx, (ye * COS_EPS) - (ze * SIN_EPS), (ye * SIN_EPS) + (ze * COS_EPS)]
}


/**
 * @typedef {object} Astrometry
 * @property {number} ra Degrees, at the epoch
 * @property {number} dec Degrees
 * @property {number} distPc Parsecs (from the parallax or a distance estimate)
 * @property {number} [pmra] μα* = μα·cos δ, mas/yr
 * @property {number} [pmdec] mas/yr
 * @property {number} [rv] Radial velocity, km/s
 */


/**
 * A star's position and velocity, equatorial, from its astrometry.
 *
 * @param {Astrometry} a
 * @returns {{pos: Array<number>, vel: Array<number>}} pos in parsecs,
 *   vel in km/s
 */
export function phaseSpace(a) {
  const ra = a.ra * DEG
  const dec = a.dec * DEG
  const sa = Math.sin(ra)
  const ca = Math.cos(ra)
  const sd = Math.sin(dec)
  const cd = Math.cos(dec)
  const u = [cd * ca, cd * sa, sd]
  // The local triad: p toward increasing RA, q toward increasing Dec.
  const p = [-sa, ca, 0]
  const q = [-sd * ca, -sd * sa, cd]
  const d = a.distPc
  // Tangential velocity, km/s: d (pc) × μ (rad/yr) in pc/yr, to km/s.
  const kt = d * MAS_RAD / KM_S_TO_PC_YR
  const pmra = Number.isFinite(a.pmra) ? a.pmra : 0
  const pmdec = Number.isFinite(a.pmdec) ? a.pmdec : 0
  const rv = Number.isFinite(a.rv) ? a.rv : 0
  const vel = [0, 1, 2].map((i) => (kt * ((pmra * p[i]) + (pmdec * q[i]))) + (rv * u[i]))
  return {pos: u.map((c) => c * d), vel}
}


/**
 * Carry a star from its epoch by uniform space motion.
 *
 * @param {Astrometry} a
 * @param {number} dtYears Julian years, the new epoch minus the old
 * @returns {{pos: Array<number>, vel: Array<number>, ra: number, dec: number, distPc: number}}
 *   pos in parsecs and vel in km/s, equatorial; ra and dec in degrees
 */
export function propagate(a, dtYears) {
  const {pos, vel} = phaseSpace(a)
  const k = dtYears * KM_S_TO_PC_YR
  const out = [pos[0] + (vel[0] * k), pos[1] + (vel[1] * k), pos[2] + (vel[2] * k)]
  const {ra, dec, r} = unitToRadec(out)
  return {pos: out, vel, ra, dec, distPc: r}
}
