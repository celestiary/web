import {DISPLAY_GAIN, INITIAL_FOV} from '../../shared.js'
import {EYE_PSF_GLSL, GLARE_GLSL, GLARE_MAX_DEG, eyePsf, eyePsfShare, glareFunction} from '../sun/glare.js'


/**
 * The observer: what the star field takes from the instrument looking at
 * it (HDR.md, "Physical stars", "The instrument").  One instance, the
 * naked eye dark adapted, is the app's observer for now; the seam is here
 * so that binoculars, a telescope or a camera can be another instance,
 * with brightness and image size separate by construction: the light an
 * instrument collects sets what it detects, its point spread function
 * sets what a point looks like, and neither sets the other.
 *
 * - **Collecting area** over the dark-adapted eye's 7 mm pupil, and the
 *   **integration time** over the eye's: together the gain on every
 *   point's light over the naked eye's (instrumentStarGain).  The user's
 *   star setting (`sm=`, starMagnitude.js) is a sensitivity in magnitudes
 *   on top of it: a longer exposure, more aperture.
 * - **The detection threshold**: the limiting magnitude at the dark gain,
 *   and what a star at it shows in exposure units; from them the detector's
 *   pool round a point (the eye's rods: 10′), which the pooled radiance is
 *   over.
 * - **The PSF**: the pool's radius, within which a point's light is pooled
 *   and drawn as the core; the share of the light the PSF puts there; and
 *   the wing, the scattering round a point per steradian by the angle from
 *   it, which is the veil round a bright star and round a disc (the glare).
 *
 * The eye's PSF is the CIE total glare equation (sun/glare.js eyePsf):
 * the optics' two lobes and the scattered light, in the eye's own angle.
 * Through a field narrower than the eye's (a telescope's) the eye's angle
 * is the sky's times the magnification (instrumentMagnification), so the
 * patch and the PSF shrink on the sky as the light per point rises by the
 * magnification squared (HDR.md, "A telescope's field").
 */


/** The Sun's apparent magnitude. */
export const SUN_APPARENT_MAGNITUDE = -26.74


/**
 * @param {number} magnitude Apparent
 * @returns {number} The star's illuminance over the Sun's at 1 AU
 */
export function illuminanceRatio(magnitude) {
  return Math.pow(10, -0.4 * (magnitude - SUN_APPARENT_MAGNITUDE))
}


/** The dark-adapted eye's pupil, metres. */
export const EYE_PUPIL_M = 0.007
/** The eye's integration time, seconds (Bloch's law: the rods' summation, about 0.1 s). */
export const EYE_INTEGRATION_S = 0.1
/**
 * The exposure the dark-adapted eye reaches, over Earth's keyed exposure:
 * a scene of 8e-3 cd/m² (a moonlit landscape) shown as a sunlit one.  The
 * metered exposure's ceiling (exposure.js METER_GAIN_MAX): the eye adapts
 * to 1e-6 cd/m², so this is well within its range; it is set so that a
 * star of magnitude 6.5 just shows (LIMIT_VALUE).
 */
export const EYE_DARK_GAIN = 4e6
/**
 * The limiting magnitude (HDR.md, "Physical stars"): the naked eye's at a
 * dark site, dark adapted.  The one parameter the star field is
 * calibrated on: a star of this magnitude shows LIMIT_VALUE at the dark
 * gain, brighter ones 2.5× more light per magnitude, fainter ones less,
 * down into black smoothly (no pop); the eye's patch, over which a star's
 * light is pooled, follows from it (EYE_PATCH_SR).
 */
export const LIMITING_MAGNITUDE = 6.5
/**
 * What a star at the limit shows, in exposure units: 12 of 255 through
 * Neutral's toe, just visible.
 */
export const LIMIT_VALUE = 0.12
/**
 * The eye's patch, steradians: the solid angle a point's light is pooled
 * over, so that a star at LIMITING_MAGNITUDE shows LIMIT_VALUE at the
 * dark-adapted gain (a star's value is DISPLAY_GAIN·π·ratio/Ω·gain,
 * stars.vert).  8.2e-6 sr, a 9.7 arcmin square: the dark-adapted eye's
 * resolution of a point (rod acuity, ~20/200, 10 arcmin), which is why
 * the calibration is physical.
 */
export const EYE_PATCH_SR = DISPLAY_GAIN * Math.PI * illuminanceRatio(LIMITING_MAGNITUDE) * EYE_DARK_GAIN / LIMIT_VALUE
/** The eye's patch's side, radians. */
export const EYE_POINT_RAD = Math.sqrt(EYE_PATCH_SR)
/**
 * The rods' pool round a point, as the eye's angle in degrees: half the
 * patch's side, 4.8′.  Inside it a star's light is pooled and drawn as the
 * core; outside it the PSF's wing is the veil round the star.
 */
export const EYE_POOL_RADIUS_DEG = EYE_POINT_RAD / 2 * 180 / Math.PI


/**
 * The wing's window: 0 inside half the pool's radius, 1 from the pool's
 * radius out, a smoothstep between (stars.frag).
 *
 * @param {number} thetaDeg The eye's angle from the point
 * @param {number} [poolRadiusDeg]
 * @returns {number}
 */
export function wingWindow(thetaDeg, poolRadiusDeg = EYE_POOL_RADIUS_DEG) {
  const t = Math.min(Math.max(((thetaDeg / poolRadiusDeg) - 0.5) / 0.5, 0), 1)
  return t * t * (3 - (2 * t))
}


/**
 * The share of a point's light the eye's PSF puts in the pool, the wing's
 * window taking the rest: 0.58.  The pooled light is what the limiting
 * magnitude is calibrated on (a star's `value` is its pooled radiance), so
 * the star's whole light is the pooled light over this share, and the wing
 * carries the rest.
 */
export const EYE_CORE_SHARE = eyePsfShare(GLARE_MAX_DEG, (t) => 1 - wingWindow(t))


/**
 * @typedef {object} Instrument
 * @property {string} name What it is
 * @property {number} apertureM The collecting aperture's diameter, metres
 * @property {number} collectingArea Over the dark-adapted eye's pupil
 * @property {number} integrationS Seconds
 * @property {number} darkGain The exposure it reaches in the dark over Earth's keyed one
 * @property {number} limitingMagnitude At darkGain
 * @property {number} limitValue What a star at the limit shows, exposure units
 * @property {number} pointPoolRad The detector's pool round a point, radians (the side of a square)
 * @property {{poolRadiusDeg: number, coreShare: number, wing: Function, wingGlsl: string, glare: Function,
 *   glareGlsl: string}} psf poolRadiusDeg where the pooled core hands over to the wing, in the
 *   instrument's own angle; coreShare the PSF's share within it; wing(θ°) the PSF per steradian,
 *   for a point; glare(θ°) the veil per steradian round a disc, over its range (0.1° to 100°)
 */


/** The naked eye, dark adapted: the app's observer. @type {Instrument} */
export const NAKED_EYE = Object.freeze({
  name: 'the naked eye, dark adapted',
  apertureM: EYE_PUPIL_M,
  collectingArea: 1,
  integrationS: EYE_INTEGRATION_S,
  darkGain: EYE_DARK_GAIN,
  limitingMagnitude: LIMITING_MAGNITUDE,
  limitValue: LIMIT_VALUE,
  pointPoolRad: EYE_POINT_RAD,
  psf: Object.freeze({
    poolRadiusDeg: EYE_POOL_RADIUS_DEG,
    coreShare: EYE_CORE_SHARE,
    wing: eyePsf,
    wingGlsl: EYE_PSF_GLSL,
    glare: glareFunction,
    glareGlsl: GLARE_GLSL,
  }),
})


/**
 * A field narrower than the naked eye's (INITIAL_FOV) is a telescope's: it
 * magnifies by the ratio of the half-angles' tangents (the far point's
 * fovScale, inverted), 1 at 45° and wider.
 *
 * @param {number} fovDegrees Vertical field of view
 * @returns {number} At least 1
 */
export function instrumentMagnification(fovDegrees) {
  const t = Math.tan(fovDegrees * Math.PI / 360)
  return t > 0 ? Math.max(Math.tan(INITIAL_FOV * Math.PI / 360) / t, 1) : 1
}


/**
 * The instrument's pool on the sky through a field (HDR.md, "A telescope's
 * field"): its angle in the eye over the magnification, which is where a
 * star's light lands.  So a star keeps its size on screen as the field
 * narrows, and its light, in that patch, rises over a surface's by the
 * magnification squared, as through a telescope whose exit pupil fills the
 * dark-adapted eye's.
 *
 * @param {number} fovDegrees Vertical field of view
 * @param {Instrument} [instrument]
 * @returns {number} Radians
 */
export function instrumentPatchRad(fovDegrees, instrument = NAKED_EYE) {
  return instrument.pointPoolRad / instrumentMagnification(fovDegrees)
}


/**
 * The gain on every point's light over the naked eye's: the collecting
 * area times the integration time, each over the eye's, times the user's
 * sensitivity in magnitudes (2.5× per magnitude: starMagnitude.js).  1 for
 * the eye at its setting of 0.
 *
 * @param {Instrument} instrument
 * @param {number} [sensitivityMag] The user's star setting, magnitudes
 * @returns {number}
 */
export function instrumentStarGain(instrument = NAKED_EYE, sensitivityMag = 0) {
  const area = instrument.collectingArea > 0 ? instrument.collectingArea : 1
  const time = instrument.integrationS > 0 ? instrument.integrationS / EYE_INTEGRATION_S : 1
  return area * time * Math.pow(10, 0.4 * (Number.isFinite(sensitivityMag) ? sensitivityMag : 0))
}
