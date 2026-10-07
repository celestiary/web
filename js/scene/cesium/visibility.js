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
