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


/**
 * Whether every ray from a point outside a sphere hits it: the view's four
 * corner rays are enough, as the rays that hit a sphere from outside make
 * a round cone, and the frustum's rays a convex set its corners span.  So
 * the ground fills the view, and nothing beyond it can show (#187: the
 * night sky's light, from the surface looking down).
 *
 * @param {Array<number>} origin The camera
 * @param {Array<Array<number>>} dirs The rays, unit
 * @param {Array<number>} center The sphere's centre
 * @param {number} radius Its radius
 * @returns {boolean} False from inside the sphere, or if any ray misses it
 */
export function raysAllHitSphere(origin, dirs, center, radius) {
  const oc = center.map((v, i) => v - origin[i])
  const c = (oc[0] * oc[0]) + (oc[1] * oc[1]) + (oc[2] * oc[2]) - (radius * radius)
  if (!(c > 0)) {
    return false
  }
  return dirs.every((d) => {
    const b = (d[0] * oc[0]) + (d[1] * oc[1]) + (d[2] * oc[2])
    return b > 0 && (b * b) - c > 0
  })
}
