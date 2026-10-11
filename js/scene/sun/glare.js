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
  return glareFieldWeight(thetaDeg) *
    ((10 / (t ** 3)) + (((5 / (t * t)) + (0.1 * GLARE_PIGMENT / t)) * age) + (0.0025 * GLARE_PIGMENT))
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


/**
 * Beyond this angle the source is outside the eye's field (the equation's
 * range ends at GLARE_MAX_DEG): the veil is taken smoothly to zero from
 * here to GLARE_MAX_DEG, where glareFunction would otherwise hold its
 * 100° value for a source behind the head.
 */
export const GLARE_FADE_DEG = 90


/**
 * The veil's share at an angle past GLARE_FADE_DEG: 1 to there, 0 at
 * GLARE_MAX_DEG, smooth between.
 *
 * @param {number} thetaDeg
 * @returns {number}
 */
export function glareFieldWeight(thetaDeg) {
  const t = Math.min(Math.max((thetaDeg - GLARE_FADE_DEG) / (GLARE_MAX_DEG - GLARE_FADE_DEG), 0), 1)
  return 1 - (t * t * (3 - (2 * t)))
}


export const GLARE_GLSL = `
float glareFunction(float thetaDeg) {
  float t = clamp(thetaDeg, ${GLARE_MIN_DEG.toFixed(2)}, ${GLARE_MAX_DEG.toFixed(1)});
  float age = ${(1 + ((GLARE_AGE / 62.5) ** 4)).toFixed(6)};
  float field = 1.0 - smoothstep(${GLARE_FADE_DEG.toFixed(1)}, ${GLARE_MAX_DEG.toFixed(1)}, thetaDeg);
  float veil = 10.0 / (t * t * t) + (5.0 / (t * t) + ${(0.1 * GLARE_PIGMENT).toFixed(4)} / t) * age;
  return field * (veil + ${(0.0025 * GLARE_PIGMENT).toFixed(6)});
}
`


/**
 * The eye's whole point spread function: the CIE total glare equation
 * (Vos & van den Berg 1999, CIE Collection 135/1999; CIE 146/2002; Vos
 * 2003, Lighting Res. Technol. 35, 163), the general equation above
 * extended inward to θ = 0 by the optics' own spread: two Lorentzian-like
 * lobes, one of 0.0046° (the diffraction and aberration core) and one of
 * 0.045° (2.7′), which hold 0.95 of the light, and the scattered light
 * (the glare terms, 0.1° and out) the rest.  Per steradian, so it
 * integrates to about 1 over the sphere (1.04 for this age and pigment,
 * eyePsfShare):
 *
 *   L/E = [1 − 0.08(A/70)⁴]·[9.2e6/(1 + (θ/0.0046)²)^1.5 + 1.5e5/(1 + (θ/0.045)²)^1.5]
 *       + [1 + 1.6(A/70)⁴]·{400/(1 + (θ/0.1)²) + 3e-8·θ² + p·[1300/(1 + (θ/0.1)²)^1.5 + 0.8/(1 + (θ/0.1)²)^0.5]}
 *       + 2.5e-3·p
 *
 * It is what a star's light does in the eye (HDR.md, "Physical stars"):
 * the core lands in the rods' pool (the patch), the wings are the veil
 * round a bright star, falling as θ^-3 (the 0.045° lobe's tail) to a
 * degree or so and as θ^-2 beyond (the glare terms).  Taken as recalled
 * and checked against the general equation (within 40% from 0.1° to
 * 100°) and its normalisation; the sandbox reaches no journal.
 *
 * @param {number} thetaDeg The angle from the source, degrees, 0 to GLARE_MAX_DEG
 * @returns {number} L_eq / E, per steradian
 */
export function eyePsf(thetaDeg) {
  const t = Math.max(thetaDeg, 0)
  const ageCore = 1 - (0.08 * ((GLARE_AGE / 70) ** 4))
  const ageGlare = 1 + (1.6 * ((GLARE_AGE / 70) ** 4))
  const lobe = (a) => (1 + ((t / a) ** 2)) ** -1.5
  const q = 1 + ((t / 0.1) ** 2)
  const optics = ageCore * ((9.2e6 * lobe(0.0046)) + (1.5e5 * lobe(0.045)))
  const scatter = ageGlare * ((400 / q) + (3e-8 * t * t) + (GLARE_PIGMENT * ((1300 / (q ** 1.5)) + (0.8 / Math.sqrt(q)))))
  return glareFieldWeight(t) * (optics + scatter + (2.5e-3 * GLARE_PIGMENT))
}


/**
 * The share of a point's light the eye's PSF puts within an angle of it:
 * ∫ eyePsf dΩ to thetaDeg, weighted by `weight(θ)` if given.
 *
 * @param {number} thetaDeg
 * @param {Function} [weight] A weight of the angle, 1 by default
 * @returns {number}
 */
export function eyePsfShare(thetaDeg, weight = () => 1) {
  const deg2ToSr = (Math.PI / 180) ** 2
  const n = 4000
  const lo = Math.log(1e-6)
  const hi = Math.log(Math.max(thetaDeg, 1.01e-6))
  let sum = 0
  for (let i = 0; i < n; i++) {
    const a = Math.exp(lo + ((hi - lo) * i / n))
    const b = Math.exp(lo + ((hi - lo) * (i + 1) / n))
    const m = Math.sqrt(a * b)
    sum += eyePsf(m) * weight(m) * 2 * Math.PI * m * (b - a)
  }
  return sum * deg2ToSr
}


/**
 * The angle, degrees, at which the PSF's wing falls to a value: the
 * inverse of eyePsf past its core (it is monotone).
 *
 * @param {number} perSr L_eq / E
 * @returns {number} Degrees; GLARE_MAX_DEG if the wing is over it everywhere
 */
export function eyePsfRadiusDeg(perSr) {
  let lo = 1e-4
  let hi = GLARE_MAX_DEG
  if (eyePsf(GLARE_FADE_DEG) >= perSr) {
    // Over the value wherever the eye's field reaches.
    return hi
  }
  if (eyePsf(lo) < perSr) {
    return 0
  }
  for (let i = 0; i < 60; i++) {
    const mid = Math.sqrt(lo * hi)
    if (eyePsf(mid) >= perSr) {
      lo = mid
    } else {
      hi = mid
    }
  }
  return hi
}


/** GLSL: float eyePsf(float thetaDeg), as eyePsf(). */
export const EYE_PSF_GLSL = `
float eyePsf(float thetaDeg) {
  float t = max(thetaDeg, 0.0);
  float a1 = t / 0.0046;
  float a2 = t / 0.045;
  float q = 1.0 + (t / 0.1) * (t / 0.1);
  float l1 = 1.0 + a1 * a1;
  float l2 = 1.0 + a2 * a2;
  float optics = ${(1 - (0.08 * ((GLARE_AGE / 70) ** 4))).toFixed(6)} * (9.2e6 / (l1 * sqrt(l1)) + 1.5e5 / (l2 * sqrt(l2)));
  float scatter = ${(1 + (1.6 * ((GLARE_AGE / 70) ** 4))).toFixed(6)} * (400.0 / q + 3.0e-8 * t * t + ${
  GLARE_PIGMENT.toFixed(2)} * (1300.0 / (q * sqrt(q)) + 0.8 / sqrt(q)));
  float field = 1.0 - smoothstep(${GLARE_FADE_DEG.toFixed(1)}, ${GLARE_MAX_DEG.toFixed(1)}, t);
  return field * (optics + scatter + ${(2.5e-3 * GLARE_PIGMENT).toFixed(6)});
}
`
