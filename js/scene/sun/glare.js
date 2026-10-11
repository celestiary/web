/**
 * The eye's veiling glare round a bright source (js/scene/Sun.md, "Glare"):
 * the light the eye's media scatter over the retina, which veils what is
 * near the source.  It is light at the eye, so it is drawn over everything
 * (no depth test), scaled by the source's visible share (eclipse.js).
 * Spencer et al. (1995, SIGGRAPH, "Physically-based glare effects for
 * digital images") argue for drawing it: a display can't make the eye
 * scatter the Sun's light, so the image must carry it.
 *
 * The CIE's general disability glare equation (CIE 135/1999, Vos & van den
 * Berg): the veiling luminance over the illuminance the source makes at
 * the eye, for a glare angle θ in degrees (0.1° to 100°), an age A and an
 * eye pigmentation p:
 *   L_veil / E = 10/θ³ + (5/θ² + 0.1 p/θ)(1 + (A/62.5)⁴) + 0.0025 p   [sr⁻¹]
 * Stiles-Holladay's 10/θ² is its middle term's mean.  Here A = 25 and
 * p = 0.5 (brown eyes): a young observer.
 */
export const GLARE_AGE = 25
export const GLARE_PIGMENT = 0.5
// The equation's range; nearer than this the source's own disc is there.
export const GLARE_MIN_DEG = 0.1
export const GLARE_MAX_DEG = 100


/**
 * @param {number} thetaDeg the angle from the source, degrees
 * @returns {number} L_veil / E, per steradian
 */
export function glareFunction(thetaDeg) {
  const t = Math.min(Math.max(thetaDeg, GLARE_MIN_DEG), GLARE_MAX_DEG)
  const age = 1 + ((GLARE_AGE / 62.5) ** 4)
  return (10 / (t ** 3)) + (((5 / (t * t)) + (0.1 * GLARE_PIGMENT / t)) * age) + (0.0025 * GLARE_PIGMENT)
}


/**
 * The veil next to a small disc, over its own radiance: its solid angle
 * times the glare function (E = L·Ω for a disc much smaller than θ).
 *
 * @param {number} thetaDeg
 * @param {number} discSolidAngle sr
 * @returns {number}
 */
export function glareOverRadiance(thetaDeg, discSolidAngle) {
  return discSolidAngle * glareFunction(thetaDeg)
}


/**
 * How far out the veil stays over a value, for sizing the pass.
 *
 * @param {number} floor the value under which it isn't drawn, over the
 *     disc's radiance times the disc's solid angle
 * @returns {number} degrees
 */
export function glareRadiusDeg(floor) {
  let lo = GLARE_MIN_DEG
  let hi = GLARE_MAX_DEG
  if (glareFunction(hi) >= floor) {
    return hi
  }
  if (glareFunction(lo) < floor) {
    return lo
  }
  for (let i = 0; i < 50; i++) {
    const mid = Math.sqrt(lo * hi)
    if (glareFunction(mid) >= floor) {
      lo = mid
    } else {
      hi = mid
    }
  }
  return hi
}


export const GLARE_GLSL = `
float glareFunction(float thetaDeg) {
  float t = clamp(thetaDeg, ${GLARE_MIN_DEG.toFixed(2)}, ${GLARE_MAX_DEG.toFixed(1)});
  float age = ${(1 + ((GLARE_AGE / 62.5) ** 4)).toFixed(6)};
  return 10.0 / (t * t * t) + (5.0 / (t * t) + ${(0.1 * GLARE_PIGMENT).toFixed(4)} / t) * age + ${(0.0025 * GLARE_PIGMENT).toFixed(6)};
}
`
