import {hopWidth} from './Colonization.js'
import {hopColor, sortFarToNear} from './ColonizationLines.js'


/**
 * Pack segments, given as [[sx, sy, sz], [ex, ey, ez]], into the high/low
 * arrays sortFarToNear takes.
 *
 * @param {Array<Array<Array<number>>>} segments
 * @returns {Array<Float32Array>}
 */
function pack(segments) {
  const n = segments.length
  const arrays = [0, 1, 2, 3].map(() => new Float32Array(n * 3))
  segments.forEach(([s, e], k) => {
    for (let c = 0; c < 3; c++) {
      arrays[0][(3 * k) + c] = s[c]
      arrays[1][(3 * k) + c] = s[c] - arrays[0][(3 * k) + c]
      arrays[2][(3 * k) + c] = e[c]
      arrays[3][(3 * k) + c] = e[c] - arrays[2][(3 * k) + c]
    }
  })
  return arrays
}


describe('ColonizationLines', () => {
  it('sortFarToNear orders segments by their closest distance, farthest first', () => {
    const LY = 9.461e15
    const segments = [
      [[0, 0, 0], [4 * LY, 0, 0]], // from the camera's star: nearest
      [[1000 * LY, 0, 0], [1040 * LY, 0, 0]], // far
      [[100 * LY, 0, 0], [130 * LY, 0, 0]], // middle
      // Long, but passes 10 ly from the camera: nearer than the middle one.
      [[-500 * LY, 10 * LY, 0], [500 * LY, 10 * LY, 0]],
    ]
    const order = sortFarToNear(...pack(segments), [1e11, 0, 0])
    expect(Array.from(order)).toEqual([1, 2, 3, 0])
  })

  it('hop colours run from near white to near black, one step per hop', () => {
    const first = hopColor(1, 64)
    const last = hopColor(64, 64)
    expect(Math.min(...first)).toBeGreaterThan(0.9)
    expect(Math.max(...last)).toBeLessThan(0.1)
    expect(hopWidth(1, 64, 6, 1)).toEqual(6)
  })
})
