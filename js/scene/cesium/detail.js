/**
 * How much detail Cesium is asked for at a field of view.  See CESIUM.md,
 * "Detail at narrow fields of view".
 *
 * Cesium picks a tile's level by its screen-space error: the tile's
 * geometric error in pixels at its distance, error × height /
 * (distance × 2 tan(fovy / 2)), against a limit (maximumScreenSpaceError).
 * At a telescope's field of view that asks for sub-metre detail from ground
 * kilometres away.  At 0.1° from 13 m over the ground, looking up at
 * Jupiter 4° over the horizon, Earth's globe visited 230,000 tiles a frame,
 * down to level 27, and the page's heap reached 1.8 GB; at 0.04° and 0.01°
 * it ran out of memory (#176).  World Terrain has no data past level ~15
 * there, but the globe only learns that a tile is upsampled from its parent
 * once it has loaded it, so it walks the subtree under every tile in view.
 *
 * So the limit grows when a pixel spans less than MIN_PIXEL_ANGLE: Cesium
 * then asks for the detail, and walks and loads the tiles, of a field whose
 * pixels span MIN_PIXEL_ANGLE, from the same place, of which the narrower
 * view sees a part.  Wider pixels, every ordinary field, change nothing.
 */


/**
 * The finest angle a pixel is given detail for, radians per CSS pixel:
 * ~21″, a 1.7° field on a 300 px tall canvas, 5.7° on a 1000 px one.  At
 * 45° a pixel spans 6 to 30 times this.  Headless, from 13 m over the
 * ground, the globe walks ~2,000 tiles a frame here, against 75 at 45°.
 */
export const MIN_PIXEL_ANGLE = 1e-4


/**
 * The angle a pixel spans, radians per CSS pixel.
 *
 * @param {number} fovyRad Vertical field of view, radians
 * @param {number} heightPx Canvas height, CSS pixels
 * @returns {number} Radians; 0 for a degenerate field, Infinity or NaN
 *   for no canvas
 */
export function pixelAngle(fovyRad, heightPx) {
  return 2 * Math.tan(fovyRad / 2) / heightPx
}


/**
 * The factor to scale a Cesium maximumScreenSpaceError by for a view: 1
 * while a pixel spans MIN_PIXEL_ANGLE or more, and below that the factor
 * by which it spans less, so every tile's error against the limit is what
 * it would be with pixels of MIN_PIXEL_ANGLE.
 *
 * @param {number} fovyRad Vertical field of view, radians
 * @param {number} heightPx Canvas height, CSS pixels (Cesium's
 *   drawingBufferHeight over its pixelRatio)
 * @param {number} [minPixelAngle] Radians
 * @returns {number} At least 1
 */
export function detailScale(fovyRad, heightPx, minPixelAngle = MIN_PIXEL_ANGLE) {
  const angle = pixelAngle(fovyRad, heightPx)
  return angle > 0 && angle < minPixelAngle ? minPixelAngle / angle : 1
}
