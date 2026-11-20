import jwstNircam from './surveys/jwst-nircam.json'
import rubinFirstLook from './surveys/rubin-firstlook.json'
import rubinVirgo from './surveys/rubin-virgo.json'
import {discMeetsCoverage, lonLatToVec, newCoverage} from './hips.js'


// The HiPS surveys the sky layer knows (Sky.md, "Surveys"), each a manifest
// in surveys/: its id (the IVOA one), title, services (the first, then a
// mirror), orders, tile width, formats, frame, credit, licence, source, and
// coverage (a MOC: order → NESTED cells; tools/hips/coverage.mjs).  A new
// survey is a manifest here.  Lazily loaded with the code that draws them:
// nothing of this is in the first load.

/** Rubin's First Look of 23 June 2025 (CDS): the Rubin app's "Rubin's image". */
export const RUBIN_FIRST_LOOK = rubinFirstLook
/**
 * The First Look's Virgo field from Rubin's own tiles (SkyViewer's, on
 * images.rubinobservatory.org): LSSTCam's coadd, wider than the press image.
 */
export const RUBIN_VIRGO = rubinVirgo
/** ESASky's JWST NIRCam imaging: the check on real tiles; `?sky=jwst-nircam` (install.js), no control yet. */
export const JWST_NIRCAM = jwstNircam

export const SURVEYS = [RUBIN_VIRGO, RUBIN_FIRST_LOOK, JWST_NIRCAM]

const toRad = Math.PI / 180
const coverages = new Map


/**
 * @param {object} survey A manifest
 * @returns {object} Its coverage (hips.js newCoverage), made once
 */
export function coverageOf(survey) {
  let c = coverages.get(survey)
  if (!c) {
    c = newCoverage(survey.coverage ?? null)
    coverages.set(survey, c)
  }
  return c
}


/**
 * Whether a field holds any of a survey's imagery, by its coverage.
 *
 * @param {object} survey An equatorial survey's manifest
 * @param {number} raDeg The field's centre
 * @param {number} decDeg
 * @param {number} radiusDeg The field's radius
 * @returns {boolean}
 */
export function surveyCovers(survey, raDeg, decDeg, radiusDeg) {
  if (survey.frame !== 'equatorial') {
    throw new Error(`surveyCovers: equatorial surveys only, not ${survey.frame}`)
  }
  return discMeetsCoverage(coverageOf(survey), lonLatToVec(raDeg, decDeg), radiusDeg * toRad)
}
