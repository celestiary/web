// Vector3 is imported for the JSDoc type only.
import {Object3D, Vector3} from 'three'


const _cam = new Vector3


/**
 * Relative-To-Eye camera uniforms for an object whose vertices are far from
 * the origin (the star field, its labels, the asterisms, the Milky Way).
 *
 * The camera's position in the object's local frame, split into a float32
 * high part and the float64 residual, so the vertex shader's
 * `(position - camHigh) + (positionLow - camLow)` keeps full precision at
 * light-year distances.  The shader then turns that eye-relative vector by
 * `mat3(modelViewMatrix)`, the object's rotation (the StellarFrame's
 * precession) and the view's, but not their translation.
 *
 * The local position is Rᵀ·(camera − t) from the object's matrixWorld
 * (rotation R, translation t, no scale): exact to float64, with no matrix
 * inverse.  Call from onBeforeRender, after the renderer has updated the
 * matrices.  Allocates nothing.
 *
 * @param {Object3D} object the object drawn, in whose frame its positions are
 * @param {Object3D} camera
 * @param {Vector3} high receives Math.fround of the local camera position
 * @param {Vector3} low receives the residual
 */
export function rteCameraLocal(object, camera, high, low) {
  camera.getWorldPosition(_cam)
  const e = object.matrixWorld.elements
  const dx = _cam.x - e[12]
  const dy = _cam.y - e[13]
  const dz = _cam.z - e[14]
  const x = (e[0] * dx) + (e[1] * dy) + (e[2] * dz)
  const y = (e[4] * dx) + (e[5] * dy) + (e[6] * dz)
  const z = (e[8] * dx) + (e[9] * dy) + (e[10] * dz)
  const hx = Math.fround(x)
  const hy = Math.fround(y)
  const hz = Math.fround(z)
  high.set(hx, hy, hz)
  low.set(x - hx, y - hy, z - hz)
}


/**
 * GLSL: the length and direction of a vector in metres without squaring
 * metres (js/scene/HDR.md, "Physical stars": nor past 2^64 m).  length()
 * and normalize() are sqrt(dot) and v·rsqrt(dot), and dot(v, v) is Inf in
 * float32 once |v| passes 2^64 m (1,950 ly).  These divide by the largest
 * component first, through clamp(), which no fast-math fold passes
 * through: a compiler may move a plain scale (v·s, or v / m) out of the
 * dot and square metres again.
 */
export const SAFE_LENGTH_GLSL = `
float safeLength(vec3 v) {
  vec3 a = abs(v);
  float m = max(max(a.x, a.y), max(a.z, 1.0e-30));
  return m * length(clamp(v / m, -1.0, 1.0));
}
vec3 safeNormalize(vec3 v) {
  vec3 a = abs(v);
  float m = max(max(a.x, a.y), max(a.z, 1.0e-30));
  return normalize(clamp(v / m, -1.0, 1.0));
}
`
