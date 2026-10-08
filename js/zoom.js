import {INITIAL_FOV, SMALLEST_SIZE_METER, toRad} from './shared.js'


/** Closest the camera comes to the ground, metres. */
export const GROUND_CLEARANCE_M = 1


/**
 * The body the camera is at, which zoom and the ground floor are about:
 * the one its platform hangs off (landed on it, or gone to it, whose
 * centre zoom moves towards), whatever it's looking at.  Targeting the Moon
 * from Earth's surface ('1') looks at the Moon; the camera is still on
 * Earth.  Falls back to the target (e.g. at a star).
 *
 * @param {object|null} platformParent The camera platform's parent
 * @param {object|null} cur The body last gone to or landed on
 * @param {object|null} target The looked-at body
 * @returns {object|null}
 */
export function homeBody(platformParent, cur, target) {
  if (cur && platformParent && (cur === platformParent || cur.orbitPosition === platformParent)) {
    return cur
  }
  return target
}


/**
 * The ground's distance from a body's centre under the camera: its radius,
 * raised (or lowered) by the terrain there when a Cesium layer knows it.
 * Zoom approaches it and the camera never goes below it.
 *
 * @param {number} surfaceR Body radius (celestiary's sphere), metres
 * @param {number|null} groundHeight Terrain height over that sphere under
 *   the camera, metres, or null when unknown
 * @returns {number}
 */
export function groundRadius(surfaceR, groundHeight) {
  return surfaceR + (groundHeight ?? 0)
}


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
  return Math.max(surfaceR, surfaceR + (altBefore * factor))
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


/** Floor of rotateScale: a drag near the ground slows to this, never to a stall. */
export const MIN_ROTATE_SCALE = 1e-6


/**
 * How much of its full speed an orbit drag turns at an altitude: 1 from a few
 * body radii out (rotation as it always was), falling smoothly as the camera
 * nears the ground, never below MIN_ROTATE_SCALE.
 *
 * Why this curve.  An orbit drag turns the camera about the body's centre by
 * `speed * scale` radians a pixel, which carries the view over the ground by
 * that angle times (R + alt).  What's on screen is a patch about alt across
 * (the field of view is fixed).  Keeping a drag worth a similar fraction of
 * the patch at every altitude wants the angle to go as alt / (R + alt), so
 * near the ground it is proportional to altitude (a power law of exponent 1;
 * a log is too gentle, leaving kilometres a pixel at 5 km up, and a higher
 * power crawls).  1 - exp(-alt / R) has the same slope at the ground
 * (alt / R) but, unlike
 * alt / (R + alt), is already 0.95 at 3 radii and 0.99 at 5, so far views
 * keep their feel instead of being slowed a third at 2 radii.  It is smooth,
 * monotonic and has no tunables.
 *
 * Only orbit drags use it.  A free-look drag (pan) and the arrow keys turn
 * the camera in place and move nothing over the ground, so this altitude
 * scale leaves them be, and they can look about from the surface.  (They are
 * slowed by the field of view instead: fovTurnScale.)
 *
 * @param {number} altitude Camera height above the ground, metres
 * @param {number} radius Body radius, metres
 * @returns {number} In [MIN_ROTATE_SCALE, 1]
 */
export function rotateScale(altitude, radius) {
  if (!(radius > 0) || !(altitude > 0)) {
    return radius > 0 ? MIN_ROTATE_SCALE : 1
  }
  return Math.min(1, Math.max(MIN_ROTATE_SCALE, -Math.expm1(-altitude / radius)))
}


/**
 * How much of its full speed a drag or key turns the view at a field of
 * view: 1 at INITIAL_FOV and wider, falling in proportion to the field's
 * size as it narrows, never below MIN_ROTATE_SCALE.
 *
 * Why this curve.  A turn rate is in radians a pixel (0.005 for a drag), and
 * a pixel spans about `fov / heightPx` of sky, so a fixed rate carries the
 * view over `rate / (fov / heightPx)` pixels for each pixel dragged: 4 at the
 * default FOV in a 600 px canvas, and 2,500 at a telescope's 0.07°, where one
 * pixel of drag swings the view hundreds of screens.  Scaling the rate by the
 * ratio of the FOV to the default keeps that figure what it was at the
 * default, whatever the FOV and the canvas, so a drag across the screen
 * moves the scene about the same fraction of it.  The ratio is of the
 * tangent half-angles (as farPoint.js fovScale), the pixel's true angle at
 * the middle of the view (2 tan(fov / 2) / heightPx), so the travel per pixel
 * there is the same at every FOV, to the digit; against the plain ratio of
 * angles that is 5% under, at narrow FOVs.  The canvas height drops out: the
 * rate it applies to already is per pixel, and is not changed at the default
 * FOV.
 *
 * An orbit drag takes it too.  It swings the camera round the body's centre,
 * so a point on the body sweeps `rate * (R + alt)` of ground a pixel, over a
 * view whose patch of ground goes as the field of view: the same ratio holds
 * a drag worth the same fraction of the screen.  It multiplies rotateScale
 * (the altitude's part), not replaces it.
 *
 * Wider than the default it stays 1: widening is not what makes a drag
 * hard to control, and at 170° the tangent ratio is 28.
 *
 * @param {number} fovDegrees The camera's vertical field of view
 * @returns {number} In [MIN_ROTATE_SCALE, 1]; 1 when the FOV is no number
 */
export function fovTurnScale(fovDegrees) {
  if (!(fovDegrees > 0 && fovDegrees < INITIAL_FOV)) {
    return 1
  }
  const ratio = Math.tan(fovDegrees * toRad / 2) / Math.tan(INITIAL_FOV * toRad / 2)
  return Math.max(MIN_ROTATE_SCALE, ratio)
}
