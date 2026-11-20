// A TAN (gnomonic) world coordinate system, as FITS writes it (Rubin.md,
// "The imagery"): pixel to RA and Dec and back, and RA and Dec to the scene's
// J2000 frame.  The image's WCS was fitted to Gaia's stars
// (tools/rubin/solveWcs.py); its pixels are 0-based, x right, y down, a
// pixel's centre at integer + 0.5, at full resolution.  Pure.

const toRad = Math.PI / 180
const toDeg = 180 / Math.PI
/** J2000's obliquity, as galacticFrame.js has it (wcs.test.js holds them equal). */
const OBLIQUITY_DEG = 23.4392811


/**
 * @param {{crval: Array<number>, crpix: Array<number>, cd: Array<Array<number>>}} wcs
 * @param {number} x Full-resolution pixels
 * @param {number} y
 * @returns {{ra: number, dec: number}} Degrees, ra in [0, 360)
 */
export function pixToWorld(wcs, x, y) {
  const {crval, crpix, cd} = wcs
  const dx = x - crpix[0]
  const dy = y - crpix[1]
  const xi = ((cd[0][0] * dx) + (cd[0][1] * dy)) * toRad
  const eta = ((cd[1][0] * dx) + (cd[1][1] * dy)) * toRad
  const a0 = crval[0] * toRad
  const d0 = crval[1] * toRad
  const den = Math.cos(d0) - (eta * Math.sin(d0))
  const ra = a0 + Math.atan2(xi, den)
  const dec = Math.atan2(Math.sin(d0) + (eta * Math.cos(d0)), Math.hypot(xi, den))
  return {ra: (((ra * toDeg) % 360) + 360) % 360, dec: dec * toDeg}
}


/**
 * @param {object} wcs As pixToWorld's
 * @param {number} raDeg
 * @param {number} decDeg
 * @returns {?{x: number, y: number}} Full-resolution pixels; null for a
 *   point 90° or more from the tangent point
 */
export function worldToPix(wcs, raDeg, decDeg) {
  const {crval, crpix, cd} = wcs
  const ra = raDeg * toRad
  const dec = decDeg * toRad
  const a0 = crval[0] * toRad
  const d0 = crval[1] * toRad
  const cosc = (Math.sin(d0) * Math.sin(dec)) + (Math.cos(d0) * Math.cos(dec) * Math.cos(ra - a0))
  if (!(cosc > 0)) {
    return null
  }
  const xi = Math.cos(dec) * Math.sin(ra - a0) / cosc * toDeg
  const eta = ((Math.cos(d0) * Math.sin(dec)) - (Math.sin(d0) * Math.cos(dec) * Math.cos(ra - a0))) / cosc * toDeg
  const det = (cd[0][0] * cd[1][1]) - (cd[0][1] * cd[1][0])
  const dx = ((cd[1][1] * xi) - (cd[0][1] * eta)) / det
  const dy = ((-cd[1][0] * xi) + (cd[0][0] * eta)) / det
  return {x: dx + crpix[0], y: dy + crpix[1]}
}


/**
 * An equatorial J2000 direction in the scene's J2000 frame (the ecliptic,
 * X the equinox, Y the ecliptic's north pole, Z −ecliptic Y), as the star
 * catalogue and galacticFrame.js equatorialToSceneUnit place them.
 *
 * @param {number} raDeg
 * @param {number} decDeg
 * @param {Array<number>} [out]
 * @returns {Array<number>} A unit [x, y, z]
 */
export function equatorialToScene(raDeg, decDeg, out = [0, 0, 0]) {
  const ra = raDeg * toRad
  const dec = decDeg * toRad
  const eps = OBLIQUITY_DEG * toRad
  const xq = Math.cos(dec) * Math.cos(ra)
  const yq = Math.cos(dec) * Math.sin(ra)
  const zq = Math.sin(dec)
  const ye = (yq * Math.cos(eps)) + (zq * Math.sin(eps))
  const ze = (-yq * Math.sin(eps)) + (zq * Math.cos(eps))
  out[0] = xq
  out[1] = ze
  out[2] = -ye
  return out
}


/**
 * A scene J2000 unit direction back to RA and Dec.
 *
 * @param {Array<number>} v [x, y, z], any length
 * @returns {{ra: number, dec: number}} Degrees
 */
export function sceneToEquatorial([x, y, z]) {
  const eps = OBLIQUITY_DEG * toRad
  const ye = -z
  const ze = y
  const yq = (ye * Math.cos(eps)) - (ze * Math.sin(eps))
  const zq = (ye * Math.sin(eps)) + (ze * Math.cos(eps))
  const ra = Math.atan2(yq, x) * toDeg
  return {ra: (ra + 360) % 360, dec: Math.atan2(zq, Math.hypot(x, yq)) * toDeg}
}
