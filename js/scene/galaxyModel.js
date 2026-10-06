import {ASTRO_UNIT_METER, DISPLAY_GAIN} from '../shared.js'
import {galacticToSceneMatrix} from './galacticFrame.js'


/**
 * The Milky Way's structure and integrated light, from published models
 * (#99; MilkyWay.md has the sources, the parameters and the numbers).
 *
 * Everything here is in the galactocentric frame G, in kiloparsecs: the
 * origin at the centre (Sgr A*), +X along the Sun → centre line (the
 * galactic frame's l = 0, as galacticFrame.js's F), +Y the north galactic
 * pole, +Z toward l = 90°.  The Sun is at (-SUN_R_KPC, SUN_Z_KPC, 0).  G is
 * F shifted by the Sun's position and with its Z negated
 * (sceneToGalacticRotation).  The azimuth β is Reid et al.'s: 0
 * toward the Sun, growing in the sense of the Galaxy's rotation (clockwise
 * seen from the north pole), so a point at radius R and azimuth β is
 * R·(-cos β, 0, sin β).
 *
 * The model is a luminosity density, L_sun per kpc³, in five components,
 * each normalised so the whole carries L_TOTAL_LSUN:
 *
 * - a thin and a thick exponential disc (Jurić et al. 2008), the thin one
 *   with a central deficit where the bar takes over, both flaring past the
 *   Sun and following the warp;
 * - a boxy bulge (an exponential of the "boxy" radius of Dwek et al. 1995's
 *   models) and the long bar (Wegg, Gerhard & Portail 2015), 27° from the
 *   Sun → centre line;
 * - the young population of the arms: four major log-spiral arms placed as
 *   Reid et al. (2019) measured them, and the Local arm;
 * - HII regions, knots along the arms' outer edges;
 *
 * and a dust density (Drimmel & Spergel 2001's thin dust disc, its lanes on
 * the arms' inner edges and along the bar's leading sides, clumped, with the
 * Local Bubble round the Sun and the nearby dark clouds of the Great Rift).
 *
 * The in-plane structure (arms, lanes, clumps, knots) is baked into a map
 * (bakeMap), which the shader samples; the radial and vertical profiles stay
 * analytic.  The JS here mirrors the shader (galaxyGlsl), for tests and for
 * the numbers in MilkyWay.md.
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
 * longitudes.
 */
export const BAR = Object.freeze({angleDeg: 27, halfLength: 5.0, end: 0.3, x0: 1.25, y0: 0.6, z0: 0.45,
  width: 0.4, hz: 0.18, scale: 3.0})

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
 * (Lallement et al. 2019).  Drawn as screens at their distance along each
 * ray (galaxyGlsl).
 */
export const CLOUDS = Object.freeze([
  Object.freeze({name: 'Aquila Rift', l: 28, b: 4, d: 0.22, sigma: 0.06, sigmaY: 0.03, av: 3}),
  Object.freeze({name: 'Serpens-Scutum', l: 16, b: 2, d: 0.45, sigma: 0.1, sigmaY: 0.04, av: 2.5}),
  Object.freeze({name: 'Cygnus Rift', l: 75, b: 1, d: 0.8, sigma: 0.2, sigmaY: 0.05, av: 3.5}),
  Object.freeze({name: 'Ophiuchus-Pipe', l: 358, b: 10, d: 0.135, sigma: 0.02, sigmaY: 0.02, av: 3}),
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
 * @param {Array<number>} rgb
 * @returns {Array<number>} rgb scaled to luma 1
 */
function unitLuma(rgb) {
  const luma = (0.2126 * rgb[0]) + (0.7152 * rgb[1]) + (0.0722 * rgb[2])
  return Object.freeze(rgb.map((v) => v / luma))
}


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
 * @param {number} x G, kpc
 * @param {number} z G, kpc
 * @returns {number} The azimuth β, radians, -π to π
 */
export function azimuth(x, z) {
  return Math.atan2(z, -x)
}


/**
 * @param {number} x G, kpc
 * @param {number} z G, kpc
 * @returns {number} The warped mid-plane's height, kpc
 */
export function warpHeight(x, z) {
  const r = Math.hypot(x, z)
  if (!(r > WARP.R)) {
    return 0
  }
  // sin(β - φ) from sin β = z/R, cos β = -x/R.
  const phi = WARP.phiDeg * DEG
  const sinBetaMinusPhi = ((z / r) * Math.cos(phi)) + ((x / r) * Math.sin(phi))
  return WARP.a * Math.pow(r - WARP.R, WARP.b) * sinBetaMinusPhi
}


/**
 * @param {number} r Radius, kpc
 * @returns {number} The flare's factor on every scale height
 */
export function flare(r) {
  return Math.exp(Math.max(r - FLARE.R, 0) / FLARE.L)
}


/**
 * The signed distance across an arm, kpc: positive outward of it (larger
 * radius at the same azimuth), from its nearest winding.
 *
 * @param {object} arm One of ARMS
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
 * @param {object} arm One of ARMS
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
 * @param {object} arm One of ARMS
 * @param {number} r Radius, kpc
 * @param {number} beta Azimuth, radians
 * @returns {number} The arm's strength there, 0 to 1: its radial extent, and a spur's azimuths
 */
export function armEnvelope(arm, r, beta) {
  let env = smoothstep(arm.rStart, arm.rStart + 1.2, r) * (1 - smoothstep(ARM_OUTER[0], ARM_OUTER[1], r))
  if (arm.betaDeg) {
    const [lo, hi] = arm.betaDeg
    const b = beta / DEG
    env *= smoothstep(lo - 15, lo, b) * (1 - smoothstep(hi, hi + 15, b))
  }
  return env
}


/**
 * @param {number} r Radius, kpc
 * @returns {number} An arm's young population's half-width (Gaussian σ), kpc: wider outward (Reid et al. 2014)
 */
export function armSigma(r) {
  return 0.15 + (0.03 * r)
}


/**
 * @param {number} x G, kpc
 * @param {number} z G, kpc
 * @returns {{xb: number, zb: number}} In the bar's frame: along it (+ the near end) and across it (+ the leading side at the near end)
 */
export function barFrame(x, z) {
  // The near end at β = 27°: R·(-cos β, sin β); across it, toward growing β.
  return {xb: (x * BAR_U[0]) + (z * BAR_U[1]), zb: (x * BAR_V[0]) + (z * BAR_V[1])}
}


const BAR_U = [-Math.cos(BAR.angleDeg * DEG), Math.sin(BAR.angleDeg * DEG)]
const BAR_V = [Math.sin(BAR.angleDeg * DEG), Math.cos(BAR.angleDeg * DEG)]


// ---- The map ---------------------------------------------------------------

/**
 * A seeded PRNG (mulberry32): the map is the same on every load.
 *
 * @param {number} seed
 * @returns {function(): number} Uniform in [0, 1)
 */
function prng(seed) {
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
function valueNoise(x, z, seed) {
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
 * @returns {number} Fractal noise, about 0 to 1: dust clumps from 3 kpc down to 0.2 kpc
 */
function clumps(x, z) {
  let sum = 0
  let norm = 0
  let amp = 1
  let freq = 1 / 3
  for (let o = 0; o < 5; o++) {
    sum += amp * valueNoise(x * freq, z * freq, 17 + o)
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


/** Knots (HII regions) along the arms. */
const KNOTS = 700


/**
 * The in-plane map: four channels over MAP.size² texels spanning
 * ±MAP.halfKpc in x and z, each O(1), the radial profiles left to the
 * shader:
 *
 * - 0, old: the old disc's modulation by the arms, the two stellar arms most (0.75 between them);
 * - 1, young: the arms' young population, with a faint floor between them and a blue cluster at each knot;
 * - 2, dust: the dust's modulation: lanes on the arms' inner edges and the bar's leading sides, clumped;
 * - 3, hii: HII regions, knots on the arms' outer edges, and a faint diffuse glow along the arms.
 *
 * Stored square-root encoded in bytes (value = (byte / 255)² × scale), for
 * resolution at the faint end, as the shader decodes it.
 *
 * @param {number} [size]
 * @returns {{size: number, halfKpc: number, data: Uint8Array, scale: Array<number>, linear: Array<Float32Array>}}
 */
export function bakeMap(size = MAP.size) {
  const steps = bakeMapSteps(size)
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
 * @param {number} [size]
 * @yields {number} The share of the rows done
 * @returns {object} bakeMap's
 */
export function* bakeMapSteps(size = MAP.size) {
  const half = MAP.halfKpc
  const n = size * size
  const old = new Float32Array(n)
  const young = new Float32Array(n)
  const dust = new Float32Array(n)
  const hii = new Float32Array(n)
  const texel = 2 * half / size
  const trig = ARMS.map(armTrig)
  for (let j = 0; j < size; j++) {
    const z = ((j + 0.5) * texel) - half
    for (let i = 0; i < size; i++) {
      const x = ((i + 0.5) * texel) - half
      const r = Math.max(Math.hypot(x, z), 1e-6)
      const beta = azimuth(x, z)
      const lnR = Math.log(r)
      const sigma = armSigma(r)
      // 1 / (2σ²) for the arm's young stars; the other profiles are wider or narrower by a fixed factor.
      const inv = 1 / (2 * sigma * sigma)
      let o = 0.75
      let y = 0.06 * smoothstep(2.5, 4, r) * (1 - smoothstep(14, 20, r))
      let d = 0.3
      let h = 0
      for (let a = 0; a < ARMS.length; a++) {
        const arm = ARMS[a]
        const env = armEnvelope(arm, r, beta) * arm.amp
        if (!(env > 0)) {
          continue
        }
        const {tanPsi, cosPsi, period, lnR0} = trig[a]
        let u = lnR - lnR0 + (beta * tanPsi)
        if (!arm.betaDeg) {
          u -= period * Math.round(u / period)
        }
        const off = r * (1 - Math.exp(-u)) * cosPsi
        const q = off * off * inv
        const profile = gaussian(q)
        y += env * profile
        o += (arm.old ? 0.6 : 0.2) * env * gaussian(q / (1.8 * 1.8))
        // Lanes on the inner (concave, upstream) edge; the gas of the arm itself.
        const lane = off + (0.8 * sigma)
        d += env * ((1.6 * gaussian(lane * lane * inv / (0.5 * 0.5))) + (0.5 * profile))
        h += 0.08 * env * gaussian(q / (0.6 * 0.6))
      }
      // The bar's dust lanes, on its leading sides, point-symmetric.
      const {xb, zb} = barFrame(x, z)
      const along = Math.abs(xb)
      if (along > 0.4 && along < 5) {
        const center = Math.sign(xb) * (0.3 + (0.06 * along))
        const w = 0.2
        const k = smoothstep(0.4, 1.0, along) * (1 - smoothstep(4.0, 5.0, along))
        d += 1.6 * k * Math.exp(-((zb - center) ** 2) / (2 * w * w))
      }
      const c = clumps(x, z)
      d *= 0.25 + (1.6 * c * c)
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
  stampKnots(young, hii, size, half)
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
 * of its dust lane), with a young cluster at each: KNOTS of them, sizes
 * 30-90 pc (σ), brightnesses log-normal.
 *
 * @param {Float32Array} young
 * @param {Float32Array} hii
 * @param {number} size
 * @param {number} half
 */
function stampKnots(young, hii, size, half) {
  const rand = prng(99)
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-12))) * Math.cos(2 * Math.PI * rand())
  const weights = ARMS.map((arm) => arm.amp * (arm.betaDeg ? 0.5 : 1))
  const total = weights.reduce((a, b) => a + b, 0)
  const texel = 2 * half / size
  let placed = 0
  for (let tries = 0; placed < KNOTS && tries < KNOTS * 50; tries++) {
    let pick = rand() * total
    let a = 0
    while (a < ARMS.length - 1 && pick > weights[a]) {
      pick -= weights[a]
      a++
    }
    const arm = ARMS[a]
    const r = 3 + (rand() * 13)
    const tanPsi = Math.tan(arm.pitchDeg * DEG)
    let beta = -Math.log(r / arm.r0) / tanPsi
    beta = Math.atan2(Math.sin(beta), Math.cos(beta))
    const weight = armEnvelope(arm, r, beta) * Math.exp(-(r - 3) / YOUNG.hR)
    if (rand() > weight) {
      continue
    }
    const sigma = armSigma(r)
    const off = (0.25 * sigma) + (0.45 * sigma * gauss())
    const rr = r + (off / Math.cos(arm.pitchDeg * DEG))
    const kx = -rr * Math.cos(beta)
    const kz = rr * Math.sin(beta)
    const ks = 0.03 + (0.06 * rand())
    const amp = Math.exp(0.8 * gauss())
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
    placed++
  }
}


/**
 * The map at (x, z), as the GPU samples it: bilinear between texel centres,
 * clamped at the edges, from the bytes, decoded.
 *
 * @param {object} map bakeMap's
 * @param {number} x G, kpc
 * @param {number} z G, kpc
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
 * @returns {number} The thin disc's central deficit
 */
function thinHole(r) {
  return 1 - (THIN.holeDepth * Math.exp(-((r / THIN.holeR) ** 2)))
}


/**
 * @param {number} r
 * @returns {number} The dust disc's central deficit
 */
function dustHole(r) {
  return 1 - Math.exp(-((r / DUST.holeR) ** 2))
}


/**
 * @param {number} rs4 r_s⁴
 * @returns {number} The boxy bulge's unnormalised density
 */
function bulgeShape(rs4) {
  return Math.exp(-Math.sqrt(Math.sqrt(rs4)))
}


/**
 * @param {number} along |x| along the bar, kpc
 * @returns {number} The long bar's profile along its length
 */
function barLength(along) {
  return Math.exp(-along / BAR.scale) / (1 + Math.exp((along - BAR.halfLength) / BAR.end))
}


/**
 * Each component's constant, L_sun per kpc³ per unit of its unnormalised
 * profile, so that it carries its FRACTIONS of L_TOTAL_LSUN within BOUNDS:
 * the discs' vertical profiles integrate to 1, so their in-plane integrals
 * over the map's texels (the map as sampled); the bulge's and bar's by
 * quadrature.
 *
 * @param {object} map bakeMap's
 * @returns {{thin: number, thick: number, young: number, hii: number, bulge: number, bar: number, dust: number}}
 */
export function normalize(map) {
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
      // Each disc's light within the volume's height (BOUNDS.y): the flare
      // and the warp take some of the thick disc's past it.
      const w = warpHeight(x, z)
      const fl = flare(r)
      const within = (hz) => 1 - (0.5 * (Math.exp(-(BOUNDS.y - w) / (hz * fl)) + Math.exp(-(BOUNDS.y + w) / (hz * fl))))
      thin += Math.exp(-r / THIN.hR) * thinHole(r) * o * area * within(THIN.hz)
      thick += Math.exp(-r / THICK.hR) * area * within(THICK.hz)
      young += Math.exp(-r / YOUNG.hR) * y * area * within(YOUNG.hz)
      hii += h * area * within(HII.hz)
      if (Math.abs(r - SUN_R_KPC) < 0.25) {
        ringDust += d
        ringCount++
      }
    }
  }
  // The boxy bulge: ∫ exp(-r_s) dV = x0·y0·z0 × ∫∫ 2πρ dρ dw exp(-(ρ⁴ + w⁴)^¼).
  let unit = 0
  const du = 0.02
  for (let rho = du / 2; rho < 30; rho += du) {
    for (let w = du / 2; w < 30; w += du) {
      unit += 2 * Math.PI * rho * 2 * bulgeShape((rho ** 4) + (w ** 4)) * du * du
    }
  }
  const bulge = BAR.x0 * BAR.y0 * BAR.z0 * unit
  // The long bar: separable, exp(-|across| / width)·exp(-|y| / hz)·barLength(|along|).
  let length = 0
  const dx = 0.005
  for (let a = dx / 2; a < 12; a += dx) {
    length += 2 * barLength(a) * dx
  }
  const bar = length * (2 * BAR.width) * (2 * BAR.hz)
  const L = L_TOTAL_LSUN
  const meanDust = ringDust / Math.max(ringCount, 1)
  const kappaV = DUST.avPerKpc / (2.5 * Math.LOG10E)
  return {
    thin: L * FRACTIONS.thin / thin,
    thick: L * FRACTIONS.thick / thick,
    young: L * FRACTIONS.young / young,
    hii: L * FRACTIONS.hii / hii,
    bulge: L * FRACTIONS.bulge / bulge,
    bar: L * FRACTIONS.bar / bar,
    dust: kappaV / (Math.exp(-SUN_R_KPC / DUST.hR) * dustHole(SUN_R_KPC) * meanDust),
  }
}


let cached = null


/**
 * The map and its normalisation, baked once.
 *
 * @returns {{map: object, norms: object}}
 */
export function galaxyModel() {
  if (!cached) {
    const map = bakeMap()
    cached = {map, norms: normalize(map)}
  }
  return cached
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
 * @param {number} x G, kpc
 * @param {number} y G, kpc
 * @param {number} z G, kpc
 * @returns {{thin: number, thick: number, young: number, hii: number, bulge: number, bar: number,
 *   rgb: Array<number>, kappa: number}} Each component's L_sun/kpc³, their colour sum, and the
 *   dust's extinction coefficient in V, per kpc
 */
export function density({map, norms}, x, y, z) {
  const r = Math.hypot(x, z)
  const [o, yo, d, h] = sampleMap(map, x, z)
  const yr = y - warpHeight(x, z)
  const fl = flare(r)
  const thin = norms.thin * Math.exp(-r / THIN.hR) * thinHole(r) * o * vertical(yr, THIN.hz * fl)
  const thick = norms.thick * Math.exp(-r / THICK.hR) * vertical(yr, THICK.hz * fl)
  const young = norms.young * Math.exp(-r / YOUNG.hR) * yo * vertical(yr, YOUNG.hz * fl)
  const hii = norms.hii * h * vertical(yr, HII.hz * fl)
  const {xb, zb} = barFrame(x, z)
  const rs4 = ((((xb / BAR.x0) ** 2) + ((zb / BAR.y0) ** 2)) ** 2) + ((y / BAR.z0) ** 4)
  const bulge = norms.bulge * bulgeShape(rs4)
  const bar = norms.bar * barLength(Math.abs(xb)) * Math.exp(-Math.abs(zb) / BAR.width) * Math.exp(-Math.abs(y) / BAR.hz)
  const rgb = [0, 1, 2].map((c) => (thin * COLORS.old[c]) + ((thick + bulge + bar) * COLORS.bulge[c]) +
    (young * COLORS.young[c]) + (hii * COLORS.hii[c]))
  const toSun = Math.hypot(x - SUN_G[0], y - SUN_G[1], z - SUN_G[2])
  const kappa = norms.dust * Math.exp(-r / DUST.hR) * dustHole(r) * d * Math.exp(-Math.abs(yr) / (DUST.hz * fl)) *
    smoothstep(DUST.bubble[0], DUST.bubble[1], toSun)
  return {thin, thick, young, hii, bulge, bar, rgb, kappa}
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
 * The ray's segment inside BOUNDS.
 *
 * @param {Array<number>} o origin, G kpc
 * @param {Array<number>} d direction, unit
 * @returns {Array<number>|null} [t0, t1], t0 ≥ 0; null if it misses
 */
export function boundsSegment(o, d) {
  const lim = [BOUNDS.r, BOUNDS.y, BOUNDS.r]
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
 * The galaxy's light along a ray, in exposure units at Earth's keyed
 * exposure (times the frame's exposureRelative on screen), as the shader
 * marches it: emission and extinction per step, the clouds as screens.
 *
 * @param {object} model galaxyModel's
 * @param {Array<number>} o origin, G kpc
 * @param {Array<number>} d direction, unit
 * @param {number} [jitter] the first step's offset, 0 to 1
 * @param {number} [resolved] How much of the catalogue's share to leave out
 *   (RESOLVED): resolvedNear the camera, as the shader does; 0 for the whole
 *   integrated light
 * @returns {{rgb: Array<number>, steps: number, transmittance: Array<number>}}
 */
export function integrateRay(model, o, d, jitter = 0.5, resolved = resolvedNear(o)) {
  const seg = boundsSegment(o, d)
  const out = {rgb: [0, 0, 0], steps: 0, transmittance: [1, 1, 1]}
  if (!seg) {
    return out
  }
  const [t0, t1] = seg
  const near = cloudsNear(o)
  const clouds = CLOUDS.map((cloud) => {
    // The closest approach in the space where the cloud is round (y scaled by σ / σy).
    const c = cloudCenter(cloud)
    const k = cloud.sigma / cloud.sigmaY
    const rel = [c[0] - o[0], (c[1] - o[1]) * k, c[2] - o[2]]
    const ds = [d[0], d[1] * k, d[2]]
    const tc = ((rel[0] * ds[0]) + (rel[1] * ds[1]) + (rel[2] * ds[2])) / ((ds[0] ** 2) + (ds[1] ** 2) + (ds[2] ** 2))
    const b2 = ((rel[0] - (ds[0] * tc)) ** 2) + ((rel[1] - (ds[1] * tc)) ** 2) + ((rel[2] - (ds[2] * tc)) ** 2)
    const tau = cloud.av / (2.5 * Math.LOG10E) * Math.exp(-b2 / (2 * cloud.sigma * cloud.sigma)) * near
    return {tc, tau}
  })
  const plane = Math.max(STEPS.PLANE, (t1 - t0) / STEPS.PLANE_STEPS)
  const dy = Math.max(Math.abs(d[1]), 1e-4)
  const T = [1, 1, 1]
  const L = [0, 0, 0]
  // The catalogue's share of the emission round the Sun (RESOLVED).
  const toSun = [SUN_G[0] - o[0], SUN_G[1] - o[1], SUN_G[2] - o[2]]
  const tcSun = (toSun[0] * d[0]) + (toSun[1] * d[1]) + (toSun[2] * d[2])
  const b2Sun = (toSun[0] ** 2) + (toSun[1] ** 2) + (toSun[2] ** 2) - (tcSun * tcSun)
  const hole = resolved
  let t = t0
  let first = true
  for (let i = 0; i < STEPS.MAX && t < t1; i++) {
    const px = o[0] + (d[0] * t)
    const py = o[1] + (d[1] * t)
    const pz = o[2] + (d[2] * t)
    const yr = py - warpHeight(px, pz)
    let ds = Math.min(plane, Math.max(STEPS.VERT_MIN, STEPS.VERT_FRACTION * Math.abs(yr)) / dy)
    if (first) {
      ds *= Math.max(jitter, 0.05)
      first = false
    }
    ds = Math.min(ds, t1 - t)
    const tm = t + (0.5 * ds)
    const s = density(model, o[0] + (d[0] * tm), o[1] + (d[1] * tm), o[2] + (d[2] * tm))
    const unresolved = hole > 0 ? 1 - (hole * resolvedOverStep(t, ds, tcSun, b2Sun)) : 1
    for (let c = 0; c < 3; c++) {
      const k = s.kappa * DUST.rgb[c]
      const att = Math.exp(-k * ds)
      const path = k > 1e-6 ? (1 - att) / k : ds
      L[c] += T[c] * s.rgb[c] * unresolved * path
      T[c] *= att
    }
    for (const cloud of clouds) {
      if (cloud.tc >= t && cloud.tc < t + ds) {
        for (let c = 0; c < 3; c++) {
          T[c] *= Math.exp(-cloud.tau * DUST.rgb[c])
        }
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
 * The march, in GLSL: `vec3 galaxyMarch(vec3 o, vec3 d, float jitter)`, the
 * light along a ray from o (G, kpc) in direction d (unit), in exposure
 * units at Earth's keyed exposure times STORE_SCALE.  Needs `uniform
 * sampler2D uGalaxyMap`, `uniform vec4 uGalaxyMapScale` (bakeMap's scale)
 * and `uniform vec4 uGalaxyNorm0, uGalaxyNorm1` (galaxyNormUniforms).  The
 * same arithmetic as integrateRay and density.
 *
 * @returns {string}
 */
export function galaxyGlsl() {
  const a = BAR.angleDeg * DEG
  const phi = WARP.phiDeg * DEG
  const cloudLines = CLOUDS.map((cloud, i) => {
    const c = cloudCenter(cloud)
    return `  cloudC[${i}] = vec4(${f(c[0])}, ${f(c[1])}, ${f(c[2])}, ${f(cloud.sigma)});
  cloudK[${i}] = ${f(cloud.sigma / cloud.sigmaY)};
  cloudTau[${i}] = ${f(cloud.av / (2.5 * Math.LOG10E))};`
  }).join('\n')
  const col = (rgb) => `vec3(${rgb.map(f).join(', ')})`
  return `
uniform sampler2D uGalaxyMap;
uniform vec4 uGalaxyMapScale;
uniform vec4 uGalaxyNorm0;
uniform vec4 uGalaxyNorm1;
const float GAL_BOUNDS_R = ${f(BOUNDS.r)};
const float GAL_BOUNDS_Y = ${f(BOUNDS.y)};
const float GAL_MAP_HALF = ${f(MAP.halfKpc)};
const vec3 GAL_SUN = vec3(${SUN_G.map(f).join(', ')});
const int GAL_CLOUDS = ${CLOUDS.length};
const vec3 GAL_DUST_RGB = ${col(DUST.rgb)};

float galSmooth(float lo, float hi, float x) {
  float t = clamp((x - lo) / (hi - lo), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

float galWarp(vec2 xz, float r) {
  if (!(r > ${f(WARP.R)})) return 0.0;
  float s = (xz.y / r) * ${f(Math.cos(phi))} + (xz.x / r) * ${f(Math.sin(phi))};
  return ${f(WARP.a)} * pow(r - ${f(WARP.R)}, ${f(WARP.b)}) * s;
}

float galVert(float y, float h) {
  return exp(-abs(y) / h) / (2.0 * h);
}

// Emission (rgb, exposure units × STORE_SCALE per kpc) and V-band extinction (per kpc).
void galDensity(vec3 p, out vec3 emit, out float kappa) {
  float r = length(p.xz);
  vec4 m = texture2D(uGalaxyMap, p.xz / (2.0 * GAL_MAP_HALF) + 0.5);
  m = m * m * uGalaxyMapScale;
  float yr = p.y - galWarp(p.xz, r);
  float fl = exp(max(r - ${f(FLARE.R)}, 0.0) / ${f(FLARE.L)});
  float hole = 1.0 - ${f(THIN.holeDepth)} * exp(-(r * r) / ${f(THIN.holeR * THIN.holeR)});
  float thin = uGalaxyNorm0.x * exp(-r / ${f(THIN.hR)}) * hole * m.r * galVert(yr, ${f(THIN.hz)} * fl);
  float thick = uGalaxyNorm0.y * exp(-r / ${f(THICK.hR)}) * galVert(yr, ${f(THICK.hz)} * fl);
  float young = uGalaxyNorm0.z * exp(-r / ${f(YOUNG.hR)}) * m.g * galVert(yr, ${f(YOUNG.hz)} * fl);
  float hii = uGalaxyNorm0.w * m.a * galVert(yr, ${f(HII.hz)} * fl);
  float xb = p.x * ${f(-Math.cos(a))} + p.z * ${f(Math.sin(a))};
  float zb = p.x * ${f(Math.sin(a))} + p.z * ${f(Math.cos(a))};
  float q = (xb / ${f(BAR.x0)}) * (xb / ${f(BAR.x0)}) + (zb / ${f(BAR.y0)}) * (zb / ${f(BAR.y0)});
  float w = (p.y / ${f(BAR.z0)}) * (p.y / ${f(BAR.z0)});
  float bulge = uGalaxyNorm1.x * exp(-sqrt(sqrt(q * q + w * w)));
  float along = abs(xb);
  float bar = uGalaxyNorm1.y * exp(-along / ${f(BAR.scale)}) / (1.0 + exp((along - ${f(BAR.halfLength)}) / ${f(BAR.end)}))
    * exp(-abs(zb) / ${f(BAR.width)}) * exp(-abs(p.y) / ${f(BAR.hz)});
  emit = thin * ${col(COLORS.old)} + (thick + bulge + bar) * ${col(COLORS.bulge)}
    + young * ${col(COLORS.young)} + hii * ${col(COLORS.hii)};
  float dhole = 1.0 - exp(-(r * r) / ${f(DUST.holeR * DUST.holeR)});
  kappa = uGalaxyNorm1.z * exp(-r / ${f(DUST.hR)}) * dhole * m.b * exp(-abs(yr) / (${f(DUST.hz)} * fl))
    * galSmooth(${f(DUST.bubble[0])}, ${f(DUST.bubble[1])}, length(p - GAL_SUN));
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
  vec4 cloudC[GAL_CLOUDS];
  float cloudK[GAL_CLOUDS];
  float cloudTau[GAL_CLOUDS];
${cloudLines}
  float cloudT[GAL_CLOUDS];
  float near = 1.0 - galSmooth(${f(CLOUDS_NEAR_KPC[0])}, ${f(CLOUDS_NEAR_KPC[1])}, length(o - GAL_SUN));
  for (int i = 0; i < GAL_CLOUDS; i++) {
    vec3 scale = vec3(1.0, cloudK[i], 1.0);
    vec3 rel = (cloudC[i].xyz - o) * scale;
    vec3 ds = d * scale;
    float tc = dot(rel, ds) / dot(ds, ds);
    vec3 miss = rel - ds * tc;
    float b2 = dot(miss, miss);
    cloudT[i] = tc;
    cloudTau[i] *= exp(-b2 / (2.0 * cloudC[i].w * cloudC[i].w)) * near;
  }
  float plane = max(${f(STEPS.PLANE)}, (t1 - t0) / ${f(STEPS.PLANE_STEPS)});
  float dy = max(abs(d.y), 1.0e-4);
  vec3 T = vec3(1.0);
  vec3 L = vec3(0.0);
  // The catalogue's share of the emission round the Sun (RESOLVED,
  // resolvedOverStep): the ray's closest approach to the Sun, and the
  // integral of 1 / (1 + s²/a²) over each step in closed form.
  vec3 toSun = GAL_SUN - o;
  float tcSun = dot(toSun, d);
  float cSun = sqrt(${f(RESOLVED.halfKpc * RESOLVED.halfKpc)} + max(dot(toSun, toSun) - tcSun * tcSun, 0.0));
  float hole = 1.0 - galSmooth(${f(RESOLVED.near[0])}, ${f(RESOLVED.near[1])}, length(toSun));
  float t = t0;
  for (int i = 0; i < ${STEPS.MAX}; i++) {
    if (t >= t1) break;
    vec3 p = o + d * t;
    float yr = p.y - galWarp(p.xz, length(p.xz));
    float ds = min(plane, max(${f(STEPS.VERT_MIN)}, ${f(STEPS.VERT_FRACTION)} * abs(yr)) / dy);
    if (i == 0) ds *= max(jitter, 0.05);
    ds = min(ds, t1 - t);
    vec3 emit;
    float kappa;
    galDensity(o + d * (t + 0.5 * ds), emit, kappa);
    vec3 k = kappa * GAL_DUST_RGB;
    vec3 att = exp(-k * ds);
    vec3 path = mix(vec3(ds), (1.0 - att) / max(k, vec3(1.0e-6)), step(vec3(1.0e-6), k));
    float resolved = ${f(RESOLVED.halfKpc * RESOLVED.halfKpc)} / (cSun * max(ds, 1.0e-6))
      * (atan((t + ds - tcSun) / cSun) - atan((t - tcSun) / cSun));
    L += T * emit * path * (1.0 - hole * resolved);
    T *= att;
    for (int c = 0; c < GAL_CLOUDS; c++) {
      if (cloudT[c] >= t && cloudT[c] < t + ds) T *= exp(-cloudTau[c] * GAL_DUST_RGB);
    }
    t += ds;
    if (max(T.r, max(T.g, T.b)) < 1.0e-3) break;
  }
  return L;
}
`
}
