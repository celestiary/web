import {describe, expect, it} from 'bun:test'
import {Object3D, PerspectiveCamera, Vector3} from 'three'
import {cubicAt, exactNdc, gpuNdc, writeOffsets} from './relativeToEye.js'


// 2026 ED138 from the Rubin seat: 7e12 m away, the camera 1e7 m from the
// frame's origin (Earth's centre plus a seat on its surface, roughly), the
// field 0.00016° on a 500 px canvas (#334).
const FAR = new Vector3(4.1e12, 1.3e12, -5.5e12)
const CAMERA_AT = new Vector3(6.1e6, -2.2e6, 7.6e6)
const FOV_DEG = 0.00016
const HEIGHT_PX = 500


/**
 * A camera at CAMERA_AT looking at FAR, matrices updated.
 *
 * @returns {PerspectiveCamera}
 */
function newCamera() {
  const camera = new PerspectiveCamera(FOV_DEG, 1, 0.3, 1e15)
  camera.position.copy(CAMERA_AT)
  camera.lookAt(FAR)
  camera.updateMatrixWorld(true)
  camera.updateProjectionMatrix()
  return camera
}


/**
 * NDC to pixels on the canvas's height.
 *
 * @param {{x: number, y: number}} a
 * @param {{x: number, y: number}} b
 * @returns {number} px between them
 */
function px(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y) * HEIGHT_PX / 2
}


/**
 * A node at `position`, its modelViewMatrix as three composes it (float64).
 *
 * @param {Vector3} position
 * @param {PerspectiveCamera} camera
 * @returns {Array<number>}
 */
function modelView(position, camera) {
  const node = new Object3D
  node.position.copy(position)
  node.updateMatrixWorld(true)
  return camera.matrixWorldInverse.clone().multiply(node.matrixWorld).elements
}


describe('relativeToEye', () => {
  it('writes offsets from an anchor exact to under a metre at 7e12 m', () => {
    const near = FAR.clone().add(new Vector3(1234.5, -2e5, 3e6))
    const points = new Float64Array([...FAR.toArray(), ...near.toArray()])
    const out = writeOffsets(points, FAR, new Float32Array(6))
    expect([...out.slice(0, 3)]).toEqual([0, 0, 0])
    expect(Math.abs(out[3] - 1234.5)).toBeLessThan(1)
    expect(Math.abs(out[4] + 2e5)).toBeLessThan(1)
    expect(Math.abs(out[5] - 3e6)).toBeLessThan(1)
    // Unanchored, float32 holds the place to ~5e5 m.
    expect(Math.abs(Math.fround(near.z) - near.z)).toBeGreaterThan(1e4)
  })

  it('draws a point at 7e12 m within a hundredth of a pixel anchored, and many pixels off unanchored', () => {
    const camera = newCamera()
    const P = camera.projectionMatrix.elements
    // Unanchored: the node at the frame's origin, the vertex at 7e12 m.
    const mv0 = modelView(new Vector3, camera)
    const truth = exactNdc(mv0, P, FAR)
    expect(px(truth, {x: 0, y: 0})).toBeLessThan(1e-6)
    // A point beside the far one, 3e4 m off (most of a pixel here), so the
    // vertex isn't on the axis by construction.
    const off = FAR.clone().add(new Vector3(2.1e4, 1.7e4, 0))
    const offTruth = exactNdc(mv0, P, off)
    const unanchored = px(gpuNdc(mv0, P, off), offTruth)
    expect(unanchored).toBeGreaterThan(2)
    // Anchored at FAR: the node there, the vertex the offset.
    const mv1 = modelView(FAR, camera)
    const local = off.clone().sub(FAR)
    expect(px(exactNdc(mv1, P, local), offTruth)).toBeLessThan(1e-3)
    expect(px(gpuNdc(mv1, P, local), offTruth)).toBeLessThan(0.01)
  })

  it('interpolates by the cubic through the samples: exact on a cubic, at the nodes and the ends', () => {
    const fn = (t) => [t * t * t, (2 * t) - 1, 5]
    const samples = new Float64Array([0, 1, 2, 3, 4, 5].flatMap(fn))
    const out = new Vector3
    for (const t of [0, 0.3, 1, 2.5, 4.2, 5]) {
      cubicAt(samples, t, out)
      const [x, y, z] = fn(t)
      expect(out.x).toBeCloseTo(x, 9)
      expect(out.y).toBeCloseTo(y, 9)
      expect(out.z).toBeCloseTo(z, 9)
    }
    // Clamped past the ends; two samples are a line.
    expect(cubicAt(samples, 9, out).x).toBeCloseTo(125, 9)
    expect(cubicAt(new Float64Array([0, 0, 0, 2, 4, 6]), 0.5, out).toArray()).toEqual([1, 2, 3])
  })
})
