import {hopWidth} from './Colonization.js'
import {hopColor} from './ColonizationLines.js'
import {Float32BufferAttribute} from 'three'
import {WideLineStripGeometry, newWideLines, setWideLineSegments, sortFarToNear, trimToFront} from './wideLines.js'


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


describe('wideLines', () => {
  it('setWideLineSegments uploads only what changed, and nothing when nothing did', () => {
    const cap = 8
    const mesh = newWideLines({start: new Float64Array(cap * 3), end: new Float64Array(cap * 3), color: new Float32Array(cap * 3)})
    const at = mesh.geometry.attributes
    const keys = ['startHigh', 'startLow', 'endHigh', 'endLow', 'aColor']
    // As three does once it has uploaded.
    const uploaded = () => keys.forEach((k) => at[k].clearUpdateRanges())
    const versions = () => keys.map((k) => at[k].version)
    const seg = {start: new Float64Array(cap * 3), end: new Float64Array(cap * 3), color: new Float32Array(cap * 3)}
    for (let j = 0; j < 9; j++) {
      seg.start[j] = 7e6 + j + 0.123
      seg.end[j] = 4e8 + j
      seg.color[j] = 0.5
    }
    expect(setWideLineSegments(mesh, seg, 3)).toBeGreaterThan(0)
    expect(mesh.geometry.instanceCount).toBe(3)
    // The high and low parts hold the float64 value.
    expect(at.startHigh.array[0] + at.startLow.array[0]).toBeCloseTo(7e6 + 0.123, 6)
    uploaded()
    // The same again: nothing flagged.
    let v = versions()
    expect(setWideLineSegments(mesh, seg, 3)).toBe(0)
    expect(versions()).toEqual(v)
    // One start moves: only the starts go up, and just that segment's span.
    seg.start[4] += 10
    v = versions()
    setWideLineSegments(mesh, seg, 3)
    expect(versions().map((x, i) => x - v[i])).toEqual([1, 1, 0, 0, 0])
    expect(at.startHigh.updateRanges).toEqual([{start: 4, count: 1}])
    // Not drawn before the next change: one range covering both.
    seg.start[7] += 10
    setWideLineSegments(mesh, seg, 3)
    expect(at.startHigh.updateRanges).toEqual([{start: 4, count: 4}])
  })

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

  it('trimToFront cuts a hop crossing the camera plane in front of the camera, in float32', () => {
    // A far hop from the flicker report: one end 3.5e18 m behind the camera,
    // the other 4.4e18 m ahead.  Cut at the near plane (6e5 m), float32
    // landed at z = 0 (w = 0); the cut at a fraction of the length is in
    // front, and on the segment.
    const behind = [1e17, 2e17, 3.51e18]
    const ahead = [-3e17, 1e17, -4.40e18]
    const [a, b] = trimToFront(behind, ahead, 6e5, Math.fround)
    expect(a[2]).toBeLessThan(0)
    expect(b).toEqual(ahead)
    const t = (a[2] - behind[2]) / (ahead[2] - behind[2])
    const onLine = behind.map((v, c) => v + (t * (ahead[c] - v)))
    // Within 1e-3 of the cut's depth sideways: a fraction of a pixel.
    expect(Math.hypot(a[0] - onLine[0], a[1] - onLine[1]) / -a[2]).toBeLessThan(1e-3)
    expect(trimToFront([0, 0, 10], [0, 0, 20], 1)).toBeNull()
    const front = [[0, 0, -10], [1, 0, -20]]
    expect(trimToFront(...front, 1)).toEqual(front)
  })

  it('WideLineStripGeometry keeps a Line\'s position and draw range, and its segment view in step', () => {
    const geom = new WideLineStripGeometry(new Float32BufferAttribute(new Float32Array(3 * 10), 3))
    expect(geom.instanceCount).toBe(9)
    expect(geom.attributes.stripStart.data.array).toBe(geom.attributes.position.array)
    expect(geom.attributes.stripEnd.offset).toBe(3)
    // Drawn range: segments between the drawn vertices.
    geom.setDrawRange(0, 6)
    expect(geom.instanceCount).toBe(5)
    // An upload of the position flags the segment view for upload too.
    const view = geom.attributes.stripStart.data
    const before = view.version
    geom.attributes.position.needsUpdate = true
    expect(view.version).toBe(before + 1)
    // A new position array (as BodyLine sets) rewires the view.
    const bigger = new Float32BufferAttribute(new Float32Array(3 * 40), 3)
    geom.setAttribute('position', bigger)
    expect(geom.attributes.stripEnd.data.array).toBe(bigger.array)
    expect(geom.instanceCount).toBe(39)
    geom.setDrawRange(0, 25)
    expect(geom.instanceCount).toBe(24)
  })

  it('hop colours run from near white to near black, one step per hop', () => {
    const first = hopColor(1, 64)
    const last = hopColor(64, 64)
    expect(Math.min(...first)).toBeGreaterThan(0.9)
    expect(Math.max(...last)).toBeLessThan(0.1)
    expect(hopWidth(1, 64, 6, 1)).toEqual(6)
  })
})
