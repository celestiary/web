/**
 * The K-corona: photospheric light Thomson-scattered by the corona's free
 * electrons (js/scene/Sun.md, "The corona").  Its brightness is computed,
 * not fitted: the electron density, from a published model shaped by the
 * cycle, integrated along each line of sight with Thomson's cross-section
 * and the Sun's light at each point, gives the surface brightness over the
 * disc's mean (B☉).  The CMEs' electrons go through the same integral.
 * This file is the model in JS (for the tests) and in GLSL (for the
 * shader); keep the two the same.
 */


// The electron density at solar minimum, cm⁻³, at r solar radii and
// heliographic latitude φ (Saito 1970, Ann. Tokyo Astron. Obs. 12, 53;
// as Saito, Poland & Munro 1977 use it): from the minimum's white-light
// eclipses.  The polar regions, the coronal holes, are 4 times thinner
// than the equator at 1.1 radii, and the outer corona's r^−2.5 term is
// nearly all equatorial.
export const SAITO = Object.freeze([
  Object.freeze([3.09e8, -16, 0.5, 1]),
  Object.freeze([1.58e8, -6, 0.95, 1]),
  Object.freeze([2.51e6, -2.5, 1, 0.5]),
])


/**
 * Saito's density.
 *
 * @param {number} r solar radii
 * @param {number} sinLat |sin φ|, φ the latitude from the current sheet
 * @returns {number} cm⁻³
 */
export function saitoDensity(r, sinLat) {
  const s = Math.min(Math.abs(sinLat), 1)
  let n = 0
  for (const [a, p, k, q] of SAITO) {
    n += a * (r ** p) * (1 - (k * (s ** q)))
  }
  return n
}


// Baumbach's K-corona (1937, from ten eclipses 1905-1929), the profile the
// integral is checked against: 10⁻⁶ of the disc centre's brightness times
// (1.425 ρ^−7 + 2.565 ρ^−17); the F-corona's 0.0532 ρ^−2.5 term is the
// zodiacal cloud's, drawn by the night sky (nightSky.js).
export const BAUMBACH_K = Object.freeze([[1.425, -7], [2.565, -17]])


/**
 * @param {number} rho impact radius, solar radii
 * @returns {number} Baumbach's K-corona over the disc centre's brightness
 */
export function baumbachK(rho) {
  return 1e-6 * BAUMBACH_K.reduce((s, [a, p]) => s + (a * (rho ** p)), 0)
}


// Thomson scattering: σ_T, and the Sun's radius in cm.  A point at r sees
// the disc's light diluted by W(r) = (1 − √(1 − 1/r²))/2 (a uniform disc's
// mean intensity), scattered by dσ/dΩ = (3σ_T/16π)(1 + cos²χ), χ the angle
// between the light's direction (radial) and the line of sight's.  Over
// the disc's mean radiance B☉,
//   B/B☉ = (3σ_T R☉/16) ∫ n(r) · 4W(r)r² · (1 + cos²χ) dŝ/r²,
// ŝ along the line in solar radii.  With the line's closest approach ρ
// and ŝ = ρ tan θ, r = ρ sec θ, cos χ = sin θ:
//   B/B☉ = (3σ_T R☉/16ρ) ∫ n(ρ sec θ) D(r) (1 + sin²θ) dθ,
// D(r) = 4W(r)r², 1 for a point source and 2 at the limb.  (Limb darkening
// and the polarisation's finer geometry are left out: van de Hulst 1950.)
export const THOMSON_CM2 = 6.6524587e-25
export const SUN_RADIUS_CM = 6.957e10
export const THOMSON_FACTOR = 3 * THOMSON_CM2 * SUN_RADIUS_CM / 16


/**
 * @param {number} r solar radii, at least 1
 * @returns {number} D(r) = 2r²(1 − √(1 − 1/r²))
 */
export function dilution(r) {
  const x = 1 / (r * r)
  // 1 − √(1 − x) = x / (1 + √(1 − x)), exact where x is small.
  return 2 * r * r * x / (1 + Math.sqrt(Math.max(1 - x, 0)))
}


// Samples along the line of sight, uniform in θ.
export const CORONA_SAMPLES = 24


/**
 * The K-corona along a line of sight, B/B☉: the integral above by the
 * midpoint rule in θ, from the camera's θ (or the far side's −π/2) to π/2.
 *
 * @param {number} rho impact radius, solar radii (> 1)
 * @param {function(number, number): number} density (r, sin θ) => cm⁻³
 * @param {number} [thetaStart]
 * @param {number} [thetaEnd]
 * @param {number} [samples]
 * @returns {number}
 */
export function thomsonBrightness(rho, density, thetaStart = -Math.PI / 2, thetaEnd = Math.PI / 2, samples = CORONA_SAMPLES) {
  const dTheta = (thetaEnd - thetaStart) / samples
  let sum = 0
  for (let k = 0; k < samples; k++) {
    const th = thetaStart + ((k + 0.5) * dTheta)
    const r = rho / Math.cos(th)
    const s = Math.sin(th)
    sum += density(r, s) * dilution(r) * (1 + (s * s))
  }
  return THOMSON_FACTOR * sum * dTheta / rho
}


// The current sheet: the magnetic equator the streamers lie along.  Its
// tilt from the rotational equator grows with the cycle, from ~10° near
// minimum to ~75° near maximum, when the sheet is also warped to high
// latitudes (the Wilcox Solar Observatory's computed tilts, Hoeksema 1995;
// the series isn't reachable from the sandbox: this is a model of its
// shape).
export const SHEET_TILT_DEG = Object.freeze([10, 75])
export const SHEET_WARP = Object.freeze([0.05, 0.45])
// Streamers: the density gathers toward the sheet, in a band that is wide
// in the helmets near the Sun and narrows to the stalks above ~2.5 radii
// (a model of their shape on Saito's mean): ×(0.6 + 0.4 e^(−(φ/w)²)),
// w from 35° at the surface to 8°, 1 on the sheet, so the equator keeps
// Saito's density, whose integral is Baumbach's K-corona within 13% from
// 1.05 to 2 radii (corona.test.js).
export const STREAMER = Object.freeze({base: 0.6, gain: 0.4, wideDeg: 35, narrowDeg: 8, scaleRadii: 0.7})


/**
 * The current sheet's tilt and warp for a level of activity.
 *
 * @param {number} level activityLevel, 0 to ~1
 * @returns {{tilt: number, warp: number}} radians; the warp's amplitude
 *     in sin latitude
 */
export function sheetShape(level) {
  const a = Math.min(Math.max(level, 0), 1)
  return {
    tilt: (SHEET_TILT_DEG[0] + ((SHEET_TILT_DEG[1] - SHEET_TILT_DEG[0]) * a)) * Math.PI / 180,
    warp: SHEET_WARP[0] + ((SHEET_WARP[1] - SHEET_WARP[0]) * a),
  }
}


/**
 * The sine of the latitude from the current sheet at a direction in the
 * Carrington frame: the tilted dipole's equator plus the warp's low-order
 * terms (as the shader's sheetSin).
 *
 * @param {Array<number>} u unit, body frame
 * @param {{pole: Array<number>, warp: number, phase: Array<number>}} sheet
 * @returns {number}
 */
export function sheetSin(u, sheet) {
  const lon = Math.atan2(-u[2], u[0])
  const c = Math.sqrt(Math.max(1 - (u[1] * u[1]), 0))
  const warp = (c * c * Math.sin((2 * lon) + sheet.phase[0])) + (c * c * c * Math.sin((3 * lon) + sheet.phase[1]) * 0.6)
  const d = (u[0] * sheet.pole[0]) + (u[1] * sheet.pole[1]) + (u[2] * sheet.pole[2])
  return Math.min(Math.max(d + (sheet.warp * warp), -1), 1)
}


/**
 * The sheet for a level of activity, its pole tilted toward a longitude.
 *
 * @param {number} level activityLevel
 * @param {number} lonRad the longitude the pole tilts toward
 * @param {Array<number>} [phase] the warp's phases
 * @returns {{pole: Array<number>, warp: number, phase: Array<number>}}
 */
export function sheetAt(level, lonRad, phase = [0, 0]) {
  const {tilt, warp} = sheetShape(level)
  return {
    pole: [Math.sin(tilt) * Math.cos(lonRad), Math.cos(tilt), -Math.sin(tilt) * Math.sin(lonRad)],
    warp,
    phase: [...phase, 0],
  }
}


/**
 * The streamers' gathering toward the sheet.
 *
 * @param {number} r solar radii
 * @param {number} sinLat sin of the latitude from the sheet
 * @returns {number}
 */
export function streamerFactor(r, sinLat) {
  const w = (STREAMER.narrowDeg + ((STREAMER.wideDeg - STREAMER.narrowDeg) * Math.exp(-(r - 1) / STREAMER.scaleRadii))) * Math.PI / 180
  const lat = Math.asin(Math.min(Math.abs(sinLat), 1))
  return STREAMER.base + (STREAMER.gain * Math.exp(-((lat / w) ** 2)))
}


/**
 * The mean corona's density (no rays): Saito's, about the sheet, with the
 * streamers' gathering.
 *
 * @param {number} r
 * @param {number} sinLat from the sheet
 * @returns {number} cm⁻³
 */
export function coronaDensity(r, sinLat) {
  return saitoDensity(r, sinLat) * streamerFactor(r, sinLat)
}


// A CME's electrons: its mass over 1.17 proton masses an electron (fully
// ionised, a tenth of the nuclei helium), in a shell at its front
// (Gaussian, σ 8% of its radius) through its cone.
export const GRAMS_PER_ELECTRON = 1.17 * 1.67262192e-24
export const CME_SHELL_SIGMA = 0.08


/**
 * The density at a CME's front, cm⁻³, for the shader.
 *
 * @param {number} mass g
 * @param {number} front solar radii
 * @param {number} halfWidth radians
 * @returns {number}
 */
export function cmeShellDensity(mass, front, halfWidth) {
  const electrons = mass / GRAMS_PER_ELECTRON
  const solidAngle = 2 * Math.PI * (1 - Math.cos(halfWidth))
  const volume = solidAngle * front * front * CME_SHELL_SIGMA * front * Math.sqrt(2 * Math.PI) * (SUN_RADIUS_CM ** 3)
  return electrons / volume
}


/**
 * The GLSL of the density and the integral, mirroring the functions above.
 * The caller declares the uniforms it reads: uSheetPole (the sheet's pole,
 * in the frame the samples are in), uSheetWarp, uWarpPhase, uRays.
 */
export const CORONA_GLSL = `
const float THOMSON_FACTOR = ${THOMSON_FACTOR.toExponential(6)};
const float STREAMER_BASE = ${STREAMER.base.toFixed(3)};
const float STREAMER_GAIN = ${STREAMER.gain.toFixed(3)};
const float STREAMER_WIDE = ${(STREAMER.wideDeg * Math.PI / 180).toFixed(6)};
const float STREAMER_NARROW = ${(STREAMER.narrowDeg * Math.PI / 180).toFixed(6)};
const float STREAMER_SCALE = ${STREAMER.scaleRadii.toFixed(3)};

float saitoDensity(float r, float s) {
  s = min(abs(s), 1.0);
  return ${SAITO[0][0].toExponential(4)} * pow(r, ${SAITO[0][1].toFixed(1)}) * (1.0 - ${SAITO[0][2].toFixed(2)} * s)
       + ${SAITO[1][0].toExponential(4)} * pow(r, ${SAITO[1][1].toFixed(1)}) * (1.0 - ${SAITO[1][2].toFixed(2)} * s)
       + ${SAITO[2][0].toExponential(4)} * pow(r, ${SAITO[2][1].toFixed(1)}) * (1.0 - sqrt(s));
}

float streamerFactor(float r, float s) {
  float w = STREAMER_NARROW + (STREAMER_WIDE - STREAMER_NARROW) * exp(-(r - 1.0) / STREAMER_SCALE);
  float lat = asin(min(abs(s), 1.0)) / w;
  return STREAMER_BASE + STREAMER_GAIN * exp(-lat * lat);
}

float dilution(float r) {
  float x = 1.0 / (r * r);
  return 2.0 * r * r * x / (1.0 + sqrt(max(1.0 - x, 0.0)));
}
`
