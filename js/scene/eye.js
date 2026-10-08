import {DISPLAY_GAIN, SUN_ILLUMINANCE_LUX} from '../shared.js'
import {
  EYE_POINT_RAD, LIMIT_VALUE, METER_GAIN_MAX, METER_KEY, SUN_APPARENT_MAGNITUDE, smoothstep,
} from './exposure.js'
import {NEUTRAL_TOE_CURVATURE, NEUTRAL_TOE_END, neutral} from './hdr.js'


/**
 * The dark-adapted eye's response to extended light, and its colour
 * (HDR.md, "The eye and extended light"; #186).
 *
 * The star field is calibrated on a point: at the dark-adapted gain a star
 * of magnitude 6.5, its light over the eye's 10′ patch, just shows
 * (exposure.js LIMITING_MAGNITUDE).  That patch is 20.3 mag/arcsec², 4.7×
 * the dark site's sky, so at the same gain an extended light at the
 * eye's own threshold for a large field, a tenth over the sky, is 0.0026
 * in exposure units, far down the tone map's toe, and the Milky Way's band
 * shows 2-10 of 255.  The eye sees it because its rods pool light over
 * large areas: Ricco's law (complete summation, threshold × area constant)
 * up to about half a degree, then Piper's (threshold × √area constant), to
 * a threshold contrast of about a tenth for fields of a few degrees, where
 * a point needs 4.7.  The display's viewer, light adapted, pools far less.
 *
 * So the night sky's diffuse light (the galaxy, the zodiacal light,
 * airglow) is tone-mapped by a response of its own, threshold for
 * threshold: the gain EXTENDED_GAIN_DARK puts the dark site's sky where
 * the eye's large-field threshold contrast over it is one step of the
 * display (Ward 1994's threshold mapping, through Neutral's toe).  It is
 * added over the image of the stars and the bodies in display values
 * (extendedToDisplay, displaySum, EYE_GLSL), not under it in exposure
 * units: the stars' calibration (a magnitude 6.5 star just shows) is a
 * dark site's, so it holds that sky already, and under the toe a pedestal
 * would raise faint stars, the opposite of what a brighter sky does.  So
 * every star's step on screen is what it was.  The meter reads the night
 * sky's physical light, unscaled.
 */


// The Sun's V-band illuminance at 1 AU (shared.js), which the Sun's light
// gives at 1 AU in three's units, now lux.
export {SUN_ILLUMINANCE_LUX}
/**
 * The luminance of one exposure unit at Earth's keyed exposure, cd/m²: a
 * white Lambertian surface facing the Sun at 1 AU, E/π = 4.0e4 cd/m², is
 * DISPLAY_GAIN.  So 2.7e4.
 */
export const EXPOSURE_UNIT_CD_M2 = SUN_ILLUMINANCE_LUX / (Math.PI * DISPLAY_GAIN)
/** A square arcsecond, steradians. */
export const ARCSEC2_SR = (Math.PI / 648000) ** 2
/** S10⊙, a tenth-magnitude Sun-like star per square degree, in V mag/arcsec²: 27.78. */
export const S10_MAG_ARCSEC2 = 10 + (2.5 * Math.log10(3600 * 3600))


/**
 * A V-band surface brightness in exposure units at Earth's keyed exposure,
 * as a star's light over its patch is (HDR.md, "Physical stars"): its
 * light per arcsec² over the Sun's at 1 AU, times DISPLAY_GAIN·π per
 * steradian.  22 mag/arcsec² (the dark site's sky, 1.7e-4 cd/m²) is
 * 6.4e-9.
 *
 * @param {number} magArcsec2
 * @returns {number}
 */
export function surfaceBrightnessValue(magArcsec2) {
  return DISPLAY_GAIN * Math.PI * Math.pow(10, -0.4 * (magArcsec2 - SUN_APPARENT_MAGNITUDE)) / ARCSEC2_SR
}


/**
 * @param {number} value Exposure units at Earth's keyed exposure
 * @returns {number} V mag/arcsec² (surfaceBrightnessValue's inverse)
 */
export function magPerArcsec2(value) {
  return SUN_APPARENT_MAGNITUDE - (2.5 * Math.log10(value * ARCSEC2_SR / (DISPLAY_GAIN * Math.PI)))
}


/**
 * @param {number} s10 A surface brightness in S10⊙ (the zodiacal light's unit)
 * @returns {number} Exposure units at Earth's keyed exposure
 */
export function s10Value(s10) {
  return surfaceBrightnessValue(S10_MAG_ARCSEC2 - (2.5 * Math.log10(s10)))
}


/**
 * The dark site's sky that the star field's calibration assumes, V
 * mag/arcsec² at the zenith: the naked eye's limit, 6.5, is the limit
 * there.  The natural night sky at a dark site at solar minimum, away from
 * the Milky Way and the ecliptic: 21.9-22.0 (Benn & Ellison 1998; Leinert
 * et al. 1998; recalled).
 */
export const DARK_SKY_MAG = 22.0
/**
 * The threshold contrast of a point's patch over that sky: the limit
 * star's radiance over its patch (exposure.js LIMIT_VALUE at
 * METER_GAIN_MAX) over the sky's, 4.7.  A point and the patch are one
 * detection: the patch (10′) is inside the rods' complete summation.
 */
export const POINT_THRESHOLD_CONTRAST = LIMIT_VALUE / (METER_GAIN_MAX * surfaceBrightnessValue(DARK_SKY_MAG))
/**
 * Ricco's area for dark-adapted rods, as a diameter: complete spatial
 * summation (the threshold's light, not its surface brightness, is fixed)
 * up to about half a degree near absolute threshold (Barlow 1958; recalled).
 */
export const RICCO_DIAMETER_RAD = 0.5 * Math.PI / 180
/**
 * The dark-adapted eye's threshold contrast for a large field (a few
 * degrees and up) over the dark site's sky.  Blackwell (1946)'s largest
 * discs (121′) at this luminance, 2e-4 cd/m², reach a few hundredths at
 * 50% detection in the laboratory; a soft-edged feature, seen without a
 * forced choice, needs two or three times that (Crumey 2014's field
 * factor).  The gegenschein and the zodiacal band, 10-30% over the sky,
 * are at the naked eye's limit at the darkest sites.  So a tenth (recalled
 * values; the sandbox reaches neither paper).
 */
export const LARGE_FIELD_THRESHOLD_CONTRAST = 0.1


/**
 * The dark-adapted eye's threshold contrast over the dark site's sky, for
 * a uniform disc of a given diameter: Ricco's law (contrast × area
 * constant) from a point to RICCO_DIAMETER_RAD, Piper's (contrast × √area
 * constant) beyond, to LARGE_FIELD_THRESHOLD_CONTRAST, where it stays.
 * Anchored on the point calibration: POINT_THRESHOLD_CONTRAST at the eye's
 * patch (EYE_POINT_RAD).  Piper's range ends at about 2.5°
 * (pipersEndRad).
 *
 * @param {number} diameterRad
 * @returns {number}
 */
export function thresholdContrast(diameterRad) {
  const d = Math.max(diameterRad, 1e-12)
  const ricco = POINT_THRESHOLD_CONTRAST * ((EYE_POINT_RAD / Math.min(d, RICCO_DIAMETER_RAD)) ** 2)
  const piper = d > RICCO_DIAMETER_RAD ? RICCO_DIAMETER_RAD / d : 1
  return Math.max(ricco * piper, LARGE_FIELD_THRESHOLD_CONTRAST)
}


/**
 * @returns {number} The diameter, radians, at which Piper's law reaches the
 *   large field's threshold (thresholdContrast)
 */
export function pipersEndRad() {
  const atRicco = POINT_THRESHOLD_CONTRAST * ((EYE_POINT_RAD / RICCO_DIAMETER_RAD) ** 2)
  return RICCO_DIAMETER_RAD * atRicco / LARGE_FIELD_THRESHOLD_CONTRAST
}


/** The display's least step, in display values: one of 255. */
export const DISPLAY_STEP = 1 / 255


/**
 * The extended response's gain at full dark adaptation: the gain at which
 * the dark site's sky (DARK_SKY_MAG at METER_GAIN_MAX), x, sits where the
 * eye's threshold for a large field over it, C·x, is one display step
 * through the tone map's toe, whose slope there is 2·k·x (k =
 * NEUTRAL_TOE_CURVATURE): 2k·C·x² = DISPLAY_STEP.  Ward (1994)'s
 * threshold mapping, which matches a just-visible difference in the scene
 * to a just-visible one on the display.  x = 0.056 (the sky 5 of 255), so
 * the gain is 2.2; the band at 20.5-22 mag/arcsec² then shows 15-45 of
 * 255.  The display step stands for the viewer's own threshold, which near
 * black is one or two steps; the gain goes as its square root.
 *
 * @returns {number}
 */
export function extendedGainDark() {
  const sky = surfaceBrightnessValue(DARK_SKY_MAG) * METER_GAIN_MAX
  const x = Math.sqrt(DISPLAY_STEP / (2 * NEUTRAL_TOE_CURVATURE * thresholdContrast(Math.PI)))
  return Math.min(x, NEUTRAL_TOE_END) / sky
}


/** extendedGainDark, once. */
export const EXTENDED_GAIN_DARK = extendedGainDark()


/**
 * The luminances, cd/m², over which vision goes from rods alone to cones
 * alone: the CIE's mesopic range (CIE 191:2010), 0.005 to 5.
 */
export const MESOPIC_CD_M2 = Object.freeze([0.005, 5])


/**
 * @param {number} cdM2 A luminance
 * @returns {number} How rod-dominated vision is at it: 1 under the mesopic
 *   range, 0 over it, smooth in log luminance between
 */
export function scotopicWeight(cdM2) {
  const l = Math.log10(Math.max(cdM2, 1e-12))
  return 1 - smoothstep(Math.log10(MESOPIC_CD_M2[0]), Math.log10(MESOPIC_CD_M2[1]), l)
}


/**
 * The luminance the eye is adapted to, cd/m², at an exposure: the metered
 * exposure brings the frame's mean to METER_KEY, so the adapted luminance
 * is METER_KEY over the gain, in exposure units at Earth's keyed exposure.
 * At the dark-adapted gain (4e6) 2e-3 cd/m², scotopic; at the keyed
 * exposure by day 8e3.
 *
 * @param {number} gainOverEarth The exposure over Earth's keyed one (exposureRelative)
 * @returns {number}
 */
export function adaptationLuminance(gainOverEarth) {
  return METER_KEY / Math.max(gainOverEarth, 1e-30) * EXPOSURE_UNIT_CD_M2
}


/**
 * The extended response's gain at an exposure: EXTENDED_GAIN_DARK where
 * the eye is rod-adapted, 1 where it is cone-adapted (by day and in
 * twilight, where the night sky is far under the day's light anyway), and
 * 1 where the frame is a photograph of the galaxy from outside (exposure.js
 * galaxyGain), not an eye.
 *
 * @param {number} gainOverEarth The exposure over Earth's keyed one
 * @param {number} [photograph] How far the galaxy's anchor frames the exposure, 0 to 1
 * @returns {number}
 */
export function extendedGain(gainOverEarth, photograph = 0) {
  const w = scotopicWeight(adaptationLuminance(gainOverEarth)) * (1 - Math.min(Math.max(photograph, 0), 1))
  return 1 + ((EXTENDED_GAIN_DARK - 1) * w)
}


/** Rec. 709 luma, as the meter's. */
const LUMA = [0.2126, 0.7152, 0.0722]


/**
 * The night sky's diffuse light to the display, as EYE_GLSL does it: its
 * physical luminance decides how much of it is seen by rods alone, which
 * see no colour (scotopicWeight: the band, at 1e-4 to 1e-3 cd/m², is grey
 * to the eye, the Purkinje regime) and pool it over large areas (the
 * extended gain, by the same share), then the tone map.
 *
 * @param {Array<number>} rgb Pre-exposed, exposure units at the frame's exposure
 * @param {number} gainOverEarth The frame's exposure over Earth's keyed one
 * @param {number} gain extendedGain's
 * @param {number} eye 1 for the eye, 0 for a photograph (galaxyGain's weight's complement)
 * @returns {Array<number>} Display values
 */
export function extendedToDisplay(rgb, gainOverEarth, gain, eye = 1) {
  const l = (LUMA[0] * rgb[0]) + (LUMA[1] * rgb[1]) + (LUMA[2] * rgb[2])
  const cd = l / Math.max(gainOverEarth, 1e-30) * EXPOSURE_UNIT_CD_M2
  const rods = scotopicWeight(cd)
  const grey = rods * eye
  // The rods' summation, the extended gain's reason, is theirs: light the
  // cones see (the zodiacal light within a few degrees of the Sun, 0.03-2
  // cd/m²) takes the stars' gain, as its colour comes back.
  const g = 1 + ((gain - 1) * rods)
  return neutral(rgb.map((v) => (v + ((l - v) * grey)) * g))
}


/**
 * The night sky's display values added to the image's, to white at most:
 * a star's step on screen over the night sky is its step over black, as
 * the star field is calibrated (the limit at a dark site, whose sky this
 * is), not raised by a pedestal in the toe nor lowered by a blend.
 *
 * @param {Array<number>} a The image of the stars and bodies, display values
 * @param {Array<number>} b The night sky's, extendedToDisplay's
 * @returns {Array<number>}
 */
export function displaySum(a, b) {
  return a.map((v, i) => Math.min(Math.max(v, 0) + Math.max(b[i], 0), 1))
}


/**
 * GLSL: `vec3 extendedToDisplay(vec3 rgb)` and `vec3 displaySum(vec3 a,
 * vec3 b)`, as the JS.  Needs neutralToneMap (hdr.js NEUTRAL_GLSL) and the
 * uniforms uExposureRelative (hdr.js absoluteUniforms), uExtendedGain and
 * uEyeMode (ThreeUi).
 */
export const EYE_GLSL = `
uniform float uExtendedGain;
uniform float uEyeMode;
const float EXPOSURE_UNIT_CD_M2 = ${EXPOSURE_UNIT_CD_M2.toExponential(6)};
vec3 extendedToDisplay(vec3 rgb) {
  float l = dot(rgb, vec3(${LUMA.join(', ')}));
  if (!(l > 0.0)) return vec3(0.0);
  float cd = l / max(uExposureRelative, 1.0e-30) * EXPOSURE_UNIT_CD_M2;
  float lo = ${Math.log10(MESOPIC_CD_M2[0]).toFixed(6)};
  float hi = ${Math.log10(MESOPIC_CD_M2[1]).toFixed(6)};
  float t = clamp((log(max(cd, 1.0e-12)) / log(10.0) - lo) / (hi - lo), 0.0, 1.0);
  float rods = 1.0 - t * t * (3.0 - 2.0 * t);
  return neutralToneMap(mix(rgb, vec3(l), rods * uEyeMode) * (1.0 + (uExtendedGain - 1.0) * rods));
}
vec3 displaySum(vec3 a, vec3 b) {
  return min(max(a, 0.0) + max(b, 0.0), vec3(1.0));
}
`
