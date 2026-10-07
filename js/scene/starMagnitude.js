/**
 * The stars' setting (`[` and `]`), the user's "exposure for just the
 * stars" (HDR.md, "Physical stars"): how far the limiting magnitude is moved
 * from the naked eye's (LIMITING_MAGNITUDE, 6.5).  0 is the default, so
 * the control reads and links as a camera's EV does: 0 where it starts,
 * `Stars +1.0 mag` a magnitude more stars, back to 0 by stepping back.
 *
 * It is held as this offset, in magnitudes, rather than as the star gain or
 * the limit itself, so stepping up and down returns to exactly 0: the gain
 * is 10^(0.4 × offset), a power of 10 with no exact inverse, and the limit
 * 6.5 + offset - 6.5 need not be exact.  Magnitudes, not stops: the
 * control is a limiting magnitude and each press is half of one, as in
 * Celestia, where a stop (a doubling of light) would be 0.753 mag.
 */

/** A key press steps the setting half a magnitude, as Celestia's do. */
export const STAR_MAG_STEPS_PER_MAG = 2

/** The setting's range, magnitudes each way: 10 is a factor of 10^4 in light. */
export const STAR_MAG_MAX = 10


/**
 * @param {number} mag Magnitudes over the naked eye's limit
 * @returns {number} Held to ±STAR_MAG_MAX; 0 for anything but a number
 */
export function clampStarMag(mag) {
  return Number.isFinite(mag) ? Math.min(Math.max(mag, -STAR_MAG_MAX), STAR_MAG_MAX) : 0
}


/**
 * The gain on every star's light over the physical value that a setting is:
 * 2.5× per magnitude.
 *
 * @param {number} mag Magnitudes
 * @returns {number} 1 at 0
 */
export function starMagGain(mag) {
  return 10 ** (0.4 * clampStarMag(mag))
}


/**
 * Step the setting by whole half magnitudes, snapping to them: from a typed
 * or linked 1.3 the next step up is 2, not 1.8.
 *
 * @param {number} mag Magnitudes
 * @param {number} steps Half magnitudes: positive for more stars
 * @returns {number} Magnitudes, held to ±STAR_MAG_MAX; never -0
 */
export function stepStarMag(mag, steps) {
  const halves = Math.round(clampStarMag(mag) * STAR_MAG_STEPS_PER_MAG) + steps
  // `+ 0` makes a -0 a 0.
  return clampStarMag(halves / STAR_MAG_STEPS_PER_MAG) + 0
}


/**
 * Round a setting to what the link carries, two decimal places; never -0.
 *
 * @param {number} mag Magnitudes
 * @returns {number}
 */
export function roundStarMag(mag) {
  return parseFloat(clampStarMag(mag).toFixed(2)) + 0
}


/**
 * The readout, as EV's: one decimal, signed.
 *
 * @param {number} mag Magnitudes
 * @returns {string} 'Stars 0 mag', 'Stars +1.5 mag', 'Stars -0.5 mag'
 */
export function formatStarMag(mag) {
  const v = parseFloat(clampStarMag(mag).toFixed(1)) + 0
  if (v === 0) {
    return 'Stars 0 mag'
  }
  return `Stars ${v > 0 ? '+' : ''}${v.toFixed(1)} mag`
}
