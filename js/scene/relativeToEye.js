// Relative-to-eye placement of far things (#340; DESIGN.md, "Relative-to-eye
// anchors"): a far thing's points are kept in float64 on the CPU and handed
// to the GPU as small float32 offsets from an anchor near where the camera
// looks, with the anchor in the node's position.
//
// Why that is enough with three's float32 matrices: three composes each
// node's modelViewMatrix on the CPU in float64 (camera.matrixWorldInverse ×
// matrixWorld, JS numbers), and only the product goes up as float32.  Its
// translation is the anchor in view space: near the line of sight its x and
// y are small, and float32 holds them to 6e-8 of themselves, not of the
// distance; z is large but only divides x and y in the projection, so its
// error moves a point by 6e-8 of its own small offset from the axis.  What
// float32 cannot hold is a large number in a vertex attribute (a point 7e12
// m from its node is held to 5e5 m, #334), so the vertices are offsets from
// the anchor, re-written when the anchor moves.  No shader change: the
// ordinary modelViewMatrix does the camera subtraction, in float64.
//
// Used by the Rubin app's apparent path and its ring (ApparentPath.js), the
// first far things placed this way; the orbit lines do the same per line
// (bodyLine.js's origin at the body), and the stars and the asterisms carry
// the camera's position as high and low float32 parts instead (rte.js).


/**
 * Write points (float64) as float32 offsets from an anchor.
 *
 * @param {Float64Array|Array<number>} points xyz, packed
 * @param {{x: number, y: number, z: number}} anchor in the points' frame
 * @param {Float32Array} out at least as long as points
 * @returns {Float32Array} out
 */
export function writeOffsets(points, anchor, out) {
  const n = points.length
  for (let i = 0; i < n; i += 3) {
    out[i] = points[i] - anchor.x
    out[i + 1] = points[i + 1] - anchor.y
    out[i + 2] = points[i + 2] - anchor.z
  }
  return out
}


/**
 * A point at a fractional index on a curve sampled at equal steps (xyz,
 * packed, float64), by the cubic through the four samples round it (shifted
 * in at the ends): smooth where linear interpolation between the samples
 * cuts the curve's chord (the apparent path's daily samples sag 5.5e6 m
 * between days, from Earth's orbit; the cubic is within a few hundred
 * metres).
 *
 * @param {Float64Array|Array<number>} samples xyz, packed, at least 2 points
 * @param {number} f fractional index, clamped to the samples
 * @param {{x: number, y: number, z: number}} out
 * @returns {object} out
 */
export function cubicAt(samples, f, out) {
  const n = samples.length / 3
  const fc = Math.min(Math.max(f, 0), n - 1)
  const m = Math.min(4, n)
  const i0 = Math.min(Math.max(Math.floor(fc) - 1, 0), n - m)
  const t = fc - i0
  let x = 0
  let y = 0
  let z = 0
  for (let j = 0; j < m; j++) {
    // Lagrange's basis at t over the nodes 0 .. m - 1.
    let w = 1
    for (let k = 0; k < m; k++) {
      if (k !== j) {
        w *= (t - k) / (j - k)
      }
    }
    const b = 3 * (i0 + j)
    x += w * samples[b]
    y += w * samples[b + 1]
    z += w * samples[b + 2]
  }
  out.x = x
  out.y = y
  out.z = z
  return out
}


/**
 * Where a point lands in normalised device coordinates as the GPU computes
 * it: the model-view and projection matrices and the vertex each rounded to
 * float32 (as uploaded), and each product and sum rounded too.  For checks
 * of what float32 does to a far thing (the tests, Rubin.md's probe).
 *
 * @param {Array<number>} modelView a Matrix4's elements, column-major
 * @param {Array<number>} projection likewise
 * @param {{x: number, y: number, z: number}} v the vertex, in the node's frame
 * @returns {{x: number, y: number}} NDC
 */
export function gpuNdc(modelView, projection, v) {
  const f = Math.fround
  const mul = (m, a) => {
    const r = [0, 0, 0, 0]
    for (let row = 0; row < 4; row++) {
      let s = 0
      for (let col = 0; col < 4; col++) {
        s = f(s + f(f(m[(4 * col) + row]) * f(a[col])))
      }
      r[row] = s
    }
    return r
  }
  const clip = mul(projection, mul(modelView, [v.x, v.y, v.z, 1]))
  return {x: f(clip[0] / clip[3]), y: f(clip[1] / clip[3])}
}


/**
 * The same in float64: where the point is.
 *
 * @param {Array<number>} modelView
 * @param {Array<number>} projection
 * @param {{x: number, y: number, z: number}} v
 * @returns {{x: number, y: number}} NDC
 */
export function exactNdc(modelView, projection, v) {
  const mul = (m, a) => [0, 1, 2, 3].map((row) =>
    (m[row] * a[0]) + (m[4 + row] * a[1]) + (m[8 + row] * a[2]) + (m[12 + row] * a[3]))
  const clip = mul(projection, mul(modelView, [v.x, v.y, v.z, 1]))
  return {x: clip[0] / clip[3], y: clip[1] / clip[3]}
}
