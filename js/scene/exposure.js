import {ASTRO_UNIT_METER, DISPLAY_GAIN, SUN_LIGHT_DECAY, SUN_LUMINOUS_INTENSITY} from '../shared.js'


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
 * The solid angle of one pixel, steradians, for a vertical field of view
 * over a viewport height.
 *
 * @param {number} fovDegrees
 * @param {number} heightPx
 * @returns {number}
 */
export function pixelSolidAngle(fovDegrees, heightPx) {
  const radPerPx = (fovDegrees * Math.PI / 180) / Math.max(heightPx, 1)
  return radPerPx * radPerPx
}


/**
 * Metered exposure (HDR.md, "Metered exposure"): the mean log luminance of
 * the frame, in exposure units at the target-keyed exposure, over METER_KEY
 * gives a gain over that exposure, never below 1 (a sunlit target keeps the
 * look the keyed exposure gives it) and at most METER_GAIN_MAX (a star
 * field, with nothing but stars to meter, is lifted to where sixth
 * magnitude shows).  Pixels darker than METER_FLOOR count as METER_FLOOR, so
 * black is the floor's gain, not infinity.
 *
 * A sunlit body on black space (the Moon at quarter, 20% of the frame)
 * would read dark by the mean, with black counted as the floor; the gain
 * is also capped so that the luminance METER_HIGHLIGHT_FRACTION of the
 * frame exceeds maps to at most METER_HIGHLIGHT: a body covering more of
 * the frame than that anchors the exposure, while a star field, whose
 * sprites cover less, runs to the dark-adapted gain.
 *
 * @param {{meanLog: number, highlight: number}} metered meanLogLuminance's
 *   measure of the frame as it was rendered
 * @param {number} renderedOverKeyed The exposure the frame was rendered at
 *   over the target-keyed exposure (its gain at the time)
 * @returns {number} The gain the scene asks for
 */
export function meteredGain({meanLog, highlight}, renderedOverKeyed) {
  const rendered = Math.max(renderedOverKeyed, 1e-30)
  const lumaAtKeyed = Math.exp(meanLog) / rendered
  const highlightAtKeyed = highlight / rendered
  const byMean = METER_KEY / Math.max(lumaAtKeyed, METER_FLOOR)
  const byHighlight = METER_HIGHLIGHT / Math.max(highlightAtKeyed, METER_FLOOR)
  return Math.min(Math.max(Math.min(byMean, byHighlight), 1), METER_GAIN_MAX)
}


/**
 * @param {Float32Array} rgba Pixels, RGBA float
 * @param {number} count How many pixels
 * @returns {{meanLog: number, highlight: number}} The mean of
 *   ln(max(luma, METER_FLOOR)), and the luminance METER_HIGHLIGHT_FRACTION
 *   of the pixels exceed; NaN pixels are skipped
 */
export function meanLogLuminance(rgba, count) {
  let sum = 0
  const lumas = []
  for (let i = 0; i < count; i++) {
    const luma = (0.2126 * rgba[i * 4]) + (0.7152 * rgba[(i * 4) + 1]) + (0.0722 * rgba[(i * 4) + 2])
    if (Number.isFinite(luma)) {
      sum += Math.log(Math.max(luma, METER_FLOOR))
      lumas.push(luma)
    }
  }
  if (lumas.length === 0) {
    return {meanLog: Math.log(METER_FLOOR), highlight: METER_FLOOR}
  }
  lumas.sort((a, b) => b - a)
  const highlight = lumas[Math.min(lumas.length - 1, Math.floor(METER_HIGHLIGHT_FRACTION * lumas.length))]
  return {meanLog: sum / lumas.length, highlight: Math.max(highlight, METER_FLOOR)}
}


/** The mean luminance, in exposure units, the metered exposure aims for. */
export const METER_KEY = 0.3
/** Pixels darker than this, in exposure units, count as this. */
export const METER_FLOOR = 1e-7
/** The most the metered exposure rises over the target-keyed one. */
export const METER_GAIN_MAX = METER_KEY / METER_FLOOR
/** The share of the frame whose luminance the highlight cap looks at. */
export const METER_HIGHLIGHT_FRACTION = 0.02
/** The most that luminance is lifted to, in exposure units. */
export const METER_HIGHLIGHT = 0.3
/** The metered gain's adaptation time constant, seconds (log space). */
export const METER_TAU_SECONDS = 1.5
/** Frames between meterings. */
export const METER_EVERY_FRAMES = 4
