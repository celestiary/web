import {Matrix4, Vector3} from 'three'


/**
 * A model as an occluder of the Sun's disc: its triangles marked in a voxel
 * grid in the model's own frame, and the share of the disc they cover from
 * a point, by rays walked through the grid (models.md, "In front of the
 * Sun").  The planets and moons occult the Sun as spheres
 * (SunLayers._occlusion); a spacecraft is nothing like one.
 *
 * A grid, not the triangles: JWST's surface is spread over 494,000 small
 * ones (its largest 4,096 are 29% of its area, 65,536 are 80%), too many to
 * test every ray against each frame.  The grid holds all of them, to its
 * cell.
 */


/** Cells along the model's longest side: JWST's 27.4 m in 21 cm cells. */
export const OCCLUDER_CELLS = 128


/**
 * The model's triangles marked in a grid of cells in the model root's
 * frame: every mesh's (and every instance's), placed by its transform below
 * the root, each sampled finer than a cell.
 *
 * @param {import('three').Object3D} root The model, as loadModel gives it
 * @param {number} [cells] Along its longest side
 * @returns {{min: Array<number>, cell: number, n: Array<number>, filled: Uint8Array, count: number}|null}
 *   null for a model with no triangles; count is the filled cells
 */
export function buildOccluder(root, cells = OCCLUDER_CELLS) {
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  eachTriangle(root, (a, b, c) => {
    for (const v of [a, b, c]) {
      for (let i = 0; i < 3; i++) {
        lo[i] = Math.min(lo[i], v.getComponent(i))
        hi[i] = Math.max(hi[i], v.getComponent(i))
      }
    }
  })
  if (!(hi[0] >= lo[0])) {
    return null
  }
  const cell = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / cells || 1
  const n = [0, 1, 2].map((i) => Math.max(1, Math.ceil((hi[i] - lo[i]) / cell) + 1))
  const filled = new Uint8Array(n[0] * n[1] * n[2])
  const mark = (x, y, z) => {
    const i = Math.floor((x - lo[0]) / cell)
    const j = Math.floor((y - lo[1]) / cell)
    const k = Math.floor((z - lo[2]) / cell)
    filled[i + (n[0] * (j + (n[1] * k)))] = 1
  }
  eachTriangle(root, (a, b, c) => {
    // Points on the triangle half a cell apart, so no cell it crosses is
    // missed.
    const edge = Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a))
    const steps = Math.max(1, Math.ceil(edge / (cell / 2)))
    for (let i = 0; i <= steps; i++) {
      for (let j = 0; i + j <= steps; j++) {
        const u = i / steps
        const v = j / steps
        mark(a.x + (u * (b.x - a.x)) + (v * (c.x - a.x)),
            a.y + (u * (b.y - a.y)) + (v * (c.y - a.y)),
            a.z + (u * (b.z - a.z)) + (v * (c.z - a.z)))
      }
    }
  })
  let count = 0
  for (let i = 0; i < filled.length; i++) {
    count += filled[i]
  }
  return {min: lo, cell, n, filled, count}
}


/**
 * Calls fn(a, b, c) for every triangle of every mesh (and instance) under
 * root, in root's frame.  The vectors are reused.
 *
 * @param {import('three').Object3D} root
 * @param {Function} fn
 */
function eachTriangle(root, fn) {
  root.updateMatrixWorld(true)
  const rootInv = new Matrix4().copy(root.matrixWorld).invert()
  const toRoot = new Matrix4()
  const inst = new Matrix4()
  const m = new Matrix4()
  const a = new Vector3()
  const b = new Vector3()
  const c = new Vector3()
  root.traverse((node) => {
    const pos = node.isMesh ? node.geometry?.attributes?.position : null
    if (!pos) {
      return
    }
    toRoot.multiplyMatrices(rootInv, node.matrixWorld)
    const index = node.geometry.index
    const count = index ? index.count : pos.count
    const instances = node.isInstancedMesh ? node.count : 1
    for (let k = 0; k < instances; k++) {
      if (node.isInstancedMesh) {
        node.getMatrixAt(k, inst)
        m.multiplyMatrices(toRoot, inst)
      } else {
        m.copy(toRoot)
      }
      for (let i = 0; i + 2 < count; i += 3) {
        a.fromBufferAttribute(pos, index ? index.getX(i) : i).applyMatrix4(m)
        b.fromBufferAttribute(pos, index ? index.getX(i + 1) : i + 1).applyMatrix4(m)
        c.fromBufferAttribute(pos, index ? index.getX(i + 2) : i + 2).applyMatrix4(m)
        fn(a, b, c)
      }
    }
  })
}


/**
 * Whether a ray, ahead of its origin, meets a filled cell: the grid walked
 * cell by cell (Amanatides and Woo 1987) from where the ray enters it.
 *
 * @param {{min: Array<number>, cell: number, n: Array<number>, filled: Uint8Array}} occ
 * @param {Array<number>} o Origin, the occluder's frame
 * @param {Array<number>} d Direction
 * @returns {boolean}
 */
export function rayHits(occ, o, d) {
  const {min, cell, n, filled} = occ
  // Into the grid's units, and clipped to its box.
  const p = [0, 1, 2].map((i) => (o[i] - min[i]) / cell)
  let t0 = 0
  let t1 = Infinity
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-15) {
      if (p[i] < 0 || p[i] > n[i]) {
        return false
      }
      continue
    }
    let a = -p[i] / d[i]
    let b = (n[i] - p[i]) / d[i]
    if (a > b) {
      [a, b] = [b, a]
    }
    t0 = Math.max(t0, a)
    t1 = Math.min(t1, b)
  }
  if (!(t0 <= t1)) {
    return false
  }
  const cellAt = [0, 0, 0]
  const step = [0, 0, 0]
  const tMax = [0, 0, 0]
  const tDelta = [0, 0, 0]
  for (let i = 0; i < 3; i++) {
    const x = p[i] + (d[i] * t0)
    cellAt[i] = Math.min(n[i] - 1, Math.max(0, Math.floor(x)))
    if (d[i] > 0) {
      step[i] = 1
      tMax[i] = t0 + ((cellAt[i] + 1 - x) / d[i])
      tDelta[i] = 1 / d[i]
    } else if (d[i] < 0) {
      step[i] = -1
      tMax[i] = t0 + ((cellAt[i] - x) / d[i])
      tDelta[i] = -1 / d[i]
    } else {
      tMax[i] = Infinity
      tDelta[i] = Infinity
    }
  }
  for (;;) {
    if (filled[cellAt[0] + (n[0] * (cellAt[1] + (n[1] * cellAt[2])))]) {
      return true
    }
    const i = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : (tMax[1] < tMax[2] ? 1 : 2)
    if (tMax[i] > t1) {
      return false
    }
    cellAt[i] += step[i]
    if (cellAt[i] < 0 || cellAt[i] >= n[i]) {
      return false
    }
    tMax[i] += tDelta[i]
  }
}


/** Rays across the disc: its centre, and rings at these fractions of its radius. */
const RINGS = [[0.4, 6], [0.75, 12], [0.95, 12]]


/**
 * The unit directions across a disc of angular radius `radius` about `dir`:
 * the centre first, then the rings.
 *
 * @param {Vector3} dir Unit
 * @param {number} radius Radians
 * @returns {Array<Vector3>}
 */
export function discRays(dir, radius) {
  const u = new Vector3(0, 1, 0)
  if (Math.abs(dir.y) > 0.9) {
    u.set(1, 0, 0)
  }
  u.cross(dir).normalize()
  const v = new Vector3().crossVectors(dir, u)
  const rays = [dir.clone()]
  for (const [f, n] of RINGS) {
    const t = Math.tan(radius * f)
    for (let k = 0; k < n; k++) {
      const th = 2 * Math.PI * (k + (f * 0.5)) / n
      rays.push(dir.clone().addScaledVector(u, t * Math.cos(th)).addScaledVector(v, t * Math.sin(th)).normalize())
    }
  }
  return rays
}


/**
 * The share of the Sun's disc a model hides from the camera: the share of
 * rays across the disc that meet it, and whether the centre's does.
 *
 * @param {{positions: Float32Array, count: number}} occ buildOccluder's
 * @param {import('three').Object3D} root The model, placed in the scene
 * @param {Vector3} cam The camera, world
 * @param {Vector3} sun The Sun's centre, world
 * @param {number} discRadius The disc's angular radius, radians
 * @returns {{fraction: number, centre: boolean}}
 */
export function sunBlocked(occ, root, cam, sun, discRadius) {
  const inv = tmpM.copy(root.matrixWorld).invert()
  const o = tmpO.copy(cam).applyMatrix4(inv).toArray()
  const dir = tmpD.subVectors(sun, cam).normalize()
  let hits = 0
  let centre = false
  const rays = discRays(dir, discRadius)
  rays.forEach((r, k) => {
    // Directions into the model's frame: the inverse's linear part (the
    // model's scale is uniform).
    const d = r.transformDirection(inv).toArray()
    if (rayHits(occ, o, d)) {
      hits++
      if (k === 0) {
        centre = true
      }
    }
  })
  return {fraction: hits / rays.length, centre}
}


const tmpM = new Matrix4()
const tmpO = new Vector3()
const tmpD = new Vector3()
