/**
 * Where the atmosphere pass takes a pixel's ray to end, replayed in float32
 * as the shader computes it (Atmosphere.js, FULLSCREEN_FRAG), for tests.
 *
 * The pass reads the scene's depth and makes it a distance along the ray,
 * with the depth buffer's step there as its error: a 24-bit step is
 * z² / near · 2⁻²⁴ of distance, so from the ground, where the near plane is
 * metres, anything past a few hundred thousand km is within a step or two
 * of the far plane, and its distance is noise.  Jupiter from 156 m up
 * (near 100 m, 8.8e11 m off) writes the far plane itself on most of its
 * disc and one step under it on the rest, which reads as 1.5e9 ± 3.4e9 m.
 *
 * From inside the atmosphere a surface is taken as inside it (a march of
 * the air to it) only when the depth puts it surely inside, its distance
 * plus the error short of where the ray leaves the air; else as past it
 * (the table's whole ray, as the sky has).  Taking Jupiter's one-step
 * pixels as inside marched 1.5e9 m in 16 samples, the first 7.5e7 m out,
 * with no air in any: no extinction where the rest of the disc had it,
 * bright dashes in the depth's rounding contours.  From outside, a
 * surface is past only when surely past: the planet's own limb, from afar
 * through coarse depth, stays ground.  See composition.md, "The ray's end".
 */


const f32 = Math.fround


/**
 * The pass's distance to a pixel's surface, along the view axis, and its
 * error, from the depth sample (window depth, 0..1), in float32.
 *
 * @param {number} depthSample
 * @param {number} near The camera's near plane, metres
 * @param {number} far The camera's far plane, metres
 * @returns {{tMax: number, tMaxErr: number}} Metres
 */
export function depthDistance(depthSample, near, far) {
  const n = f32(near)
  const scatterFar = f32(Math.min(far, 1e15))
  const zNdc = f32(f32(depthSample * 2) - 1)
  const den = f32(f32(n + scatterFar) - f32(zNdc * f32(scatterFar - n)))
  let tMax = f32(f32(f32(2 * n) * scatterFar) / den)
  tMax = Math.max(tMax, n)
  const tMaxErr = f32(f32(f32(tMax * tMax) / n) * f32(2 / 16777216))
  return {tMax, tMaxErr}
}


/**
 * How the pass treats a pixel's ray (the LUT path's classification).
 *
 * @param {object} p
 * @param {number} p.depthSample Window depth, 0..1 (1 is the cleared far plane)
 * @param {number} p.near
 * @param {number} p.far
 * @param {number} p.exitDistance Where the ray leaves the atmosphere, metres
 * @param {boolean} p.inside Whether the camera is inside the atmosphere
 * @returns {'background'|'past'|'short'|'ground'} background: nothing drawn,
 *   sky; past: a body beyond the air, the table's whole ray; short: a
 *   surface inside the air, seen from inside it, a march to it; ground: a
 *   surface inside the air seen from outside, the table's ray to it
 */
export function rayEnd({depthSample, near, far, exitDistance, inside}) {
  if (depthSample >= 1) {
    return 'background'
  }
  const {tMax, tMaxErr} = depthDistance(depthSample, near, far)
  const tEnd = inside ? tMax + tMaxErr : tMax - tMaxErr
  if (tEnd > exitDistance) {
    return 'past'
  }
  return inside ? 'short' : 'ground'
}


/**
 * The window depth a point at a distance writes, quantised to the 24-bit
 * buffer, with the projection's float32 arithmetic (z = a·zEye + b, w = d).
 *
 * @param {number} distance Metres, along the view axis
 * @param {number} near
 * @param {number} far
 * @returns {number} 0..1
 */
export function depthOf(distance, near, far) {
  const a = f32(-(far + near) / (far - near))
  const b = f32(-2 * far * near / (far - near))
  const z = f32(f32(a * f32(-distance)) + b)
  const w = f32(distance)
  const ndc = f32(z / w)
  const steps = (2 ** 24) - 1
  return Math.round(((ndc * 0.5) + 0.5) * steps) / steps
}
