// A label group's look by how near or prominent each of its labels is
// (DESIGN.md, label styles): within its group, a label's text runs from the
// group's smallest size to its largest, and its brightness from half the
// brightest to the brightest, as its prominence runs from 0 to 1.  Between
// groups the ranges stack by how near the group's labels usually are:
// satellites' smallest above bodies', above stars', and a near body's at
// the top, over every satellite's.  Satellites are the first group to use
// it (population/Population.md, names by distance).


/**
 * @typedef {object} LabelStyle
 * @property {number} near where prominence is 1: a distance, m, or any
 *   measure that is smaller for the more prominent
 * @property {number} far where it is 0
 * @property {[number, number]} size the text's height at prominence 0 and 1,
 *   px (the sheet's font units, in which 'medium' is 16)
 * @property {[number, number]} brightness at prominence 0 and 1
 * @property {'log'|'linear'} [interpolation] how the measure maps between
 *   near and far: by its logarithm (the default) or as it is
 */


/** Earth's satellites: by their distance from the camera, 1,000 km to 50,000 km. */
export const SATELLITE_LABELS = {near: 1e6, far: 5e7, size: [11, 14], brightness: [0.5, 1]}


/**
 * @param {number} x the label's measure (its distance from the camera)
 * @param {LabelStyle} style
 * @returns {number} its prominence, 1 at `near` or nearer, 0 at `far` or farther
 */
export function prominence(x, style) {
  const log = style.interpolation !== 'linear'
  const f = log ? Math.log : (v) => v
  const t = (f(style.far) - f(Math.max(x, Number.MIN_VALUE))) / (f(style.far) - f(style.near))
  return Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0
}


/**
 * @param {number} p prominence, 0 to 1
 * @param {LabelStyle} style
 * @returns {{size: number, scale: number, brightness: number}} the text's
 *   height, px; that as a scale of the largest (SpriteSheet.setStyle); and
 *   its brightness
 */
export function labelLook(p, style) {
  const [s0, s1] = style.size
  const [b0, b1] = style.brightness
  const size = s0 + ((s1 - s0) * p)
  return {size, scale: size / s1, brightness: b0 + ((b1 - b0) * p)}
}


/**
 * @param {LabelStyle} style
 * @returns {string} the font a scalable sheet draws its text in: at its
 *   largest, made smaller per label
 */
export function labelFont(style) {
  return `${style.size[1]}px arial`
}
