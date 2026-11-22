import {DISPLAY_GAIN, INITIAL_FOV} from '../../shared.js'
import {sceneOfScreen} from '../screen.js'
import {
  CAMERA_GLARE_GLSL, EYE_PSF_GLSL, GLARE_GLSL, GLARE_MAX_DEG, GLARE_MODEL_CAMERA, GLARE_MODEL_EYE, cameraGlareFunction,
  eyePsf, eyePsfShare, glareFunction,
} from '../sun/glare.js'


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
 *   and what a star at it shows on the screen; with the detector's pool
 *   round a point (the eye's rods: 10′), which the pooled radiance is
 *   over, they set the dark gain.
 * - **The PSF**: the pool's radius, within which a point's light is pooled
 *   and drawn as the core; the share of the light the PSF puts there; and
 *   the wing, the scattering round a point per steradian by the angle from
 *   it, which is the veil round a bright star and round a disc (the glare).
 * - **The adaptation**: how fast its exposure follows the light
 *   (ADAPTATION; exposure.js adaptMeterGain, ThreeUi._updateExposure).
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
 * The limiting magnitude (HDR.md, "Physical stars"): the naked eye's at a
 * dark site, dark adapted.  The one parameter the star field is
 * calibrated on: a star of this magnitude shows LIMIT_VALUE at the dark
 * gain, brighter ones 2.5× more light per magnitude, fainter ones less,
 * down into black smoothly (no pop); the dark gain follows from it and
 * the eye's patch (EYE_DARK_GAIN).
 */
export const LIMITING_MAGNITUDE = 6.5
/**
 * What a star at the limit shows on the screen, a screen value (screen.js):
 * 0.08, 20 of 255, just visible.  The calibration is on the screen, so that
 * the light the display emits for the limit star is what it was meant to
 * be whatever the output transform: it is what the limit star's 0.12
 * showed through the tone map alone, before the frame was sRGB-encoded.
 */
export const LIMIT_SCREEN = 0.08
/**
 * What a star at the limit shows, in exposure units at the dark gain: the
 * scene value whose screen value is LIMIT_SCREEN, 0.034 in Neutral's toe
 * (0.12 while the screen took the tone map's output unencoded).
 */
export const LIMIT_VALUE = sceneOfScreen(LIMIT_SCREEN)
/**
 * The eye's patch's side, radians: the side of the square a point's light
 * is pooled over, 9.7′, the dark-adapted eye's resolution of a point (rod
 * acuity, ~20/200, 10 arcmin), inside the rods' complete summation
 * (Ricco's area, about half a degree: eye.js RICCO_DIAMETER_RAD), so a
 * point and its patch are one detection.  A physical input: the dark gain
 * is derived from it (EYE_DARK_GAIN).  It is the 9.69′ that the
 * calibration before the screen was encoded (the limit star at 0.12 at a
 * gain of 4e6) gave.
 */
export const EYE_POINT_RAD = 9.69 / 60 * Math.PI / 180
/** The eye's patch, steradians: 7.9e-6. */
export const EYE_PATCH_SR = EYE_POINT_RAD * EYE_POINT_RAD
/**
 * The exposure the dark-adapted eye reaches, over Earth's keyed exposure:
 * the gain at which a star at LIMITING_MAGNITUDE, its light over the patch,
 * shows LIMIT_VALUE (a star's value is DISPLAY_GAIN·π·ratio/Ω·gain,
 * stars.vert), so LIMIT_SCREEN on the screen.  1.13e6: a scene of 2.8e-2
 * cd/m² (a moonlit landscape) shown as a sunlit one.  The metered
 * exposure's ceiling (exposure.js METER_GAIN_MAX).  It was 4e6 while the
 * screen took the tone map's output unencoded: the encoding lifts the toe,
 * and the gain comes down by what keeps the limit star's light on the
 * screen, 3.54 (about √12.92, sRGB's linear slope, under its square).
 */
export const EYE_DARK_GAIN = LIMIT_VALUE * EYE_PATCH_SR / (DISPLAY_GAIN * Math.PI * illuminanceRatio(LIMITING_MAGNITUDE))
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
 *   glareGlsl: string, glareModel: number}} psf poolRadiusDeg where the pooled core hands over to the
 *   wing, in the instrument's own angle; coreShare the PSF's share within it; wing(θ°) the PSF per
 *   steradian, for a point; glare(θ°) the veil per steradian round a disc, over its range (0.1° to
 *   100°), and glareModel which of the glare pass's functions it is (glare.js GLARE_MODEL_*)
 * @property {{upSeconds: number, downSeconds: number, exposureSeconds: number}} adaptation How fast
 *   its exposure follows the light (ADAPTATION): the metered gain's time constants rising (to the
 *   dark) and falling (to the light), and the exposure's own toward the meter's and the target's
 * @property {?number} fieldMaxDeg The optics' field: the widest it sees, degrees (null: no range,
 *   the field is free, as the naked eye's is in celestiary)
 * @property {?number} pixelScaleArcsec A detector pixel on the sky, arcseconds: the narrowest
 *   field is where one is one screen pixel (instrumentFieldRange)
 * @property {?number} resolutionArcsec What it resolves, arcseconds, where that differs from the
 *   pixel (a telescope's delivered image quality: seeing)
 */


/**
 * How fast the observer's exposure follows the light, as time constants in
 * seconds, each in log space (exposure.js easeExposure: 63% of the way, in
 * stops, per constant): the metered gain rising, as the eye adapts to the
 * dark (`upSeconds`), and falling, as a camera's auto-exposure catches a
 * bright planet come upon from a star field (`downSeconds`); and the
 * rendered exposure's own ease toward the meter's and the target-keyed
 * exposure (`exposureSeconds`: between targets, and over the meter's).
 *
 * The instrument's, not the scene's: what the sky sends doesn't change with
 * how fast the eye or camera looking at it adapts (#236).  The real eye's
 * dark adaptation takes minutes (the rods' twenty to thirty); these are a
 * camera's, chosen to get one's bearings by.  They were 1.5 s, 0.3 s and
 * 0.5 s, halved at the maintainer's review: more like an eye's first
 * seconds, but slow to look about the first scene by (from the Sun's
 * stopped-down disc to the dark-adapted field, 17 stops, a stop of the goal
 * in about 4 s; now 2 s).
 */
export const ADAPTATION = Object.freeze({
  upSeconds: 0.75,
  downSeconds: 0.15,
  exposureSeconds: 0.25,
})


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
    glareModel: GLARE_MODEL_EYE,
  }),
  adaptation: ADAPTATION,
  fieldMaxDeg: null,
  pixelScaleArcsec: null,
  resolutionArcsec: null,
})


/**
 * A camera (Sun.md, "Glare"; HDR.md, "The instrument"): the user's other
 * observer (the Observer setting, `K` in a link's `s=`), the naked eye's
 * light and star PSF with a lens's veiling glare round a disc
 * (glare.js cameraGlareFunction, 10 to 35 times under the eye's), so the
 * Sun in or near the field veils the frame as in a photograph (from the
 * ISS, the air over Earth's limb with the Sun 20° off) and not as in the
 * eye.  The stars' PSF and calibration stay the eye's: the star shaders
 * carry the eye's PSF as a function and the limit is the dark-adapted
 * eye's, which a camera's own response (#208) would replace together;
 * changing the wing alone would change every star's look with no
 * calibration under it.  An app's instrument (Rubin's) overrides it while
 * the app runs (ThreeUi.setInstrument), and stopping the app returns to it.
 *
 * @type {Instrument}
 */
export const CAMERA = Object.freeze({
  ...NAKED_EYE,
  name: 'a camera',
  psf: Object.freeze({
    ...NAKED_EYE.psf,
    glare: cameraGlareFunction,
    glareGlsl: CAMERA_GLARE_GLSL,
    glareModel: GLARE_MODEL_CAMERA,
  }),
})


/**
 * The Vera C. Rubin Observatory's Simonyi Survey Telescope and its camera
 * (scene/rubin/Rubin.md, "The optics"), which the Rubin app makes the
 * active instrument while it runs (ThreeUi.setInstrument): an 8.4 m
 * primary (6.4 m effective, the central obscuration taken out), a field
 * 3.5° across (9.6 deg²), 0.2″ pixels, and a delivered image quality of
 * about 0.7″ FWHM, seeing-limited on Cerro Pachón.
 *
 * For now only its field is its own.  Its light and its point spread
 * function are the eye's, copied (#340 carries the view as the instrument
 * sees it): a collecting area of 1, so the star field doesn't jump when
 * the app opens and the user's star setting (`sm=`) is still the
 * sensitivity, and the eye's PSF and adaptation, which the star shader
 * and the meter read through `ui.instrument` as ever.
 *
 * @type {Instrument}
 */
export const RUBIN = Object.freeze({
  ...NAKED_EYE,
  name: 'the Rubin Observatory\'s Simonyi Survey Telescope',
  apertureM: 8.4,
  fieldMaxDeg: 3.5,
  pixelScaleArcsec: 0.2,
  resolutionArcsec: 0.7,
})


/**
 * The field an instrument's optics allow (Rubin.md, "The optics"): from
 * its widest field down to where one of its detector pixels is one screen
 * pixel at the canvas's height, `pixelScaleArcsec × heightPx` (200″, 0.056°,
 * for Rubin on a 1,000 px canvas), past which zooming only magnifies
 * pixels.  A vertical field, as the camera's is.
 *
 * @param {Instrument} instrument
 * @param {number} heightPx The canvas's height, device pixels
 * @returns {?{minDeg: number, maxDeg: number}} null for an instrument with
 *   no range (the naked eye)
 */
export function instrumentFieldRange(instrument, heightPx) {
  const max = instrument?.fieldMaxDeg
  if (!(max > 0)) {
    return null
  }
  const pixelDeg = instrument.pixelScaleArcsec > 0 ? instrument.pixelScaleArcsec / 3600 : 0
  return {minDeg: Math.min(pixelDeg * Math.max(heightPx, 1), max), maxDeg: max}
}


/**
 * @param {number} fovDegrees
 * @param {?{minDeg: number, maxDeg: number}} range instrumentFieldRange's
 * @returns {number} The field held to the range; as given with none
 */
export function clampField(fovDegrees, range) {
  return range ? Math.min(Math.max(fovDegrees, range.minDeg), range.maxDeg) : fovDegrees
}


/**
 * @param {number} fovDegrees
 * @param {?{minDeg: number, maxDeg: number}} range
 * @returns {?string} 'max' at the widest field, 'min' at the pixel limit,
 *   null inside the range or with none
 */
export function fieldEnd(fovDegrees, range) {
  if (!range) {
    return null
  }
  if (fovDegrees >= range.maxDeg * (1 - 1e-9)) {
    return 'max'
  }
  return fovDegrees <= range.minDeg * (1 + 1e-9) ? 'min' : null
}


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
