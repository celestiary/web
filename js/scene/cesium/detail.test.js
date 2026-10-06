import {MIN_PIXEL_ANGLE, detailScale} from './detail.js'


const rad = (deg) => deg * Math.PI / 180


/**
 * Cesium's screen-space error for a tile, QuadtreePrimitive's
 * screenSpaceError (no fog, pixelRatio 1).
 *
 * @returns {number} Pixels
 */
function sse(geometricError, distance, fovyRad, heightPx) {
  return geometricError * heightPx / (distance * 2 * Math.tan(fovyRad / 2))
}


describe('detailScale', () => {
  it('leaves ordinary fields of view alone', () => {
    for (const height of [300, 800, 2160]) {
      for (const deg of [45, 90, 170]) {
        expect(detailScale(rad(deg), height)).toBe(1)
      }
    }
    expect(detailScale(rad(10), 800)).toBe(1)
    // A pixel at 45° on a 4K-tall canvas spans ~4 × MIN_PIXEL_ANGLE.
    expect(2 * Math.tan(rad(22.5)) / 2160).toBeGreaterThan(3 * MIN_PIXEL_ANGLE)
  })

  it('asks for no more detail than pixels of MIN_PIXEL_ANGLE would', () => {
    // At the field whose pixels span MIN_PIXEL_ANGLE, and every narrower
    // one, a tile's error over the scaled limit is the same: the same
    // tiles meet it.
    const height = 800
    const floorFov = 2 * Math.atan(MIN_PIXEL_ANGLE * height / 2)
    const atFloor = sse(1, 1e4, floorFov, height)
    for (const deg of [2, 0.5, 0.1, 0.04, 0.01, 0.001]) {
      const fov = rad(deg)
      expect(sse(1, 1e4, fov, height) / detailScale(fov, height)).toBeCloseTo(atFloor, 6)
    }
  })

  it('grows as the field narrows, and with the canvas', () => {
    expect(detailScale(rad(0.01), 300)).toBeCloseTo(MIN_PIXEL_ANGLE * 300 / (2 * Math.tan(rad(0.005))), 6)
    expect(detailScale(rad(0.01), 300)).toBeGreaterThan(150)
    expect(detailScale(rad(0.01), 900)).toBeCloseTo(3 * detailScale(rad(0.01), 300), 6)
    expect(detailScale(rad(1e-4), 300)).toBeGreaterThan(detailScale(rad(1e-3), 300))
  })

  it('takes another floor', () => {
    expect(detailScale(rad(1), 1000, 1e-3)).toBeCloseTo(1e-3 * 1000 / (2 * Math.tan(rad(0.5))), 6)
    expect(detailScale(rad(1), 10, 1e-3)).toBe(1)
  })

  it('is 1 for a degenerate view', () => {
    expect(detailScale(0, 300)).toBe(1)
    expect(detailScale(NaN, 300)).toBe(1)
    expect(detailScale(rad(1), 0)).toBe(1)
  })
})
