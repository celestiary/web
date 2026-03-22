import {SMALLEST_SIZE_METER} from './shared.js'


/**
 * Remaps a zoom step from linear-distance space to altitude space so the
 * camera asymptotically approaches the surface rather than passing through it.
 *
 * Linear zoom:   new_dist = old_dist * factor   (camera passes through surface)
 * Altitude zoom: new_alt  = old_alt  * factor   (altitude → 0 but never negative)
 *
 * @param {number} distBefore Distance from camera to orbit center before zoom
 * @param {number} distAfter  Distance after TrackballControls applied zoom
 * @param {number} surfaceR   Radius of the target body (scene units = meters)
 * @returns {number} Corrected distance to use, clamped to surfaceR at minimum
 */
export function asymptoticZoomDist(distBefore, distAfter, surfaceR) {
  if (distAfter === distBefore) {
    return distAfter // no zoom this frame
  }
  const altBefore = Math.max(0, distBefore - surfaceR)
  const factor = distAfter / distBefore
  return Math.max(surfaceR, surfaceR + altBefore * factor)
}


/**
 * Computes the camera near-plane distance for a given altitude above the
 * surface.  Shrinks proportionally as the camera descends so the surface
 * stays visible; caps at SMALLEST_SIZE_METER when far away to preserve depth
 * buffer precision across the full stellar scene.
 *
 * @param {number} altitude   Current altitude above the target surface (meters)
 * @returns {number} Near-plane distance in meters
 */
export function dynamicNear(altitude) {
  return Math.min(SMALLEST_SIZE_METER, Math.max(1e2, altitude * 0.1))
}
