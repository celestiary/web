/**
 * Whether a Cesium body can show this frame, beyond being in range and in
 * the frustum (CesiumLayers._visibleAt).  See CESIUM.md, "Activation".
 */


/**
 * Scale on an occluder's smallest radius (its sphere's, or its Cesium
 * ellipsoid's polar radius) for the ground it surely hides behind: under
 * the deepest land, so a body is taken for hidden only when it is behind
 * the occluder's ground whichever side of the swap draws it.  0.6% is
 * 38 km on Earth (the ellipsoid's poles are 14 km under celestiary's
 * sphere, the Dead Sea 0.4 km under the datum), 20 km on Mars (Hellas,
 * 8 km under its datum), 10 km on the Moon (South Pole-Aitken, 9 km).
 */
export const OCCLUDER_SCALE = 0.994


/**
 * Whether a sphere is entirely hidden from the eye behind another, opaque
 * one: it lies within the occluder's silhouette cone, and wholly farther
 * than where the cone's rays leave the occluder's near side (its tangent
 * distance).  Conservative: false whenever any of it could show.
 *
 * @param {object} eye The camera's world position (Vector3)
 * @param {object} center The body's centre (Vector3)
 * @param {number} radius The body's radius (its stencil shell's)
 * @param {object} occluderCenter (Vector3)
 * @param {number} occluderRadius The occluder's ground, under its lowest
 *   (see OCCLUDER_SCALE)
 * @returns {boolean}
 */
export function hiddenBehind(eye, center, radius, occluderCenter, occluderRadius) {
  const toOccluder = occluderCenter.clone().sub(eye)
  const toBody = center.clone().sub(eye)
  const dOccluder = toOccluder.length()
  const dBody = toBody.length()
  if (!(dOccluder > occluderRadius) || !(dBody > radius)) {
    return false
  }
  const tangent = Math.sqrt((dOccluder * dOccluder) - (occluderRadius * occluderRadius))
  if (dBody - radius < tangent) {
    return false
  }
  const separation = toBody.angleTo(toOccluder)
  return separation + Math.asin(radius / dBody) <= Math.asin(occluderRadius / dOccluder)
}


/**
 * Above the eye's horizon, how high nearby land can stand, radians: canyon
 * walls and mountains close by.  The sphere test in groundInView sees only
 * the body's mean surface; this keeps the credits up whenever the frame's
 * low edge is near the horizon.
 */
export const RELIEF_MARGIN = 10 * Math.PI / 180


/**
 * Whether any of a body's ground can be in the frame: the angle from the
 * view's direction to the body's centre is within the ground's angular
 * radius, the frame's half-diagonal and RELIEF_MARGIN.  Conservative (the
 * frame taken as the cone round its corners), so false only when no
 * ground can show: on the surface looking up, the sky alone.  Below the
 * mean surface (a deep valley), the horizon is taken as level.
 *
 * @param {object} eye The camera's world position (Vector3)
 * @param {object} viewDir The camera's unit view direction (Vector3)
 * @param {number} halfDiag The frame's half-diagonal angle, radians
 * @param {object} center The body's centre (Vector3)
 * @param {number} groundRadius Its mean surface's radius
 * @returns {boolean}
 */
export function groundInView(eye, viewDir, halfDiag, center, groundRadius) {
  const toCenter = center.clone().sub(eye)
  const d = toCenter.length()
  const angularRadius = d > groundRadius ? Math.asin(groundRadius / d) : Math.PI / 2
  return viewDir.angleTo(toCenter) <= angularRadius + halfDiag + RELIEF_MARGIN
}


/**
 * @param {number} fovDeg A perspective camera's vertical field of view
 * @param {number} aspect Its width over height
 * @returns {number} the half-diagonal angle of its frame, radians
 */
export function halfDiagonal(fovDeg, aspect) {
  const t = Math.tan(fovDeg * Math.PI / 360)
  return Math.atan(Math.hypot(t, t * aspect))
}
