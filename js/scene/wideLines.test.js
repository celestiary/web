import {hopWidth} from './Colonization.js'
import {hopColor} from './ColonizationLines.js'
import {Float32BufferAttribute, Matrix4, PerspectiveCamera, Vector3} from 'three'
import {mat4Multiply, reprojection} from '@pablo-mayrgundter/portal-netgl/core'
import {WideLineStripGeometry, newWideLineStrip, newWideLines, setWideLineSegments, sortFarToNear, trimToFront}
  from './wideLines.js'


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


// Host reprojection (layer mode; portal-netgl's opt-in, js/layer): a NetGL
// host that composes the guest's frame for a later view sets
// netgl_reproject, and the shader applies it to the ends before extruding,
// so the line keeps its width in pixels.  The wide line's extrusion, as the
// shader does it, in doubles.
describe('wideLines under host reprojection', () => {
  /**
   * @param {Array<number>} m column-major 4x4
   * @param {Array<number>} v
   * @returns {Array<number>}
   */
  const mul = (m, v) => [0, 1, 2, 3].map((r) => (m[r] * v[0]) + (m[4 + r] * v[1]) + (m[8 + r] * v[2]) + (m[12 + r] * v[3]))
  const res = [800, 500]
  /**
   * The quad's four corners in pixels, from the ends' clip positions.
   *
   * @param {Array<number>} cs
   * @param {Array<number>} ce
   * @param {number} halfW px
   * @param {Array<number>} [after] a correction applied after the extrusion (a wrapped shader)
   * @returns {Array<Array<number>>}
   */
  const corners = (cs, ce, halfW, after = null) => {
    const half = res.map((r) => r / 2)
    const d = [0, 1].map((i) => ((ce[i] / ce[3]) - (cs[i] / cs[3])) * half[i])
    const len = Math.hypot(...d)
    const dir = d.map((x) => x / len)
    const perp = [-dir[1], dir[0]]
    const out = []
    for (const [clip, cap] of [[cs, -1], [ce, 1]]) {
      for (const side of [-1, 1]) {
        let c = [...clip]
        for (const i of [0, 1]) {
          c[i] += (((perp[i] * side) + (dir[i] * cap)) * halfW / half[i]) * c[3]
        }
        if (after) {
          c = mul(after, c)
        }
        out.push([0, 1].map((i) => ((c[i] / c[3]) + 1) * half[i]))
      }
    }
    return out
  }
  const camera = (pos, fov) => {
    const c = new PerspectiveCamera(fov, res[0] / res[1], 1e5, 1e9)
    c.position.set(...pos)
    c.lookAt(new Vector3(0, 0, 0))
    c.updateMatrixWorld()
    return {viewMatrix: c.matrixWorldInverse.toArray(), projectionMatrix: c.projectionMatrix.toArray()}
  }

  it('the shader opts in: it declares the uniform and applies it to the ends before the extrusion', () => {
    for (const mesh of [newWideLines({start: [0, 0, 0], end: [1, 1, 1], color: [1, 1, 1]}),
      newWideLineStrip(new Float32Array(6), {color: 'white'})]) {
      const src = mesh.material.vertexShader
      // portal-netgl's test for the opt-in: the declaration, so its replay doesn't wrap main.
      expect(src).toMatch(/\buniform\s+mat4\s+netgl_reproject\s*;/)
      expect(src.indexOf('netgl_reproject * (projectionMatrix')).toBeGreaterThan(0)
      expect(src.indexOf('netgl_reproject * (projectionMatrix')).toBeLessThan(src.indexOf('clip.xy +='))
      // Identity unless a host sets it: the app draws as before.
      const u = mesh.material.uniforms.netgl_reproject.value
      expect(u).toBeInstanceOf(Matrix4)
      expect(u.equals(new Matrix4())).toBe(true)
      // portal-netgl 0.6.7's scales, declared with the types its replay
      // looks for, and applied to the resolution and the width; 1 here.
      expect(src).toMatch(/\buniform\s+float\s+netgl_pixelScale\s*;/)
      expect(src).toMatch(/\buniform\s+vec2\s+netgl_viewportScale\s*;/)
      expect(src).toContain('0.5 * uResolution * netgl_viewportScale')
      expect(src).toContain('uPixelRatio * netgl_pixelScale')
      expect(mesh.material.uniforms.netgl_pixelScale.value).toBe(1)
      expect(mesh.material.uniforms.netgl_viewportScale.value.toArray()).toEqual([1, 1])
    }
  })

  // The extrusion as the shader does it, for a frame drawn at resolution
  // `res` (device px) and pixel ratio `pr`, composed into one at `resTo`:
  // the corners in the composed buffer's pixels.  The host maps the
  // frame's viewport onto the composed one (NDC is drawn into resTo).
  const composed = (cs, ce, {resFrom, pr, resTo, widthCss, viewportScale = [1, 1], pixelScale = 1}) => {
    const half = resFrom.map((r, i) => r * viewportScale[i] / 2)
    const d = [0, 1].map((i) => ((ce[i] / ce[3]) - (cs[i] / cs[3])) * half[i])
    const len = Math.hypot(...d)
    const dir = d.map((x) => x / len)
    const perp = [-dir[1], dir[0]]
    const halfW = 0.5 * widthCss * pr * pixelScale
    const out = []
    for (const [clip, cap] of [[cs, -1], [ce, 1]]) {
      for (const side of [-1, 1]) {
        const c = [...clip]
        for (const i of [0, 1]) {
          c[i] += (((perp[i] * side) + (dir[i] * cap)) * halfW / half[i]) * c[3]
        }
        out.push([0, 1].map((i) => ((c[i] / c[3]) + 1) * resTo[i] / 2))
      }
    }
    return out
  }
  const cameraFor = (pos, fov, aspect) => {
    const c = new PerspectiveCamera(fov, aspect, 1e5, 1e9)
    c.position.set(...pos)
    c.lookAt(new Vector3(0, 0, 0))
    c.updateMatrixWorld()
    return {viewMatrix: c.matrixWorldInverse.toArray(), projectionMatrix: c.projectionMatrix.toArray()}
  }

  for (const [name, from, to] of [
    ['a pixel-ratio change (2x to 1x)', {css: [800, 500], pr: 2}, {css: [800, 500], pr: 1}],
    ['a resize (800x500 to 1200x600)', {css: [800, 500], pr: 1}, {css: [1200, 600], pr: 1}],
  ]) {
    it(`composed after ${name}, with the host's scales, a beam is the guest's own for the new buffer`, () => {
      const ends = [[6.4e6, 1e6, 2e5, 1], [5.9e6, -2e6, 1.5e6, 1]]
      const resFrom = from.css.map((x) => x * from.pr)
      const resTo = to.css.map((x) => x * to.pr)
      const vf = cameraFor([2.5e7, 3e6, 4e6], 30, from.css[0] / from.css[1])
      const vt = cameraFor([2.5e7, 3e6, 4e6], 30, to.css[0] / to.css[1])
      const C = reprojection(vf, vt)
      const vp = (v) => mat4Multiply(v.projectionMatrix, v.viewMatrix)
      const [cs, ce] = ends.map((p) => mul(C, mul(vp(vf), p)))
      const truth = composed(...ends.map((p) => mul(vp(vt), p)), {resFrom: resTo, pr: to.pr, resTo, widthCss: 3})
      // What portal-netgl's replay sets: the viewport remap's scale and the ratio's.
      const viewportScale = [0, 1].map((i) => resTo[i] / resFrom[i])
      const pixelScale = to.pr / from.pr
      const scaled = composed(cs, ce, {resFrom, pr: from.pr, resTo, widthCss: 3, viewportScale, pixelScale})
      const unscaled = composed(cs, ce, {resFrom, pr: from.pr, resTo, widthCss: 3})
      for (let k = 0; k < 4; k++) {
        for (const i of [0, 1]) {
          expect(scaled[k][i]).toBeCloseTo(truth[k][i], 6)
        }
      }
      const width = (q) => Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1])
      expect(width(scaled)).toBeCloseTo(3 * to.pr, 6)
      // Without them: right on a ratio change (the offset is the same share
      // of the viewport at either ratio), scaled by the change of size on a
      // resize.
      if (from.pr !== to.pr) {
        expect(width(unscaled)).toBeCloseTo(3 * to.pr, 6)
      } else {
        expect(width(unscaled)).toBeGreaterThan(3 * 1.15)
      }
    })
  }

  it('a beam drawn for one view and corrected lands, and is as wide, as one drawn for the next', () => {
    // A DSN beam's two ends, metres, and a pan with a zoom in between.
    const ends = [[6.4e6, 1e6, 2e5, 1], [5.9e6, -2e6, 1.5e6, 1]]
    const from = camera([2.5e7, 3e6, 4e6], 30)
    const to = camera([2.4e7, 5e6, 3.5e6], 24)
    const C = reprojection(from, to)
    const vp = (v) => mat4Multiply(v.projectionMatrix, v.viewMatrix)
    const [cs, ce] = ends.map((p) => mul(vp(from), p))
    const truth = corners(...ends.map((p) => mul(vp(to), p)), 3)
    const optIn = corners(mul(C, cs), mul(C, ce), 3)
    const wrapped = corners(cs, ce, 3, C)
    for (let k = 0; k < 4; k++) {
      for (const i of [0, 1]) {
        expect(optIn[k][i]).toBeCloseTo(truth[k][i], 6)
      }
    }
    // Wrapped, C after the extrusion scales the width with the zoom.
    const width = (q) => Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1])
    expect(width(optIn)).toBeCloseTo(6, 6)
    expect(Math.abs(width(wrapped) - 6)).toBeGreaterThan(0.5)
  })
})
