/**
 * The rings' photometry (rings.md, "Lighting: the rings in exposure
 * units"): a layer of particles many particles thick, lit by the Sun's
 * irradiance at the planet and scattering it once, the classical model of
 * ring photometry (Chandrasekhar 1960; Cuzzi et al. 1984, in Planetary
 * Rings; Dones, Cuzzi & Showalter 1993, Icarus 105, 184).  Seen from the
 * lit face a slab of normal optical depth τ has
 *
 *   I/F = ϖP(α)/4 · μ₀/(μ + μ₀) · (1 − e^(−τ(1/μ + 1/μ₀)))
 *
 * and from the unlit face, the light diffusely transmitted,
 *
 *   I/F = ϖP(α)/4 · μ₀/(μ − μ₀) · (e^(−τ/μ) − e^(−τ/μ₀))
 *
 * where μ₀ and μ are the cosines of the Sun's and the view's angles from
 * the ring plane's normal, α the phase angle, ϖ the particles'
 * single-scattering albedo and P their phase function, normalized to a
 * mean of 1 over the sphere.  The radiance is (I/F)·E/π for the
 * irradiance E (exposure.js irradianceAt), so the rings are in exposure
 * units like any lit surface, and the background shows through the share
 * e^(−τ/μ).
 *
 * The particles' phase function is the power law P ∝ (π − α)^n with n = 3,
 * the backscattering of icy regolith-covered particles (Dones et al. 1993
 * fit about 3 to the A ring in Voyager's phase curves; Callisto's is
 * similar): the lit rings dim away from opposition.
 */


/** The power law's exponent. */
export const RING_PHASE_EXPONENT = 3


// ∫₀^π (π − α)³ sin α dα = π³ − 6π, so P = 2(π − α)³ / (π³ − 6π) has a
// mean of 1 over the sphere (½∫P sin α dα = 1).
const RING_PHASE_NORM = 2 / ((Math.PI ** 3) - (6 * Math.PI))


/**
 * The single-scattering albedo ϖ of a ring texel per unit of its colour
 * map's stored value.  Calibrated against the rings' integrated light:
 * Mallama & Hilton's (2018, Astronomy and Computing 25, 10) magnitude law
 * for Saturn, the one JPL Horizons uses, adds −1.825·sin B mag for the
 * rings at ring opening B, away from opposition (its opposition-surge term,
 * −0.378·sin B·e^(−2.25α), isn't modelled here).  Fitted at B = 26.6°
 * (2017 June 15, opposition), where the rings add 1.046 times the globe's
 * light; at B = 7.4° (2026 October 6) the render's rings then add 0.229 mag
 * against the law's 0.189 (0.211 with the surge).  The B ring's band of the
 * map (median stored value 0.55) comes out at ϖ ≈ 0.5, inside Cuzzi et
 * al.'s 0.4-0.6 for B ring particles (rings.md, "Lighting").
 */
export const RING_ALBEDO_SCALE = 0.914


/**
 * @param {number} cosAlpha Cosine of the phase angle (Sun to particle to eye)
 * @returns {number} P(α), mean 1 over the sphere
 */
export function ringPhase(cosAlpha) {
  const alpha = Math.acos(Math.min(1, Math.max(-1, cosAlpha)))
  return RING_PHASE_NORM * ((Math.PI - alpha) ** RING_PHASE_EXPONENT)
}


/**
 * The geometric factor of the slab's single scattering: I/F over ϖP/4.
 *
 * @param {number} tau Normal optical depth
 * @param {number} mu0 |cos| of the Sun's angle from the ring normal
 * @param {number} mu |cos| of the view's angle from the ring normal
 * @param {boolean} litFace Whether the eye is on the Sun's side of the plane
 * @returns {number}
 */
export function ringSlabFactor(tau, mu0, mu, litFace) {
  if (litFace) {
    return mu0 / (mu + mu0) * (1 - Math.exp(-tau * ((1 / mu) + (1 / mu0))))
  }
  // The limit at μ = μ₀ is (τ/μ)·e^(−τ/μ).
  if (Math.abs(mu - mu0) < RING_MU_EPSILON) {
    return tau / mu * Math.exp(-tau / mu)
  }
  return mu0 / (mu - mu0) * (Math.exp(-tau / mu) - Math.exp(-tau / mu0))
}


/** Where the unlit face's form switches to its limit at μ = μ₀. */
export const RING_MU_EPSILON = 1e-3


/**
 * @param {number} albedo ϖ
 * @param {number} tau Normal optical depth
 * @param {number} mu0 |cos| of the Sun's angle from the ring normal
 * @param {number} mu |cos| of the view's angle from the ring normal
 * @param {number} cosAlpha Cosine of the phase angle
 * @param {boolean} litFace Whether the eye is on the Sun's side of the plane
 * @returns {number} The ring's I/F
 */
export function ringReflectance(albedo, tau, mu0, mu, cosAlpha, litFace) {
  return albedo * ringPhase(cosAlpha) / 4 * ringSlabFactor(tau, mu0, mu, litFace)
}


/**
 * The normal optical depth for a texel of the opacity map, taken as the
 * share of the background a ray normal to the plane loses, 1 − e^(−τ).
 *
 * @param {number} opacity 0 to 1
 * @returns {number}
 */
export function ringTau(opacity) {
  return -Math.log(Math.max(1 - opacity, RING_MIN_TRANSMISSION))
}


/** The opaque end of the opacity map: τ 6.9. */
export const RING_MIN_TRANSMISSION = 1e-3


/** The same in GLSL, for rings-frag.js. */
export const RING_PHOTOMETRY_GLSL = /* glsl */`
#define RING_PI 3.141592653589793
float ringPhase(float cosAlpha) {
  float a = acos(clamp(cosAlpha, -1.0, 1.0));
  return ${RING_PHASE_NORM.toPrecision(9)} * pow(RING_PI - a, ${RING_PHASE_EXPONENT.toFixed(1)});
}
float ringSlabFactor(float tau, float mu0, float mu, bool litFace) {
  if (litFace) {
    return mu0 / (mu + mu0) * (1.0 - exp(-tau * (1.0 / mu + 1.0 / mu0)));
  }
  if (abs(mu - mu0) < ${RING_MU_EPSILON.toExponential()}) {
    return tau / mu * exp(-tau / mu);
  }
  return mu0 / (mu - mu0) * (exp(-tau / mu) - exp(-tau / mu0));
}
float ringTau(float opacity) {
  return -log(max(1.0 - opacity, ${RING_MIN_TRANSMISSION.toExponential()}));
}
`
