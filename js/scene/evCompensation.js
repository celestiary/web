/**
 * The user's exposure compensation (HDR.md, "User exposure"): a photograph's
 * EV dial, in stops, laid over the exposure the scene is metered to, to boost
 * or cut a frame to match a target photo.  A stop is a doubling of the light,
 * so the compensation is one multiplier, 2^EV, on the metered exposure
 * (renderExposure); EV 0 is the metered exposure itself.
 */

/** A key press steps the compensation a third of a stop, as a camera's dial. */
export const EV_STEPS_PER_STOP = 3

/** The compensation's range, stops each way: 2^10 is a factor of 1,024. */
export const EV_MAX = 10


/**
 * @param {number} ev Stops
 * @returns {number} Held to ±EV_MAX; 0 for anything but a number
 */
export function clampEv(ev) {
  return Number.isFinite(ev) ? Math.min(Math.max(ev, -EV_MAX), EV_MAX) : 0
}


/**
 * The multiplier for a compensation.
 *
 * @param {number} ev Stops
 * @returns {number} 2^EV, 1 at 0
 */
export function evGain(ev) {
  return 2 ** clampEv(ev)
}


/**
 * The exposure a frame renders with: the target-keyed exposure times the
 * metered gain, times the user's compensation.  The one place the
 * compensation meets the metered gain; the metering itself never sees it
 * (the meter divides its readback by the gain the frame rendered with, so
 * a compensation moves the picture and not what it is metered to).
 *
 * @param {number} keyed The target-keyed exposure
 * @param {number} meterGain The metered gain over it
 * @param {number} ev The compensation, stops
 * @returns {number}
 */
export function renderExposure(keyed, meterGain, ev) {
  return keyed * meterGain * evGain(ev)
}


/**
 * Step the compensation by whole thirds of a stop, snapping to the thirds:
 * from a typed or linked 1.3 the next step up is 1⅔, not 1.6333.
 *
 * @param {number} ev Stops
 * @param {number} steps Thirds of a stop: positive for brighter
 * @returns {number} Stops, held to ±EV_MAX
 */
export function stepEv(ev, steps) {
  const thirds = Math.round(clampEv(ev) * EV_STEPS_PER_STOP) + steps
  return clampEv(thirds / EV_STEPS_PER_STOP)
}


/**
 * Round a compensation to what the link carries, two decimal places, so a
 * third is 0.33 and comes back (stepEv) to the same third.
 *
 * @param {number} ev Stops
 * @returns {number}
 */
export function roundEv(ev) {
  // `+ 0` makes a rounded -0 a 0.
  return parseFloat(clampEv(ev).toFixed(2)) + 0
}


/**
 * The readout: one decimal, signed, as a camera shows it (+1.3 is 1⅓).
 *
 * @param {number} ev Stops
 * @returns {string} 'EV 0', 'EV +1.3', 'EV -0.7'
 */
export function formatEv(ev) {
  const v = parseFloat(clampEv(ev).toFixed(1)) + 0
  if (v === 0) {
    return 'EV 0'
  }
  return `EV ${v > 0 ? '+' : ''}${v.toFixed(1)}`
}
