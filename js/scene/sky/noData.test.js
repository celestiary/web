import {describe, expect, it} from 'bun:test'
import {clearNoData} from './noData.js'


const W = 64


/**
 * @param {(x: number, y: number) => number} value A pixel's grey, as served
 * @returns {Uint8Array} RGBA rows, opaque
 */
function tile(value) {
  const d = new Uint8Array(W * W * 4)
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const o = ((y * W) + x) * 4
      d[o] = d[o + 1] = d[o + 2] = value(x, y)
      d[o + 3] = 255
    }
  }
  return d
}

const alpha = (d, x, y) => d[(((y * W) + x) * 4) + 3]
const grey = (d, x, y) => d[((y * W) + x) * 4]


describe('a negative\'s black: no data or a saturated core', () => {
  it('clears black that borders the survey\'s light sky, a little wider, over white', () => {
    // The sky at 230, no data left of x = 20, with the jpeg's ringing at its edge.
    const d = tile((x) => (x < 20 ? (x === 19 ? 9 : 0) : 230))
    const r = clearNoData(d, W, W)
    expect(r).toEqual({noData: 20 * W, saturated: 0})
    expect(alpha(d, 5, 30)).toBe(0)
    expect(grey(d, 5, 30)).toBe(255)
    // Widened 4 px into the data, for the blend at its edge.
    expect(alpha(d, 23, 30)).toBe(0)
    expect(alpha(d, 24, 30)).toBe(255)
    expect(grey(d, 40, 30)).toBe(230)
  })

  it('keeps black in the dark of a bright object: a saturated core', () => {
    // A bulge, dark as served, round a black core 24 px across; light sky beyond.
    const d = tile((x, y) => {
      const r = Math.hypot(x - 32, y - 32)
      return r < 12 ? 0 : (r < 26 ? 40 : 230)
    })
    const r = clearNoData(d, W, W)
    expect(r.noData).toBe(0)
    expect(r.saturated).toBeGreaterThan(400)
    expect(alpha(d, 32, 32)).toBe(255)
    expect(grey(d, 32, 32)).toBe(0)
  })

  it('keeps a star\'s small core whatever is round it, and tells both in one tile', () => {
    const d = tile((x, y) => (y < 10 ? 0 : (Math.hypot(x - 40, y - 40) < 3 ? 0 : 230)))
    const r = clearNoData(d, W, W)
    expect(r.noData).toBe(10 * W)
    expect(r.saturated).toBeGreaterThan(10)
    expect(alpha(d, 40, 40)).toBe(255)
    expect(alpha(d, 30, 4)).toBe(0)
  })

  it('takes a tile black all over as no data, and takes the manifest\'s black', () => {
    const d = tile(() => 3)
    expect(clearNoData(d, W, W)).toEqual({noData: W * W, saturated: 0})
    const e = tile(() => 20)
    expect(clearNoData(e, W, W).noData).toBe(0)
    expect(clearNoData(e, W, W, {black: 24}).noData).toBe(W * W)
  })
})
