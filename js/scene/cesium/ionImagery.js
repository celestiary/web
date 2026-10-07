/**
 * When Earth's globe asks Cesium ion for its detail imagery (Bing Maps,
 * ion asset 2).  See CESIUM.md, "Cesium ion sessions".
 *
 * ion bills the Bing imagery by sessions: every viewer that requests the
 * asset's endpoint opens one, however little it then draws.  The globe's
 * base is the bundled Blue Marble, sharp from orbit, and Bing adds nothing
 * until the camera is close enough that a Blue Marble texel spans more
 * than a couple of screen pixels.  So the layer is requested only then,
 * and once requested is kept for the page's life (a second request may be
 * a second session).
 */
import {MIN_PIXEL_ANGLE, pixelAngle} from './detail.js'


/**
 * Bing is wanted once a base texel spans more than this many screen
 * pixels.  At 1 the base is exactly sharp; at 2 it is soft but readable,
 * and the request leads Cesium's own switch to the detail layer (globe
 * tile level 5, `detailFromLevel`) by about 2x in distance, which is the
 * time ion's answer and the first tiles take.
 */
export const MAX_BASE_TEXEL_PX = 2

// A GeographicTilingScheme has two tiles across at level 0.
const LEVEL_ZERO_TILES_X = 2


/**
 * The ground size of a texel of the base imagery's finest level, at the
 * equator, where a geographic tile is widest.
 *
 * @param {{tileSize: number, maximumLevel: number}} imagery A body's
 *   monthlyImagery config (bodies.js), geographic tiling
 * @param {number} equatorRadius Metres
 * @returns {number} Metres per texel
 */
export function baseTexelMeters({tileSize, maximumLevel}, equatorRadius) {
  return 2 * Math.PI * equatorRadius / (LEVEL_ZERO_TILES_X * tileSize * (2 ** maximumLevel))
}


/**
 * The camera altitude under which the base's texels span more than
 * `maxTexelPx` screen pixels, so detail imagery would show.
 *
 * The ground a pixel spans at the nearest ground is altitude × the pixel's
 * angle, so a texel of t metres covers t / (altitude × angle) pixels, and
 * the threshold is where that reaches `maxTexelPx`: t / (maxTexelPx ×
 * angle).  The angle is floored at MIN_PIXEL_ANGLE (detail.js): Cesium is
 * never asked for finer detail than pixels of that angle would get, so at a
 * telescope's field a pixel's ground size is what the floor says, not what
 * the field says, and Bing could add nothing finer.  A telescope on Earth
 * from the Moon (about 380,000 km, a pixel of 38 km at the floor) is far
 * over the threshold, whatever the field.
 *
 * An oblique view has farther ground in the rest of the frame, and the
 * test is at the nearest, so it errs toward asking early.
 *
 * @param {number} texelM Base texel size, metres (baseTexelMeters)
 * @param {number} fovyRad Vertical field of view, radians
 * @param {number} heightPx Canvas height, CSS pixels
 * @param {number} [maxTexelPx]
 * @param {number} [minPixelAngle] Radians
 * @returns {number} Metres over the surface; 0 for no canvas
 */
export function ionImageryAltitude(
    texelM, fovyRad, heightPx, maxTexelPx = MAX_BASE_TEXEL_PX, minPixelAngle = MIN_PIXEL_ANGLE) {
  const angle = pixelAngle(fovyRad, heightPx)
  if (!(angle < Infinity)) {
    return 0
  }
  return texelM / (maxTexelPx * (angle > 0 ? Math.max(angle, minPixelAngle) : minPixelAngle))
}
