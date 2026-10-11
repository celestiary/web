import earthPhase from './cloudPhase.earth.json'


/**
 * The physics of the volumetric clouds (CloudVolume.js; atmos/clouds.md):
 * the optical properties of a cloud by type, from published liquid-water
 * contents and droplet sizes; the droplets' phase function and the angular
 * shapes of its scattering orders (cloudPhase.earth.json, from
 * tools/clouds/miePhase.mjs); the multiply scattered light as the
 * delta-Eddington field of the local column; and the parameters each
 * body's deck would take.  Pure, and mirrored in the march's GLSL, so the
 * tests integrate the same model over a slab and set it against the slab's
 * own reflectance and transmittance.
 */


/** Water's density, kg/m³. */
export const WATER_DENSITY = 1000

/**
 * The extinction coefficient of a cloud of droplets, per metre: for
 * droplets much larger than the wavelength each takes twice its geometric
 * cross section from the beam (the extinction paradox: Q_ext → 2; the Mie
 * computation gives 2.09 for 10 µm droplets at 550 nm), so
 * σ = 3·Q·LWC / (4·ρ_w·r_eff) (Stephens 1978, J. Atmos. Sci. 35, 2111,
 * eq. 10; Hu & Stamnes 1993, J. Climate 6, 728, as a fit in r_eff).  A
 * stratocumulus at 0.3 g/m³ and 10 µm is 0.045 /m: 45 per km, an optical
 * depth of 20-30 through a 500 m deck.
 *
 * @param {number} lwcGramsPerM3 Liquid-water content, g/m³
 * @param {number} rEffMicrons The droplets' effective radius, µm
 * @param {number} [qExt] The extinction efficiency
 * @returns {number} Per metre
 */
export function extinctionCoefficient(lwcGramsPerM3, rEffMicrons, qExt = 2) {
  return (3 * qExt * lwcGramsPerM3 * 1e-3) / (4 * WATER_DENSITY * rEffMicrons * 1e-6)
}


/**
 * Earth's cloud types, as the renderer parametrises them.  Liquid-water
 * contents and droplet sizes:
 * - stratocumulus: LWC 0.2-0.4 g/m³ in marine decks, r_eff 9.6-11.8 µm
 *   (Miles, Verlinde & Clothiaux 2000, J. Atmos. Sci. 57, 295, from 44
 *   campaigns; Han, Rossow & Lacis 1994, J. Climate 7, 465, from satellite
 *   retrievals: 11.8 µm over ocean, 8.5 over land);
 * - cumulus: 0.5-1 g/m³, 2 in congestus cores (Warner 1955, Tellus 7,
 *   449; Lawson & Blyth 1998, J. Atmos. Sci. 55, 3011), r_eff 10-15 µm;
 * - cirrus (not drawn yet; see clouds.md): ice, IWC 0.01-0.1 g/m³,
 *   extinction 0.05-2 per km (Heymsfield & McFarquhar 2002, in Cirrus,
 *   OUP), so a few tenths of optical depth.
 *
 * Single-scattering albedo: water absorbs nothing in the visible (the
 * imaginary index is 1.7e-9 at 550 nm, Hale & Querry 1973): 1.
 */
export const CLOUD_TYPES = {
  stratocumulus: {lwc: 0.3, rEff: 10, albedo: 1},
  cumulus: {lwc: 0.7, rEff: 12, albedo: 1},
}


/**
 * Earth's low cloud layer as drawn, metres over the ground sphere: the
 * base, the top of the stratiform and fair-weather cumulus, and the top of
 * the convective towers the map's thickest cloud grows into.  WMO's low
 * clouds have bases from the surface to 2 km; marine stratocumulus sits at
 * 0.5-1 km with tops at 1-2 km (the boundary layer's depth), trade cumulus
 * from about 0.6 km up to 2-3 km, continental cumulus bases at 1-2 km; a
 * cumulonimbus tops out at the tropopause, 8-12 km in middle latitudes
 * and higher in the tropics (WMO International Cloud Atlas, 2017).  The
 * convective tops are held at 9 km.
 */
export const EARTH_LAYER = {base: 800, top: 2400, towerTop: 9000}


/**
 * How much of the sunlight reaching the ground on a clear day is the
 * direct beam: the rest is the sky's, which a cloud's shadow leaves.  The
 * diffuse share of the global irradiance under a clear sky is 0.1-0.2 at a
 * high Sun (Iqbal 1983, An Introduction to Solar Radiation, ch. 7).
 */
export const DIRECT_SHARE = 0.85


/**
 * Delta-M scaling (Wiscombe 1977, J. Atmos. Sci. 34, 1408): the diffraction
 * peak's share f of the scattered light is taken as unscattered, so the
 * beam's extinction is σ·(1 − ω·f) and the rest scatters by the peak-less
 * phase function.  Half of a large droplet's extinction is diffraction, so
 * a cloud's beam penetrates about twice as far as Beer's law with the full
 * extinction says, and the ground seen through thin cloud keeps the light
 * diffracted by a degree or two (a blur the march doesn't draw).
 *
 * @param {number} sigma The extinction coefficient
 * @param {number} albedo The single-scattering albedo
 * @param {number} peakShare f
 * @returns {number} The scaled extinction
 */
export function deltaScaled(sigma, albedo, peakShare) {
  return sigma * (1 - (albedo * peakShare))
}


/**
 * @param {number} g The asymmetry parameter
 * @param {number} peakShare f
 * @returns {number} The asymmetry of the peak-less phase function, (g − f) / (1 − f)
 */
export function deltaScaledAsymmetry(g, peakShare) {
  return (g - peakShare) / (1 - peakShare)
}


/**
 * Eddington's two-stream coefficient for a conservative scatterer:
 * γ = 3(1 − g)/4 (Meador & Weaver 1980, J. Atmos. Sci. 37, 630, Table 1,
 * at ω = 1; γ₁ = γ₂ there).  Other closures put it between (1 − g)/2 and
 * (1 − g); the spread is the method's accuracy.
 *
 * @param {number} g The asymmetry parameter
 * @returns {number}
 */
export function eddingtonGamma(g) {
  return 0.75 * (1 - g)
}


/**
 * Delta-Eddington's scaling of a slab (Joseph, Wiscombe & Weinman 1976,
 * J. Atmos. Sci. 33, 2452): the forward share f = g² of the phase function
 * is taken as unscattered, τ' = τ(1 − g²) and g' = g/(1 + g), which keeps
 * the two-stream's γ₃ = (2 − 3g)/4 positive (g' ≤ 1/2) and the Eddington
 * solution sound for forward-scattering droplets.  On top of the
 * march's delta-M (deltaScaled): that took the diffraction peak out of
 * the beam; this takes the rest of the forward lobe out of the diffuse
 * field's closure.
 *
 * @param {number} tau
 * @param {number} g
 * @returns {{tau: number, g: number}}
 */
export function deltaEddington(tau, g) {
  return {tau: tau * (1 - (g * g)), g: g / (1 + g)}
}


/**
 * A conservative (non-absorbing) slab under a collimated beam, in the
 * delta-Eddington approximation (deltaEddington; Shettle & Weinman 1970,
 * J. Atmos. Sci. 27, 1048).  With ω = 1 the two-stream equations (Meador &
 * Weaver's, γ₁ = γ₂ = γ, γ₃ = (2 − 3gμ₀)/4 for a beam of cosine μ₀ from
 * the vertical) integrate in closed form: the net diffuse flux is the
 * beam's loss, F↑ − F↓ = E (e^(−τ/μ₀) − T), and the total F↑ + F↓ is
 * linear in τ plus the beam's exponential; the boundary conditions (no
 * diffuse light in at the top, none up from below) give
 *
 *   T = [1 + e^(−τ* / μ₀) + (2γ + 3g/2) μ₀ (1 − e^(−τ* / μ₀))] / (2 + 2γτ*),
 *   R = 1 − T,
 *
 * in the scaled τ* and g, for the beam's irradiance on the slab.  A
 * stratocumulus of τ = 20 (g 0.866) under a high Sun reflects 0.63 and
 * passes 0.37, as observed for such decks (Stephens 1978, J. Atmos. Sci.
 * 35, 2123: about 0.65); a low Sun's beam is scattered nearer the top and
 * more of it comes back.
 *
 * @param {number} tau The slab's optical depth, unscaled
 * @param {number} g The asymmetry parameter, unscaled
 * @param {number} [muSun] The beam's cosine from the vertical
 * @returns {{reflectance: number, transmittance: number}} Of the beam's irradiance
 */
export function eddingtonSlab(tau, g, muSun = 1) {
  const s = deltaEddington(tau, g)
  const gamma = eddingtonGamma(s.g)
  const mu = Math.max(muSun, MU_SUN_MIN)
  const direct = Math.exp(-s.tau / mu)
  const k = ((2 * gamma) + (1.5 * s.g)) * mu
  const transmittance = (1 + direct + (k * (1 - direct))) / (2 + (2 * gamma * s.tau))
  return {reflectance: 1 - transmittance, transmittance}
}


// The Sun's cosine from the vertical is held above this in the slab's
// solution: at the terminator the beam's path through a layer is bounded by
// the sphere's curvature, which the plane-parallel slab has no notion of.
export const MU_SUN_MIN = 0.05


/**
 * The ground's irradiance under a cloud, as a fraction of the clear-sky
 * value: the direct beam's share, through the cloud's transmittance (the
 * beam is scattered, not absorbed, and what the cloud passes reaches the
 * ground spread out), plus the sky's share untouched.
 *
 * @param {number} tau The cloud's optical depth along the Sun's path
 * @param {number} g The asymmetry parameter
 * @returns {number} 0 to 1; 1 − it is the shadow's depth
 */
export function groundUnderCloud(tau, g) {
  return 1 - (DIRECT_SHARE * (1 - eddingtonSlab(tau, g).transmittance))
}


/**
 * The Eddington intensity at a slab's boundary is not exactly the flux it
 * carries (the approximation's boundary condition fixes the flux, not the
 * intensity), so the march's radiance out of a thick slab, the diffuse
 * source integrated through the slab's extinction with the exact single
 * scattering on top, differs a little from the slab's own R from above
 * and T from below.  The diffuse source is scaled by this so the two
 * agree to within 5% from τ 10 to 50 (cloudPhysics.test.js: 1.01-1.05
 * above, 0.94-0.97 below).
 */
export const EDDINGTON_SOURCE_SCALE = 0.97


/**
 * The diffuse light inside the slab (eddingtonSlab), at optical depth τ
 * from the top, as the source it makes for a ray toward the eye: in the
 * Eddington approximation the intensity is I₀ + μ I₁, with I₀ the mean
 * intensity, (F↑ + F↓)/2π, and I₁ = 3(F↑ − F↓)/4π its up-down tilt, and a
 * phase function of asymmetry g scatters that field toward a direction of
 * cosine μᵥ (from the vertical, up positive) as I₀ + g μᵥ I₁ (the
 * first-moment term; Chandrasekhar 1960, Radiative Transfer, §84).  Per
 * unit of the beam's flux on the slab, E·μ₀ (the march multiplies by μ₀,
 * as the beam's own scattering is per unit of E), and per steradian: the cloud's own
 * multiply scattered light, which single scattering alone leaves out (a
 * deck of τ 20 is 0.08 of a sunlit white by single scattering, 0.6-0.7
 * in fact).  The beam's own single scattering at the point is not in it:
 * the march adds that exactly, by the phase function.
 *
 * @param {number} tau Optical depth from the slab's top to the point, unscaled
 * @param {number} tauStar The slab's whole optical depth, unscaled
 * @param {number} g The asymmetry parameter, unscaled
 * @param {number} muView The cosine of the direction toward the eye from the vertical
 * @param {number} [muSun] The beam's cosine from the vertical
 * @returns {number} ≥ 0
 */
export function eddingtonSource(tau, tauStar, g, muView, muSun = 1) {
  const s = deltaEddington(tauStar, g)
  const depth = tau * (1 - (g * g))
  const gamma = eddingtonGamma(s.g)
  const {transmittance: T} = eddingtonSlab(tauStar, g, muSun)
  const mu = Math.max(muSun, MU_SUN_MIN)
  const direct = Math.exp(-depth / mu)
  const k = ((2 * gamma) + (1.5 * s.g)) * mu
  const net = direct - T
  const total = (-k * direct) - (2 * gamma * T * depth) + (1 - T) + k
  const i0 = total / (2 * Math.PI)
  const i1 = (3 * net) / (4 * Math.PI)
  return Math.max(i0 + (s.g * muView * i1), 0) * EDDINGTON_SOURCE_SCALE
}


/**
 * A homogeneous slab's radiance toward an eye straight above (the Sun
 * behind it, scattering angle 180°) or straight below (the Sun over the
 * slab, 0°), by the march's model: exact single scattering of the
 * delta-scaled beam by the peak-less phase function, plus the Eddington
 * diffuse source (eddingtonSource), through the slab's extinction to the
 * eye.  Mirrors the GLSL in CloudVolume.js; the test sets it against the
 * slab's own reflectance and transmittance.
 *
 * @param {number} tau The slab's full optical depth (unscaled)
 * @param {object} phase A cloudPhase fixture
 * @param {object} [opts]
 * @param {boolean} [opts.fromBelow] The eye under the slab
 * @param {number} [opts.steps]
 * @returns {{radiance: number, albedo: number}} L/E per steradian, and
 *   π·L/E, the equivalent Lambertian albedo, against the slab's R or T
 */
export function slabRadiance(tau, phase, {fromBelow = false, steps = 2000} = {}) {
  const f = phase.peak.share
  const g = deltaScaledAsymmetry(phase.asymmetry, f)
  const scaled = tau * (1 - f)
  const single = phaseAt(phase, 1, fromBelow ? 0 : 180)
  const muView = fromBelow ? -1 : 1
  const ds = scaled / steps
  let radiance = 0
  for (let i = 0; i < steps; i++) {
    const tauSun = (i + 0.5) * ds
    const tauView = fromBelow ? scaled - tauSun : tauSun
    const source = (single * Math.exp(-tauSun)) + eddingtonSource(tauSun, scaled, g, muView)
    radiance += source * Math.exp(-tauView) * ds
  }
  return {radiance, albedo: Math.PI * radiance}
}


/**
 * @param {object} phase A cloudPhase fixture
 * @param {number} order 1 for single scattering
 * @param {number} angleDeg The scattering angle
 * @returns {number} The order's phase function there, per steradian
 *   (linear between the table's angles)
 */
export function phaseAt(phase, order, angleDeg) {
  const row = phase.orders[Math.min(order, phase.orders.length) - 1]
  const x = Math.min(Math.max(angleDeg / phase.tableStepDeg, 0), row.length - 1)
  const i = Math.min(Math.floor(x), row.length - 2)
  const t = x - i
  return (row[i] * (1 - t)) + (row[i + 1] * t)
}


/**
 * The peak-less phase function as a table for a texture: one row over the
 * scattering angle, 0 to 180°.  (The fixture also holds the higher
 * scattering orders' shapes; the march's multiple scattering is the
 * Eddington field, so only the first is drawn.)
 *
 * @param {object} phase A cloudPhase fixture
 * @returns {{data: Float32Array, width: number}}
 */
export function phaseTable(phase) {
  return {data: Float32Array.from(phase.orders[0]), width: phase.orders[0].length}
}

/**
 * The per-body parameters of the volumetric cloud renderer: what it draws
 * for Earth, and what each other deck would take (clouds.md, "Other
 * bodies").  Each has the particles' phase function by Mie theory
 * (`phase`: a fixture from tools/clouds/miePhase.mjs, with the particle
 * size and index it was made for), the layers' heights and extinction, the
 * single-scattering albedo per channel, and what seeds the coverage.  Only
 * Earth is `enabled`: the others' seed is their own surface texture, which
 * is the cloud top itself, and the hand-off from texture to volume is the
 * follow-up recorded there.
 */
export const BODY_CLOUDS = {
  earth: {
    enabled: true,
    phase: earthPhase,
    layer: EARTH_LAYER,
    types: CLOUD_TYPES,
    // The extinction of the stratiform cloud, and of the convective, per
    // metre (extinctionCoefficient, with the Mie Q_ext).
    extinction: [
      extinctionCoefficient(CLOUD_TYPES.stratocumulus.lwc, CLOUD_TYPES.stratocumulus.rEff, earthPhase.qExt),
      extinctionCoefficient(CLOUD_TYPES.cumulus.lwc, CLOUD_TYPES.cumulus.rEff, earthPhase.qExt),
    ],
    albedo: [1, 1, 1],
    seed: 'the day\'s NASA GIBS coverage map (CloudMap.js)',
  },
  venus: {
    enabled: false,
    // Pioneer Venus's particle-size spectrometer (Knollenberg & Hunten
    // 1980, J. Geophys. Res. 85, 8039): three cloud layers, upper 56.5-70
    // km (τ ≈ 6-8 at 0.63 µm), middle 50.5-56.5 (τ ≈ 8-10), lower
    // 47.5-50.5 (τ ≈ 6-12), about 29 in all; a thin haze above to 90 km.
    // Mode-2 droplets of 75% sulphuric acid, r_eff 1.05 µm, v_eff 0.07,
    // index 1.44 (Hansen & Hovenier 1974, J. Atmos. Sci. 31, 1137, from
    // the polarisation), which Mie gives an asymmetry of about 0.72 at
    // 550 nm; the single-scattering albedo is 1 in the red and about 0.99
    // in the blue, where the unknown UV absorber darkens the deck.
    phase: null,
    particles: {refractiveIndex: 1.44, rEffUm: 1.05, vEff: 0.07},
    layers: [
      {name: 'upper', base: 56500, top: 70000, extinction: 7 / 13500},
      {name: 'middle', base: 50500, top: 56500, extinction: 9 / 6000},
      {name: 'lower', base: 47500, top: 50500, extinction: 9 / 3000},
    ],
    albedo: [1, 0.995, 0.99],
    seed: 'full cover; the UV markings (venus.jpg) are the deck\'s own top, no coverage map',
  },
  titan: {
    enabled: false,
    // Titan's haze is its atmosphere's aerosol, which the atmosphere pass
    // draws (composition.md, per-body data; #218 refits it to Huygens'
    // DISR, Tomasko et al. 2008, Planet. Space Sci. 56, 669: fractal
    // aggregates of ~3000 0.05 µm monomers, τ ≈ 3 at 531 nm from the
    // ground up, single-scattering albedo 0.95 in the red to 0.8 in the
    // blue).  What this renderer would draw are its methane clouds, in the
    // troposphere at 10-40 km, sparse and seasonal (Griffith et al. 2005,
    // Science 310, 474); there is no coverage map for them.
    phase: null,
    layers: [{name: 'methane', base: 10000, top: 40000, extinction: null}],
    albedo: [1, 1, 1],
    seed: 'none: no map of Titan\'s methane clouds',
  },
  jupiter: {
    enabled: false,
    // The ammonia-ice cloud tops near 0.7 bar, about 9 km over the 1 bar
    // level (a 27 km scale height), τ of several to ten (West, Strobel &
    // Tomasko 1986, Icarus 65, 161), particles of 0.5-1 µm (Sromovsky &
    // Fry 2010, Icarus 210, 211), so an asymmetry near 0.7; the
    // single-scattering albedo falls into the blue by the chromophores
    // that colour the belts.  Jupiter's texture is the cloud top itself,
    // so the hand-off is texture to volume, with the texture as the seed
    // (#41, the giants on the parametric renderer).
    phase: null,
    layers: [{name: 'ammonia', base: 0, top: 9000, extinction: 8 / 9000}],
    albedo: [0.995, 0.98, 0.93],
    seed: 'the colour map (jupiter.jpg) as the deck\'s top; no coverage map',
  },
}


/**
 * @param {string} name A body's name
 * @returns {object|null} Its BODY_CLOUDS entry when the volumetric clouds
 *   are drawn for it
 */
export function cloudParams(name) {
  const entry = BODY_CLOUDS[name]
  return entry?.enabled ? entry : null
}
