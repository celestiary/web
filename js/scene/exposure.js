import {DISPLAY_GAIN, SUN_LIGHT_DECAY, SUN_LUMINOUS_INTENSITY} from '../shared.js'


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
  return DISPLAY_GAIN * Math.PI * Math.pow(distanceMeters, SUN_LIGHT_DECAY) / SUN_LUMINOUS_INTENSITY
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
