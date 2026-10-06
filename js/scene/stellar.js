/**
 * A star's surface from its physical parameters (js/scene/Stars.md): its
 * effective temperature from its spectral class, the colour and visual
 * surface brightness of a blackbody at that temperature, its limb
 * darkening, its granulation and its spots.  One set of functions for the
 * Sun's disc (star-shaders.js) and the field stars' points
 * (StarsBufferGeometry.js), so a star is the same colour as a point and
 * as a disc.
 */


/** The Sun's effective temperature, K (IAU 2015 Resolution B3, nominal). */
export const SUN_TEFF = 5772
/** The Sun's radius, m (IAU 2015 Resolution B3, nominal). */
export const SUN_RADIUS = 6.957e8
/** The Sun's surface gravity, log10 cgs (GM / R², IAU 2015 B3 nominal values). */
export const SUN_LOGG = 4.438
/** The Sun's absolute bolometric magnitude (IAU 2015 Resolution B2). */
export const SUN_MBOL = 4.74
/** The Sun's absolute visual magnitude, as the catalogue has it (StarsCatalog getSunProps). */
export const SUN_MV = 4.83

/** The temperature range of the colour functions and their table, K. */
export const TEMP_MIN = 1000
export const TEMP_MAX = 50000


// --- Colour: a blackbody through the CIE 1931 observer to linear sRGB.

/**
 * A piecewise Gaussian, the lobe of the CIE fits below.
 *
 * @param {number} x
 * @param {number} mu
 * @param {number} sigmaLo Width below mu
 * @param {number} sigmaHi Width above mu
 * @returns {number}
 */
function lobe(x, mu, sigmaLo, sigmaHi) {
  const t = (x - mu) / (x < mu ? sigmaLo : sigmaHi)
  return Math.exp(-0.5 * t * t)
}


/**
 * The CIE 1931 2° colour-matching functions, as the multi-lobe Gaussian fits
 * of Wyman, Sloan & Shirley 2013 ("Simple Analytic Approximations to the CIE
 * XYZ Color Matching Functions", JCGT 2(2)), within about 1% of the tables.
 *
 * @param {number} nm Wavelength, nm
 * @returns {Array<number>} x̄, ȳ, z̄
 */
export function cieXyzBar(nm) {
  return [
    (1.056 * lobe(nm, 599.8, 37.9, 31.0)) + (0.362 * lobe(nm, 442.0, 16.0, 26.7)) - (0.065 * lobe(nm, 501.1, 20.4, 26.2)),
    (0.821 * lobe(nm, 568.8, 46.9, 40.5)) + (0.286 * lobe(nm, 530.9, 16.3, 31.1)),
    (1.217 * lobe(nm, 437.0, 11.8, 36.0)) + (0.681 * lobe(nm, 459.0, 26.0, 13.8)),
  ]
}


/** The second radiation constant, hc/k, in nm·K (CODATA 2018). */
const C2_NM_K = 1.438776877e7
const VISIBLE_NM = [360, 830]
const VISIBLE_STEP_NM = 2
// The CIE functions at each step, computed once.
const VISIBLE_SAMPLES = []
for (let nm = VISIBLE_NM[0]; nm <= VISIBLE_NM[1]; nm += VISIBLE_STEP_NM) {
  VISIBLE_SAMPLES.push([nm, cieXyzBar(nm)])
}


/**
 * Planck's law, up to a constant factor: the spectral radiance of a
 * blackbody at a wavelength.
 *
 * @param {number} nm
 * @param {number} temp K
 * @returns {number}
 */
export function planck(nm, temp) {
  const x = C2_NM_K / (nm * temp)
  if (x > 700) {
    return 0
  }
  return 1 / ((nm ** 5) * Math.expm1(x))
}


/**
 * The CIE XYZ of a spectrum over the visible.
 *
 * @param {Function} radiance (nm) => spectral radiance
 * @returns {Array<number>} X, Y, Z, in the spectrum's units × nm
 */
export function spectrumXyz(radiance) {
  let x = 0
  let y = 0
  let z = 0
  for (const [nm, [xb, yb, zb]] of VISIBLE_SAMPLES) {
    const b = radiance(nm)
    x += b * xb
    y += b * yb
    z += b * zb
  }
  return [x * VISIBLE_STEP_NM, y * VISIBLE_STEP_NM, z * VISIBLE_STEP_NM]
}


/**
 * @param {number} temp K
 * @returns {Array<number>} The CIE XYZ of a blackbody, Planck's law's units
 */
export function blackbodyXyz(temp) {
  const t = clampTemp(temp)
  return spectrumXyz((nm) => planck(nm, t))
}


/**
 * CIE XYZ to linear sRGB (IEC 61966-2-1, D65 white).
 *
 * @param {Array<number>} xyz
 * @returns {Array<number>} r, g, b, linear
 */
export function xyzToLinearSrgb([x, y, z]) {
  return [
    (3.2404542 * x) - (1.5371385 * y) - (0.4985314 * z),
    (-0.9692660 * x) + (1.8760108 * y) + (0.0415560 * z),
    (0.0556434 * x) - (0.2040259 * y) + (1.0572252 * z),
  ]
}


/**
 * A blackbody's colour: linear sRGB at a luminance (Y) of 1, so the colour
 * carries the chromaticity and a star's brightness comes from elsewhere
 * (its catalogue lumens as a point, its surface brightness as a disc).
 * Channels may pass 1 (a hot star's blue is 2): the scene buffer is
 * linear HDR, and the tone map takes them.  A channel under 0 (out of
 * gamut, the reddest stars' blue) is 0.
 *
 * @param {number} temp K
 * @returns {Array<number>}
 */
export function blackbodyColor(temp) {
  const xyz = blackbodyXyz(temp)
  return xyzToLinearSrgb(xyz).map((c) => Math.max(c / xyz[1], 0))
}


const SUN_Y = blackbodyXyz(SUN_TEFF)[1]


/**
 * A blackbody's luminance relative to one at the Sun's temperature: the
 * visual surface brightness of a star's disc over the Sun's, the photopic
 * analogue of (T / T☉)⁴.  What a display shows is luminance, the units of
 * the scene buffer (HDR.md), so this, not σT⁴, scales a disc: a 3000 K
 * surface is 0.073 of the Sun's in σT⁴ but 0.016 in luminance, most of
 * its light in the infrared; a 20,000 K one 144× in σT⁴, 34× in
 * luminance, most of its light in the ultraviolet.
 *
 * @param {number} temp K
 * @returns {number}
 */
export function blackbodyLuminance(temp) {
  return blackbodyXyz(temp)[1] / SUN_Y
}


/**
 * @param {number} temp K
 * @returns {number} (T / T☉)⁴: the bolometric surface flux over the Sun's (Stefan–Boltzmann)
 */
export function stefanBoltzmannRatio(temp) {
  return (clampTemp(temp) / SUN_TEFF) ** 4
}


/**
 * @param {number} temp
 * @returns {number} temp within [TEMP_MIN, TEMP_MAX], and the Sun's for a non-number
 */
export function clampTemp(temp) {
  if (!Number.isFinite(temp)) {
    return SUN_TEFF
  }
  return Math.min(Math.max(temp, TEMP_MIN), TEMP_MAX)
}


/** The blackbody table's entries, spaced evenly in log temperature over [TEMP_MIN, TEMP_MAX]. */
export const BLACKBODY_LUT_SIZE = 64
const LOG_TEMP_SPAN = Math.log(TEMP_MAX / TEMP_MIN)


/**
 * @param {number} i
 * @returns {number} The temperature of the blackbody table's entry i, K
 */
export function lutTemperature(i) {
  return TEMP_MIN * Math.exp(LOG_TEMP_SPAN * i / (BLACKBODY_LUT_SIZE - 1))
}


/**
 * The blackbody table the disc shader interpolates (BLACKBODY_GLSL) and
 * the field stars read (blackbodyFromLut): per entry its colour
 * (blackbodyColor) and the log2 of its luminance over the Sun's
 * (blackbodyLuminance), which is smooth in log temperature where the
 * luminance itself spans 11 decades.
 *
 * @returns {Float32Array} BLACKBODY_LUT_SIZE × [r, g, b, log2 luminance]
 */
export function blackbodyLut() {
  const lut = new Float32Array(BLACKBODY_LUT_SIZE * 4)
  for (let i = 0; i < BLACKBODY_LUT_SIZE; i++) {
    const t = lutTemperature(i)
    const xyz = blackbodyXyz(t)
    const rgb = xyzToLinearSrgb(xyz).map((c) => Math.max(c / xyz[1], 0))
    lut.set([...rgb, Math.log2(xyz[1] / SUN_Y)], i * 4)
  }
  return lut
}


let sharedLut = null
/** @returns {Float32Array} The blackbody table, computed once */
export function sharedBlackbodyLut() {
  sharedLut ??= blackbodyLut()
  return sharedLut
}


/**
 * The table interpolated as the shader does it (BLACKBODY_GLSL): linearly
 * in log temperature.
 *
 * @param {Float32Array} lut
 * @param {number} temp K
 * @returns {Array<number>} [r, g, b, log2 luminance over the Sun's]
 */
export function blackbodyFromLut(lut, temp) {
  const u = Math.log(clampTemp(temp) / TEMP_MIN) / LOG_TEMP_SPAN * (BLACKBODY_LUT_SIZE - 1)
  const i = Math.min(Math.floor(u), BLACKBODY_LUT_SIZE - 2)
  const f = u - i
  const out = []
  for (let k = 0; k < 4; k++) {
    out.push((lut[(i * 4) + k] * (1 - f)) + (lut[((i + 1) * 4) + k] * f))
  }
  return out
}


/**
 * GLSL: `vec4 blackbody(float temp)`, the table (uniform `uBlackbody`) as
 * blackbodyFromLut reads it: rgb the colour at a luminance of 1, a the
 * log2 of the luminance over the Sun's.
 */
export const BLACKBODY_GLSL = `
const int BLACKBODY_LUT_SIZE = ${BLACKBODY_LUT_SIZE};
uniform vec4 uBlackbody[BLACKBODY_LUT_SIZE];
vec4 blackbody(float temp) {
  float t = clamp(temp, ${TEMP_MIN.toFixed(1)}, ${TEMP_MAX.toFixed(1)});
  float u = log(t / ${TEMP_MIN.toFixed(1)}) / ${LOG_TEMP_SPAN.toFixed(9)} * float(BLACKBODY_LUT_SIZE - 1);
  int i = int(min(floor(u), float(BLACKBODY_LUT_SIZE - 2)));
  return mix(uBlackbody[i], uBlackbody[i + 1], u - float(i));
}
`


// --- Temperature from spectral class.

/** The catalogue's spectral classes (Celestia's stars.dat: the type nibble), by index. */
export const SPECTRAL_CLASSES = ['O', 'B', 'A', 'F', 'G', 'K', 'M', 'R', 'S', 'N', 'WC', 'WN', '?', 'L', 'T', 'C']
/** White dwarfs' classes (star kind 1), by the type nibble. */
export const WHITE_DWARF_CLASSES = ['DA', 'DB', 'DC', 'DO', 'DQ', 'DZ', 'D', 'DX']
/** The catalogue's luminosity classes, by index; 8 is unknown. */
export const LUMINOSITY_CLASSES = ['Ia0', 'Ia', 'Ib', 'II', 'III', 'IV', 'V', 'VI', '']
/** The luminosity class index for unknown. */
export const LUM_CLASS_UNKNOWN = 8
/** The luminosity class index for a dwarf, V. */
export const LUM_CLASS_V = 6
/** The subclass for unknown. */
export const SUBCLASS_UNKNOWN = 10
/** A normal star and a white dwarf, the catalogue's star kinds. */
export const KIND_NORMAL = 0
export const KIND_WHITE_DWARF = 1


/**
 * A star's spectral type as text, e.g. "G2 V", from the catalogue's
 * indices or a body file's (the Sun's "4").
 *
 * @param {object} props
 * @returns {string}
 */
export function spectralTypeName(props) {
  const type = parseInt(props?.spectralType)
  const sub = parseInt(props?.sub)
  const lum = parseInt(props?.lumClass)
  const kind = parseInt(props?.kind) || KIND_NORMAL
  const letters = kind === KIND_WHITE_DWARF ? WHITE_DWARF_CLASSES : SPECTRAL_CLASSES
  if (!(type >= 0 && type < letters.length)) {
    return '?'
  }
  let name = letters[type]
  if (sub >= 0 && sub < SUBCLASS_UNKNOWN) {
    name += sub
  }
  const lumName = kind === KIND_NORMAL && lum >= 0 ? LUMINOSITY_CLASSES[lum] ?? '' : ''
  return lumName ? `${name} ${lumName}` : name
}


// de Jager & Nieuwenhuijzen 1987 (A&A 177, 217; "DJ87"): log Teff and
// log L over the HR diagram as a double Chebyshev series in the spectral
// type s and the luminosity class b, their eqs. 2a and 2b, with the 20
// coefficients of their solution (as PyAstronomy's SpecTypeDeJager has
// them, which reproduces their Table 5 to a few percent in Teff).
const DJ87_LOG_L = [
  [3.82573, -2.13868, -0.46357, 0.02076, -0.11937],
  [-1.55607, -1.89216, -0.96916, -0.08869, -0.20423],
  [1.05165, 0.42330, -0.94379, -0.07438],
  [-0.01663, -0.20024, -0.18552],
  [-0.07576, -0.10934],
  [0.11008],
]
const DJ87_LOG_T = [
  [3.96105, 0.03165, -0.02963, 0.01307, -0.01172],
  [-0.62945, 0.02596, -0.06009, 0.01881, -0.01121],
  [0.14370, -0.00977, -0.03265, 0.01649],
  [0.00791, 0.00076, -0.03006],
  [0.00723, -0.02621],
  [0.02755],
]
// DJ87 Table 1: s at the start of each run of types, and its step per subclass.
const DJ87_S = [['O', 1, 0.1, 0.1], ['O', 9, 0.9, 0.3], ['B', 2, 1.8, 0.15], ['A', 0, 3.0, 0.1],
  ['F', 0, 4.0, 0.1], ['G', 0, 5.0, 0.05], ['K', 0, 5.5, 0.1], ['M', 0, 6.5, 0.2]]
// DJ87 Table 2: b for each of the catalogue's luminosity classes (VI as V).
const DJ87_B = [0.0, 0.6, 1.4, 2.0, 3.0, 4.0, 5.0, 5.0]
const DJ87_LETTERS = 'OBAFGKM'


/**
 * @param {string} letter O to M
 * @param {number} sub 0 to 9.x
 * @returns {number} DJ87's spectral variable s
 */
function dj87S(letter, sub) {
  const index = (l, n) => (DJ87_LETTERS.indexOf(l) * 10) + n
  const at = index(letter, sub)
  let k = DJ87_S.length - 1
  while (k > 0 && at < index(DJ87_S[k][0], DJ87_S[k][1])) {
    k--
  }
  const [l0, n0, s0, step] = DJ87_S[k]
  return s0 + ((at - index(l0, n0)) * step)
}


/**
 * de Jager & Nieuwenhuijzen 1987's calibration of the HR diagram.
 *
 * @param {string} letter O, B, A, F, G, K or M
 * @param {number} sub Subclass, 0 to 9 (O from 1)
 * @param {number} b DJ87's luminosity variable: 5 for V, 3 for III, 0.6 for Ia
 * @returns {{teff: number, logL: number}} K, and log10 L/L☉
 */
export function deJager(letter, sub, b) {
  const s = dj87S(letter, letter === 'O' ? Math.max(sub, 1) : sub)
  const sn = (s - 4.25) / 4.25
  const bn = (b - 2.5) / 2.5
  const cheb = (i, x) => Math.cos(i * Math.acos(Math.min(Math.max(x, -1), 1)))
  let logL = 0
  let logT = 0
  for (let i = 0; i < DJ87_LOG_T.length; i++) {
    for (let j = 0; j < DJ87_LOG_T[i].length; j++) {
      const t = cheb(i, sn) * cheb(j, bn)
      logL += DJ87_LOG_L[i][j] * t
      logT += DJ87_LOG_T[i][j] * t
    }
  }
  return {teff: 10 ** logT, logL}
}


/**
 * DJ87's luminosity variable b for a catalogue luminosity class index.
 *
 * @param {number} lumClass
 * @returns {number}
 */
export function deJagerB(lumClass) {
  return DJ87_B[lumClass] ?? DJ87_B[LUM_CLASS_V]
}


/** The luminosity class index for a bright giant, II. */
const LUM_CLASS_II = 3
// The red supergiants' temperature scale from their TiO bands fitted with
// MARCS models, Levesque et al. 2005 (ApJ 628, 973, table 2): 4,100 K at
// K1 I to 3,450 K at M5 I, a few hundred kelvin warmer than the older
// scales DJ87 was fitted to.  [subclass as K = 0-9, M = 10-19; K]
const RED_SUPERGIANTS = [[11, 4100], [12, 4015], [13, 3920], [15, 3840], [17, 3800], [20, 3790], [21, 3745],
  [21.5, 3710], [22, 3660], [22.5, 3615], [23, 3605], [23.5, 3550], [24, 3535], [24.5, 3495], [25, 3450]]


/**
 * @param {string} letter K or M
 * @param {number} sub
 * @returns {number} A K or M supergiant's (or bright giant's) temperature, K (Levesque et al. 2005)
 */
function redSupergiantTeff(letter, sub) {
  return interpolate(RED_SUPERGIANTS, (letter === 'M' ? 20 : 10) + sub)
}


/**
 * A star's effective temperature from its spectral class, subclass and
 * luminosity class (the catalogue's indices):
 * - O to M: de Jager & Nieuwenhuijzen 1987 (deJager), an unknown subclass
 *   as 5 and an unknown luminosity class as V, unless `b` is given;
 * - K1 to M5 supergiants and bright giants: Levesque et al. 2005;
 * - white dwarfs: the temperature index, Teff = 50,400 K / subclass
 *   (Sion et al. 1983), 10,000 K where unknown;
 * - Wolf-Rayet stars: 50,000 K, the table's top (they are 30-200 kK, and
 *   past ~20 kK a blackbody's colour hardly changes);
 * - carbon and S stars: R 5,100 K down to 3,700 at R9, N and C 3,100 to
 *   2,500, S 3,600 to 3,000 (approximate: Bergeat et al. 2001; Van Eck et
 *   al. 2017); 177 of the catalogue's stars;
 * - L and T dwarfs: 2,250 to 1,400 K and 1,300 to 700 K, approximately
 *   (Pecaut & Mamajek 2013); none in the catalogue.
 *
 * @param {object} props kind, spectralType, sub, lumClass (numbers or numeric strings)
 * @param {number} [b] DJ87's luminosity variable, overriding the class's
 * @returns {number} K
 */
export function teffFromClass(props, b) {
  const kind = parseInt(props?.kind) || KIND_NORMAL
  const type = parseInt(props?.spectralType)
  let sub = parseInt(props?.sub)
  const known = sub >= 0 && sub < SUBCLASS_UNKNOWN
  if (kind === KIND_WHITE_DWARF) {
    return known ? clampTemp(50400 / Math.max(sub, 0.5)) : 10000
  }
  if (!known) {
    sub = 5
  }
  const letter = SPECTRAL_CLASSES[type]
  const lum = parseInt(props?.lumClass)
  if (b === undefined && lum >= 0 && lum <= LUM_CLASS_II && ((letter === 'K' && sub >= 1) || letter === 'M')) {
    return redSupergiantTeff(letter, sub)
  }
  if (DJ87_LETTERS.includes(letter ?? '-')) {
    return clampTemp(deJager(letter, sub, b ?? deJagerB(lum)).teff)
  }
  switch (letter) {
    case 'WC': case 'WN': return TEMP_MAX
    case 'R': return 5100 - (155 * sub)
    case 'N': case 'C': return 3100 - (65 * sub)
    case 'S': return 3600 - (65 * sub)
    case 'L': return 2250 - (95 * sub)
    case 'T': return 1300 - (65 * sub)
    default: return SUN_TEFF
  }
}


/**
 * A star's effective temperature: its own (`teff`, from a body file or the
 * measured stars, starParams.js) where it has one, the Sun's for the Sun,
 * else from its class (teffFromClass).
 *
 * @param {object} props
 * @returns {number} K
 */
export function starTeff(props) {
  if (Number.isFinite(props?.teff)) {
    return props.teff
  }
  const name = String(props?.name ?? '').toLowerCase()
  if (props?.hipId === 0 || name === 'sun' || name === 'sol') {
    return SUN_TEFF
  }
  return teffFromClass(props)
}


// --- Bolometric correction.

// Flower 1996's BC_V(log Teff) polynomials, with Torres 2010's corrected
// coefficients (AJ 140, 1158, Table 1), on the scale where M_bol,☉ = 4.73.
const BC_COOL = [-0.190537291496456e+05, 0.155144866764412e+05, -0.421278819301717e+04, 0.381476328422343e+03]
const BC_MID = [-0.370510203809015e+05, 0.385672629965804e+05, -0.150651486316025e+05, 0.261724637119416e+04,
  -0.170623810323864e+03]
const BC_HOT = [-0.118115450538963e+06, 0.137145973583929e+06, -0.636233812100225e+05, 0.147412923562646e+05,
  -0.170587278406872e+04, 0.788731721804990e+02]
// Under this its cool branch, fitted to giants, diverges (−5 at 3000 K, −11 at 2500).
const BC_TEMP_MIN = 3000


/**
 * The bolometric correction, M_bol − M_V, of a star at a temperature:
 * Flower 1996 as corrected by Torres 2010.  Calibrated mostly on giants at
 * the cool end: a late M dwarf's is about a magnitude too negative there
 * (Proxima, 2,980 K: −4.6 here, −3.7 measured).
 *
 * @param {number} temp K
 * @returns {number} Magnitudes
 */
export function bolometricCorrectionV(temp) {
  const lt = Math.log10(Math.min(Math.max(clampTemp(temp), BC_TEMP_MIN), TEMP_MAX))
  const c = lt < 3.70 ? BC_COOL : (lt < 3.90 ? BC_MID : BC_HOT)
  return c.reduce((sum, k, i) => sum + (k * (lt ** i)), 0)
}


// --- Limb darkening.

/**
 * The specific intensity leaving a grey, plane-parallel atmosphere in LTE
 * at a wavelength and direction: I_λ(μ) = ∫ B_λ(T(τ)) e^(−τ/μ) dτ/μ with
 * the Eddington approximation's T⁴(τ) = ¾ Teff⁴ (τ + ⅔) (Gray 2005,
 * The Observation and Analysis of Stellar Photospheres, ch. 9).  The limb
 * darkens because it shows the cooler upper layers, more so in the blue
 * (Wien's side of the Planck curve) and in cooler stars.
 *
 * @param {number} nm
 * @param {number} teff K
 * @param {number} mu Cosine of the angle from the surface normal
 * @returns {number} Planck's law's units
 */
export function greyIntensity(nm, teff, mu) {
  // τ = μu: I = ∫ B(T(μu)) e^-u du, by the midpoint rule to u = 30.
  const n = 96
  const uMax = 30
  let sum = 0
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) * uMax / n
    const t = teff * Math.pow(0.75 * ((mu * u) + (2 / 3)), 0.25)
    sum += planck(nm, t) * Math.exp(-u)
  }
  return sum * uMax / n
}


/**
 * The power-2 limb-darkening law (Hestroffer 1997; Maxted 2018):
 * I(μ)/I(1) = 1 − c (1 − μ^α).
 *
 * @param {number} mu
 * @param {number} c
 * @param {number} alpha
 * @returns {number}
 */
export function powerTwo(mu, c, alpha) {
  return 1 - (c * (1 - Math.pow(Math.max(mu, 0), alpha)))
}


/**
 * @param {number} c
 * @param {number} alpha
 * @returns {number} The power-2 law's mean over the disc, ∫ I 2μ dμ: the
 *   disc's mean intensity over its centre's
 */
export function powerTwoMean(c, alpha) {
  return 1 - (c * alpha / (alpha + 2))
}


/**
 * A star's limb darkening in each sRGB channel: the grey atmosphere's
 * intensity (greyIntensity) through the CIE observer to linear sRGB at
 * μ = 1, ½ and 0, matched by the power-2 law there (Maxted 2018's h1 =
 * I(½), h2 = I(½) − I(0)): c = 1 − I(0), 2^−α = h2 / c.  The Sun's: its
 * limb 0.40, 0.33 and 0.25 of its centre in red, green and blue.
 *
 * Claret's tables (Claret 2000; Claret & Bloemen 2011) were the intent,
 * from model atmospheres rather than a grey one; the grey law is within
 * ~10% of the Sun's measured limb in the visible but darkens a cool M
 * star's limb more than a model atmosphere does (Stars.md).
 *
 * @param {number} teff K
 * @returns {{c: Array<number>, alpha: Array<number>, mean: Array<number>}} per channel
 */
export function limbDarkening(teff) {
  const t = clampTemp(teff)
  const rgbAt = (mu) => xyzToLinearSrgb(spectrumXyz((nm) => greyIntensity(nm, t, mu)))
  const [i1, iHalf, i0] = [rgbAt(1), rgbAt(0.5), rgbAt(0)]
  const c = []
  const alpha = []
  for (let k = 0; k < 3; k++) {
    // A channel at or under 0 (a cool star's blue) takes green's law.
    const kk = i1[k] > 0 ? k : 1
    const h1 = iHalf[kk] / i1[kk]
    const zero = Math.min(Math.max(i0[kk] / i1[kk], 0), 0.99)
    const ck = 1 - zero
    const h2 = Math.max(h1 - zero, 1e-6)
    c.push(ck)
    alpha.push(Math.min(Math.max(-Math.log2(h2 / ck), 0.05), 4))
  }
  return {c, alpha, mean: c.map((ck, k) => powerTwoMean(ck, alpha[k]))}
}


// --- Surface structure.

/**
 * How the visual luminance of a blackbody changes with its temperature,
 * d ln Y / d ln T: about 4.4 at the Sun's, 7 at 3,000 K, 1.6 at 20,000 K.
 * A temperature fluctuation δT/T is a contrast of this times it.
 *
 * @param {number} temp K
 * @returns {number}
 */
export function luminanceSlope(temp) {
  const t = clampTemp(temp)
  const h = 0.01
  return Math.log(blackbodyLuminance(t * (1 + h)) / blackbodyLuminance(t * (1 - h))) / (2 * h)
}


// The granulation's rms intensity contrast in the visible by effective
// temperature, from 3D convection simulations (Magic et al. 2013 A&A 557,
// A26; Tremblay et al. 2013 A&A 557, A7): rising from M dwarfs to a peak
// in the F stars and gone where the convective envelope is (A stars and
// hotter, from ~8,300 K).  [K, contrast]
const GRANULATION_CONTRAST = [[2500, 0.01], [3500, 0.03], [4500, 0.08], [5772, 0.15], [6500, 0.19], [7200, 0.12],
  [8300, 0]]


/**
 * @param {Array<Array<number>>} table [[x, y], ...], x increasing
 * @param {number} x
 * @returns {number} y linearly interpolated, held at the ends
 */
export function interpolate(table, x) {
  if (!(x > table[0][0])) {
    return table[0][1]
  }
  for (let i = 1; i < table.length; i++) {
    if (x <= table[i][0]) {
      const [x0, y0] = table[i - 1]
      const [x1, y1] = table[i]
      return y0 + ((y1 - y0) * (x - x0) / (x1 - x0))
    }
  }
  return table[table.length - 1][1]
}


/**
 * The granulation's rms intensity contrast: by temperature
 * (GRANULATION_CONTRAST), and higher at low gravity, where the cells are
 * larger and more vigorous (red giants' and supergiants' few giant cells,
 * Freytag et al. 2002, Chiavassa et al. 2010): ×1.6 at log g 0.
 *
 * @param {number} teff K
 * @param {number} [logg] cgs
 * @returns {number}
 */
export function granulationContrast(teff, logg = SUN_LOGG) {
  const lowG = Math.min(Math.max((SUN_LOGG - logg) / SUN_LOGG, 0), 1)
  return interpolate(GRANULATION_CONTRAST, teff) * (1 + (0.6 * lowG))
}


/** The Sun's granules across its radius: a 1.3 Mm cell in 696 Mm. */
export const SUN_GRANULES_PER_RADIUS = 535
/** The fewest cells across a radius: a supergiant's few giant cells. */
export const MIN_CELLS_PER_RADIUS = 1.5


/**
 * The granules across a star's radius.  A granule's size follows the
 * pressure scale height at the surface, H_p ∝ T / g (Freytag et al. 1997;
 * Trampedach et al. 2013), so its share of the radius is the Sun's times
 * (T/T☉)(g☉/g)(R☉/R): a dwarf many small cells, a giant few huge ones.
 *
 * @param {number} teff K
 * @param {number} logg cgs
 * @param {number} radiusSun R / R☉
 * @returns {number}
 */
export function granulesPerRadius(teff, logg, radiusSun) {
  const n = SUN_GRANULES_PER_RADIUS * radiusSun * (10 ** (logg - SUN_LOGG)) * (SUN_TEFF / clampTemp(teff))
  return Number.isFinite(n) ? Math.max(n, MIN_CELLS_PER_RADIUS) : SUN_GRANULES_PER_RADIUS
}


// A spot's umbra under the photosphere by its temperature, from Doppler
// imaging and molecular bands (Berdyugina 2005, Living Rev. Solar Phys. 2,
// 8, fig. 7): ~1,700 K for the Sun's (~4,000 K umbrae), ~2,000 K for F and
// G stars, a few hundred kelvin for M dwarfs.  [K, ΔT]
const UMBRA_DELTA_T = [[3000, 300], [3500, 500], [4500, 1000], [5500, 1600], [5772, 1700], [6500, 2000]]


/**
 * @param {number} teff K
 * @returns {number} The umbra's temperature deficit, K
 */
export function umbraDeltaT(teff) {
  return interpolate(UMBRA_DELTA_T, teff)
}


/** A penumbra's deficit over its umbra's: the Sun's is ~400 K, its umbra's ~1,700. */
export const PENUMBRA_FRACTION = 0.25
