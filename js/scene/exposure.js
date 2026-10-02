import {ASTRO_UNIT_METER, DISPLAY_GAIN, SUN_LIGHT_DECAY, SUN_LUMINOUS_INTENSITY} from '../shared.js'
import {HDR_MAX_VALUE} from './hdr.js'


/**
 * Target-keyed exposure: the renderer's tone-mapping exposure is set so the
 * targeted body's sunlit side renders at its albedo (a surface facing the
 * Sun shows its texture's colour), as a spacecraft camera adapts to what
 * it's pointed at.  Bodies far from the Sun would otherwise be dim and
 * near ones blown out; one fixed exposure (3e-16 before) put Mars's and
 * Earth's lit sides at ~12-18× albedo, compressed toward white.
 *
 * Celestiary's Sun is a PointLight: a surface d metres out facing it gets
 * irradiance E = I / d^decay, and a Lambertian one reflects E·albedo/π.
 * Scaled by exposure π·d^decay / I that is the albedo; DISPLAY_GAIN (shared
 * with Cesium's layers) brightens both alike.
 */


/**
 * @param {number} distanceMeters The body's distance from the Sun
 * @returns {number} toneMappingExposure for which it renders at its albedo
 *   times DISPLAY_GAIN
 */
export function exposureAt(distanceMeters) {
  return DISPLAY_GAIN * Math.PI / irradianceAt(distanceMeters)
}


/**
 * @param {number} distanceMeters Distance from the Sun
 * @returns {number} The Sun's irradiance there, in three's units (the
 *   PointLight's intensity over d^decay)
 */
export function irradianceAt(distanceMeters) {
  return SUN_LUMINOUS_INTENSITY / Math.pow(distanceMeters, SUN_LIGHT_DECAY)
}


/**
 * The atmosphere pass's sky scale (HDR.md, "The sky in exposure units"): its
 * in-scatter times a body's `sunIntensity` is the sky in exposure units when
 * the body is the exposure target, and this factor carries it to any other
 * exposure: the Sun's irradiance at the body, times the exposure, over the
 * π·DISPLAY_GAIN that exposureAt normalizes a sunlit surface by.  So 1 at
 * the body's own exposure; and the sky dims or brightens with the exposure
 * as the surface under it does.
 *
 * @param {number} distanceMeters The body's distance from the Sun
 * @param {number} exposure The renderer's toneMappingExposure
 * @returns {number}
 */
export function skyExposure(distanceMeters, exposure) {
  return irradianceAt(distanceMeters) * exposure / (DISPLAY_GAIN * Math.PI)
}


/**
 * Ease exposure toward its goal, evenly in log space (in stops), as an eye
 * or auto-exposing camera adapts.
 *
 * @param {number} current
 * @param {number} goal
 * @param {number} dtSeconds Time since the last step
 * @param {number} tauSeconds Time constant: ~63% of the way per tau
 * @returns {number}
 */
export function easeExposure(current, goal, dtSeconds, tauSeconds = EXPOSURE_TAU_SECONDS) {
  if (!(current > 0) || !(dtSeconds >= 0)) {
    return goal
  }
  const k = 1 - Math.exp(-dtSeconds / tauSeconds)
  if (k >= 1) {
    return goal
  }
  return Math.exp(Math.log(current) + ((Math.log(goal) - Math.log(current)) * k))
}


/** Adaptation time constant, seconds. */
export const EXPOSURE_TAU_SECONDS = 0.5


/**
 * The exposure relative to Earth's keyed one: 1 when a body 1 AU from the
 * Sun is the exposure target at its own exposure.  Everything of absolute
 * brightness (a star's light, the Milky Way's glow, the Sun's disc) is
 * scaled by it: a star's pixel value is its illuminance over the Sun's at
 * 1 AU, times π·DISPLAY_GAIN over the pixel's solid angle, times this
 * (HDR.md, "Physical stars").
 *
 * @param {number} exposure The renderer's toneMappingExposure
 * @returns {number}
 */
export function exposureRelative(exposure) {
  return exposure / exposureAt(ASTRO_UNIT_METER)
}


/**
 * The solid angle a point source's light lands in, steradians: one pixel,
 * for a vertical field of view over a viewport height, or the dark-adapted
 * eye's resolution of a point (EYE_POINT_RAD) where a pixel is finer.  The
 * stars' shader does the same (shaders/stars.vert; HDR.md "Physical
 * stars").
 *
 * @param {number} fovDegrees
 * @param {number} heightPx
 * @returns {number}
 */
export function pointSolidAngle(fovDegrees, heightPx) {
  const radPerPx = Math.max((fovDegrees * Math.PI / 180) / Math.max(heightPx, 1), EYE_POINT_RAD)
  return radPerPx * radPerPx
}


/** The eye's resolution of a point, dark adapted: 10 arcmin, in radians. */
export const EYE_POINT_RAD = 10 / 60 * Math.PI / 180


/**
 * Metered exposure (HDR.md, "Metered exposure"): the mean log luminance of
 * the frame, in exposure units at the target-keyed exposure, over METER_KEY
 * gives a gain over that exposure, never below 1 for a sunlit target (it
 * keeps the look the keyed exposure gives it) and at most METER_GAIN_MAX (a
 * star field, with nothing but stars to meter, is lifted to the eye's dark
 * adaptation).  Pixels darker than METER_FLOOR count as METER_FLOOR, so
 * black is the floor's gain, not infinity.
 *
 * A sunlit body on black space (the Moon at quarter, 20% of the frame)
 * would read dark by the mean, with black counted as the floor; the gain
 * is also capped so that the luminance METER_HIGHLIGHT_FRACTION of the
 * frame exceeds maps to at most METER_HIGHLIGHT: a body covering more of
 * the frame than that anchors the exposure, while a star field, whose
 * sprites cover less, runs to the dark-adapted gain.
 *
 * And the one way down: where the luminance METER_BLOWN_FRACTION (a
 * quarter) of the frame exceeds is over METER_HIGHLIGHT_MAX, brighter than
 * a sunlit white surface (the Sun's disc, 46,000 of them, filling the
 * frame), the gain falls to bring it there, to METER_GAIN_MIN at most.  A
 * sunlit surface is never over it, so no planet is darkened; nor is a
 * frame for a small highlight that is (the sky round a low Sun, 2% of it
 * at 6), which clips, as a camera lets it.
 *
 * A frame with nothing in it at all (every pixel under METER_FLOOR: a
 * planet's texture, or the star catalogue, still loading) asks for
 * nothing: null, and the gain stays where it is.  Running to the
 * dark-adapted gain on a black loading frame rendered the planet 3e6
 * times too bright when it came.
 *
 * @param {{meanLog: number, highlight: number, blown: number, max: number}} metered
 *   meanLogLuminance's measure of the frame as it was rendered
 * @param {number} renderedOverKeyed The exposure the frame was rendered at
 *   over the target-keyed exposure (its gain at the time)
 * @returns {number|null} The gain the scene asks for; null for no scene
 */
export function meteredGain({meanLog, highlight, blown, max}, renderedOverKeyed) {
  if (!(max > METER_FLOOR)) {
    return null
  }
  const rendered = Math.max(renderedOverKeyed, 1e-30)
  const lumaAtKeyed = Math.exp(meanLog) / rendered
  const highlightAtKeyed = highlight / rendered
  const blownAtKeyed = blown / rendered
  if (blownAtKeyed > METER_HIGHLIGHT_MAX) {
    return Math.max(METER_HIGHLIGHT_MAX / blownAtKeyed, METER_GAIN_MIN)
  }
  const byMean = METER_KEY / Math.max(lumaAtKeyed, METER_FLOOR)
  const byHighlight = METER_HIGHLIGHT / Math.max(highlightAtKeyed, METER_FLOOR)
  return Math.min(Math.max(Math.min(byMean, byHighlight), 1), METER_GAIN_MAX)
}


/**
 * @param {Float32Array|Uint8Array} rgba Pixels, RGBA: floats, or bytes
 *   (the LDR fallback's target), which count as their value over 255
 * @param {number} count How many pixels
 * @returns {{meanLog: number, highlight: number, blown: number, max: number}}
 *   The mean of ln(max(luma, METER_FLOOR)), the luminance
 *   METER_HIGHLIGHT_FRACTION of the pixels exceed, the one
 *   METER_BLOWN_FRACTION of them exceed, and the brightest; a pixel that
 *   isn't finite (overflowed) counts as the buffer's most, HDR_MAX_VALUE
 */
export function meanLogLuminance(rgba, count) {
  const scale = rgba instanceof Uint8Array ? 1 / 255 : 1
  let sum = 0
  const lumas = []
  for (let i = 0; i < count; i++) {
    let luma = ((0.2126 * rgba[i * 4]) + (0.7152 * rgba[(i * 4) + 1]) + (0.0722 * rgba[(i * 4) + 2])) * scale
    if (!Number.isFinite(luma)) {
      luma = HDR_MAX_VALUE
    }
    sum += Math.log(Math.max(luma, METER_FLOOR))
    lumas.push(luma)
  }
  if (lumas.length === 0) {
    return {meanLog: Math.log(METER_FLOOR), highlight: METER_FLOOR, blown: METER_FLOOR, max: 0}
  }
  lumas.sort((a, b) => b - a)
  const exceeded = (fraction) => Math.max(lumas[Math.min(lumas.length - 1, Math.floor(fraction * lumas.length))], METER_FLOOR)
  return {
    meanLog: sum / lumas.length,
    highlight: exceeded(METER_HIGHLIGHT_FRACTION),
    blown: exceeded(METER_BLOWN_FRACTION),
    max: lumas[0],
  }
}


/** The mean luminance, in exposure units, the metered exposure aims for. */
export const METER_KEY = 0.3
/** Pixels darker than this, in exposure units, count as this. */
export const METER_FLOOR = 1e-7
/** The most the metered exposure rises over the target-keyed one. */
export const METER_GAIN_MAX = METER_KEY / METER_FLOOR
/** The share of the frame whose luminance the highlight cap looks at. */
export const METER_HIGHLIGHT_FRACTION = 0.02
/**
 * The most that luminance is lifted to, in exposure units: a sunlit
 * surface of albedo 0.4 (DISPLAY_GAIN × 0.4).  Brighter than that, the
 * frame holds a sunlit surface and the keyed exposure stands (the Moon at
 * quarter, Mars from orbit, Earth's clouds); dimmer (a low Sun's sky and
 * ground, twilight), the frame is lifted toward the key.
 */
export const METER_HIGHLIGHT = 0.6
/**
 * The most that luminance is let stand at, in exposure units: a sunlit
 * white surface (DISPLAY_GAIN); over it the gain falls below 1.
 */
export const METER_HIGHLIGHT_MAX = DISPLAY_GAIN
/** The share of the frame that must be over it for the gain to fall. */
export const METER_BLOWN_FRACTION = 0.25
/** The least the metered exposure falls to under the target-keyed one. */
export const METER_GAIN_MIN = 1e-5
/**
 * The metered gain's adaptation time constants, seconds (log space): up,
 * as the eye adapts to the dark, slowly; down, to the light, fast, as a
 * camera's auto-exposure, so a planet come upon from a star field is
 * blown out for a second, not five.
 */
export const METER_TAU_UP_SECONDS = 1.5
export const METER_TAU_DOWN_SECONDS = 0.3
/** Frames between meterings. */
export const METER_EVERY_FRAMES = 4
