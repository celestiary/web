/**
 * PBR Neutral, the one tone map (HDR.md), and its exact inverse, on the
 * CPU: the JS mirrors of hdr.js NEUTRAL_GLSL and NEUTRAL_INVERSE_GLSL.  A
 * module of its own, importing nothing, so that the observer's calibration
 * (observer/instrument.js, through screen.js) can use it: hdr.js imports
 * the observer.
 */


// PBR Neutral's constants (Khronos; three's NeutralToneMapping).
export const START_COMPRESSION = 0.8 - 0.04
export const DESATURATION = 0.15
export const TOE_END = 0.08
export const TOE_OFFSET = 0.04
// Display values at or over this are clamped before inverting: N(x) only
// approaches 1, and N⁻¹(0.999) ≈ 58 is already far into the shoulder.
export const MAX_DISPLAY = 0.999
/**
 * The toe's curvature: under TOE_END a grey x shows as this × x² (6.25),
 * so its slope is twice that times x (eye.js, the extended response).
 */
export const NEUTRAL_TOE_CURVATURE = TOE_OFFSET / (TOE_END * TOE_END)
/** Where the toe ends, in exposure units: a grey there shows as TOE_OFFSET (0.04). */
export const NEUTRAL_TOE_END = TOE_END


/**
 * PBR Neutral, without the exposure multiply (the buffer holds exposed values).
 *
 * @param {Array<number>} rgb Scene-referred, exposure units
 * @returns {Array<number>} Display values, 0 to 1
 */
export function neutral(rgb) {
  if (!rgb.every(Number.isFinite)) {
    // As the GLSL: a non-finite value is the white point, not NaN.
    return rgb.map(() => 1)
  }
  const x = Math.min(...rgb)
  const offset = x < TOE_END ? x - (6.25 * x * x) : TOE_OFFSET
  let c = rgb.map((v) => v - offset)
  const peak = Math.max(...c)
  if (peak < START_COMPRESSION) {
    return c
  }
  const d = 1 - START_COMPRESSION
  const newPeak = 1 - (d * d / (peak + d - START_COMPRESSION))
  c = c.map((v) => v * newPeak / peak)
  const g = 1 - (1 / ((DESATURATION * (peak - newPeak)) + 1))
  return c.map((v) => (v * (1 - g)) + (newPeak * g))
}


/**
 * The exact inverse of neutral.
 *
 * @param {Array<number>} display Display values, 0 to 1
 * @returns {Array<number>} Scene-referred values that neutral maps to them
 */
export function neutralInverse(display) {
  let c = display.map((v) => Math.max(v, 0))
  const q0 = Math.max(...c)
  if (q0 >= START_COMPRESSION) {
    // PBR Neutral desaturates what it compresses, so a bright saturated
    // colour (a pure blue line at 1) is outside what it can produce: the
    // exact inverse would need negative channels.  Keep the hue, and scale
    // the colour down to the brightest the tone map can show at that
    // saturation (maxNeutralPeak).
    const q = Math.min(q0, MAX_DISPLAY, maxNeutralPeak(Math.min(...c) / q0))
    const y = c.map((v) => v * q / q0)
    const d = 1 - START_COMPRESSION
    const peak = START_COMPRESSION - d + (d * d / (1 - q))
    const g = 1 - (1 / ((DESATURATION * (peak - q)) + 1))
    c = y.map((v) => (v - (g * q)) / (1 - g) * peak / q)
  }
  const m = Math.max(Math.min(...c), 0)
  const offset = m >= TOE_OFFSET ? TOE_OFFSET : (0.4 * Math.sqrt(m)) - m
  return c.map((v) => v + offset)
}


/**
 * The brightest peak PBR Neutral can put out for a colour of this
 * saturation: its shoulder mixes toward white by g, so a colour whose
 * weakest channel is `rho` of its strongest needs g ≤ rho.  With u = 1 − q,
 * p − q = K where g = 1 − 1/(0.15·K + 1), and p = 0.52 + 0.0576/u, so
 * u + 0.0576/u = K + 0.48.  0.76 (no shoulder) for a pure primary, 1 for
 * grey.
 *
 * @param {number} rho min channel over max channel, 0 to 1
 * @returns {number}
 */
export function maxNeutralPeak(rho) {
  if (rho >= 1) {
    return 1
  }
  const d = 1 - START_COMPRESSION
  const k = rho / (DESATURATION * (1 - rho))
  const b = k + (2 * d)
  const u = (b - Math.sqrt(Math.max((b * b) - (4 * d * d), 0))) / 2
  return Math.max(1 - u, START_COMPRESSION)
}
