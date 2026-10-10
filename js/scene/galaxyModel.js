import {ASTRO_UNIT_METER, DISPLAY_GAIN} from '../shared.js'
import {galacticToSceneMatrix} from './galacticFrame.js'


/**
 * A disc galaxy's structure and integrated light, from published models:
 * the Milky Way (#99; MilkyWay.md has its sources, parameters and numbers)
 * and, from the same components with their own parameters, SPARC's disc
 * galaxies (#221; Galaxies.md, sparcGalaxy.js).  A galaxy is a *spec*
 * (MILKY_WAY is one): its luminosity, its components' shares and scales,
 * its arms, bar and dust, and the recipe its in-plane map is baked by.
 *
 * Everything here is in a galaxy's own frame, in kiloparsecs: the origin
 * at its centre, +Y its disc's north pole, X and Z in its plane.  For the
 * Milky Way that frame is G, galactocentric: +X along the Sun → centre
 * line (the galactic frame's l = 0, as galacticFrame.js's F), +Z toward
 * l = 90°, the Sun at (-SUN_R_KPC, SUN_Z_KPC, 0).  G is F shifted by the
 * Sun's position and with its Z negated (sceneToGalacticRotation).  The
 * azimuth β is Reid et al.'s: 0 toward -X (the Sun), growing in the sense
 * of the rotation (clockwise seen from the north pole), so a point at
 * radius R and azimuth β is R·(-cos β, 0, sin β).
 *
 * The model is a luminosity density, L_sun per kpc³, in six components,
 * each normalised so the whole carries the spec's L:
 *
 * - a thin and a thick exponential disc (Jurić et al. 2008 for the Milky
 *   Way), the thin one with a central deficit where a bar takes over, both
 *   flaring and following a warp where the spec has them;
 * - a boxy bulge (an exponential of the "boxy" radius of Dwek et al. 1995's
 *   models; for other galaxies a power of it, a Sérsic-like profile) and a
 *   long bar (Wegg, Gerhard & Portail 2015 for the Milky Way's);
 * - the young population of the arms, or of an irregular's clumps;
 * - HII regions, knots along the arms' outer edges or in the clumps;
 *
 * and a dust density (Drimmel & Spergel 2001's thin dust disc for the
 * Milky Way, its lanes on the arms' inner edges and along the bar's
 * leading sides, clumped; the Milky Way's alone has the Local Bubble round
 * the Sun and the nearby dark clouds of the Great Rift).
 *
 * The in-plane structure (arms, lanes, clumps, knots, a measured radial
 * profile's departure from the exponential) is baked into a map (bakeMap),
 * which the shader samples; the radial and vertical profiles stay
 * analytic.  The JS here mirrors the shader (galaxyGlsl), for tests and
 * for the numbers in the docs.
 */


/** Metres in a kiloparsec. */
export const KPC_METER = 3.085677581491367e19
/** The Sun's distance from the centre, kpc (Reid et al. 2019: 8.15 ± 0.15). */
export const SUN_R_KPC = 8.15
/** The Sun's height over the disc's mid-plane, kpc (Bennett & Bovy 2019: 20.8 ± 0.3 pc). */
export const SUN_Z_KPC = 0.0208
/** The Sun in G, kpc. */
export const SUN_G = Object.freeze([-SUN_R_KPC, SUN_Z_KPC, 0])
/**
 * The Galaxy's total luminosity, V band, L_sun: M_V ≈ -20.9 (Bland-Hawthorn
 * & Gerhard 2016's review; Licquia, Newman & Bershady 2016 put the Milky
 * Way on the spiral scaling relations at about this).
 */
export const L_TOTAL_LSUN = 2.5e10
/**
 * The light's split between the components.  The bulge and bar are a
 * quarter of it (by mass about a third, Bland-Hawthorn & Gerhard 2016; old
 * stars have more mass per light), the thick disc about 6% of the thin
 * disc's light at the Sun (12% by mass, Jurić et al. 2008), the young
 * population and the HII regions the arms' blue and pink.
 */
export const FRACTIONS = Object.freeze({bulge: 0.2, bar: 0.05, thin: 0.48, thick: 0.07, young: 0.18, hii: 0.02})

/** Thin disc (Jurić et al. 2008): scale length and height, kpc, and its central deficit. */
export const THIN = Object.freeze({hR: 2.6, hz: 0.3, holeR: 3.0, holeDepth: 0.9})
/** Thick disc (Jurić et al. 2008). */
export const THICK = Object.freeze({hR: 3.6, hz: 0.9})
/**
 * The arms' young stars, up to a few hundred Myr (OB associations, open
 * clusters, B and A dwarfs): the gas disc's scale length, and a layer
 * about as thick as the dust's (A dwarfs' scale height is 0.1-0.15 kpc,
 * Bovy 2017).  Thinner than the dust, the young stars' light filled the
 * edge-on disc's dust lane with a bright line, which a real edge-on disc
 * doesn't show.
 */
export const YOUNG = Object.freeze({hR: 3.5, hz: 0.14})
/** HII regions: thinner, in the dust (an Hα layer of about 0.1 kpc). */
export const HII = Object.freeze({hz: 0.09})
/**
 * The flare: past R, every scale height grows as exp((R' - R) / L)
 * (López-Corredoira et al. 2002; Momany et al. 2006: the thin disc's
 * doubles by 15-16 kpc).
 */
export const FLARE = Object.freeze({R: 9.5, L: 9.0})
/**
 * The warp: the mid-plane rises by a·(R' - R)^b·sin(β - φ) past R (the
 * classical Cepheids' warp, Chen et al. 2019: north toward l ≈ 90°, about a
 * kiloparsec by 15 kpc, its line of nodes near the Sun's azimuth).
 */
export const WARP = Object.freeze({R: 9.5, a: 0.12, b: 1.33, phiDeg: 17.5})
/**
 * Bulge and bar.  The boxy bulge is exp(-r_s) with r_s⁴ = ((x/x0)² +
 * (y/y0)²)² + (z/z0)⁴ in the bar's frame (the boxy form of Dwek et al.
 * 1995's models; scales as Rattenbury et al. 2007's fit, kpc).  The long
 * bar (Wegg, Gerhard & Portail 2015): half-length 5 kpc, a thin layer
 * (scale height 0.18 kpc), at 27° to the Sun → centre line (their 28-33°,
 * Bland-Hawthorn & Gerhard 2016's 27 ± 2°), its near end at positive
 * longitudes.  `n` is the bulge's profile index, exp(-r_s^(1/n)): 1 here.
 */
export const BAR = Object.freeze({angleDeg: 27, halfLength: 5.0, end: 0.3, x0: 1.25, y0: 0.6, z0: 0.45,
  width: 0.4, hz: 0.18, scale: 3.0, n: 1})

/**
 * The arms: four major arms and the Local arm, logarithmic spirals
 * ln(R / r0) = -β·tan ψ, r0 the radius where each crosses the Sun → centre
 * line (β = 0).  r0 is Reid et al. (2019)'s fit for each arm evaluated
 * there (Scutum-Centaurus 5.43, Sagittarius-Carina 6.87, Perseus 10.07 kpc,
 * the Local arm 8.53; the Norma-Outer arm 3.81, between their Norma (4.44)
 * and Outer (12.44 one turn on) segments); the pitch is 12° for the four
 * (Reid et al.'s segments run 7-20°, Vallée 2017's mean is 13°), 11.4° for
 * the Local arm.  Scutum-Centaurus and Perseus are the two arms the old
 * stars show (Benjamin et al. 2005, Churchwell et al. 2009): they alone
 * modulate the old disc, and they start at the bar's ends.  The Local arm is
 * a spur, over the azimuths Reid et al. trace it and a little further.
 */
export const ARMS = Object.freeze([
  Object.freeze({name: 'Norma-Outer', r0: 3.81, pitchDeg: 12, amp: 0.8, rStart: 3.2, old: 0}),
  Object.freeze({name: 'Scutum-Centaurus', r0: 5.43, pitchDeg: 12, amp: 1.0, rStart: 4.4, old: 1}),
  Object.freeze({name: 'Sagittarius-Carina', r0: 6.87, pitchDeg: 12, amp: 0.8, rStart: 3.6, old: 0}),
  Object.freeze({name: 'Perseus', r0: 10.07, pitchDeg: 12, amp: 1.0, rStart: 4.4, old: 1}),
  Object.freeze({name: 'Local', r0: 8.53, pitchDeg: 11.4, amp: 0.45, rStart: 0, betaDeg: [-35, 60], old: 0}),
])
/** Where every arm fades out, kpc. */
export const ARM_OUTER = Object.freeze([13, 19])
/** An arm's young population's half-width (Gaussian σ), kpc: a + b·R, wider outward (Reid et al. 2014). */
export const ARM_SIGMA = Object.freeze({a: 0.15, b: 0.03})

/**
 * Dust (Drimmel & Spergel 2001's dust disc: scale height 0.134 kpc, scale
 * length 0.28 R_sun), with a central deficit, A_V of 1 mag/kpc in the
 * mid-plane at the Sun's radius on average round the ring (the classic
 * figure), reddening by Cardelli et al. 1989's ratios (A_R : A_V : A_B ≈
 * 0.75 : 1 : 1.32), and none inside the Local Bubble (Lallement et al.
 * 2014: the Sun sits in a cavity ~100-200 pc across).
 */
export const DUST = Object.freeze({hR: 3.5, hz: 0.134, holeR: 4.0, avPerKpc: 1.0, rgb: Object.freeze([0.75, 1.0, 1.32]),
  bubble: Object.freeze([0.05, 0.16])})

/**
 * The nearby dark clouds that make the Great Rift and the other naked-eye
 * dark lanes: (l, b) degrees, distance kpc, size (Gaussian σ) kpc in the
 * plane and across it, peak A_V through the centre.  Approximate positions
 * and sizes, from the CO survey (Dame et al. 2001) and 3D dust maps
 * (Lallement et al. 2019).  Each is a Gaussian along each ray, its column
 * spread over the march's steps (cloudOverStep).
 *
 * #186 tightened the Great Rift's clouds: the first cut's Gaussians had
 * tails over the star clouds the naked eye sees between them, the Aquila
 * Rift's (σ 15° by 8°) and Serpens-Scutum's over the Scutum cloud, and the
 * Pipe's over Baade's window, where they added 1.9 mag of the window's 3.8
 * (measured: 1.5-2).  They now cover the rift (Dame et al. 2001's CO puts
 * the Aquila Rift at l = 20-40°, b = 0-10°), and a Vulpecula segment
 * carries the rift from Aquila to Cygnus, where the first cut had a gap.
 */
export const CLOUDS = Object.freeze([
  Object.freeze({name: 'Aquila Rift', l: 30, b: 5, d: 0.22, sigma: 0.045, sigmaY: 0.015, av: 3}),
  Object.freeze({name: 'Serpens-Scutum', l: 16, b: 3, d: 0.45, sigma: 0.06, sigmaY: 0.025, av: 2.5}),
  Object.freeze({name: 'Vulpecula Rift', l: 55, b: 1, d: 0.4, sigma: 0.06, sigmaY: 0.02, av: 2}),
  Object.freeze({name: 'Cygnus Rift', l: 75, b: 1, d: 0.8, sigma: 0.08, sigmaY: 0.04, av: 3.5}),
  Object.freeze({name: 'Ophiuchus-Pipe', l: 358, b: 10, d: 0.135, sigma: 0.012, sigmaY: 0.012, av: 3}),
  Object.freeze({name: 'Coalsack', l: 301, b: -1, d: 0.18, sigma: 0.012, sigmaY: 0.012, av: 2}),
  Object.freeze({name: 'Taurus', l: 172, b: -15, d: 0.14, sigma: 0.03, sigmaY: 0.02, av: 2.5}),
  Object.freeze({name: 'Orion', l: 209, b: -19, d: 0.4, sigma: 0.05, sigmaY: 0.03, av: 2}),
])

/** The baked in-plane map: texels a side, and its half-width, kpc. */
export const MAP = Object.freeze({size: 1024, halfKpc: 20})
/** The volume the light is integrated over, kpc: |x|, |z| ≤ r and |y| ≤ y. */
export const BOUNDS = Object.freeze({r: 20, y: 5})

/**
 * Each component's colour per unit of luminosity, in stored values
 * (HDR.md), normalised to luma 1: the old disc warm white, the bulge, bar
 * and thick disc older and warmer, the young arms blue, HII regions pink
 * (Hα with Hβ and [OIII]).
 */
export const COLORS = Object.freeze({
  old: unitLuma([1.0, 0.86, 0.7]),
  bulge: unitLuma([1.0, 0.8, 0.6]),
  young: unitLuma([0.56, 0.72, 1.0]),
  hii: unitLuma([1.0, 0.42, 0.6]),
})

/**
 * Exposure units at Earth's keyed exposure for a column of 1 L_sun per
 * kpc² (a surface brightness integrated along the line of sight): a
 * radiance L is DISPLAY_GAIN·π·L / E_sun(1 AU) (HDR.md, "Physical stars"),
 * and a column Σ of solar luminosities radiates Σ·L_sun / 4π per
 * steradian, against the Sun's L_sun / (4π AU²) at 1 AU: so
 * DISPLAY_GAIN·π·(AU / kpc)².  1 L_sun/pc² (26.4 mag/arcsec² in V) is
 * 1.1e-10.
 */
export const VALUE_PER_LSUN_KPC2 = DISPLAY_GAIN * Math.PI * ((ASTRO_UNIT_METER / KPC_METER) ** 2)

/**
 * The march's stored scale: the radiance is held in its render target
 * times this, so a half float keeps it (the galaxy's values are 1e-12 to
 * 1e-6 at Earth's keyed exposure, under half-float's smallest normal).
 */
export const STORE_SCALE = 1e8

/**
 * The march's steps (galaxyGlsl, integrateRay): along the plane at most
 * max(PLANE, the segment over PLANE_STEPS) kpc, across it at most
 * max(VERT_MIN, VERT_FRACTION × the height over the mid-plane) of height,
 * and at most MAX of them.
 */
export const STEPS = Object.freeze({PLANE: 0.25, PLANE_STEPS: 96, VERT_MIN: 0.02, VERT_FRACTION: 0.3, MAX: 192})

/**
 * The spiral recipe's constants (bakeMapSteps), the Milky Way's: the old
 * disc's floor between the arms and its modulation by an arm (a stellar
 * arm's and another's), that modulation's width over the young stars'; the
 * young stars' faint floor between the arms and the radii it spans; the
 * dust's floor, its lanes (offset in and width, in σ, and strength), the
 * gas of the arm itself; the HII glow along the arms; and the clumping
 * (its largest scale, kpc, and contrast).
 */
export const SPIRAL_RECIPE = Object.freeze({
  oldFloor: 0.75, oldArm: Object.freeze([0.2, 0.6]), oldWidth: 1.8,
  youngFloor: 0.06, youngFloorR: Object.freeze([2.5, 4, 14, 20]),
  dustFloor: 0.3, laneOffset: 0.8, laneWidth: 0.5, laneAmp: 1.6, armDust: 0.5,
  hiiGlow: 0.08, hiiWidth: 0.6,
  clumpKpc: 3, clumpFloor: 0.25, clumpContrast: 1.6,
})


/**
 * @param {Array<number>} rgb
 * @returns {Array<number>} rgb scaled to luma 1
 */
export function unitLuma(rgb) {
  const luma = (0.2126 * rgb[0]) + (0.7152 * rgb[1]) + (0.0722 * rgb[2])
  return Object.freeze(rgb.map((v) => v / luma))
}


/**
 * The Milky Way as a spec: the constants above.  Its map recipe is
 * 'spiral', with the bar's dust lanes, the named clouds, the Local Bubble
 * and the share the star catalogue resolves round the Sun.
 */
export const MILKY_WAY = Object.freeze({
  name: 'Milky Way',
  L: L_TOTAL_LSUN,
  fractions: FRACTIONS,
  thin: THIN,
  thick: THICK,
  young: YOUNG,
  hii: HII,
  flare: FLARE,
  warp: WARP,
  bar: BAR,
  arms: ARMS,
  armOuter: ARM_OUTER,
  armSigma: ARM_SIGMA,
  dust: Object.freeze({...DUST, normR: SUN_R_KPC, kappa: DUST.avPerKpc / (2.5 * Math.LOG10E)}),
  colors: COLORS,
  map: MAP,
  bounds: BOUNDS,
  steps: STEPS,
  recipe: SPIRAL_RECIPE,
  knots: Object.freeze({count: 700, r: Object.freeze([3, 16]), seed: 99}),
  clumpSeed: 17,
  barLanes: true,
  milkyWay: true,
})


const DEG = Math.PI / 180


/**
 * @param {number} lo
 * @param {number} hi
 * @param {number} x
 * @returns {number}
 */
function smoothstep(lo, hi, x) {
  const t = Math.min(Math.max((x - lo) / (hi - lo), 0), 1)
  return t * t * (3 - (2 * t))
}


/**
 * @param {number} x kpc
 * @param {number} z kpc
 * @returns {number} The azimuth β, radians, -π to π
 */
export function azimuth(x, z) {
  return Math.atan2(z, -x)
}


/**
 * @param {number} x kpc
 * @param {number} z kpc
 * @param {?object} [warp] The spec's warp (WARP); none, 0
 * @returns {number} The warped mid-plane's height, kpc
 */
export function warpHeight(x, z, warp = WARP) {
  if (!warp) {
    return 0
  }
  const r = Math.hypot(x, z)
  if (!(r > warp.R)) {
    return 0
  }
  // sin(β - φ) from sin β = z/R, cos β = -x/R.
  const phi = warp.phiDeg * DEG
  const sinBetaMinusPhi = ((z / r) * Math.cos(phi)) + ((x / r) * Math.sin(phi))
  return warp.a * Math.pow(r - warp.R, warp.b) * sinBetaMinusPhi
}


/**
 * @param {number} r Radius, kpc
 * @param {?object} [fl] The spec's flare (FLARE); none, 1
 * @returns {number} The flare's factor on every scale height
 */
export function flare(r, fl = FLARE) {
  return fl ? Math.exp(Math.max(r - fl.R, 0) / fl.L) : 1
}


/**
 * The signed distance across an arm, kpc: positive outward of it (larger
 * radius at the same azimuth), from its nearest winding.
 *
 * @param {object} arm One of a spec's arms
 * @param {number} r Radius, kpc
 * @param {number} beta Azimuth, radians
 * @returns {number}
 */
export function armOffset(arm, r, beta) {
  const {tanPsi, cosPsi, period, lnR0} = armTrig(arm)
  let u = Math.log(r) - lnR0 + (beta * tanPsi)
  if (!arm.betaDeg) {
    u -= period * Math.round(u / period)
  }
  return r * (1 - Math.exp(-u)) * cosPsi
}


const ARM_TRIG = new Map()


/**
 * @param {object} arm One of a spec's arms
 * @returns {{tanPsi: number, cosPsi: number, period: number, lnR0: number}} Its pitch's tangent and cosine,
 *   ln-radius period, and ln r0
 */
function armTrig(arm) {
  let trig = ARM_TRIG.get(arm)
  if (!trig) {
    const tanPsi = Math.tan(arm.pitchDeg * DEG)
    trig = {tanPsi, cosPsi: Math.cos(arm.pitchDeg * DEG), period: 2 * Math.PI * tanPsi, lnR0: Math.log(arm.r0)}
    ARM_TRIG.set(arm, trig)
  }
  return trig
}


/**
 * @param {object} arm One of a spec's arms
 * @param {number} r Radius, kpc
 * @param {number} beta Azimuth, radians
 * @param {Array<number>} [outer] Where the arms fade out (ARM_OUTER)
 * @returns {number} The arm's strength there, 0 to 1: its radial extent, and a spur's azimuths
 */
export function armEnvelope(arm, r, beta, outer = ARM_OUTER) {
  let env = smoothstep(arm.rStart, arm.rStart + (arm.rRise ?? 1.2), r) * (1 - smoothstep(outer[0], outer[1], r))
  if (arm.betaDeg) {
    const [lo, hi] = arm.betaDeg
    const b = beta / DEG
    env *= smoothstep(lo - 15, lo, b) * (1 - smoothstep(hi, hi + 15, b))
  }
  return env
}


/**
 * @param {number} r Radius, kpc
 * @param {object} [s] The spec's armSigma (ARM_SIGMA)
 * @returns {number} An arm's young population's half-width (Gaussian σ), kpc: wider outward (Reid et al. 2014)
 */
export function armSigma(r, s = ARM_SIGMA) {
  return s.a + (s.b * r)
}


const BAR_TRIG = new Map()


/**
 * @param {object} bar A spec's bar
 * @returns {{u: Array<number>, v: Array<number>}} Its long axis (toward the near end, for the Milky Way's)
 *   and its across axis, in the plane's (x, z)
 */
function barTrig(bar) {
  let trig = BAR_TRIG.get(bar)
  if (!trig) {
    trig = {
      u: [-Math.cos(bar.angleDeg * DEG), Math.sin(bar.angleDeg * DEG)],
      v: [Math.sin(bar.angleDeg * DEG), Math.cos(bar.angleDeg * DEG)],
    }
    BAR_TRIG.set(bar, trig)
  }
  return trig
}


/**
 * @param {number} x kpc
 * @param {number} z kpc
 * @param {object} [bar] The spec's bar (BAR)
 * @returns {{xb: number, zb: number}} In the bar's frame: along it (+ the near end) and across it (+ the leading side at the near end)
 */
export function barFrame(x, z, bar = BAR) {
  // The near end at β = angle: R·(-cos β, sin β); across it, toward growing β.
  const {u, v} = barTrig(bar)
  return {xb: (x * u[0]) + (z * u[1]), zb: (x * v[0]) + (z * v[1])}
}


// ---- The map ---------------------------------------------------------------

/**
 * A seeded PRNG (mulberry32): the map is the same on every load.
 *
 * @param {number} seed
 * @returns {function(): number} Uniform in [0, 1)
 */
export function prng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}


/**
 * @param {number} i
 * @param {number} j
 * @param {number} seed
 * @returns {number} A lattice value in [0, 1)
 */
function hash2(i, j, seed) {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(seed, 2147483647)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}


/**
 * @param {number} x
 * @param {number} z
 * @param {number} seed
 * @returns {number} Value noise, 0 to 1
 */
export function valueNoise(x, z, seed) {
  const i = Math.floor(x)
  const j = Math.floor(z)
  const fx = x - i
  const fz = z - j
  const sx = fx * fx * (3 - (2 * fx))
  const sz = fz * fz * (3 - (2 * fz))
  const a = hash2(i, j, seed)
  const b = hash2(i + 1, j, seed)
  const c = hash2(i, j + 1, seed)
  const d = hash2(i + 1, j + 1, seed)
  return (a + ((b - a) * sx)) + (((c + ((d - c) * sx)) - (a + ((b - a) * sx))) * sz)
}


/**
 * @param {number} x kpc
 * @param {number} z kpc
 * @param {number} [largest] The largest scale, kpc
 * @param {number} [seed]
 * @returns {number} Fractal noise, about 0 to 1: dust clumps from `largest` down to a fifteenth of it
 */
export function clumps(x, z, largest = 3, seed = 17) {
  let sum = 0
  let norm = 0
  let amp = 1
  let freq = 1 / largest
  for (let o = 0; o < 5; o++) {
    sum += amp * valueNoise(x * freq, z * freq, seed + o)
    norm += amp
    amp *= 0.6
    freq *= 2
  }
  return sum / norm
}


/**
 * @param {number} q The exponent, x² / 2σ²
 * @returns {number} exp(-q), and 0 past 30 (under 1e-13), without the exp
 */
function gaussian(q) {
  return q > 30 ? 0 : Math.exp(-q)
}


/**
 * The in-plane map: four channels over size² texels spanning ±halfKpc in x
 * and z, each O(1), the radial profiles left to the shader:
 *
 * - 0, old: the old disc's modulation by the arms (the stellar arms most)
 *   and by a measured profile's departure from the exponential;
 * - 1, young: the arms' young population (or an irregular's clumps), with
 *   a faint floor between them and a blue cluster at each knot;
 * - 2, dust: the dust's modulation: lanes on the arms' inner edges and the
 *   bar's leading sides, clumped;
 * - 3, hii: HII regions, knots on the arms' outer edges, and a faint
 *   diffuse glow along the arms.
 *
 * Stored square-root encoded in bytes (value = (byte / 255)² × scale), for
 * resolution at the faint end, as the shader decodes it.
 *
 * @param {number} [size]
 * @param {object} [spec] MILKY_WAY by default
 * @returns {{size: number, halfKpc: number, data: Uint8Array, scale: Array<number>, linear: Array<Float32Array>}}
 */
export function bakeMap(size = MAP.size, spec = MILKY_WAY) {
  const steps = bakeMapSteps(size, spec)
  let next = steps.next()
  while (!next.done) {
    next = steps.next()
  }
  return next.value
}


/** Rows of the map baked between yields (bakeMapSteps). */
export const BAKE_ROWS_PER_STEP = 32


/**
 * bakeMap, as a generator that yields every BAKE_ROWS_PER_STEP rows and
 * returns the map, so the page can bake it between frames (MilkyWay.js):
 * about 1.5 s of arithmetic at 1024², which shouldn't block a frame.
 *
 * The spec's recipe (`spec.recipe`, SPIRAL_RECIPE's keys) sets the arms'
 * contrasts; a spec may add a measured radial profile (`profileRatio`, its
 * departure from the exponential the shader draws), a lopsided old disc
 * (`lopsided`: an m = 1 mode), arms broken into segments (`flocculent`),
 * and star-forming clumps in place of arms (`clumpsSF`).  The Milky Way
 * has none of those.
 *
 * @param {number} [size]
 * @param {object} [spec] MILKY_WAY by default
 * @yields {number} The share of the rows done
 * @returns {object} bakeMap's
 */
export function* bakeMapSteps(size = MAP.size, spec = MILKY_WAY) {
  const half = spec.map.halfKpc
  const n = size * size
  const old = new Float32Array(n)
  const young = new Float32Array(n)
  const dust = new Float32Array(n)
  const hii = new Float32Array(n)
  const texel = 2 * half / size
  const arms = spec.arms
  const trig = arms.map(armTrig)
  const rc = spec.recipe
  const [yf0, yf1, yf2, yf3] = rc.youngFloorR
  const bar = spec.bar
  const barScale = bar.halfLength / 5
  const flocculent = spec.flocculent ?? null
  const lopsided = spec.lopsided ?? null
  const profile = spec.profileRatio ?? null
  for (let j = 0; j < size; j++) {
    const z = ((j + 0.5) * texel) - half
    for (let i = 0; i < size; i++) {
      const x = ((i + 0.5) * texel) - half
      const r = Math.max(Math.hypot(x, z), 1e-6)
      const beta = azimuth(x, z)
      const lnR = Math.log(r)
      const sigma = armSigma(r, spec.armSigma)
      // 1 / (2σ²) for the arm's young stars; the other profiles are wider or narrower by a fixed factor.
      const inv = 1 / (2 * sigma * sigma)
      let o = rc.oldFloor
      let y = rc.youngFloor * smoothstep(yf0, yf1, r) * (1 - smoothstep(yf2, yf3, r))
      let d = rc.dustFloor
      let h = 0
      for (let a = 0; a < arms.length; a++) {
        const arm = arms[a]
        let env = armEnvelope(arm, r, beta, spec.armOuter) * arm.amp
        if (!(env > 0)) {
          continue
        }
        const {tanPsi, cosPsi, period, lnR0} = trig[a]
        let u = lnR - lnR0 + (beta * tanPsi)
        if (!arm.betaDeg) {
          u -= period * Math.round(u / period)
        }
        if (flocculent) {
          // Segments along the arm: noise in the arm's own coordinate
          // (ln R, nearly its length), each arm its own.
          env *= smoothstep(flocculent.cut, flocculent.cut + 0.25,
              valueNoise(lnR * flocculent.perLnR, a * 7.31, spec.clumpSeed + 40))
        }
        const off = r * (1 - Math.exp(-u)) * cosPsi
        const q = off * off * inv
        const profileA = gaussian(q)
        y += env * profileA
        o += (arm.old ? rc.oldArm[1] : rc.oldArm[0]) * env * gaussian(q / (rc.oldWidth * rc.oldWidth))
        // Lanes on the inner (concave, upstream) edge; the gas of the arm itself.
        const lane = off + (rc.laneOffset * sigma)
        d += env * ((rc.laneAmp * gaussian(lane * lane * inv / (rc.laneWidth * rc.laneWidth))) + (rc.armDust * profileA))
        h += rc.hiiGlow * env * gaussian(q / (rc.hiiWidth * rc.hiiWidth))
      }
      // The bar's dust lanes, on its leading sides, point-symmetric.
      if (spec.barLanes) {
        const {xb, zb} = barFrame(x, z, bar)
        const along = Math.abs(xb)
        if (along > 0.4 * barScale && along < 5 * barScale) {
          const center = Math.sign(xb) * ((0.3 * barScale) + (0.06 * along))
          const w = 0.2 * barScale
          const k = smoothstep(0.4 * barScale, 1.0 * barScale, along) * (1 - smoothstep(4.0 * barScale, 5.0 * barScale, along))
          d += 1.6 * k * Math.exp(-((zb - center) ** 2) / (2 * w * w))
        }
      }
      const c = clumps(x, z, rc.clumpKpc, spec.clumpSeed)
      d *= rc.clumpFloor + (rc.clumpContrast * c * c)
      if (lopsided) {
        o *= 1 + (lopsided.a1 * smoothstep(0, lopsided.r, r) * Math.cos(beta - lopsided.phi))
      }
      if (profile) {
        o *= profile(r)
      }
      const idx = (j * size) + i
      old[idx] = o
      young[idx] = y
      dust[idx] = d
      hii[idx] = h
    }
    if ((j + 1) % BAKE_ROWS_PER_STEP === 0) {
      yield (j + 1) / size
    }
  }
  if (spec.clumpsSF) {
    stampClumps(young, hii, dust, size, half, spec)
  }
  stampKnots(young, hii, size, half, spec)
  const linear = [old, young, dust, hii]
  const scale = linear.map((ch) => {
    let max = 0
    for (let k = 0; k < n; k++) {
      max = Math.max(max, ch[k])
    }
    return max > 0 ? max : 1
  })
  const data = new Uint8Array(n * 4)
  for (let k = 0; k < n; k++) {
    for (let c = 0; c < 4; c++) {
      data[(k * 4) + c] = Math.round(Math.sqrt(Math.max(linear[c][k], 0) / scale[c]) * 255)
    }
  }
  return {size, halfKpc: half, data, scale, linear}
}


/**
 * HII regions along the arms, just outward of each arm's centre (downstream
 * of its dust lane), with a young cluster at each: the spec's knots.count
 * of them, sizes 30-90 pc (σ), brightnesses log-normal.  An armless
 * galaxy's (an S0's, an irregular's) are stampClumps' instead.
 *
 * @param {Float32Array} young
 * @param {Float32Array} hii
 * @param {number} size
 * @param {number} half
 * @param {object} spec
 */
function stampKnots(young, hii, size, half, spec) {
  const arms = spec.arms
  if (arms.length === 0 || !(spec.knots.count > 0)) {
    return
  }
  const rand = prng(spec.knots.seed)
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-12))) * Math.cos(2 * Math.PI * rand())
  const weights = arms.map((arm) => arm.amp * (arm.betaDeg ? 0.5 : 1))
  const total = weights.reduce((a, b) => a + b, 0)
  const texel = 2 * half / size
  const [rLo, rHi] = spec.knots.r
  const count = spec.knots.count
  let placed = 0
  for (let tries = 0; placed < count && tries < count * 50; tries++) {
    let pick = rand() * total
    let a = 0
    while (a < arms.length - 1 && pick > weights[a]) {
      pick -= weights[a]
      a++
    }
    const arm = arms[a]
    const r = rLo + (rand() * (rHi - rLo))
    const tanPsi = Math.tan(arm.pitchDeg * DEG)
    let beta = -Math.log(r / arm.r0) / tanPsi
    beta = Math.atan2(Math.sin(beta), Math.cos(beta))
    const weight = armEnvelope(arm, r, beta, spec.armOuter) * Math.exp(-(r - rLo) / spec.young.hR)
    if (rand() > weight) {
      continue
    }
    const sigma = armSigma(r, spec.armSigma)
    const off = (0.25 * sigma) + (0.45 * sigma * gauss())
    const rr = r + (off / Math.cos(arm.pitchDeg * DEG))
    stampKnot(young, hii, size, half, texel, -rr * Math.cos(beta), rr * Math.sin(beta), 0.03 + (0.06 * rand()),
        Math.exp(0.8 * gauss()))
    placed++
  }
}


/**
 * One HII region and its cluster, a Gaussian of σ ks kpc at (kx, kz).
 *
 * @param {Float32Array} young
 * @param {Float32Array} hii
 * @param {number} size
 * @param {number} half
 * @param {number} texel
 * @param {number} kx
 * @param {number} kz
 * @param {number} ks
 * @param {number} amp
 */
function stampKnot(young, hii, size, half, texel, kx, kz, ks, amp) {
  const reach = Math.ceil((3 * 1.5 * ks) / texel)
  const ci = Math.floor((kx + half) / texel)
  const cj = Math.floor((kz + half) / texel)
  for (let j = Math.max(cj - reach, 0); j <= Math.min(cj + reach, size - 1); j++) {
    const z = ((j + 0.5) * texel) - half
    for (let i = Math.max(ci - reach, 0); i <= Math.min(ci + reach, size - 1); i++) {
      const x = ((i + 0.5) * texel) - half
      const d2 = ((x - kx) ** 2) + ((z - kz) ** 2)
      const idx = (j * size) + i
      hii[idx] += amp * Math.exp(-d2 / (2 * ks * ks))
      young[idx] += 0.5 * amp * Math.exp(-d2 / (2 * 2.25 * ks * ks))
    }
  }
}


/**
 * Star formation in clumps, for a galaxy without arms (an irregular, a
 * blue compact dwarf): the spec's clumpsSF.count complexes, each a group
 * of knots round a centre, placed by the young disc's profile about an
 * offset centre (`offset`, kpc: the off-centre star formation of
 * irregulars), their dust with them.
 *
 * @param {Float32Array} young
 * @param {Float32Array} hii
 * @param {Float32Array} dust
 * @param {number} size
 * @param {number} half
 * @param {object} spec
 */
function stampClumps(young, hii, dust, size, half, spec) {
  const sf = spec.clumpsSF
  const rand = prng(spec.knots.seed + 1)
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-12))) * Math.cos(2 * Math.PI * rand())
  const texel = 2 * half / size
  for (let c = 0; c < sf.count; c++) {
    // Radius from the exponential's area distribution, r·e^(-r/h): the sum of two exponentials.
    const r = -sf.hR * (Math.log(Math.max(rand(), 1e-9)) + Math.log(Math.max(rand(), 1e-9)))
    const phi = 2 * Math.PI * rand()
    const cx = sf.offset[0] + (r * Math.cos(phi))
    const cz = sf.offset[1] + (r * Math.sin(phi))
    const knots = 2 + Math.floor(rand() * sf.knotsPer)
    const spread = sf.size * (0.5 + rand())
    const amp = Math.exp(0.8 * gauss())
    for (let k = 0; k < knots; k++) {
      const kx = cx + (spread * gauss())
      const kz = cz + (spread * gauss())
      stampKnot(young, hii, size, half, texel, kx, kz, 0.03 + (0.06 * rand()), amp * Math.exp(0.5 * gauss()))
    }
    // The complex's diffuse young light and its dust.
    const reach = Math.ceil((3 * spread) / texel)
    const ci = Math.floor((cx + half) / texel)
    const cj = Math.floor((cz + half) / texel)
    for (let j = Math.max(cj - reach, 0); j <= Math.min(cj + reach, size - 1); j++) {
      const z = ((j + 0.5) * texel) - half
      for (let i = Math.max(ci - reach, 0); i <= Math.min(ci + reach, size - 1); i++) {
        const x = ((i + 0.5) * texel) - half
        const g = Math.exp(-(((x - cx) ** 2) + ((z - cz) ** 2)) / (2 * spread * spread))
        const idx = (j * size) + i
        young[idx] += sf.diffuse * amp * g
        dust[idx] += sf.dust * amp * g
      }
    }
  }
}


/**
 * The map at (x, z), as the GPU samples it: bilinear between texel centres,
 * clamped at the edges, from the bytes, decoded.
 *
 * @param {object} map bakeMap's
 * @param {number} x kpc
 * @param {number} z kpc
 * @returns {Array<number>} [old, young, dust, hii]
 */
export function sampleMap(map, x, z) {
  const {size, halfKpc, data, scale} = map
  const fx = Math.min(Math.max((((x + halfKpc) / (2 * halfKpc)) * size) - 0.5, 0), size - 1)
  const fz = Math.min(Math.max((((z + halfKpc) / (2 * halfKpc)) * size) - 0.5, 0), size - 1)
  const i0 = Math.floor(fx)
  const j0 = Math.floor(fz)
  const i1 = Math.min(i0 + 1, size - 1)
  const j1 = Math.min(j0 + 1, size - 1)
  const tx = fx - i0
  const tz = fz - j0
  const out = [0, 0, 0, 0]
  for (let c = 0; c < 4; c++) {
    const at = (i, j) => data[(((j * size) + i) * 4) + c] / 255
    const v = ((1 - tz) * (((1 - tx) * at(i0, j0)) + (tx * at(i1, j0)))) + (tz * (((1 - tx) * at(i0, j1)) + (tx * at(i1, j1))))
    out[c] = v * v * scale[c]
  }
  return out
}


// ---- Normalisation ---------------------------------------------------------

/**
 * @param {number} r
 * @param {object} thin The spec's thin disc
 * @returns {number} The thin disc's central deficit
 */
function thinHole(r, thin) {
  return 1 - (thin.holeDepth * Math.exp(-((r / thin.holeR) ** 2)))
}


/**
 * @param {number} r
 * @param {object} dust The spec's dust
 * @returns {number} The dust disc's central deficit
 */
function dustHole(r, dust) {
  return dust.holeR > 0 ? 1 - Math.exp(-((r / dust.holeR) ** 2)) : 1
}


/**
 * @param {number} rs4 r_s⁴
 * @param {number} [n] The profile index: exp(-r_s^(1/n))
 * @returns {number} The boxy bulge's unnormalised density
 */
function bulgeShape(rs4, n = 1) {
  const rs = Math.sqrt(Math.sqrt(rs4))
  return n === 1 ? Math.exp(-rs) : Math.exp(-Math.pow(rs, 1 / n))
}


/**
 * @param {number} along |x| along the bar, kpc
 * @param {object} bar The spec's bar
 * @returns {number} The long bar's profile along its length
 */
function barLength(along, bar) {
  return Math.exp(-along / bar.scale) / (1 + Math.exp((along - bar.halfLength) / bar.end))
}


const BULGE_UNIT = new Map()


/**
 * ∫ exp(-r_s^(1/n)) dV for x0 = y0 = z0 = 1: ∫∫ 2πρ·2 dρ dw over the
 * boxy radius (ρ⁴ + w⁴)^¼.  For n = 1 by quadrature (the Milky Way's, as
 * it always was); the boxy radius's level sets are similar, so the integral
 * is a shape constant times ∫ f(r)·r² dr, which is 2 for n = 1 and
 * n·Γ(3n) for exp(-r^(1/n)).
 *
 * @param {number} n
 * @returns {number}
 */
export function bulgeUnitVolume(n = 1) {
  let unit = BULGE_UNIT.get(n)
  if (unit === undefined) {
    if (n === 1) {
      unit = 0
      const du = 0.02
      for (let rho = du / 2; rho < 30; rho += du) {
        for (let w = du / 2; w < 30; w += du) {
          unit += 2 * Math.PI * rho * 2 * bulgeShape((rho ** 4) + (w ** 4)) * du * du
        }
      }
    } else {
      unit = bulgeUnitVolume(1) / 2 * n * gamma(3 * n)
    }
    BULGE_UNIT.set(n, unit)
  }
  return unit
}


/**
 * Γ(x) for x > 0, by Lanczos's approximation (g = 7, nine terms; to about
 * 1e-15 relative).
 *
 * @param {number} x
 * @returns {number}
 */
export function gamma(x) {
  if (x < 0.5) {
    return Math.PI / (Math.sin(Math.PI * x) * gamma(1 - x))
  }
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7]
  const z = x - 1
  let a = c[0]
  const t = z + 7.5
  for (let i = 1; i < 9; i++) {
    a += c[i] / (z + i)
  }
  return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * a
}


/**
 * Each component's constant, L_sun per kpc³ per unit of its unnormalised
 * profile, so that it carries its share (spec.fractions) of spec.L within
 * spec.bounds: the discs' vertical profiles integrate to 1, so their
 * in-plane integrals over the map's texels (the map as sampled); the
 * bulge's and bar's by quadrature.  The dust's is set by spec.dust.kappa,
 * the extinction coefficient in V (per kpc) the mid-plane has on average
 * round the ring at spec.dust.normR.
 *
 * @param {object} map bakeMap's
 * @param {object} [spec] MILKY_WAY by default
 * @returns {{thin: number, thick: number, young: number, hii: number, bulge: number, bar: number, dust: number}}
 */
export function normalize(map, spec = MILKY_WAY) {
  const {size, halfKpc} = map
  const texel = 2 * halfKpc / size
  const area = texel * texel
  let thin = 0
  let thick = 0
  let young = 0
  let hii = 0
  let ringDust = 0
  let ringCount = 0
  const {data, scale} = map
  const yMax = spec.bounds.y
  const ringHalf = Math.max(0.25, texel)
  // At a texel's centre the GPU's bilinear sample is the texel itself.
  const decode = (k, c) => {
    const v = data[(k * 4) + c] / 255
    return v * v * scale[c]
  }
  for (let j = 0; j < size; j++) {
    const z = ((j + 0.5) * texel) - halfKpc
    for (let i = 0; i < size; i++) {
      const x = ((i + 0.5) * texel) - halfKpc
      const r = Math.hypot(x, z)
      const k = (j * size) + i
      const o = decode(k, 0)
      const y = decode(k, 1)
      const d = decode(k, 2)
      const h = decode(k, 3)
      // Each disc's light within the volume's height (bounds.y): the flare
      // and the warp take some of the thick disc's past it.
      const w = warpHeight(x, z, spec.warp)
      const fl = flare(r, spec.flare)
      const within = (hz) => 1 - (0.5 * (Math.exp(-(yMax - w) / (hz * fl)) + Math.exp(-(yMax + w) / (hz * fl))))
      thin += Math.exp(-r / spec.thin.hR) * thinHole(r, spec.thin) * o * area * within(spec.thin.hz)
      thick += Math.exp(-r / spec.thick.hR) * area * within(spec.thick.hz)
      young += Math.exp(-r / spec.young.hR) * y * area * within(spec.young.hz)
      hii += h * area * within(spec.hii.hz)
      if (Math.abs(r - spec.dust.normR) < ringHalf) {
        ringDust += d
        ringCount++
      }
    }
  }
  const bar = spec.bar
  // The bulge: ∫ exp(-r_s^(1/n)) dV = x0·y0·z0 × the unit's, boxy or an
  // ellipsoid's (4π·n·Γ(3n)).
  const bulge = bar.x0 * bar.y0 * bar.z0 *
    (bar.boxy === false ? 4 * Math.PI * (bar.n ?? 1) * gamma(3 * (bar.n ?? 1)) : bulgeUnitVolume(bar.n ?? 1))
  // The long bar: separable, exp(-|across| / width)·exp(-|y| / hz)·barLength(|along|).
  let length = 0
  const dx = 0.005 * Math.max(1, bar.halfLength / 5)
  for (let a = dx / 2; a < Math.max(12, 2.4 * bar.halfLength); a += dx) {
    length += 2 * barLength(a, bar) * dx
  }
  const barVolume = length * (2 * bar.width) * (2 * bar.hz)
  const L = spec.L
  const fr = spec.fractions
  const meanDust = ringDust / Math.max(ringCount, 1)
  const share = (part, integral) => (part > 0 && integral > 0 ? L * part / integral : 0)
  return {
    thin: share(fr.thin, thin),
    thick: share(fr.thick, thick),
    young: share(fr.young, young),
    hii: share(fr.hii, hii),
    bulge: share(fr.bulge, bulge),
    bar: share(fr.bar, barVolume),
    dust: spec.dust.kappa > 0 ?
      spec.dust.kappa / (Math.exp(-spec.dust.normR / spec.dust.hR) * dustHole(spec.dust.normR, spec.dust) * meanDust) :
      0,
  }
}


let cached = null


/**
 * A galaxy's map and its normalisation, baked once for the Milky Way.
 *
 * @param {object} [spec] MILKY_WAY by default (cached); another is baked each call
 * @param {number} [size] The map's texels a side (MAP.size)
 * @returns {{map: object, norms: object, spec: object}}
 */
export function galaxyModel(spec = MILKY_WAY, size = MAP.size) {
  if (spec === MILKY_WAY && size === MAP.size) {
    if (!cached) {
      const map = bakeMap()
      cached = {map, norms: normalize(map), spec: MILKY_WAY}
    }
    return cached
  }
  const map = bakeMap(size, spec)
  return {map, norms: normalize(map, spec), spec}
}


// ---- The density -----------------------------------------------------------

/**
 * @param {number} y height over the mid-plane, kpc
 * @param {number} h scale height, kpc
 * @returns {number} The exponential vertical profile, integrating to 1
 */
function vertical(y, h) {
  return Math.exp(-Math.abs(y) / h) / (2 * h)
}


/**
 * The luminosity density and the dust at a point, as the shader computes
 * it.
 *
 * @param {object} model galaxyModel's
 * @param {number} x kpc
 * @param {number} y kpc
 * @param {number} z kpc
 * @returns {{thin: number, thick: number, young: number, hii: number, bulge: number, bar: number,
 *   rgb: Array<number>, kappa: number}} Each component's L_sun/kpc³, their colour sum, and the
 *   dust's extinction coefficient in V, per kpc
 */
export function density({map, norms, spec = MILKY_WAY}, x, y, z) {
  const r = Math.hypot(x, z)
  const [o, yo, d, h] = sampleMap(map, x, z)
  const yr = y - warpHeight(x, z, spec.warp)
  const fl = flare(r, spec.flare)
  const bar = spec.bar
  const thin = norms.thin * Math.exp(-r / spec.thin.hR) * thinHole(r, spec.thin) * o * vertical(yr, spec.thin.hz * fl)
  const thick = norms.thick * Math.exp(-r / spec.thick.hR) * vertical(yr, spec.thick.hz * fl)
  const young = norms.young * Math.exp(-r / spec.young.hR) * yo * vertical(yr, spec.young.hz * fl)
  const hii = norms.hii * h * vertical(yr, spec.hii.hz * fl)
  const {xb, zb} = barFrame(x, z, bar)
  let bulge
  if (bar.boxy === false) {
    // An ellipsoid's: a classical bulge or a pseudobulge (sparcGalaxy.js).
    const rs = Math.hypot(xb / bar.x0, zb / bar.y0, y / bar.z0)
    bulge = norms.bulge * Math.exp(-Math.pow(Math.max(rs, 1e-12), 1 / (bar.n ?? 1)))
  } else {
    const rs4 = ((((xb / bar.x0) ** 2) + ((zb / bar.y0) ** 2)) ** 2) + ((y / bar.z0) ** 4)
    bulge = norms.bulge * bulgeShape(rs4, bar.n ?? 1)
  }
  const barL = norms.bar * barLength(Math.abs(xb), bar) * Math.exp(-Math.abs(zb) / bar.width) *
    Math.exp(-Math.abs(y) / bar.hz)
  const colors = spec.colors
  const rgb = [0, 1, 2].map((c) => (thin * colors.old[c]) + ((thick + bulge + barL) * colors.bulge[c]) +
    (young * colors.young[c]) + (hii * colors.hii[c]))
  let kappa = norms.dust * Math.exp(-r / spec.dust.hR) * dustHole(r, spec.dust) * d *
    Math.exp(-Math.abs(yr) / (spec.dust.hz * fl))
  if (spec.milkyWay) {
    const toSun = Math.hypot(x - SUN_G[0], y - SUN_G[1], z - SUN_G[2])
    kappa *= smoothstep(DUST.bubble[0], DUST.bubble[1], toSun)
  }
  return {thin, thick, young, hii, bulge, bar: barL, rgb, kappa}
}


/**
 * A cloud's centre in G, kpc.
 *
 * @param {object} cloud One of CLOUDS
 * @returns {Array<number>}
 */
export function cloudCenter(cloud) {
  const l = cloud.l * DEG
  const b = cloud.b * DEG
  return [
    SUN_G[0] + (cloud.d * Math.cos(b) * Math.cos(l)),
    SUN_G[1] + (cloud.d * Math.sin(b)),
    SUN_G[2] + (cloud.d * Math.cos(b) * Math.sin(l)),
  ]
}


/**
 * The named clouds are the local instances of the dust's clumps (the map's
 * clumps stand for the rest of the disc's): they fade out between these
 * distances of the camera from the Sun, so from outside the galaxy the
 * Sun's neighbourhood isn't the one spot of the disc with resolved clouds.
 */
export const CLOUDS_NEAR_KPC = Object.freeze([2, 5])


/**
 * @param {Array<number>} o The camera, G kpc
 * @returns {number} How much of the named clouds to draw (CLOUDS_NEAR_KPC)
 */
function cloudsNear(o) {
  return 1 - smoothstep(CLOUDS_NEAR_KPC[0], CLOUDS_NEAR_KPC[1], Math.hypot(o[0] - SUN_G[0], o[1] - SUN_G[1], o[2] - SUN_G[2]))
}


/**
 * The light the star catalogue resolves (MilkyWay.md, "Double counting").
 * The catalogue's stars (stars.dat, Hipparcos-based, complete to about
 * magnitude 8) are drawn as points over this light, so near the Sun the
 * same light was counted twice: measured from the Sun, the catalogue holds
 * 0.9-1.0 of the model's emission within 200 pc, half at 250 pc, a third
 * at 350, a tenth at 700 and none past 1.5 kpc (its giants reach farther
 * than its dwarfs), which is 26% of the model's light in the plane and
 * 56% at the poles.  The march leaves out that share of the emission,
 * h(s) = 1 / (1 + (s / halfKpc)²) at a distance s from the Sun, so the
 * points and the diffuse light together make the measured integrated
 * starlight.  The form integrates in closed form over a step
 * (resolvedOverStep), so the march's quarter-kiloparsec steps in the
 * plane take it exactly.
 *
 * Only while the catalogue's light near the Sun shows as points: from
 * farther than `near` kpc (a giant at the Sun is under magnitude 6.5 from
 * 0.2-0.3 kpc) the stars are under the eye's limit, their light lost in
 * the tone map's toe, and the hole would read as a dark dimple round the
 * Sun; it fades out over `near` of the camera's distance from the Sun.
 */
export const RESOLVED = Object.freeze({halfKpc: 0.234, near: Object.freeze([0.1, 0.4])})


/**
 * @param {Array<number>} o The camera, G kpc
 * @returns {number} How much of the resolved light to leave out (RESOLVED)
 */
export function resolvedNear(o) {
  return 1 - smoothstep(RESOLVED.near[0], RESOLVED.near[1], Math.hypot(o[0] - SUN_G[0], o[1] - SUN_G[1], o[2] - SUN_G[2]))
}


/**
 * @param {number} s Distance from the Sun, kpc
 * @returns {number} The share of the model's emission there that the
 *   catalogue resolves (RESOLVED)
 */
export function resolvedFraction(s) {
  return 1 / (1 + ((s / RESOLVED.halfKpc) ** 2))
}


/**
 * The mean of resolvedFraction over a step of a ray: along a ray whose
 * closest approach to the Sun is b at t = tc, s² = b² + (t − tc)², so
 * the integral of 1 / (1 + s²/a²) is a²/c · atan((t − tc)/c), with c² =
 * a² + b².  The same arithmetic as the march's GLSL.
 *
 * @param {number} t0 The step's start along the ray, kpc
 * @param {number} ds Its length, kpc
 * @param {number} tc Where the ray passes closest to the Sun, kpc
 * @param {number} b2 That distance, squared, kpc²
 * @returns {number}
 */
export function resolvedOverStep(t0, ds, tc, b2) {
  const a2 = RESOLVED.halfKpc * RESOLVED.halfKpc
  const c = Math.sqrt(a2 + Math.max(b2, 0))
  if (!(ds > 1e-9)) {
    return resolvedFraction(Math.sqrt(Math.max(b2, 0) + ((t0 - tc) ** 2)))
  }
  return a2 / (c * ds) * (Math.atan((t0 + ds - tc) / c) - Math.atan((t0 - tc) / c))
}


/**
 * The share of a cloud's column, through its centre's closest approach,
 * that lies in a step of a ray: the Gaussian's mass along the ray between
 * the step's ends, a difference of its cumulative distribution.  The first
 * cut drew each cloud as a screen at its closest approach, all or nothing
 * as the step held it, so from a camera inside a cloud's reach (126 pc
 * from the Sun, 1.5σ from the Taurus cloud's centre) the rays whose closest
 * approach was behind the camera lost the cloud, and those ahead had its
 * whole column: a straight edge across the sky, along the great circle
 * where the closest approach is at the camera (the user's preview).  Here
 * only the part ahead of the camera counts, and the sky is smooth.
 *
 * @param {number} t0 The step's start along the ray
 * @param {number} ds Its length
 * @param {number} tc The cloud's closest approach along the ray
 * @param {number} width The cloud's σ along the ray, in the same units
 * @returns {number} 0 to 1
 */
export function cloudOverStep(t0, ds, tc, width) {
  return normalCdf((t0 + ds - tc) / width) - normalCdf((t0 - tc) / width)
}


/**
 * The standard normal distribution's cumulative, by Abramowitz & Stegun
 * 7.1.26's erf (to 1.5e-7), as the GLSL computes it.
 *
 * @param {number} x
 * @returns {number}
 */
export function normalCdf(x) {
  const z = Math.abs(x) / Math.SQRT2
  const k = 1 / (1 + (0.3275911 * z))
  const poly = k * (0.254829592 + (k * (-0.284496736 + (k * (1.421413741 + (k * (-1.453152027 + (k * 1.061405429))))))))
  const erf = 1 - (poly * Math.exp(-z * z))
  return 0.5 * (1 + (x < 0 ? -erf : erf))
}


/**
 * The ray's segment inside a spec's bounds.
 *
 * @param {Array<number>} o origin, kpc
 * @param {Array<number>} d direction, unit
 * @param {object} [bounds] The spec's (BOUNDS)
 * @returns {Array<number>|null} [t0, t1], t0 ≥ 0; null if it misses
 */
export function boundsSegment(o, d, bounds = BOUNDS) {
  const lim = [bounds.r, bounds.y, bounds.r]
  let t0 = 0
  let t1 = Infinity
  for (let k = 0; k < 3; k++) {
    if (Math.abs(d[k]) < 1e-12) {
      if (Math.abs(o[k]) > lim[k]) {
        return null
      }
      continue
    }
    const a = (-lim[k] - o[k]) / d[k]
    const b = (lim[k] - o[k]) / d[k]
    t0 = Math.max(t0, Math.min(a, b))
    t1 = Math.min(t1, Math.max(a, b))
  }
  return t1 > t0 ? [t0, t1] : null
}


/**
 * A galaxy's light along a ray, in exposure units at Earth's keyed
 * exposure (times the frame's exposureRelative on screen), as the shader
 * marches it: emission and extinction per step, and for the Milky Way each
 * cloud's column spread over the steps as its Gaussian along the ray
 * (cloudOverStep).
 *
 * @param {object} model galaxyModel's
 * @param {Array<number>} o origin, kpc in the galaxy's frame (G for the Milky Way)
 * @param {Array<number>} d direction, unit
 * @param {number} [jitter] the first step's offset, 0 to 1
 * @param {number} [resolved] How much of the catalogue's share to leave out
 *   (RESOLVED): resolvedNear the camera, as the shader does; 0 for the whole
 *   integrated light.  The Milky Way's only.
 * @returns {{rgb: Array<number>, steps: number, transmittance: Array<number>}}
 */
export function integrateRay(model, o, d, jitter = 0.5, resolved = undefined) {
  const spec = model.spec ?? MILKY_WAY
  const mw = Boolean(spec.milkyWay)
  const steps = spec.steps
  const seg = boundsSegment(o, d, spec.bounds)
  const out = {rgb: [0, 0, 0], steps: 0, transmittance: [1, 1, 1]}
  if (!seg) {
    return out
  }
  const [t0, t1] = seg
  const near = mw ? cloudsNear(o) : 0
  const clouds = !mw ? [] : CLOUDS.map((cloud) => {
    // The closest approach in the space where the cloud is round (y scaled by σ / σy).
    const c = cloudCenter(cloud)
    const k = cloud.sigma / cloud.sigmaY
    const rel = [c[0] - o[0], (c[1] - o[1]) * k, c[2] - o[2]]
    const ds = [d[0], d[1] * k, d[2]]
    const tc = ((rel[0] * ds[0]) + (rel[1] * ds[1]) + (rel[2] * ds[2])) / ((ds[0] ** 2) + (ds[1] ** 2) + (ds[2] ** 2))
    const b2 = ((rel[0] - (ds[0] * tc)) ** 2) + ((rel[1] - (ds[1] * tc)) ** 2) + ((rel[2] - (ds[2] * tc)) ** 2)
    const tau = cloud.av / (2.5 * Math.LOG10E) * Math.exp(-b2 / (2 * cloud.sigma * cloud.sigma)) * near
    // The cloud's σ along the ray, in t: the scaled direction's length is
    // how far the round cloud's space moves per unit of t.
    const width = cloud.sigma / Math.hypot(...ds)
    return {tc, tau, width}
  })
  const plane = Math.max(steps.PLANE, (t1 - t0) / steps.PLANE_STEPS)
  const dy = Math.max(Math.abs(d[1]), 1e-4)
  const T = [1, 1, 1]
  const L = [0, 0, 0]
  // The catalogue's share of the emission round the Sun (RESOLVED).
  const toSun = [SUN_G[0] - o[0], SUN_G[1] - o[1], SUN_G[2] - o[2]]
  const tcSun = (toSun[0] * d[0]) + (toSun[1] * d[1]) + (toSun[2] * d[2])
  const b2Sun = (toSun[0] ** 2) + (toSun[1] ** 2) + (toSun[2] ** 2) - (tcSun * tcSun)
  const hole = !mw ? 0 : resolved ?? resolvedNear(o)
  const dustRgb = spec.dust.rgb
  let t = t0
  let first = true
  for (let i = 0; i < steps.MAX && t < t1; i++) {
    const px = o[0] + (d[0] * t)
    const py = o[1] + (d[1] * t)
    const pz = o[2] + (d[2] * t)
    const yr = py - warpHeight(px, pz, spec.warp)
    let ds = Math.min(plane, Math.max(steps.VERT_MIN, steps.VERT_FRACTION * Math.abs(yr)) / dy)
    if (first) {
      ds *= Math.max(jitter, 0.05)
      first = false
    }
    ds = Math.min(ds, t1 - t)
    const tm = t + (0.5 * ds)
    const s = density(model, o[0] + (d[0] * tm), o[1] + (d[1] * tm), o[2] + (d[2] * tm))
    const unresolved = hole > 0 ? 1 - (hole * resolvedOverStep(t, ds, tcSun, b2Sun)) : 1
    for (let c = 0; c < 3; c++) {
      const k = s.kappa * dustRgb[c]
      const att = Math.exp(-k * ds)
      const path = k > 1e-6 ? (1 - att) / k : ds
      L[c] += T[c] * s.rgb[c] * unresolved * path
      T[c] *= att
    }
    for (const cloud of clouds) {
      const tau = cloud.tau * cloudOverStep(t, ds, cloud.tc, cloud.width)
      for (let c = 0; c < 3; c++) {
        T[c] *= Math.exp(-tau * dustRgb[c])
      }
    }
    t += ds
    out.steps++
    if (Math.max(...T) < 1e-3) {
      break
    }
  }
  out.rgb = L.map((v) => v * VALUE_PER_LSUN_KPC2)
  out.transmittance = T
  return out
}


// ---- Frames ----------------------------------------------------------------

let sceneToG = null


/**
 * The turn from the scene's J2000 catalogue frame to G's axes, row-major
 * 3×3.  galacticToSceneMatrix's columns are F's axes in the scene, so its
 * transpose takes scene vectors into F; G is F with Z negated.  F's +Z is
 * X × Y, the centre × the north pole, which points to l = 270°, and G's +Z
 * is l = 90°, the way the Sun moves: the model's azimuth grows with the
 * rotation, so its arms trail and its bar's near end is at l > 0.  (A
 * reflection, which a ray march doesn't mind: the same matrix turns the
 * view rays, MilkyWay.js.)  With F's Z, the first cut drew a mirror image:
 * leading arms, the bar's near end at l < 0, the Aquila Rift at l = 332°.
 *
 * @returns {Array<number>}
 */
export function sceneToGalacticRotation() {
  if (!sceneToG) {
    const e = galacticToSceneMatrix().elements
    sceneToG = [e[0], e[1], e[2], e[4], e[5], e[6], -e[8], -e[9], -e[10]]
  }
  return sceneToG
}


/**
 * A point in the catalogue frame (metres from the Sun, the frame the
 * StellarFrame's children are in) in G, kpc.
 *
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @returns {Array<number>}
 */
export function catalogToGalactic(x, y, z) {
  const m = sceneToGalacticRotation()
  return [
    (((m[0] * x) + (m[1] * y) + (m[2] * z)) / KPC_METER) + SUN_G[0],
    (((m[3] * x) + (m[4] * y) + (m[5] * z)) / KPC_METER) + SUN_G[1],
    (((m[6] * x) + (m[7] * y) + (m[8] * z)) / KPC_METER) + SUN_G[2],
  ]
}


/**
 * How far the camera is outside the galaxy's light, 0 inside to 1 well
 * out: an ellipsoidal radius over 18 kpc in the plane and 4 kpc across it,
 * blended from 1 to 1.6.  The meter frames the galaxy as a photograph
 * where this is 1 (exposure.js galaxyGain); inside, the eye's dark
 * adaptation holds, so the night sky is unchanged.
 *
 * @param {Array<number>} p G, kpc
 * @returns {number}
 */
export function outsideWeight(p) {
  const e = Math.hypot(Math.hypot(p[0], p[2]) / 18, p[1] / 4)
  return smoothstep(1.0, 1.6, e)
}


// ---- GLSL ------------------------------------------------------------------

/**
 * @param {number} v
 * @returns {string} A GLSL float literal
 */
function f(v) {
  return Number(v).toExponential(7)
}


/**
 * The march's normalisation uniforms' values (galaxyGlsl): normalize's
 * constants, the emission ones in exposure units × STORE_SCALE per kpc.
 *
 * @param {object} norms normalize's
 * @returns {{uGalaxyNorm0: Array<number>, uGalaxyNorm1: Array<number>}}
 */
export function galaxyNormUniforms(norms) {
  const k = VALUE_PER_LSUN_KPC2 * STORE_SCALE
  return {
    uGalaxyNorm0: [norms.thin * k, norms.thick * k, norms.young * k, norms.hii * k],
    uGalaxyNorm1: [norms.bulge * k, norms.bar * k, norms.dust, 0],
  }
}


/**
 * The structural uniforms of the shared march (galaxyGlsl with
 * `uniforms`): a spec's scales, its bar's frame and its colours, so one
 * program draws any galaxy that has no warp, flare or clouds and whose
 * bulge is an ellipsoid (`bar.boxy` false): every one but the Milky Way.
 *
 * @param {object} spec
 * @returns {object} uGalP (8 vec4s, as flat arrays) and uGalC (4 vec3s)
 */
export function galaxySpecUniforms(spec) {
  const {thin, thick, young, hii, bar, dust, bounds, steps, colors} = spec
  const a = bar.angleDeg * DEG
  const tiny = 1e-12
  return {
    uGalP: [
      [thin.hR, thin.hz, Math.max(thin.holeR * thin.holeR, tiny), thin.holeDepth],
      [thick.hR, thick.hz, young.hR, young.hz],
      [hii.hz, 1 / (bar.n ?? 1), spec.map.halfKpc, steps.PLANE],
      [-Math.cos(a), Math.sin(a), bar.x0, bar.y0],
      [bar.z0, bar.scale, bar.halfLength, bar.end],
      [bar.width, bar.hz, dust.hR, Math.max(dust.holeR * dust.holeR, tiny)],
      [dust.hz, bounds.r, bounds.y, steps.PLANE_STEPS],
      [steps.VERT_MIN, steps.VERT_FRACTION, dust.holeR > 0 ? 1 : 0, 0],
    ],
    uGalC: [colors.old, colors.bulge, colors.young, colors.hii],
  }
}


/**
 * The march, in GLSL: `vec3 galaxyMarch(vec3 o, vec3 d, float jitter)`, the
 * light along a ray from o (kpc, the galaxy's frame) in direction d (unit),
 * in exposure units at Earth's keyed exposure times STORE_SCALE.  Needs
 * `uniform sampler2D uGalaxyMap`, `uniform vec4 uGalaxyMapScale` (bakeMap's
 * scale) and `uniform vec4 uGalaxyNorm0, uGalaxyNorm1` (galaxyNormUniforms).
 * The same arithmetic as integrateRay and density.
 *
 * Two forms.  The spec's own (the default; the Milky Way's): its values
 * written into the code as constants, with its warp, flare, clouds, Local
 * Bubble and resolved share.  And with `uniforms`, one program for every
 * other galaxy: the structure from `uniform vec4 uGalP[8]` and `uniform
 * vec3 uGalC[4]` (galaxySpecUniforms), no warp, flare or clouds, the steps
 * capped at `maxSteps`.
 *
 * @param {object} [spec] MILKY_WAY by default; ignored with `uniforms`
 * @param {object} [opts]
 * @param {boolean} [opts.uniforms] The shared, uniform-driven form
 * @param {number} [opts.maxSteps] Its steps' cap (STEPS.MAX)
 * @returns {string}
 */
export function galaxyGlsl(spec = MILKY_WAY, {uniforms = false, maxSteps = STEPS.MAX} = {}) {
  return uniforms ? sharedGlsl(maxSteps) : specGlsl(spec)
}


/**
 * @param {object} spec
 * @returns {string} galaxyGlsl's spec form
 */
function specGlsl(spec) {
  const {thin, thick, young, hii, bar, dust, bounds, steps, colors} = spec
  const warp = spec.warp
  const fla = spec.flare
  const mw = Boolean(spec.milkyWay)
  const a = bar.angleDeg * DEG
  const clouds = mw ? CLOUDS : []
  const cloudLines = clouds.map((cloud, i) => {
    const c = cloudCenter(cloud)
    return `  cloudC[${i}] = vec4(${f(c[0])}, ${f(c[1])}, ${f(c[2])}, ${f(cloud.sigma)});
  cloudK[${i}] = ${f(cloud.sigma / cloud.sigmaY)};
  cloudTau[${i}] = ${f(cloud.av / (2.5 * Math.LOG10E))};`
  }).join('\n')
  const col = (rgb) => `vec3(${rgb.map(f).join(', ')})`
  const warpBody = warp ? `  if (!(r > ${f(warp.R)})) return 0.0;
  float s = (xz.y / r) * ${f(Math.cos(warp.phiDeg * DEG))} + (xz.x / r) * ${f(Math.sin(warp.phiDeg * DEG))};
  return ${f(warp.a)} * pow(r - ${f(warp.R)}, ${f(warp.b)}) * s;` : '  return 0.0;'
  const flareExpr = fla ? `exp(max(r - ${f(fla.R)}, 0.0) / ${f(fla.L)})` : '1.0'
  let bulgeExpr = (bar.n ?? 1) === 1 ? 'exp(-sqrt(sqrt(q * q + w * w)))' :
    `exp(-pow(max(sqrt(sqrt(q * q + w * w)), 1.0e-12), ${f(1 / bar.n)}))`
  if (bar.boxy === false) {
    bulgeExpr = `exp(-pow(max(sqrt(q + w), 1.0e-12), ${f(1 / (bar.n ?? 1))}))`
  }
  const dholeExpr = dust.holeR > 0 ? `1.0 - exp(-(r * r) / ${f(dust.holeR * dust.holeR)})` : '1.0'
  const bubble = mw ? `
    * galSmooth(${f(DUST.bubble[0])}, ${f(DUST.bubble[1])}, length(p - GAL_SUN))` : ''
  return `
uniform sampler2D uGalaxyMap;
uniform vec4 uGalaxyMapScale;
uniform vec4 uGalaxyNorm0;
uniform vec4 uGalaxyNorm1;
const float GAL_BOUNDS_R = ${f(bounds.r)};
const float GAL_BOUNDS_Y = ${f(bounds.y)};
const float GAL_MAP_HALF = ${f(spec.map.halfKpc)};
const vec3 GAL_SUN = vec3(${SUN_G.map(f).join(', ')});
const int GAL_CLOUDS = ${clouds.length};
const vec3 GAL_DUST_RGB = ${col(dust.rgb)};

float galSmooth(float lo, float hi, float x) {
  float t = clamp((x - lo) / (hi - lo), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

float galWarp(vec2 xz, float r) {
${warpBody}
}

float galVert(float y, float h) {
  return exp(-abs(y) / h) / (2.0 * h);
}

// The standard normal cumulative (normalCdf), for the clouds' columns.
float galNormalCdf(float x) {
  float z = abs(x) * 0.70710678;
  float k = 1.0 / (1.0 + 0.3275911 * z);
  float poly = k * (0.254829592 + k * (-0.284496736 + k * (1.421413741 + k * (-1.453152027 + k * 1.061405429))));
  float e = 1.0 - poly * exp(-z * z);
  return 0.5 * (1.0 + (x < 0.0 ? -e : e));
}

// Emission (rgb, exposure units × STORE_SCALE per kpc) and V-band extinction (per kpc).
void galDensity(vec3 p, out vec3 emit, out float kappa) {
  float r = length(p.xz);
  vec4 m = texture2D(uGalaxyMap, p.xz / (2.0 * GAL_MAP_HALF) + 0.5);
  m = m * m * uGalaxyMapScale;
  float yr = p.y - galWarp(p.xz, r);
  float fl = ${flareExpr};
  float hole = 1.0 - ${f(thin.holeDepth)} * exp(-(r * r) / ${f(thin.holeR * thin.holeR)});
  float thin = uGalaxyNorm0.x * exp(-r / ${f(thin.hR)}) * hole * m.r * galVert(yr, ${f(thin.hz)} * fl);
  float thick = uGalaxyNorm0.y * exp(-r / ${f(thick.hR)}) * galVert(yr, ${f(thick.hz)} * fl);
  float young = uGalaxyNorm0.z * exp(-r / ${f(young.hR)}) * m.g * galVert(yr, ${f(young.hz)} * fl);
  float hii = uGalaxyNorm0.w * m.a * galVert(yr, ${f(hii.hz)} * fl);
  float xb = p.x * ${f(-Math.cos(a))} + p.z * ${f(Math.sin(a))};
  float zb = p.x * ${f(Math.sin(a))} + p.z * ${f(Math.cos(a))};
  float q = (xb / ${f(bar.x0)}) * (xb / ${f(bar.x0)}) + (zb / ${f(bar.y0)}) * (zb / ${f(bar.y0)});
  float w = (p.y / ${f(bar.z0)}) * (p.y / ${f(bar.z0)});
  float bulge = uGalaxyNorm1.x * ${bulgeExpr};
  float along = abs(xb);
  float bar = uGalaxyNorm1.y * exp(-along / ${f(bar.scale)}) / (1.0 + exp((along - ${f(bar.halfLength)}) / ${f(bar.end)}))
    * exp(-abs(zb) / ${f(bar.width)}) * exp(-abs(p.y) / ${f(bar.hz)});
  emit = thin * ${col(colors.old)} + (thick + bulge + bar) * ${col(colors.bulge)}
    + young * ${col(colors.young)} + hii * ${col(colors.hii)};
  float dhole = ${dholeExpr};
  kappa = uGalaxyNorm1.z * exp(-r / ${f(dust.hR)}) * dhole * m.b * exp(-abs(yr) / (${f(dust.hz)} * fl))${bubble};
}

vec3 galaxyMarch(vec3 o, vec3 d, float jitter) {
  vec3 lim = vec3(GAL_BOUNDS_R, GAL_BOUNDS_Y, GAL_BOUNDS_R);
  vec3 inv = 1.0 / vec3(abs(d.x) < 1.0e-9 ? 1.0e-9 : d.x, abs(d.y) < 1.0e-9 ? 1.0e-9 : d.y,
    abs(d.z) < 1.0e-9 ? 1.0e-9 : d.z);
  vec3 ta = (-lim - o) * inv;
  vec3 tb = (lim - o) * inv;
  vec3 tmin = min(ta, tb);
  vec3 tmax = max(ta, tb);
  float t0 = max(max(max(tmin.x, tmin.y), tmin.z), 0.0);
  float t1 = min(min(tmax.x, tmax.y), tmax.z);
  if (!(t1 > t0)) return vec3(0.0);
${mw ? cloudsSetupGlsl(cloudLines) : ''}  float plane = max(${f(steps.PLANE)}, (t1 - t0) / ${f(steps.PLANE_STEPS)});
  float dy = max(abs(d.y), 1.0e-4);
  vec3 T = vec3(1.0);
  vec3 L = vec3(0.0);
${mw ? RESOLVED_SETUP_GLSL : ''}  float t = t0;
  for (int i = 0; i < ${steps.MAX}; i++) {
    if (t >= t1) break;
    vec3 p = o + d * t;
    float yr = p.y - galWarp(p.xz, length(p.xz));
    float ds = min(plane, max(${f(steps.VERT_MIN)}, ${f(steps.VERT_FRACTION)} * abs(yr)) / dy);
    if (i == 0) ds *= max(jitter, 0.05);
    ds = min(ds, t1 - t);
    vec3 emit;
    float kappa;
    galDensity(o + d * (t + 0.5 * ds), emit, kappa);
    vec3 k = kappa * GAL_DUST_RGB;
    vec3 att = exp(-k * ds);
    vec3 path = mix(vec3(ds), (1.0 - att) / max(k, vec3(1.0e-6)), step(vec3(1.0e-6), k));
${mw ? RESOLVED_STEP_GLSL : '    L += T * emit * path;\n'}    T *= att;
${mw ? CLOUDS_STEP_GLSL : ''}    t += ds;
    if (max(T.r, max(T.g, T.b)) < 1.0e-3) break;
  }
  return L;
}
`
}


/**
 * @param {string} cloudLines The clouds' constants
 * @returns {string} The Milky Way's clouds' setup in galaxyMarch
 */
function cloudsSetupGlsl(cloudLines) {
  return `  vec4 cloudC[GAL_CLOUDS];
  float cloudK[GAL_CLOUDS];
  float cloudTau[GAL_CLOUDS];
${cloudLines}
  float cloudT[GAL_CLOUDS];
  float cloudW[GAL_CLOUDS];
  float near = 1.0 - galSmooth(${f(CLOUDS_NEAR_KPC[0])}, ${f(CLOUDS_NEAR_KPC[1])}, length(o - GAL_SUN));
  for (int i = 0; i < GAL_CLOUDS; i++) {
    vec3 scale = vec3(1.0, cloudK[i], 1.0);
    vec3 rel = (cloudC[i].xyz - o) * scale;
    vec3 ds = d * scale;
    float tc = dot(rel, ds) / dot(ds, ds);
    vec3 miss = rel - ds * tc;
    float b2 = dot(miss, miss);
    cloudT[i] = tc;
    cloudW[i] = cloudC[i].w / length(ds);
    cloudTau[i] *= exp(-b2 / (2.0 * cloudC[i].w * cloudC[i].w)) * near;
  }
`
}


const RESOLVED_SETUP_GLSL = `  // The catalogue's share of the emission round the Sun (RESOLVED,
  // resolvedOverStep): the ray's closest approach to the Sun, and the
  // integral of 1 / (1 + s²/a²) over each step in closed form.
  vec3 toSun = GAL_SUN - o;
  float tcSun = dot(toSun, d);
  float cSun = sqrt(${f(RESOLVED.halfKpc * RESOLVED.halfKpc)} + max(dot(toSun, toSun) - tcSun * tcSun, 0.0));
  float hole = 1.0 - galSmooth(${f(RESOLVED.near[0])}, ${f(RESOLVED.near[1])}, length(toSun));
`


const RESOLVED_STEP_GLSL = `    float resolved = ${f(RESOLVED.halfKpc * RESOLVED.halfKpc)} / (cSun * max(ds, 1.0e-6))
      * (atan((t + ds - tcSun) / cSun) - atan((t - tcSun) / cSun));
    L += T * emit * path * (1.0 - hole * resolved);
`


const CLOUDS_STEP_GLSL = `    for (int c = 0; c < GAL_CLOUDS; c++) {
      // Only where the step is within 5σ of the cloud and the ray passes
      // close enough to it to matter: elsewhere its share is under 3e-7.
      float lo = (t - cloudT[c]) / cloudW[c];
      float hi = (t + ds - cloudT[c]) / cloudW[c];
      if (cloudTau[c] > 1.0e-4 && hi > -5.0 && lo < 5.0) {
        T *= exp(-cloudTau[c] * (galNormalCdf(hi) - galNormalCdf(lo)) * GAL_DUST_RGB);
      }
    }
`


/**
 * @param {number} maxSteps
 * @returns {string} galaxyGlsl's shared, uniform-driven form
 */
function sharedGlsl(maxSteps) {
  return `
uniform sampler2D uGalaxyMap;
uniform vec4 uGalaxyMapScale;
uniform vec4 uGalaxyNorm0;
uniform vec4 uGalaxyNorm1;
uniform vec4 uGalP[8];
uniform vec3 uGalC[4];
const vec3 GAL_DUST_RGB = vec3(${DUST.rgb.map(f).join(', ')});

float galVert(float y, float h) {
  return exp(-abs(y) / h) / (2.0 * h);
}

// Emission (rgb, exposure units × STORE_SCALE per kpc) and V-band extinction (per kpc).
void galDensity(vec3 p, out vec3 emit, out float kappa) {
  float r = length(p.xz);
  vec4 m = texture2D(uGalaxyMap, p.xz / (2.0 * uGalP[2].z) + 0.5);
  m = m * m * uGalaxyMapScale;
  float hole = 1.0 - uGalP[0].w * exp(-(r * r) / uGalP[0].z);
  float thin = uGalaxyNorm0.x * exp(-r / uGalP[0].x) * hole * m.r * galVert(p.y, uGalP[0].y);
  float thick = uGalaxyNorm0.y * exp(-r / uGalP[1].x) * galVert(p.y, uGalP[1].y);
  float young = uGalaxyNorm0.z * exp(-r / uGalP[1].z) * m.g * galVert(p.y, uGalP[1].w);
  float hii = uGalaxyNorm0.w * m.a * galVert(p.y, uGalP[2].x);
  float xb = p.x * uGalP[3].x + p.z * uGalP[3].y;
  float zb = p.x * uGalP[3].y - p.z * uGalP[3].x;
  // The bulge an ellipsoid's, exp(-r^(1/n)) (galaxyModel.js density, boxy false).
  float q = (xb / uGalP[3].z) * (xb / uGalP[3].z) + (zb / uGalP[3].w) * (zb / uGalP[3].w);
  float w = (p.y / uGalP[4].x) * (p.y / uGalP[4].x);
  float bulge = uGalaxyNorm1.x * exp(-pow(max(sqrt(q + w), 1.0e-12), uGalP[2].y));
  float along = abs(xb);
  float bar = uGalaxyNorm1.y * exp(-along / uGalP[4].y) / (1.0 + exp((along - uGalP[4].z) / uGalP[4].w))
    * exp(-abs(zb) / uGalP[5].x) * exp(-abs(p.y) / uGalP[5].y);
  emit = thin * uGalC[0] + (thick + bulge + bar) * uGalC[1] + young * uGalC[2] + hii * uGalC[3];
  float dhole = uGalP[7].z > 0.5 ? 1.0 - exp(-(r * r) / uGalP[5].w) : 1.0;
  kappa = uGalaxyNorm1.z * exp(-r / uGalP[5].z) * dhole * m.b * exp(-abs(p.y) / uGalP[6].x);
}

vec3 galaxyMarch(vec3 o, vec3 d, float jitter) {
  vec3 lim = vec3(uGalP[6].y, uGalP[6].z, uGalP[6].y);
  vec3 inv = 1.0 / vec3(abs(d.x) < 1.0e-9 ? 1.0e-9 : d.x, abs(d.y) < 1.0e-9 ? 1.0e-9 : d.y,
    abs(d.z) < 1.0e-9 ? 1.0e-9 : d.z);
  vec3 ta = (-lim - o) * inv;
  vec3 tb = (lim - o) * inv;
  vec3 tmin = min(ta, tb);
  vec3 tmax = max(ta, tb);
  float t0 = max(max(max(tmin.x, tmin.y), tmin.z), 0.0);
  float t1 = min(min(tmax.x, tmax.y), tmax.z);
  if (!(t1 > t0)) return vec3(0.0);
  float plane = max(uGalP[2].w, (t1 - t0) / uGalP[6].w);
  float dy = max(abs(d.y), 1.0e-4);
  vec3 T = vec3(1.0);
  vec3 L = vec3(0.0);
  float t = t0;
  for (int i = 0; i < ${maxSteps}; i++) {
    if (t >= t1) break;
    vec3 p = o + d * t;
    float ds = min(plane, max(uGalP[7].x, uGalP[7].y * abs(p.y)) / dy);
    if (i == 0) ds *= max(jitter, 0.05);
    ds = min(ds, t1 - t);
    vec3 emit;
    float kappa;
    galDensity(o + d * (t + 0.5 * ds), emit, kappa);
    vec3 k = kappa * GAL_DUST_RGB;
    vec3 att = exp(-k * ds);
    vec3 path = mix(vec3(ds), (1.0 - att) / max(k, vec3(1.0e-6)), step(vec3(1.0e-6), k));
    L += T * emit * path;
    T *= att;
    t += ds;
    if (max(T.r, max(T.g, T.b)) < 1.0e-3) break;
  }
  return L;
}
`
}
