/**
 * The Moon's photometric function, for celestiary's Moon mesh (Planet.js)
 * and Cesium's Moon tileset (CesiumLayers sunlitShader) alike: Planet.md,
 * "Lighting and exposure", and HDR.md, "A star beside the Moon".
 *
 * Lunar-Lambert (McEwen 1991, Icarus 92, 298; its limb parameter L(α) for
 * the Moon from McEwen 1996, LPSC 27, 841, as USGS ISIS's
 * LunarLambertMcEwen has it):
 *
 *     I/F = A · f(α) · [2 L(α) μ0 / (μ0 + μ) + (1 − L(α)) μ0]
 *
 * with A the normal albedo (I/F at i = e = α = 0), μ0 and μ the cosines of
 * the incidence and emission angles, and α the phase angle.  The first term
 * is Lommel-Seeliger's, which holds the full Moon's disc flat (no limb
 * darkening) and brightens the bright limb at partial phase; the second is
 * Lambert's.  L falls from 1 at full to 0 by 104°, so a crescent is
 * Lambert's shape, with a terminator that falls off as μ0.
 *
 * f(α) is fitted, phase by phase, so that the whole disc's light is JPL
 * Horizons' (Allen's) phase law for the Moon,
 *
 *     V(1, α) = 0.23 + 0.026 α + 4e-9 α⁴        (α in degrees)
 *
 * (lunarPhotometry.horizons.json: Horizons' APmag over a lunation, reduced
 * to 1 AU, is this to ±0.001 mag).  The disc's light for each term has a
 * closed form (Lommel-Seeliger's and Lambert's integral phase functions),
 * so f is exact at every phase, in JS and in GLSL.  Past 160° f is held: the
 * law is an extrapolation there (it is fitted to ~150°), and earthshine
 * outshines the sliver.
 *
 * A comes from the colour map: its stored values are a linear stretch of
 * I/F (the LRO WAC mosaic's maria are 0.15-0.19 and its highlands 0.32-0.42,
 * a ratio of ~2.1, as the Moon's measured albedos; sRGB-decoded they would
 * be ~4.4), scaled so the near side's disc at full is the Moon's geometric
 * albedo, 0.121 for V(1, 0) = 0.23 (MOON_TEXTURE_GAIN).
 *
 * Before, both Moons were lit by Lambert's law with the stored values × 1.3
 * as albedo: 3.25 stops too bright at #192's crescent (×2.2 from the
 * albedo, ×4.2 from Lambert's phase law against the Moon's).
 */


/** Horizons' V(1, 0) for the Moon: its absolute magnitude, as its APmag gives it. */
export const MOON_ABSOLUTE_MAGNITUDE = 0.23

/** The Sun's V magnitude at 1 AU, as exposure.js's SUN_APPARENT_MAGNITUDE. */
const SUN_V = -26.74

/** The Moon's mean radius, metres (IAU). */
export const MOON_RADIUS_M = 1737.4e3

const AU_M = 1.495978707e11

/**
 * The Moon's geometric albedo, from its absolute magnitude: the disc at full
 * phase is p × πR² of a white Lambert disc's light.  0.121.
 */
export const MOON_GEOMETRIC_ALBEDO =
  Math.pow(10, -0.4 * (MOON_ABSOLUTE_MAGNITUDE - SUN_V)) / ((MOON_RADIUS_M / AU_M) ** 2)

/**
 * The colour map's (moon.jpg) mean stored value over the near side's disc,
 * weighted by its projected area (μ, centred on 0°, 0°), as a disc at full
 * phase shows it: `python3 tools/moon/textureMean.py public/textures/moon.jpg`.
 */
export const MOON_TEXTURE_NEAR_MEAN = 0.2716

/**
 * The scale from moon.jpg's stored values to normal albedo: the near
 * side's disc then averages the Moon's geometric albedo at full.  moon.json
 * texture_gain and Cesium's textureGain (bodies.js) are this.  0.445.
 */
export const MOON_TEXTURE_GAIN = MOON_GEOMETRIC_ALBEDO / MOON_TEXTURE_NEAR_MEAN

/** The phase angle past which f(α) is held, radians (160°). */
export const PHASE_HOLD = 160 * Math.PI / 180


const DEG = 180 / Math.PI


/**
 * @param {number} alpha Phase angle, radians
 * @returns {number} Horizons' phase law: magnitudes fainter than at full, for the whole disc
 */
export function moonPhaseMagnitude(alpha) {
  const a = Math.abs(alpha) * DEG
  return (0.026 * a) + (4e-9 * (a ** 4))
}


/**
 * @param {number} alpha Phase angle, radians
 * @returns {number} McEwen's L(α), the Lommel-Seeliger share, held in 0-1 (it reaches 0 at 104°)
 */
export function limbParameter(alpha) {
  const a = Math.abs(alpha) * DEG
  return Math.min(Math.max(1 + (a * (-0.019 + (a * (2.42e-4 - (1.46e-6 * a))))), 0), 1)
}


/**
 * Lommel-Seeliger's integral phase function, 1 at full: the disc's light of
 * 2μ0 / (μ0 + μ) over its light at α = 0 (where it is 1 everywhere).
 *
 * @param {number} alpha Radians
 * @returns {number}
 */
export function lommelSeeligerIntegral(alpha) {
  const a = Math.min(Math.abs(alpha), Math.PI - 1e-9)
  if (a < 1e-6) {
    return 1
  }
  const h = a / 2
  return 1 - (Math.sin(h) * Math.tan(h) * Math.log(1 / Math.tan(a / 4)))
}


/**
 * Lambert's integral phase function, 1 at full.  The disc's light of μ0 at
 * full is 2/3 of the disc's area.
 *
 * @param {number} alpha Radians
 * @returns {number}
 */
export function lambertIntegral(alpha) {
  const a = Math.min(Math.abs(alpha), Math.PI)
  return (Math.sin(a) + ((Math.PI - a) * Math.cos(a))) / Math.PI
}


/**
 * f(α): the scale at each phase that makes the disc's light Horizons' law
 * (see the header), 1 at full.
 *
 * @param {number} alpha Radians
 * @returns {number}
 */
export function phaseFunction(alpha) {
  const a = Math.min(Math.abs(alpha), PHASE_HOLD)
  const l = limbParameter(a)
  const disc = (l * lommelSeeligerIntegral(a)) + ((1 - l) * (2 / 3) * lambertIntegral(a))
  return Math.pow(10, -0.4 * moonPhaseMagnitude(a)) / disc
}


/**
 * I/F per unit of normal albedo: the photometric function, as the shaders
 * compute it (LUNAR_PHOTOMETRY_GLSL lunarReflectance).  A Lambert surface's
 * would be μ0.
 *
 * @param {number} mu0 Cosine of the incidence angle
 * @param {number} mu Cosine of the emission angle
 * @param {number} alpha Phase angle, radians
 * @returns {number}
 */
export function lunarReflectance(mu0, mu, alpha) {
  if (!(mu0 > 0)) {
    return 0
  }
  const m = Math.max(mu, 0)
  const l = limbParameter(alpha)
  return phaseFunction(alpha) * ((2 * l * mu0 / Math.max(mu0 + m, 1e-6)) + ((1 - l) * mu0))
}


/**
 * The maria's and highlands' stored values in moon.jpg (medians at five
 * sites each: `tools/moon/textureMean.py`): 0.171 and 0.366.  The highlands'
 * normal albedo, 0.163, is the Moon's bright surface for the meter
 * (lunarHighlight); the texels' own extremes are the mosaic's shading as
 * much as albedo (it was imaged at a high Sun's incidence).
 */
export const MOON_HIGHLAND_STORED = 0.366


/** Least cosine of emission the meter's highlight looks at (lunarPeakReflectance). */
const PEAK_MU_MIN = 0.25


/**
 * The brightest point of the visible, lit disc, per unit of normal albedo,
 * leaving out the outermost 3% of the radius (μ under 0.25), where
 * Lommel-Seeliger's term peaks toward 2L at the limb itself over a pixel or
 * two.  It lies in the phase plane (off it, μ0 and μ scale alike, which
 * leaves Lommel-Seeliger's term as it is and lowers Lambert's).  1 at full,
 * 0.40 at quarter, 0.22 at #192's crescent (127.5°), where Lambert's
 * subsolar point would be 0.79.
 *
 * @param {number} alpha Phase angle, radians
 * @returns {number}
 */
export function lunarPeakReflectance(alpha) {
  const a = Math.min(Math.abs(alpha), Math.PI)
  let peak = 0
  const n = 180
  for (let i = 0; i <= n; i++) {
    // From the sub-observer point toward the Sun, -90° to 90°: μ = cos θ.
    const theta = (-Math.PI / 2) + (Math.PI * i / n)
    if (Math.cos(theta) >= PEAK_MU_MIN) {
      peak = Math.max(peak, lunarReflectance(Math.cos(a - theta), Math.cos(theta), a))
    }
  }
  return peak
}


/**
 * The meter's highlight for the Moon (exposure.js highlightReflectance):
 * the I/F of its brightest surface, the highlands, at its brightest on the
 * lit disc at this phase.  0.16 at full, 0.066 at quarter, 0.035 at #192's
 * crescent.  At parity's 64° view the frame's brightest meter tap read
 * 0.079 against 0.089 here; a Lambert body's estimate (2.5 × its albedo,
 * facing the Sun) would be 0.30 at every phase.
 *
 * @param {number} alpha Phase angle, radians
 * @returns {number}
 */
export function lunarHighlight(alpha) {
  return MOON_HIGHLAND_STORED * MOON_TEXTURE_GAIN * lunarPeakReflectance(alpha)
}


/**
 * The whole disc's light at a phase, by summing the photometric function
 * over it (a grid on the projected disc), over a white Lambert disc's at
 * full (πR², I/F 1): the geometric albedo times the phase law, for a
 * uniform normal albedo `albedo`.  For tests: the closed forms phaseFunction
 * uses agree with it.
 *
 * @param {number} alpha Phase angle, radians
 * @param {number} [albedo] Normal albedo
 * @param {number} [n] Grid cells across the disc
 * @returns {number}
 */
export function discIntegral(alpha, albedo = 1, n = 400) {
  const s = [Math.sin(alpha), 0, Math.cos(alpha)]
  let sum = 0
  for (let j = 0; j < n; j++) {
    const y = -1 + ((2 * (j + 0.5)) / n)
    for (let i = 0; i < n; i++) {
      const x = -1 + ((2 * (i + 0.5)) / n)
      const r2 = (x * x) + (y * y)
      if (r2 >= 1) {
        continue
      }
      // The surface's normal: the observer is along +z.
      const z = Math.sqrt(1 - r2)
      const mu0 = (x * s[0]) + (z * s[2])
      sum += albedo * lunarReflectance(mu0, z, alpha)
    }
  }
  return sum * ((2 / n) ** 2) / Math.PI
}


/**
 * The Moon's V magnitude by the model: the absolute magnitude's albedo, the
 * disc's light at the phase, at distances r from the Sun and Δ from the
 * observer.
 *
 * @param {number} alpha Phase angle, radians
 * @param {number} rAu Sun-Moon, AU
 * @param {number} deltaAu Observer-Moon, AU
 * @returns {number}
 */
export function moonMagnitude(alpha, rAu, deltaAu) {
  return MOON_ABSOLUTE_MAGNITUDE + (5 * Math.log10(rAu * deltaAu)) + moonPhaseMagnitude(alpha)
}


/**
 * Surface brightness, V mag/arcsec², of a surface of I/F `iOverF` lit by the
 * Sun from r AU: what Horizons' S-brt is for the lit part's mean.
 *
 * @param {number} iOverF
 * @param {number} [rAu]
 * @returns {number}
 */
export function surfaceBrightness(iOverF, rAu = 1) {
  const arcsec = Math.PI / (180 * 3600)
  return SUN_V - (2.5 * Math.log10(iOverF / Math.PI * arcsec * arcsec / (rAu * rAu)))
}


/** Earth's geometric albedo (V; Allen's Astrophysical Quantities, 4th ed., §12.3). */
export const EARTH_GEOMETRIC_ALBEDO = 0.367


/**
 * Earthshine on the Moon, as a fraction of the sunlight on it: the light
 * Earth reflects, whose irradiance at the Moon is the Sun's × Earth's
 * geometric albedo × its phase law at the Moon's view of it × (R⊕ / d)²
 * (the standard earthshine estimate: Danjon; Qiu et al. 2003, JGR 108,
 * 4709), with Lambert's phase law for Earth, Φ(α) = (sin α + (π − α) cos α) / π.
 * 1.0e-4 at full Earth (new Moon), 6.9e-5 at #192's crescent (Earth seen
 * from the Moon at 52.5°), 2.4e-5 with Earth at quarter.  Both Moons light
 * their night side with it through the lunar photometric function, at the
 * small phase the earthlight is seen at from Earth, so the regolith's
 * opposition brightening (flat to the limb, f(α) near 1) is in it.
 *
 * @param {number} phaseAngle Earth's phase angle seen from the Moon (Sun-Earth-Moon), radians
 * @param {number} distance Earth-Moon, metres
 * @param {number} earthRadius Metres
 * @returns {number}
 */
export function earthshineFraction(phaseAngle, distance, earthRadius = 6.371e6) {
  const a = Math.min(Math.max(phaseAngle, 0), Math.PI)
  return EARTH_GEOMETRIC_ALBEDO * lambertIntegral(a) * ((earthRadius / distance) ** 2)
}


const f4 = (x) => x.toExponential(6)


/**
 * The photometric function in GLSL, for three's shader and Cesium's custom
 * shader alike (no `PI` or `czm_` names): `lunarReflectance(mu0, mu,
 * cosAlpha)` is lunarReflectance above, I/F over the normal albedo.
 */
export const LUNAR_PHOTOMETRY_GLSL = `
const float LUNAR_PI = 3.141592653589793;
float lunarLimbParameter(float a) {
  // McEwen's L(α), α in degrees; 0 from 104°.
  return clamp(1.0 + a * (-0.019 + a * (2.42e-4 - 1.46e-6 * a)), 0.0, 1.0);
}
float lunarPhaseFunction(float alpha) {
  // f(α): Horizons' V(1, α) over the disc's light of the two terms, held
  // past ${(PHASE_HOLD * DEG).toFixed(0)}° (lunarPhotometry.js).
  float al = clamp(alpha, 1e-4, ${f4(PHASE_HOLD)});
  float a = al * ${f4(DEG)};
  float l = lunarLimbParameter(a);
  float h = 0.5 * al;
  float ls = 1.0 - sin(h) * tan(h) * log(1.0 / tan(0.5 * h));
  float lam = (sin(al) + (LUNAR_PI - al) * cos(al)) / LUNAR_PI;
  float a2 = a * a;
  float dv = 0.026 * a + 4e-9 * a2 * a2;
  return exp2(-0.4 * 3.321928095 * dv) / (l * ls + (1.0 - l) * (2.0 / 3.0) * lam);
}
float lunarReflectance(float mu0, float mu, float cosAlpha) {
  if (mu0 <= 0.0) return 0.0;
  float m = max(mu, 0.0);
  float alpha = acos(clamp(cosAlpha, -1.0, 1.0));
  float l = lunarLimbParameter(alpha * ${f4(DEG)});
  return lunarPhaseFunction(alpha) * (2.0 * l * mu0 / max(mu0 + m, 1e-6) + (1.0 - l) * mu0);
}
`
