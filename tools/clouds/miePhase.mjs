#!/usr/bin/env node
// The phase function of a cloud's droplets, by Mie theory, and the angular
// shapes of its higher scattering orders, for the volumetric clouds
// (js/scene/clouds/cloudPhysics.js; js/scene/atmos/clouds.md).  Writes the
// offline fixture js/scene/clouds/cloudPhase.earth.json; run it by hand to
// refresh it:
//
//   node tools/clouds/miePhase.mjs > js/scene/clouds/cloudPhase.earth.json
//
// Mie scattering by homogeneous spheres after Bohren & Huffman 1983
// (Absorption and Scattering of Light by Small Particles, appendix A,
// BHMIE), averaged over a gamma distribution of droplet radii (Hansen &
// Travis 1974, Space Sci. Rev. 16, 527: n(r) ∝ r^((1−3v)/v) e^(−r/(a·v)),
// effective radius a, effective variance v).  Water's refractive index at
// 550 nm is 1.333 + 1.7e-9 i (Hale & Querry 1973, Appl. Opt. 12, 555).
//
// The phase function is normalised so ∫P dω = 1 over the sphere, as the
// atmosphere pass's (AtmospherePrecompute.js miePhase).
//
// Delta-M (Wiscombe 1977, J. Atmos. Sci. 34, 1408): the diffraction peak,
// a few degrees wide, is taken out as unscattered light, and the rest is
// renormalised.  The march then uses the extinction scaled by (1 − ω·f)
// and this peak-less phase function P'.
//
// The light scattered k times has, at a point, the angular distribution of
// the k-fold spherical convolution of P', whose Legendre coefficients are
// the k-th powers of P'’s (the addition theorem; for a Henyey-Greenstein
// lobe of asymmetry g that is the lobe of g^k, as composition.md's aureole
// uses).  The orders are tabulated here for the multiple-scattering
// octaves (cloudPhysics.js OCTAVES), so each octave scatters by its
// order's own shape, not a lobe of a guessed width.

const WAVELENGTH_UM = 0.55
const REFRACTIVE_INDEX = {re: 1.333, im: 1.7e-9}
// Stratocumulus and cumulus droplets: effective radius 10 µm (Miles,
// Verlinde & Clothiaux 2000, J. Atmos. Sci. 57, 295: marine stratocumulus
// 9.6-11 µm; Han, Rossow & Lacis 1994, J. Climate 7, 465: 11.8 µm over
// ocean, 8.5 over land), effective variance 0.1 (Hansen & Travis's
// cloud C1).
const R_EFF_UM = 10
const V_EFF = 0.1
// The Mie computation's angular step; the table's is coarser.  The
// diffraction peak of a 10 µm droplet is about 1.6° wide (λ / 2r).
const FINE_STEP_DEG = 0.1
const TABLE_STEP_DEG = 0.5
// The diffraction peak, taken as unscattered (delta-M): a smooth window
// from fully removed inside PEAK_IN_DEG to fully kept past PEAK_OUT_DEG, so
// the remainder has no cliff for the Legendre series to ring on.
const PEAK_IN_DEG = 1.5
const PEAK_OUT_DEG = 4
// Legendre terms: enough for the fogbow (a few degrees wide) and the
// glory; Lanczos sigma factors damp the truncation's ringing.
const LEGENDRE_TERMS = 256
// Scattering orders tabulated: the octaves (cloudPhysics.js OCTAVES).
const ORDERS = 8


/**
 * BHMIE: the scattering amplitudes S1, S2 at each angle, and the extinction
 * and scattering efficiencies, for one sphere.
 *
 * @param {number} x The size parameter 2πr/λ
 * @param {{re: number, im: number}} m The relative refractive index
 * @param {Float64Array} cosines The scattering angles' cosines
 * @returns {{s1: Float64Array, s2: Float64Array, qext: number, qsca: number}} |S1|², |S2|²
 */
function bhmie(x, m, cosines) {
  const nmax = Math.round(x + (4 * Math.cbrt(x)) + 2)
  const nmx = Math.round(Math.max(nmax, Math.hypot(m.re * x, m.im * x)) + 15)
  // The logarithmic derivative D(n) = ψ'_n(mx)/ψ_n(mx), by downward
  // recurrence (complex).
  const dRe = new Float64Array(nmx + 1)
  const dIm = new Float64Array(nmx + 1)
  const yRe = m.re * x
  const yIm = m.im * x
  for (let n = nmx; n >= 1; n--) {
    const [enRe, enIm] = cdiv(n, 0, yRe, yIm)
    const [qRe, qIm] = cdiv(1, 0, dRe[n] + enRe, dIm[n] + enIm)
    dRe[n - 1] = enRe - qRe
    dIm[n - 1] = enIm - qIm
  }
  const nang = cosines.length
  const s1Re = new Float64Array(nang)
  const s1Im = new Float64Array(nang)
  const s2Re = new Float64Array(nang)
  const s2Im = new Float64Array(nang)
  const pi0 = new Float64Array(nang)
  const pi1 = new Float64Array(nang).fill(1)
  // Riccati-Bessel functions by upward recurrence.
  let psi0 = Math.cos(x)
  let psi1 = Math.sin(x)
  let chi0 = -Math.sin(x)
  let chi1 = Math.cos(x)
  let xi1Re = psi1
  let xi1Im = -chi1
  let qsca = 0
  let qext = 0
  for (let n = 1; n <= nmax; n++) {
    const fn = ((2 * n) + 1) / (n * (n + 1))
    const psi = (((2 * n) - 1) * psi1 / x) - psi0
    const chi = (((2 * n) - 1) * chi1 / x) - chi0
    const xiRe = psi
    const xiIm = -chi
    // an = ((D/m + n/x) ψ − ψ_{n−1}) / ((D/m + n/x) ξ − ξ_{n−1})
    const [dmRe, dmIm] = cdiv(dRe[n], dIm[n], m.re, m.im)
    const tRe = dmRe + (n / x)
    const tIm = dmIm
    const [anRe, anIm] = cdiv((tRe * psi) - psi1, tIm * psi,
        (tRe * xiRe) - (tIm * xiIm) - xi1Re, (tRe * xiIm) + (tIm * xiRe) - xi1Im)
    // bn = ((m D + n/x) ψ − ψ_{n−1}) / ((m D + n/x) ξ − ξ_{n−1})
    const uRe = (m.re * dRe[n]) - (m.im * dIm[n]) + (n / x)
    const uIm = (m.re * dIm[n]) + (m.im * dRe[n])
    const [bnRe, bnIm] = cdiv((uRe * psi) - psi1, uIm * psi,
        (uRe * xiRe) - (uIm * xiIm) - xi1Re, (uRe * xiIm) + (uIm * xiRe) - xi1Im)
    qsca += ((2 * n) + 1) * ((anRe * anRe) + (anIm * anIm) + (bnRe * bnRe) + (bnIm * bnIm))
    qext += ((2 * n) + 1) * (anRe + bnRe)
    for (let j = 0; j < nang; j++) {
      const mu = cosines[j]
      const pi = pi1[j]
      const tau = (n * mu * pi) - ((n + 1) * pi0[j])
      s1Re[j] += fn * ((anRe * pi) + (bnRe * tau))
      s1Im[j] += fn * ((anIm * pi) + (bnIm * tau))
      s2Re[j] += fn * ((anRe * tau) + (bnRe * pi))
      s2Im[j] += fn * ((anIm * tau) + (bnIm * pi))
      pi1[j] = ((((2 * n) + 1) * mu * pi) - ((n + 1) * pi0[j])) / n
      pi0[j] = pi
    }
    psi0 = psi1
    psi1 = psi
    chi0 = chi1
    chi1 = chi
    xi1Re = psi1
    xi1Im = -chi1
  }
  const s1 = Float64Array.from(s1Re, (re, j) => (re * re) + (s1Im[j] * s1Im[j]))
  const s2 = Float64Array.from(s2Re, (re, j) => (re * re) + (s2Im[j] * s2Im[j]))
  return {s1, s2, qext: 2 * qext / (x * x), qsca: 2 * qsca / (x * x)}
}


/**
 * @param {number} aRe
 * @param {number} aIm
 * @param {number} bRe
 * @param {number} bIm
 * @returns {[number, number]} a / b
 */
function cdiv(aRe, aIm, bRe, bIm) {
  const d = (bRe * bRe) + (bIm * bIm)
  return [((aRe * bRe) + (aIm * bIm)) / d, ((aIm * bRe) - (aRe * bIm)) / d]
}


/**
 * The gamma distribution's weights over a grid of radii.
 *
 * @param {number} a Effective radius
 * @param {number} v Effective variance
 * @returns {{radii: Array<number>, weights: Array<number>}} Normalised to 1
 */
function gammaDistribution(a, v) {
  const radii = []
  const weights = []
  const steps = 60
  const rMax = a * (1 + (8 * Math.sqrt(v)))
  let sum = 0
  for (let i = 0; i < steps; i++) {
    const r = (rMax * (i + 0.5)) / steps
    const w = Math.pow(r, (1 - (3 * v)) / v) * Math.exp(-r / (a * v))
    radii.push(r)
    weights.push(w)
    sum += w
  }
  return {radii, weights: weights.map((w) => w / sum)}
}


/**
 * @param {number} lo
 * @param {number} hi
 * @param {number} x
 * @returns {number} smoothstep
 */
function smoothstep(lo, hi, x) {
  const t = Math.min(Math.max((x - lo) / (hi - lo), 0), 1)
  return t * t * (3 - (2 * t))
}


/**
 * Legendre polynomials P_0..P_L at μ.
 *
 * @param {number} mu
 * @param {number} count L + 1
 * @returns {Float64Array}
 */
function legendre(mu, count) {
  const p = new Float64Array(count)
  p[0] = 1
  if (count > 1) {
    p[1] = mu
  }
  for (let l = 2; l < count; l++) {
    p[l] = ((((2 * l) - 1) * mu * p[l - 1]) - ((l - 1) * p[l - 2])) / l
  }
  return p
}


/** @returns {object} The fixture */
function main() {
  const nFine = Math.round(180 / FINE_STEP_DEG) + 1
  const theta = Float64Array.from({length: nFine}, (_, i) => (i * FINE_STEP_DEG * Math.PI) / 180)
  const cosines = Float64Array.from(theta, Math.cos)
  const {radii, weights} = gammaDistribution(R_EFF_UM, V_EFF)
  const k = (2 * Math.PI) / WAVELENGTH_UM
  // The size-averaged differential scattering cross section, and the
  // cross sections (µm²).
  const dCsca = new Float64Array(nFine)
  let csca = 0
  let cext = 0
  let area = 0
  for (let i = 0; i < radii.length; i++) {
    const r = radii[i]
    const {s1, s2, qext, qsca} = bhmie(k * r, REFRACTIVE_INDEX, cosines)
    const geometric = Math.PI * r * r
    for (let j = 0; j < nFine; j++) {
      // dC/dω = (|S1|² + |S2|²) / (2 k²)
      dCsca[j] += weights[i] * (s1[j] + s2[j]) / (2 * k * k)
    }
    csca += weights[i] * qsca * geometric
    cext += weights[i] * qext * geometric
    area += weights[i] * geometric
  }
  // The quadrature weights over the sphere, 2π sin θ dθ (trapezoid).
  const dTheta = (FINE_STEP_DEG * Math.PI) / 180
  const dOmega = Float64Array.from(theta, (t, j) => (j === 0 || j === nFine - 1 ? 0.5 : 1) * 2 * Math.PI * Math.sin(t) * dTheta)
  // P = dC/dω / Csca, so ∫P dω = 1; normalised by the quadrature's own
  // integral, which misses a little of the forward spike.
  let integral = 0
  for (let j = 0; j < nFine; j++) {
    integral += dCsca[j] * dOmega[j] / csca
  }
  const phase = Float64Array.from(dCsca, (d) => d / csca / integral)
  let g = 0
  for (let j = 0; j < nFine; j++) {
    g += phase[j] * cosines[j] * dOmega[j]
  }
  // Delta-M: the peak's share f, and the remainder P' renormalised.
  const window = Float64Array.from(theta, (t) => smoothstep(PEAK_IN_DEG, PEAK_OUT_DEG, (t * 180) / Math.PI))
  let kept = 0
  for (let j = 0; j < nFine; j++) {
    kept += phase[j] * window[j] * dOmega[j]
  }
  const fPeak = 1 - kept
  const outside = Float64Array.from(phase, (p, j) => p * window[j] / kept)
  let gOutside = 0
  for (let j = 0; j < nFine; j++) {
    gOutside += outside[j] * cosines[j] * dOmega[j]
  }
  // Legendre coefficients of P': χ_l = 2π ∫ P'(μ) P_l(μ) dμ, so χ_0 = 1 and
  // χ_1 = g'.
  const chi = new Float64Array(LEGENDRE_TERMS)
  for (let j = 0; j < nFine; j++) {
    const pl = legendre(cosines[j], LEGENDRE_TERMS)
    for (let l = 0; l < LEGENDRE_TERMS; l++) {
      chi[l] += outside[j] * pl[l] * dOmega[j]
    }
  }
  // Lanczos sigma factors against the truncation's ringing.
  const sigma = Float64Array.from(chi, (_, l) => {
    const x = (Math.PI * l) / LEGENDRE_TERMS
    return l === 0 ? 1 : Math.sin(x) / x
  })
  // The orders' tables on the coarser grid: order k has coefficients χ_l^k.
  const nTable = Math.round(180 / TABLE_STEP_DEG) + 1
  const tableTheta = Float64Array.from({length: nTable}, (_, i) => (i * TABLE_STEP_DEG * Math.PI) / 180)
  const orders = []
  for (let order = 1; order <= ORDERS; order++) {
    const row = new Float64Array(nTable)
    for (let j = 0; j < nTable; j++) {
      const pl = legendre(Math.cos(tableTheta[j]), LEGENDRE_TERMS)
      let sum = 0
      for (let l = 0; l < LEGENDRE_TERMS; l++) {
        sum += (((2 * l) + 1) / (4 * Math.PI)) * Math.pow(chi[l], order) * sigma[l] * pl[l]
      }
      row[j] = Math.max(sum, 1e-6)
    }
    orders.push(Array.from(row, (p) => +p.toPrecision(5)))
  }
  // The first order's table against P' itself, where the eye sees a cloud
  // from above or beside it.
  const check = {}
  for (const deg of [5, 10, 20, 30, 45, 60, 90, 120, 138, 150, 165, 180]) {
    const fine = outside[Math.round(deg / FINE_STEP_DEG)]
    const table = orders[0][Math.round(deg / TABLE_STEP_DEG)]
    check[deg] = {mie: +fine.toPrecision(4), table: +table.toPrecision(4), ratio: +(table / fine).toFixed(3)}
  }
  return {
    source: 'tools/clouds/miePhase.mjs: Bohren & Huffman 1983 BHMIE over a gamma distribution (Hansen & Travis 1974); ' +
      'delta-M peak removal (Wiscombe 1977); scattering orders by Legendre powers',
    wavelengthUm: WAVELENGTH_UM,
    refractiveIndex: REFRACTIVE_INDEX,
    rEffUm: R_EFF_UM,
    vEff: V_EFF,
    // The extinction efficiency over the geometric cross section: about 2
    // for droplets much larger than the wavelength (the extinction
    // paradox), which cloudPhysics.js's extinction from the liquid-water
    // content assumes.
    qExt: +(cext / area).toFixed(4),
    singleScatteringAlbedo: +(csca / cext).toFixed(6),
    asymmetry: +g.toFixed(4),
    quadratureIntegral: +integral.toFixed(4),
    peak: {
      windowDeg: [PEAK_IN_DEG, PEAK_OUT_DEG],
      // f: the share of the scattered light in the peak, taken as
      // unscattered (delta-M).
      share: +fPeak.toFixed(4),
      asymmetryOutside: +gOutside.toFixed(4),
    },
    legendreTerms: LEGENDRE_TERMS,
    // χ_1..χ_8 of P', for the record; order k's asymmetry is χ_1^k.
    legendre: Array.from(chi.slice(0, 9), (c) => +c.toFixed(5)),
    firstOrderAgainstMie: check,
    tableStepDeg: TABLE_STEP_DEG,
    // orders[k − 1][j]: the k-th scattering order's phase function at
    // j·tableStepDeg, per steradian, ∫ dω = 1.
    orders,
  }
}


process.stdout.write(`${JSON.stringify(main())}\n`)
