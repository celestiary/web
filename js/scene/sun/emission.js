import {
  SUN_TEFF,
  blackbodyLuminance,
  cieXyzBar,
  limbDarkening,
  planck,
  spectrumXyz,
  xyzToLinearSrgb,
} from '../stellar.js'


/**
 * The light of the Sun's cool, line-emitting layers and of its flares,
 * relative to its disc's mean radiance (js/scene/Sun.md): the units the
 * shaders multiply the disc's radiance in exposure units by.
 */


// The disc centre's continuum at Hα, 4.077e-5 erg cm⁻² s⁻¹ sr⁻¹ Hz⁻¹ (the
// calibration of the Meudon MSDP's Hα in Schmieder et al. 2010, A&A 514,
// A68, arXiv:0911.5091), is a blackbody's at 6,143 K there: the temperature
// the lines' continuum is taken at.
export const CONTINUUM_HALPHA_CGS_HZ = 4.077e-5
export const HALPHA_NM = 656.28
export const HBETA_NM = 486.13
const H_CGS = 6.62607015e-27
const C_CGS = 2.99792458e10
const K_CGS = 1.380649e-16


/**
 * @returns {number} The disc centre's brightness temperature at Hα, K
 */
export function centreTemperatureAtHalpha() {
  const nu = C_CGS / (HALPHA_NM * 1e-7)
  const b = 2 * H_CGS * (nu ** 3) / (C_CGS * C_CGS)
  return H_CGS * nu / (K_CGS * Math.log1p(b / CONTINUUM_HALPHA_CGS_HZ))
}


// The Balmer decrement E(Hα)/E(Hβ): about 3 in bright prominences, more in
// faint ones (Labrosse et al. 2010, Space Sci. Rev. 151, 243, after
// Gouttebroze, Heinzel & Vial 1993).  Ca II H and K and He D3 add a little
// in the violet and the yellow and are left out.
export const BALMER_DECREMENT = 3


/**
 * The colour and luminance of Balmer-line emission (Hα with Hβ at the
 * decrement), for 1 nm of Hα's equivalent width against the disc centre's
 * continuum, over the disc's mean luminance: linear sRGB whose Y is that
 * ratio.  A prominence of E nm of Hα is E times this.
 *
 * @returns {Array<number>} r, g, b
 */
export function balmerPerNm() {
  const tc = centreTemperatureAtHalpha()
  const line = (nm, e) => cieXyzBar(nm).map((c) => c * e * planck(nm, tc))
  const ha = line(HALPHA_NM, 1)
  const hb = line(HBETA_NM, (planck(HALPHA_NM, tc) / planck(HBETA_NM, tc)) / BALMER_DECREMENT)
  const xyz = [ha[0] + hb[0], ha[1] + hb[1], ha[2] + hb[2]]
  // The disc's mean luminance: the centre's continuum (the same blackbody)
  // times the limb darkening's mean in luminance (green's, near enough).
  const centreY = spectrumXyz((nm) => planck(nm, tc))[1]
  const meanY = centreY * limbDarkening(SUN_TEFF).mean[1]
  return xyzToLinearSrgb(xyz).map((c) => Math.max(c, 0) / meanY)
}


// White-light flares.  The optical continuum's relative enhancement at
// 360 nm averages 19% (mostly under 30%) in flares that show one (the
// statistics summarised in arXiv:2512.01717); white light shows in about
// half of M and X flares and
// a tenth of C flares (Watanabe et al. 2017; Castellanos Durán & Kleint
// 2020).  The kernel's continuum is taken as a 10,000 K blackbody's
// (the colour temperature fitted to flare continua: Kerr & Fletcher 2014),
// filling the share of the pixel that gives 19% at 360 nm; in the visual
// band that is less (below).
export const FLARE_CONTRAST_360 = 0.19
export const FLARE_TEMPERATURE = 10000
export const FLARE_REFERENCE_FLUX = 5e-5
export const FLARE_CONTRAST_EXPONENT = 0.3
export const WHITE_LIGHT_SHARE = Object.freeze({c: 0.1, mx: 0.5})


/**
 * A white-light flare kernel's contrast in luminance against the
 * photosphere under it, at its peak, for a GOES class: 19% at 360 nm for
 * an M5 (the mean of the white-light flares, mostly M), through a
 * 10,000 K continuum to the visual band, and with the class as
 * (F/F_M5)^0.3 (a model of the larger flares' brighter kernels).
 *
 * @param {number} flux GOES 1-8 Å peak flux, W m⁻²
 * @returns {number}
 */
export function flareContrast(flux) {
  const fill = FLARE_CONTRAST_360 * planck(360, SUN_TEFF) / planck(360, FLARE_TEMPERATURE)
  const visual = fill * blackbodyLuminance(FLARE_TEMPERATURE)
  return visual * ((flux / FLARE_REFERENCE_FLUX) ** FLARE_CONTRAST_EXPONENT)
}
