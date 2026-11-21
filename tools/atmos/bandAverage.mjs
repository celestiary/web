#!/usr/bin/env node
// Each channel's coefficients for Earth's air, from the spectra: the
// Rayleigh, the aerosol and the ozone over the linear-sRGB channels'
// spectral responses under sunlight, in place of one wavelength a channel
// (680, 550, 440 nm, Bruneton's kLambdaR/G/B).
//
//   node tools/atmos/bandAverage.mjs          the table and the limb check
//   node tools/atmos/bandAverage.mjs --json   the coefficients alone
//
// The method (composition.md, "The channels' coefficients"):
//
// - A channel's response is its row of the XYZ to linear sRGB matrix
//   applied to the CIE 1931 2° colour-matching functions, r̄ = 3.2406 x̄ −
//   1.5372 ȳ − 0.4986 z̄ and so on, weighted by the Sun's spectrum, w_c(λ)
//   = S(λ) c̄(λ).  The weights have negative lobes (r̄ between 440 and
//   545 nm, ḡ under 470 and over 640, b̄ over 500), and they are kept:
//   the light through a path, as linear sRGB relative to the Sun's own,
//   is ∫ w_c T / ∫ w_c, which is what a renderer that multiplies a white
//   Sun by a per-channel transmittance should reproduce.  Clipping a lobe
//   would make a different colour space.
// - A channel's coefficient is the band's average of the species'
//   spectral coefficient under that weight, k_c = ∫ w_c k / ∫ w_c (the
//   "band" coefficients).  It is exact where the path is thin, for the
//   transmittance (1 − k N to first order) and for the in-scatter, whose
//   colour is ∫ w_c β, so the sky's colour and the thin paths come out as
//   the spectrum's.  A negative result (ozone's blue: b̄'s negative lobe
//   over 500 nm sits on the Chappuis band) is a colour outside sRGB's
//   gamut, and is clamped to 0: an absorption can't be a gain.
// - The alternative, the coefficient whose transmittance through a column
//   matches the band's, k_c = −ln(∫ w_c e^(−k N) / ∫ w_c) / N, at N the
//   species' own path through the limb at a reference tangent height
//   (20 km), is given beside it ("matched").  Matched species by species,
//   it doesn't add across species (the lobes weight each one's spectrum
//   differently), and through the whole limb, 10 to 35 km, it misses the
//   spectrum by more than the band average does (`limbError`).
// - Either way the Rayleigh and the aerosol move little from 680, 550 and
//   440 nm, but the ozone's red is 3.8 times the 680 nm value: the
//   Chappuis band peaks at 600 nm, inside red's response, where one
//   wavelength a channel sees the band's tail.  That under-absorbed red is
//   the limb's magenta.
// - The spectra: the Sun, ASTM G-173's extraterrestrial column in 10 nm
//   bins (Bruneton's demo.cc, kSolarIrradiance); the ozone, the Bremen
//   cross-sections at 233 K (Serdyuchenko et al. 2014, demo.cc's
//   kOzoneCrossSection) at 300 Dobson units in its 15 km tent (demo.cc's
//   peak density); the Rayleigh, 1.216e-5 /m at 550 nm as λ^−4.08
//   (Bucholtz 1995, composition.md); the aerosol, 1e-4 /m at 550 nm as
//   λ^−1.3 (Ångström).  All interpolated linearly to 1 nm from 360 to
//   830 nm, as Bruneton's model.cc integrates its conversions.
//
// The tables are those of ebruneton/precomputed_atmospheric_scattering
// (BSD-3-Clause), atmosphere/demo/demo.cc and atmosphere/constants.h.


// ASTM G-173 extraterrestrial irradiance, W m⁻² nm⁻¹, averaged over each
// 10 nm bin from 360 nm (demo.cc kSolarIrradiance).
export const SOLAR = [
  1.11776, 1.14259, 1.01249, 1.14716, 1.72765, 1.73054, 1.6887, 1.61253,
  1.91198, 2.03474, 2.02042, 2.02212, 1.93377, 1.95809, 1.91686, 1.8298,
  1.8685, 1.8931, 1.85149, 1.8504, 1.8341, 1.8345, 1.8147, 1.78158, 1.7533,
  1.6965, 1.68194, 1.64654, 1.6048, 1.52143, 1.55622, 1.5113, 1.474, 1.4482,
  1.41018, 1.36775, 1.34188, 1.31429, 1.28303, 1.26758, 1.2367, 1.2082,
  1.18737, 1.14683, 1.12362, 1.1058, 1.07124, 1.04992,
]

// Ozone absorption cross-sections, m², 233 K, averaged over each 10 nm bin
// from 360 nm (Serdyuchenko et al. 2014; demo.cc kOzoneCrossSection).
export const OZONE_SIGMA = [
  1.18e-27, 2.182e-28, 2.818e-28, 6.636e-28, 1.527e-27, 2.763e-27, 5.52e-27,
  8.451e-27, 1.582e-26, 2.316e-26, 3.669e-26, 4.924e-26, 7.752e-26, 9.016e-26,
  1.48e-25, 1.602e-25, 2.139e-25, 2.755e-25, 3.091e-25, 3.5e-25, 4.266e-25,
  4.672e-25, 4.398e-25, 4.701e-25, 5.019e-25, 4.305e-25, 3.74e-25, 3.215e-25,
  2.662e-25, 2.238e-25, 1.852e-25, 1.473e-25, 1.209e-25, 9.423e-26, 7.455e-26,
  6.566e-26, 5.105e-26, 4.15e-26, 4.228e-26, 3.237e-26, 2.451e-26, 2.801e-26,
  2.534e-26, 1.624e-26, 1.465e-26, 2.078e-26, 1.383e-26, 7.105e-27,
]

// CIE 1931 2° colour-matching functions x̄, ȳ, z̄ at 5 nm from 360 nm (CVRL's
// ciexyz31.txt; Bruneton's constants.h CIE_2_DEG_COLOR_MATCHING_FUNCTIONS).
export const CIE = [
  [0.0001299, 0.000003917, 0.0006061], [0.0002321, 0.000006965, 0.001086],
  [0.0004149, 0.00001239, 0.001946], [0.0007416, 0.00002202, 0.003486],
  [0.001368, 0.000039, 0.006450001], [0.002236, 0.000064, 0.01054999],
  [0.004243, 0.00012, 0.02005001], [0.00765, 0.000217, 0.03621],
  [0.01431, 0.000396, 0.06785001], [0.02319, 0.00064, 0.1102],
  [0.04351, 0.00121, 0.2074], [0.07763, 0.00218, 0.3713],
  [0.13438, 0.004, 0.6456], [0.21477, 0.0073, 1.0390501],
  [0.2839, 0.0116, 1.3856], [0.3285, 0.01684, 1.62296],
  [0.34828, 0.023, 1.74706], [0.34806, 0.0298, 1.7826],
  [0.3362, 0.038, 1.77211], [0.3187, 0.048, 1.7441],
  [0.2908, 0.06, 1.6692], [0.2511, 0.0739, 1.5281],
  [0.19536, 0.09098, 1.28764], [0.1421, 0.1126, 1.0419],
  [0.09564, 0.13902, 0.8129501], [0.05795001, 0.1693, 0.6162],
  [0.03201, 0.20802, 0.46518], [0.0147, 0.2586, 0.3533],
  [0.0049, 0.323, 0.272], [0.0024, 0.4073, 0.2123],
  [0.0093, 0.503, 0.1582], [0.0291, 0.6082, 0.1117],
  [0.06327, 0.71, 0.07824999], [0.1096, 0.7932, 0.05725001],
  [0.1655, 0.862, 0.04216], [0.2257499, 0.9148501, 0.02984],
  [0.2904, 0.954, 0.0203], [0.3597, 0.9803, 0.0134],
  [0.4334499, 0.9949501, 0.008749999], [0.5120501, 1, 0.005749999],
  [0.5945, 0.995, 0.0039], [0.6784, 0.9786, 0.002749999],
  [0.7621, 0.952, 0.0021], [0.8425, 0.9154, 0.0018],
  [0.9163, 0.87, 0.001650001], [0.9786, 0.8163, 0.0014],
  [1.0263, 0.757, 0.0011], [1.0567, 0.6949, 0.001],
  [1.0622, 0.631, 0.0008], [1.0456, 0.5668, 0.0006],
  [1.0026, 0.503, 0.00034], [0.9384, 0.4412, 0.00024],
  [0.8544499, 0.381, 0.00019], [0.7514, 0.321, 0.0001],
  [0.6424, 0.265, 0.00004999999], [0.5419, 0.217, 0.00003],
  [0.4479, 0.175, 0.00002], [0.3608, 0.1382, 0.00001],
  [0.2835, 0.107, 0], [0.2187, 0.0816, 0],
  [0.1649, 0.061, 0], [0.1212, 0.04458, 0],
  [0.0874, 0.032, 0], [0.0636, 0.0232, 0],
  [0.04677, 0.017, 0], [0.0329, 0.01192, 0],
  [0.0227, 0.00821, 0], [0.01584, 0.005723, 0],
  [0.01135916, 0.004102, 0], [0.008110916, 0.002929, 0],
  [0.005790346, 0.002091, 0], [0.004109457, 0.001484, 0],
  [0.002899327, 0.001047, 0], [0.00204919, 0.00074, 0],
  [0.001439971, 0.00052, 0], [0.0009999493, 0.0003611, 0],
  [0.0006900786, 0.0002492, 0], [0.0004760213, 0.0001719, 0],
  [0.0003323011, 0.00012, 0], [0.0002348261, 0.0000848, 0],
  [0.0001661505, 0.00006, 0], [0.000117413, 0.0000424, 0],
  [0.00008307527, 0.00003, 0], [0.00005870652, 0.0000212, 0],
  [0.00004150994, 0.00001499, 0], [0.00002935326, 0.0000106, 0],
  [0.00002067383, 0.0000074657, 0], [0.00001455977, 0.0000052578, 0],
  [0.00001025398, 0.0000037029, 0], [0.000007221456, 0.0000026078, 0],
  [0.000005085868, 0.0000018366, 0], [0.000003581652, 0.0000012934, 0],
  [0.000002522525, 0.00000091093, 0], [0.000001776509, 0.00000064153, 0],
  [0.000001251141, 0.00000045181, 0],
]

// XYZ to linear sRGB (IEC 61966-2-1; constants.h XYZ_TO_SRGB).
export const XYZ_TO_SRGB = [
  [3.2406, -1.5372, -0.4986],
  [-0.9689, 1.8758, 0.0415],
  [0.0557, -0.2040, 1.0570],
]

export const LAMBDA_MIN = 360
export const LAMBDA_MAX = 830
// One wavelength a channel, Bruneton's kLambdaR, kLambdaG, kLambdaB.
export const CHANNEL_NM = [680, 550, 440]

// Earth's air (composition.md, "Earth's air"): the anchors at 550 nm and
// the laws, the scale heights and the ozone's tent.
export const EARTH = {
  radius: 6.371e6,
  top: 8e4,
  rayleigh550: 1.216e-5,
  rayleighExponent: 4.08,
  rayleighScaleHeight: 8e3,
  mie550: 1e-4,
  angstrom: 1.3,
  mieScaleHeight: 1.2e3,
  ozonePeakDensity: 300 * 2.687e20 / 15000,
  ozoneTent: [1e4, 2.5e4, 4e4],
}

// The tangent height whose columns the matched coefficients match.
export const REFERENCE_TANGENT_M = 20e3
// The tangent heights the limb's check runs over, km.
export const LIMB_HEIGHTS_KM = [10, 12.5, 15, 17.5, 20, 22.5, 25, 27.5, 30, 35]


/**
 * @param {Array<number>} table values at a step from LAMBDA_MIN
 * @param {number} step nm
 * @param {number} nm
 * @returns {number} linearly interpolated, held at the ends
 */
function interp(table, step, nm) {
  const u = (nm - LAMBDA_MIN) / step
  const i = Math.min(Math.max(Math.floor(u), 0), table.length - 2)
  const f = Math.min(Math.max(u - i, 0), 1)
  return (table[i] * (1 - f)) + (table[i + 1] * f)
}


/**
 * The spectral coefficients of each species, per metre at the species'
 * reference density (sea level, or the ozone's peak).
 *
 * @param {number} nm
 * @param {object} [air]
 * @returns {{rayleigh: number, mie: number, ozone: number}}
 */
export function spectralCoefficients(nm, air = EARTH) {
  return {
    rayleigh: air.rayleigh550 * Math.pow(550 / nm, air.rayleighExponent),
    mie: air.mie550 * Math.pow(nm / 550, -air.angstrom),
    ozone: air.ozonePeakDensity * interp(OZONE_SIGMA, 10, nm),
  }
}


/**
 * The wavelengths at 1 nm and each channel's weight there, the Sun's
 * irradiance times the channel's response.
 *
 * @returns {{nm: Array<number>, weight: Array<Array<number>>}} weight[c][i]
 */
export function channelWeights() {
  const nm = []
  const weight = [[], [], []]
  for (let l = LAMBDA_MIN; l <= LAMBDA_MAX; l++) {
    nm.push(l)
    const s = interp(SOLAR, 10, l)
    const xyz = [0, 1, 2].map((j) => interp(CIE.map((row) => row[j]), 5, l))
    for (let c = 0; c < 3; c++) {
      const m = XYZ_TO_SRGB[c]
      weight[c].push(s * ((m[0] * xyz[0]) + (m[1] * xyz[1]) + (m[2] * xyz[2])))
    }
  }
  return {nm, weight}
}


/**
 * Linear sRGB of the light through a path, relative to the Sun's.
 *
 * @param {function(number): number} transmittance of the wavelength (nm)
 * @returns {Array<number>} r, g, b
 */
export function spectralColour(transmittance) {
  const {nm, weight} = channelWeights()
  return weight.map((w) => {
    let num = 0
    let den = 0
    for (let i = 0; i < nm.length; i++) {
      num += w[i] * transmittance(nm[i])
      den += w[i]
    }
    return num / den
  })
}


/**
 * The density-weighted path lengths (m) of each species along a ray
 * tangent to the sphere at a height, through the whole atmosphere.
 *
 * @param {number} h tangent height, m
 * @param {object} [air]
 * @returns {{rayleigh: number, mie: number, ozone: number}}
 */
export function tangentColumns(h, air = EARTH) {
  const r0 = air.radius + h
  const rTop = air.radius + air.top
  const tMax = Math.sqrt((rTop * rTop) - (r0 * r0))
  const [lo, peak, hi] = air.ozoneTent
  const n = 20000
  const dt = tMax / n
  const col = {rayleigh: 0, mie: 0, ozone: 0}
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) * dt
    const z = Math.sqrt((r0 * r0) + (t * t)) - air.radius
    col.rayleigh += Math.exp(-z / air.rayleighScaleHeight) * dt
    col.mie += Math.exp(-z / air.mieScaleHeight) * dt
    col.ozone += Math.max(1 - (Math.abs(z - peak) / (z < peak ? peak - lo : hi - peak)), 0) * dt
  }
  // Both halves of the chord.
  return {rayleigh: 2 * col.rayleigh, mie: 2 * col.mie, ozone: 2 * col.ozone}
}


const SPECIES = ['rayleigh', 'mie', 'ozone']


/**
 * Each species' coefficient per channel: at the channels' wavelengths
 * (point), the band's average clamped at 0 (band), and the band's
 * transmittance matched through the species' column at the reference
 * tangent height (matched).
 *
 * @param {object} [air]
 * @param {number} [hRef] m
 * @returns {object} {point, band, matched}: each {rayleigh, mie, ozone}: [r, g, b]
 */
export function channelCoefficients(air = EARTH, hRef = REFERENCE_TANGENT_M) {
  const {nm, weight} = channelWeights()
  const k = nm.map((l) => spectralCoefficients(l, air))
  const cols = tangentColumns(hRef, air)
  const point = {}
  const band = {}
  const matched = {}
  for (const s of SPECIES) {
    point[s] = CHANNEL_NM.map((l) => spectralCoefficients(l, air)[s])
    band[s] = weight.map((w) => {
      let num = 0
      let den = 0
      for (let i = 0; i < nm.length; i++) {
        num += w[i] * k[i][s]
        den += w[i]
      }
      return Math.max(num / den, 0)
    })
    matched[s] = weight.map((w) => {
      let num = 0
      let den = 0
      for (let i = 0; i < nm.length; i++) {
        num += w[i] * Math.exp(-k[i][s] * cols[s])
        den += w[i]
      }
      // A ratio over 1 is a colour outside sRGB's gamut (the negative
      // lobes absorbed more than the positive): no absorption, not a gain.
      return Math.max(-Math.log(Math.min(num / den, 1)) / cols[s], 0)
    })
  }
  return {point, band, matched}
}


/**
 * The light through the limb at a tangent height, linear sRGB relative to
 * the Sun's: spectrally, and by a model's per-channel coefficients.
 *
 * @param {number} h m
 * @param {object} [coeffs] {rayleigh, mie, ozone}: [r, g, b]; omitted, the spectrum
 * @param {object} [air]
 * @returns {Array<number>} r, g, b
 */
export function limbColour(h, coeffs, air = EARTH) {
  const cols = tangentColumns(h, air)
  if (!coeffs) {
    return spectralColour((l) => {
      const k = spectralCoefficients(l, air)
      return Math.exp(-SPECIES.reduce((a, s) => a + (k[s] * cols[s]), 0))
    })
  }
  return [0, 1, 2].map((c) => Math.exp(-SPECIES.reduce((a, s) => a + (coeffs[s][c] * cols[s]), 0)))
}


/**
 * @param {Array<number>} rgb
 * @returns {Array<number>} r/g, b/g
 */
export function chroma(rgb) {
  return [rgb[0] / rgb[1], rgb[2] / rgb[1]]
}


/**
 * How far a model's limb is from the spectrum's, over the tangent heights:
 * the rms of ln(model / spectrum) over the channels, and of the chromaticity
 * (ln of r/g and b/g against the spectrum's).
 *
 * @param {object} coeffs {rayleigh, mie, ozone}: [r, g, b]
 * @param {Array<number>} [heightsKm]
 * @returns {{rgb: number, chroma: number}}
 */
export function limbError(coeffs, heightsKm = LIMB_HEIGHTS_KM) {
  let e = 0
  let ec = 0
  for (const km of heightsKm) {
    const truth = limbColour(km * 1e3)
    const rgb = limbColour(km * 1e3, coeffs)
    for (let c = 0; c < 3; c++) {
      e += Math.log(rgb[c] / truth[c]) ** 2
    }
    const [rg, bg] = chroma(rgb)
    const [trg, tbg] = chroma(truth)
    ec += (Math.log(rg / trg) ** 2) + (Math.log(bg / tbg) ** 2)
  }
  return {rgb: Math.sqrt(e / (3 * heightsKm.length)), chroma: Math.sqrt(ec / (2 * heightsKm.length))}
}


/**
 * @param {number} x
 * @param {number} [digits]
 * @returns {string}
 */
function sig(x, digits = 4) {
  return Number(x.toPrecision(digits)).toString()
}


if (import.meta.main || process.argv[1]?.endsWith('bandAverage.mjs')) {
  const models = channelCoefficients()
  const {point, band, matched} = models
  if (process.argv.includes('--json')) {
    const round = (o) => Object.fromEntries(SPECIES.map((s) => [s, o[s].map((v) => Number(v.toPrecision(4)))]))
    console.log(JSON.stringify({band: round(band), matched: round(matched)}, null, 2))
  } else {
    console.log(`Per channel (r, g, b), /m; matched through the limb at ${REFERENCE_TANGENT_M / 1e3} km`)
    for (const s of SPECIES) {
      console.log(`${s.padEnd(9)} 680/550/440 nm: ${point[s].map((v) => sig(v)).join(', ')}`)
      console.log(`${''.padEnd(9)} band:           ${band[s].map((v) => sig(v)).join(', ')}`)
      console.log(`${''.padEnd(9)} matched:        ${matched[s].map((v) => sig(v)).join(', ')}`)
    }
    console.log('\nThe limb\'s transmittance, linear sRGB relative to the Sun (r/g, b/g)')
    for (const km of [10, 15, 20, 25, 30, 35]) {
      const rows = [['spectral', limbColour(km * 1e3)], ['3 wavelengths', limbColour(km * 1e3, point)],
        ['band', limbColour(km * 1e3, band)], ['matched', limbColour(km * 1e3, matched)]]
      console.log(`${km} km`)
      for (const [name, rgb] of rows) {
        const [rg, bg] = chroma(rgb)
        console.log(`  ${name.padEnd(14)} ${rgb.map((v) => sig(v, 3)).join(' / ')}   (${sig(rg, 3)}, ${sig(bg, 3)})`)
      }
    }
    console.log(`\nAgainst the spectrum, ${LIMB_HEIGHTS_KM[0]} to ${LIMB_HEIGHTS_KM.at(-1)} km: rms ln error, rgb and chroma`)
    for (const [name, m] of Object.entries(models)) {
      const e = limbError(m)
      console.log(`  ${name.padEnd(8)} ${e.rgb.toFixed(3)}  ${e.chroma.toFixed(3)}`)
    }
  }
}
