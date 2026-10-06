/**
 * When a cached view of something smooth (the galaxy's march, the zodiacal
 * light's integral) needs rendering again: the camera moved more than the
 * cache can show, the view turned more than half a texel, or the
 * projection changed.  So a still view costs nothing, and a view turning
 * slowly (the sky with time running, from a landed camera) re-renders it
 * every few frames, not every frame (#186; the user's 18 FPS).
 */


/**
 * @param {{elements: Array<number>}} a A rotation (three's Matrix3)
 * @param {{elements: Array<number>}} b Another
 * @returns {number} The angle of the rotation between them, radians:
 *   acos((trace(aᵀb) − 1) / 2), trace(aᵀb) being the sum of their
 *   elements' products
 */
export function rotationAngle(a, b) {
  let trace = 0
  for (let i = 0; i < 9; i++) {
    trace += a.elements[i] * b.elements[i]
  }
  return Math.acos(Math.min(Math.max((trace - 1) / 2, -1), 1))
}


/**
 * @param {{position: Array<number>, view: object, proj: Array<number>}|null} last The cached view
 * @param {Array<number>} position The camera, in the cache's units
 * @param {object} view Its rotation (a Matrix3)
 * @param {Array<number>} proj The projection's terms the cache uses
 * @param {number} moveTolerance How far the camera may move, in those units
 * @param {number} texelRad A texel's angle, radians
 * @returns {boolean} Whether to render the cache again
 */
export function viewChanged(last, position, view, proj, moveTolerance, texelRad) {
  if (!last || proj.some((v, i) => v !== last.proj[i])) {
    return true
  }
  if (Math.hypot(...position.map((v, i) => v - last.position[i])) > moveTolerance) {
    return true
  }
  return rotationAngle(last.view, view) > 0.5 * texelRad
}
