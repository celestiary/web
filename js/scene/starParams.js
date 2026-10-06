import {
  DJ87_LETTERS,
  KIND_NORMAL,
  KIND_WHITE_DWARF,
  LUM_CLASS_UNKNOWN,
  SPECTRAL_CLASSES,
  SUN_LOGG,
  SUN_MBOL,
  SUN_TEFF,
  bolometricCorrectionV,
  clampTemp,
  deJager,
  deJagerB,
  teffFromClass,
} from './stellar.js'


/**
 * Every star's physical parameters (js/scene/Stars.md, "Every star"): its
 * effective temperature, radius, mass and surface gravity, its rotation
 * where it is measured, and its activity, from the catalogue's class and
 * absolute magnitude, or from published measurements for the stars that
 * have them (MEASURED_STARS).  What Star.js draws a star's disc from, and
 * what the catalogue sizes it by (StarsCatalog.js).
 */


/** The J2000 obliquity of the ecliptic, radians (IAU 2006: 84381.406″; the scene's 84381.448″). */
const OBLIQUITY = 84381.448 / 3600 * Math.PI / 180
/**
 * The celestial (equatorial J2000) north pole in the catalogue's frame: the
 * mean ecliptic of J2000 with the scene's axes (X the equinox, Y the north
 * ecliptic pole, Z minus ecliptic Y; celestialFrame.js): the pole is at
 * ecliptic (0, sin ε, cos ε), so (0, cos ε, −sin ε) here (Polaris is 0.7° from it).
 */
export const CATALOGUE_NORTH = [0, Math.cos(OBLIQUITY), -Math.sin(OBLIQUITY)]


const deg = (d) => d * Math.PI / 180


/**
 * Stars with published parameters, by Hipparcos id (the Sun 0).  teff and
 * radius for a rotator are its polar ones, with its equatorial radius and
 * temperature under `rotation`; inclination is of the rotation axis to the
 * line of sight, and the position angle that of the projected pole, east
 * of north.
 */
export const MEASURED_STARS = new Map([
  [0, {
    name: 'Sun', teff: SUN_TEFF, radius: 1, mass: 1,
    sources: 'IAU 2015 Resolutions B2 and B3 (nominal Teff, radius, GM)',
  }],
  [32349, {
    name: 'Sirius A', teff: 9845, radius: 1.7144, mass: 2.063,
    sources: 'Davis et al. 2011 (PASA 28, 58: interferometric radius and Teff); Bond et al. 2017 (ApJ 840, 70: mass)',
  }],
  [91262, {
    name: 'Vega', teff: 10060, radius: 2.362, mass: 2.15,
    rotation: {radiusEq: 2.818, teffEq: 8152, inclination: deg(4.98), positionAngle: null},
    sources: 'Yoon et al. 2010 (ApJ 708, 71: a rapidly rotating star seen pole-on, polar and equatorial radius and ' +
      'temperature, inclination; mass)',
  }],
  [97649, {
    name: 'Altair', teff: 8450, radius: 1.636, mass: 1.791,
    rotation: {radiusEq: 2.029, teffEq: 6860, beta: 0.190, inclination: deg(57.2), positionAngle: deg(-61.8)},
    sources: 'Monnier et al. 2007 (Science 317, 342: the first image of a main-sequence star\'s surface; ' +
      'polar and equatorial radius and temperature, gravity darkening β, inclination and position angle, mass)',
  }],
  [27989, {
    name: 'Betelgeuse', teff: 3600, radius: 764, mass: 18,
    sources: 'Levesque & Massey 2020 (ApJL 891, L37: Teff); Joyce et al. 2020 (ApJ 902, 63: radius, 16.5-19 M☉)',
  }],
  [70890, {
    name: 'Proxima Centauri', teff: 2980, radius: 0.1542, mass: 0.122,
    activity: 'flare',
    sources: 'Ribas et al. 2017 (A&A 603, A58: Teff); Boyajian et al. 2012 (ApJ 757, 112: interferometric radius); ' +
      'mass from the M-dwarf mass-luminosity relation (Mann et al. 2015)',
  }],
])


/**
 * The main-sequence mass-luminosity relation, inverted: L/L☉ = 0.23 M^2.3
 * under 0.43 M☉, M^4 to 2, 1.4 M^3.5 to 55 and 32,000 M above (Duric 2004,
 * Advanced Astrophysics, §5.2).  For an evolved star it gives its
 * progenitor's mass only roughly: a red giant of ~1 M☉ and a few hundred
 * L☉ comes out at 4 M☉ (Arcturus), a supergiant ~30% high (Betelgeuse);
 * the granule scale it sets is a power of g, so a factor of 4 in mass is
 * one of 4 in the granules' size.
 *
 * @param {number} lum L / L☉
 * @returns {number} M / M☉
 */
export function massFromLuminosity(lum) {
  if (!(lum > 0)) {
    return 1
  }
  if (lum < 0.23 * (0.43 ** 2.3)) {
    return (lum / 0.23) ** (1 / 2.3)
  }
  if (lum < 16) {
    return lum ** 0.25
  }
  if (lum < 1.4 * (55 ** 3.5)) {
    return (lum / 1.4) ** (1 / 3.5)
  }
  return lum / 32000
}


/**
 * @param {number} absMag Absolute visual magnitude
 * @param {number} teff K
 * @returns {number} L / L☉, bolometric: the magnitude through the bolometric correction
 */
export function luminosityFromMagnitude(absMag, teff) {
  return 10 ** (-0.4 * (absMag + bolometricCorrectionV(teff) - SUN_MBOL))
}


/**
 * @param {number} lum L / L☉
 * @param {number} teff K
 * @returns {number} R / R☉ by Stefan-Boltzmann, L = 4πR²σT⁴
 */
export function radiusFromLuminosity(lum, teff) {
  return Math.sqrt(lum) * ((SUN_TEFF / clampTemp(teff)) ** 2)
}


/**
 * A star's luminosity class as DJ87's continuous b (0 a hypergiant, 5 a
 * dwarf) where the catalogue has none (61,579 of its stars): the b at
 * which DJ87's luminosity for its type, through the bolometric
 * correction, gives its absolute magnitude.  Brighter than DJ87's dwarf of
 * its type, it is a subgiant, giant or supergiant by how much; fainter, a
 * dwarf (b 5).
 *
 * @param {string} letter O to M
 * @param {number} sub
 * @param {number} absMag
 * @returns {number} b in [0, 5]
 */
export function inferLuminosityB(letter, sub, absMag) {
  const mags = predictedMagnitudes(letter, sub)
  if (!Number.isFinite(absMag) || absMag >= mags[B_STEPS]) {
    return 5
  }
  if (absMag <= mags[0]) {
    return 0
  }
  // The predicted magnitude rises (fainter) with b: the first step past it.
  let i = 1
  while (mags[i] < absMag) {
    i++
  }
  const f = (absMag - mags[i - 1]) / (mags[i] - mags[i - 1])
  return (i - 1 + f) * 5 / B_STEPS
}


const B_STEPS = 50
const predictedByType = new Map


/**
 * @param {string} letter
 * @param {number} sub
 * @returns {Float64Array} DJ87's absolute visual magnitude for the type at b = 0 to 5, B_STEPS steps
 */
function predictedMagnitudes(letter, sub) {
  const key = `${letter}${sub}`
  let mags = predictedByType.get(key)
  if (!mags) {
    mags = new Float64Array(B_STEPS + 1)
    for (let i = 0; i <= B_STEPS; i++) {
      const {teff, logL} = deJager(letter, sub, i * 5 / B_STEPS)
      mags[i] = SUN_MBOL - (2.5 * logL) - bolometricCorrectionV(teff)
    }
    // Held monotone, so the search above always ends.
    for (let i = 1; i <= B_STEPS; i++) {
      mags[i] = Math.max(mags[i], mags[i - 1] + 1e-9)
    }
    predictedByType.set(key, mags)
  }
  return mags
}


// Spots by type, as the shader's lattice (Star.js, star-shaders.js): cells
// across the radius, the chance of a spot in an active region's cell, its
// largest radius in cells, the band of |sin latitude| active regions are
// in, and a shift of the active regions' threshold (more of the star
// active).  Cool active stars have more, larger spots, at high latitudes
// and the poles too (Doppler imaging; Berdyugina 2005 §4, Strassmeier
// 2009): an M dwarf's cover a few to tens of percent of it; the Sun's at
// most ~0.5%.  Hot stars (radiative envelopes) and supergiants (no
// solar-type dynamo; their surfaces are giant convection cells) have none.
// Approximate, within the observed ranges, not fitted.
const SUN_SPOTS = {freq: 25, prob: 0.35, radius: 0.45, belt: [Math.sin(deg(5)), Math.sin(deg(35))], bias: 0}
const NO_SPOTS = {...SUN_SPOTS, prob: 0}
const K_DWARF_SPOTS = {freq: 20, prob: 0.45, radius: 0.45, belt: [Math.sin(deg(5)), Math.sin(deg(60))], bias: -0.3}
const M_DWARF_SPOTS = {freq: 8, prob: 0.6, radius: 0.45, belt: [-0.1, 1.1], bias: -0.9}
const FLARE_STAR_SPOTS = {...M_DWARF_SPOTS, prob: 0.7, bias: -1.2}
const GIANT_SPOTS = {freq: 12, prob: 0.15, radius: 0.45, belt: [0, Math.sin(deg(70))], bias: 0}
const CONVECTIVE_TEFF_MAX = 7000
const M_DWARF_TEFF_MAX = 3900
const K_DWARF_TEFF_MAX = 5300
const SUPERGIANT_B_MAX = 2.5
const GIANT_B_MAX = 4


/**
 * @param {number} teff K
 * @param {number} lumB DJ87's b: 5 a dwarf, 3 a giant, under 2.5 a supergiant
 * @param {string} [kind] 'flare' for a known flare star
 * @returns {object} The spots' lattice: freq, prob, radius, belt, bias
 */
export function spotsByType(teff, lumB, kind) {
  if (teff >= CONVECTIVE_TEFF_MAX || lumB < SUPERGIANT_B_MAX) {
    return NO_SPOTS
  }
  if (lumB < GIANT_B_MAX) {
    return GIANT_SPOTS
  }
  if (teff < M_DWARF_TEFF_MAX) {
    return kind === 'flare' ? FLARE_STAR_SPOTS : M_DWARF_SPOTS
  }
  return teff < K_DWARF_TEFF_MAX ? K_DWARF_SPOTS : SUN_SPOTS
}


/**
 * A rotating star's shape and gravity darkening (Roche model, von Zeipel
 * 1924): from its polar and equatorial radii, the rotation that puts both
 * on one equipotential, GM/R_p = GM/R_e + ½Ω²R_e², so in units of
 * GM / R_p³, Ω² = 2(1 − 1/e)/e², e = R_e / R_p; and T ∝ g_eff^β, β
 * from the equatorial temperature where it is given (Vega's is von
 * Zeipel's 0.25), else as given (Altair's 0.19, Monnier et al. 2007).
 *
 * @param {object} rotation MEASURED_STARS' rotation
 * @param {number} teffPole K
 * @param {number} radiusPole R☉
 * @returns {{oblate: number, omega2: number, beta: number, teffMean: number}} oblate is R_e / R_p
 */
export function rocheModel(rotation, teffPole, radiusPole) {
  const e = rotation.radiusEq / radiusPole
  const omega2 = 2 * (1 - (1 / e)) / (e * e)
  const gEq = (1 / (e * e)) - (omega2 * e)
  const beta = rotation.beta ?? (Math.log(rotation.teffEq / teffPole) / Math.log(gEq))
  // The surface's mean T⁴, over the ellipsoid's area, for the star's
  // colour as a point and its mean surface brightness.
  let sumT4 = 0
  let sumArea = 0
  const n = 400
  for (let i = 0; i < n; i++) {
    const cosLat = Math.cos(((i + 0.5) / n * Math.PI) - (Math.PI / 2))
    const sinLat = Math.sin(((i + 0.5) / n * Math.PI) - (Math.PI / 2))
    const g = effectiveGravity(cosLat * e, sinLat, omega2)
    const t = teffPole * (g ** beta)
    // A band's area on the ellipsoid ~ its radius from the axis times its arc.
    const w = cosLat * e * Math.hypot(sinLat * e, cosLat)
    sumT4 += (t ** 4) * w
    sumArea += w
  }
  return {oblate: e, omega2, beta, teffMean: (sumT4 / sumArea) ** 0.25}
}


/**
 * The Roche model's effective gravity at a point of the surface, in units
 * of GM / R_p², as star-shaders.js computes it.
 *
 * @param {number} x Distance from the axis, R_p
 * @param {number} y Height along the axis, R_p
 * @param {number} omega2 Ω², GM / R_p³
 * @returns {number}
 */
export function effectiveGravity(x, y, omega2) {
  const r = Math.hypot(x, y)
  const sin2 = (x * x) / (r * r)
  const gr = (-1 / (r * r)) + (omega2 * r * sin2)
  const gt = omega2 * r * Math.sqrt(sin2) * (y / r)
  return Math.hypot(gr, gt)
}


/**
 * The direction of a star's rotation axis from its inclination and
 * position angle, in the frame its line of sight and north are given in:
 * the pole tipped toward the observer by 90° − i, in the direction PA east
 * of north on the sky.  A null position angle (unmeasured) is north.
 *
 * @param {object} rotation inclination and positionAngle, radians
 * @param {Array<number>} sight Unit vector from the observer to the star
 * @param {Array<number>} north The celestial north pole's direction (need not be unit or perpendicular)
 * @returns {Array<number>} Unit vector
 */
export function rotationAxis(rotation, sight, north) {
  const dot = (a, b) => (a[0] * b[0]) + (a[1] * b[1]) + (a[2] * b[2])
  const unit = (a) => {
    const l = Math.hypot(...a)
    return a.map((c) => c / l)
  }
  const cross = (a, b) => [(a[1] * b[2]) - (a[2] * b[1]), (a[2] * b[0]) - (a[0] * b[2]), (a[0] * b[1]) - (a[1] * b[0])]
  const l = unit(sight)
  const pn = dot(north, l)
  const n = unit(north.map((c, k) => c - (pn * l[k])))
  // East is to the left of north for an observer looking along l.
  const e = cross(n, l)
  const pa = rotation.positionAngle ?? 0
  const i = rotation.inclination
  const s = n.map((c, k) => (Math.cos(pa) * c) + (Math.sin(pa) * e[k]))
  return unit(s.map((c, k) => (Math.sin(i) * c) - (Math.cos(i) * l[k])))
}


const teffByClass = new Map
/**
 * teffFromClass, cached by class and b to 0.02 (the whole catalogue's
 * parameters are computed as it loads).
 *
 * @param {object} props
 * @param {number} [lumB]
 * @returns {number} K
 */
function classTeff(props, lumB) {
  const key = `${props?.kind}:${props?.spectralType}:${props?.sub}:${props?.lumClass}:${lumB === undefined ? '' : Math.round(lumB * 50)}`
  let teff = teffByClass.get(key)
  if (teff === undefined) {
    teff = teffFromClass(props, lumB === undefined ? undefined : Math.round(lumB * 50) / 50)
    teffByClass.set(key, teff)
  }
  return teff
}


/**
 * A star's physical parameters: measured (MEASURED_STARS) where published,
 * else from the catalogue:
 * - the luminosity class where given, else inferred from the absolute
 *   magnitude (inferLuminosityB);
 * - the temperature from the class (stellar.js teffFromClass);
 * - the bolometric luminosity from the absolute magnitude and the
 *   bolometric correction, and the radius from it and the temperature by
 *   Stefan-Boltzmann;
 * - the mass from the luminosity (massFromLuminosity), and the surface
 *   gravity from the mass and radius;
 * - spots by type (spotsByType).
 *
 * @param {object} props A catalogue star's (StarsCatalog) or a body file's (the Sun)
 * @returns {object} teff (K; the pole's for a rotator), teffMean, radius (R☉; the equator's for a
 *   rotator), radiusPole, mass (M☉), logg (cgs, at the pole), lumB, rotation (null, or the Roche
 *   model and the measured inclination and position angle), spots, measured (bool), sources
 */
export function starParams(props) {
  const name = String(props?.name ?? '').trim().toLowerCase()
  const hip = (name === 'sun' || name === 'sol') ? 0 : props?.hipId
  const measured = MEASURED_STARS.get(hip)
  const kind = parseInt(props?.kind) || KIND_NORMAL
  const type = parseInt(props?.spectralType)
  let sub = parseInt(props?.sub)
  sub = sub >= 0 && sub <= 9 ? sub : 5
  const lumClass = parseInt(props?.lumClass)
  const letter = SPECTRAL_CLASSES[type]
  const normal = kind === KIND_NORMAL && DJ87_LETTERS.includes(letter ?? '-')
  let lumB = 5
  if (normal) {
    lumB = lumClass >= 0 && lumClass < LUM_CLASS_UNKNOWN ?
      deJagerB(lumClass) :
      inferLuminosityB(letter, letter === 'O' ? Math.max(sub, 1) : sub, props?.absMag)
  }
  if (measured) {
    const out = {
      teff: measured.teff, teffMean: measured.teff, radius: measured.radius, radiusPole: measured.radius,
      mass: measured.mass, lumB, rotation: null, measured: true, sources: measured.sources,
    }
    if (measured.rotation) {
      const roche = rocheModel(measured.rotation, measured.teff, measured.radius)
      out.rotation = {...measured.rotation, ...roche}
      out.teffMean = roche.teffMean
      out.radius = measured.rotation.radiusEq
    }
    out.logg = SUN_LOGG + Math.log10(out.mass) - (2 * Math.log10(out.radiusPole))
    out.spots = spotsByType(out.teffMean, lumB, measured.activity)
    return out
  }
  const teff = Number.isFinite(props?.teff) ? props.teff : classTeff(props, normal ? lumB : undefined)
  const lum = luminosityFromMagnitude(props?.absMag, teff)
  const radius = Number.isFinite(lum) ? radiusFromLuminosity(lum, teff) : 1
  const mass = kind === KIND_WHITE_DWARF ? 0.6 : massFromLuminosity(lum)
  return {
    teff,
    teffMean: teff,
    radius,
    radiusPole: radius,
    mass,
    logg: SUN_LOGG + Math.log10(mass) - (2 * Math.log10(radius)),
    lumB,
    rotation: null,
    spots: spotsByType(teff, lumB),
    measured: false,
    sources: 'Teff from class (de Jager & Nieuwenhuijzen 1987; Levesque et al. 2005); radius by Stefan-Boltzmann from ' +
      'the absolute magnitude and the bolometric correction (Flower 1996, Torres 2010); mass from the ' +
      'mass-luminosity relation',
  }
}
