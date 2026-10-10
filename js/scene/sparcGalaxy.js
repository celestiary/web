import {ARM_SIGMA, DUST, MILKY_WAY, SPIRAL_RECIPE, STEPS, prng, unitLuma} from './galaxyModel.js'
import {skyBasis} from './galacticFrame.js'
import {hashString} from './starSeed.js'
import {blackbodyColor} from './stellar.js'


/**
 * A SPARC galaxy's spec for galaxyModel.js, from its row in
 * public/data/sparc/galaxies.json (tools/sparc/buildSparc.mjs): the same
 * components as the Milky Way's, each primed from what was measured and,
 * where nothing was, from published trends with the Hubble type.
 * Galaxies.md lists every parameter, which are measured and which are
 * defaults, and the sources.
 *
 * Measured, per galaxy:
 *
 * - SPARC (Lelli, McGaugh & Schombert 2016): the Hubble type T, the
 *   distance, the inclination, L[3.6], the disc's scale length, its
 *   surface brightness profile (the bulge-disc decomposition) and the
 *   bulge's luminosity and half-light radius, V_flat;
 * - RC3 (de Vaucouleurs et al. 1991), for 97 of them: the face-on V
 *   luminosity, from B_T^0 and (B-V)_T^0, and the colour; the bar family
 *   (SA, SAB, SB), for 149;
 * - NED, SIMBAD, RC3 and HyperLEDA: the position and the position angle.
 *
 * Defaults by type are each a constant below, with its source.  Each
 * galaxy is seeded by its name (prng), so what isn't measured is drawn the
 * same on every load.
 */


/** Metres in a megaparsec. */
export const MPC_METER = 3.085677581491367e22

/** The Sun's absolute magnitude in V (as StarsCatalog and stellar.js have it). */
const SUN_MV = 4.83

/**
 * log10(L_V^0 / L[3.6]) = a + b·(B-V)^0, both in solar units: fitted to the
 * 97 SPARC galaxies RC3 has B_T^0 and (B-V)_T^0 for (Galaxies.md, "The
 * light"), an rms of 0.22 dex.  The slope is Bell et al. (2003)'s for the
 * V-band mass-to-light ratio against B-V (1.305) and the intercept puts
 * the [3.6] mass-to-light ratio at 0.53, SPARC's 0.5 (McGaugh & Schombert
 * 2014): stellar mass is what [3.6] traces, and V is that over the
 * colour's mass-to-light ratio.  For the 78 galaxies without RC3's
 * photometry, L_V^0 is L[3.6] by this, at their type's median colour.
 */
export const V_OVER_36 = Object.freeze({a: 0.349, b: -1.308})

/**
 * Each component's B-V, for the colours and for splitting the light by
 * colour: an old population's, as an elliptical's and a bulge's (0.96,
 * Fukugita, Shimasaku & Ichikawa 1995's E); the old disc's, as an early
 * spiral's integrated (0.78, their Sab); the young stars', a population
 * about 10^8 yr old (-0.05; star clusters of that age, e.g. Bica et al.
 * 1991's LMC types); HII regions take the Milky Way's colour (an emission
 * spectrum, not a continuum).
 */
export const COMPONENT_BV = Object.freeze({bulge: 0.96, old: 0.78, young: -0.05})

/**
 * The young population's share of the V light where the colour can't set
 * it, and its bounds: none to half.  The Milky Way's is 0.18.
 */
export const YOUNG_MAX = 0.5

/** HII regions' light over the young stars' (the Milky Way's 0.02 / 0.18). */
export const HII_OVER_YOUNG = 0.11

/**
 * The thin disc's scale length over its height, by type: de Grijs (1998)
 * and Kregel, van der Kruit & de Grijs (2002) find h_R/h_z rising from
 * about 4 for early spirals to 8-10 for Sc-Sd (their mean 7.3); dwarfs and
 * irregulars are thick, an intrinsic axis ratio of 0.3-0.5 (Sánchez-Janssen,
 * Méndez-Abreu & Aguerri 2010; Roychowdhury et al. 2013).  Index T, 0-11.
 */
export const HR_OVER_HZ = Object.freeze([4, 4, 5, 6, 7, 8, 8, 8, 7, 4, 3, 3])

/**
 * The face-on optical depth in V through the centre, by type: Xilouris et
 * al. (1999)'s edge-on Sb-Sc fits, τ_V 0.5-1.4 (about 0.7-0.8); less in
 * lenticulars, and in dwarfs and irregulars, whose gas is metal-poor and
 * whose dust-to-gas ratio is low (Rémy-Ruyer et al. 2014).  Index T.
 */
export const TAU_FACE_ON = Object.freeze([0.1, 0.6, 0.7, 0.8, 0.8, 0.7, 0.7, 0.5, 0.4, 0.25, 0.15, 0.15])

/**
 * The dust disc over the stars' (Xilouris et al. 1999): its scale length
 * 1.4 times theirs, its scale height half the thin disc's.
 */
export const DUST_OVER_STARS = Object.freeze({hR: 1.4, hz: 0.5})

/**
 * Arms' pitch by type, degrees: Kennicutt (1981) and Ma (2002) find the
 * pitch opening from about 6-8° in Sa to 20-25° in Sd, with a scatter of
 * ±5° at a type.  Index T (0 and 9-11 have none).
 */
export const PITCH_DEG = Object.freeze([0, 8, 10, 12, 14, 17, 19, 21, 23, 0, 0, 0])

/**
 * The bar's half-length over the disc's scale length: Erwin (2005) finds
 * bars in early types about 1-1.5 scale lengths long, in late types
 * 0.5-0.8.  Its share of the light: Gadotti (2011) finds Bar/T about 0.1
 * for strong bars; a weak bar (SAB) half that.
 */
export const BAR_DEFAULTS = Object.freeze({early: 1.3, mid: 1.0, late: 0.7, strongShare: 0.10, weakShare: 0.05})

/**
 * The bulge's profile index n (exp(-r^(1/n))) and its flattening, by type:
 * classical bulges, n ~ 2-4 and nearly round, in S0-Sab; pseudobulges, n
 * < 2 and flat, in later types (Fisher & Drory 2008; Kormendy & Kennicutt
 * 2004).
 */
export const BULGE_BY_TYPE = Object.freeze({n: [3, 3, 2, 2, 1.5, 1.5, 1, 1, 1, 1, 1, 1],
  flattening: [0.7, 0.7, 0.7, 0.6, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]})

/**
 * The thick disc's light over the thin disc's, against the rotation
 * speed: Yoachim & Dalcanton (2006) find thick discs a minor part of
 * massive discs (about 0.2-0.3 of the thin's light at V_c over 120-150
 * km/s) and as luminous as the thin disc in the slowest rotators (V_c
 * under about 80), as Comerón et al. (2011) do at 3.6 µm; between, linear
 * in V.  Its scale length 1.25 and height 2.5 times the thin disc's
 * (Yoachim & Dalcanton 2006).
 */
export const THICK_DISC = Object.freeze({fast: 150, slow: 70, fastRatio: 0.25, slowRatio: 1.0, hR: 1.25, hz: 2.5})

/**
 * The young disc and the HII layer: the Milky Way's proportions (its
 * young stars' scale length 3.5 / 2.6 the thin disc's, scale height 0.14 /
 * 0.30; HII 0.09 / 0.30): star formation follows the gas, whose discs are
 * longer than the stars' (UV discs: Muñoz-Mateos et al. 2007).
 */
export const YOUNG_DISC = Object.freeze({hR: 3.5 / 2.6, hz: 0.14 / 0.3, hiiHz: 0.09 / 0.3})

/**
 * Lopsidedness, the m = 1 mode's amplitude A1 of the old disc, by type:
 * common, and larger in late types (Zaritsky et al. 2013: a median A1
 * about 0.1, more in late types and dwarfs; Swaters et al. 1999).
 */
export const LOPSIDED_A1 = Object.freeze([0.03, 0.03, 0.04, 0.05, 0.06, 0.08, 0.1, 0.12, 0.14, 0.18, 0.2, 0.15])

/**
 * An irregular's young light between its star-forming complexes, over a
 * complex's peak: in dwarf irregulars much of the young stars' light is
 * diffuse, outside the complexes (Hunter & Elmegreen 2004).  A spiral's is
 * the Milky Way's interarm floor (SPIRAL_RECIPE.youngFloor).
 */
export const DIFFUSE_YOUNG = 0.3


/**
 * The families, by type: one glow model, and how its in-plane map is
 * baked (Galaxies.md, "Families").
 *
 * - lenticular (S0, T 0): no arms, no young population, little dust;
 * - spiral (Sa-Sdm, T 1-8): log-spiral arms, grand design to flocculent;
 * - magellanic (Sm, T 9): one arm and clumps (de Vaucouleurs & Freeman
 *   1972's Magellanic spirals);
 * - irregular (Im, T 10) and bcd (T 11): star formation in clumps, off
 *   centre (Hunter & Elmegreen 2004), a blue compact dwarf's concentrated
 *   in its middle.
 *
 * @param {number} t
 * @returns {string}
 */
export function family(t) {
  if (t <= 0) {
    return 'lenticular'
  }
  if (t <= 8) {
    return 'spiral'
  }
  return t === 9 ? 'magellanic' : t === 10 ? 'irregular' : 'bcd'
}


/**
 * The pooled type bins the sample's medians are taken over (typeDefaults):
 * a bin needs a few galaxies with RC3's photometry.
 */
const TYPE_BINS = Object.freeze([[0, 1], [2, 2], [3, 4], [5, 5], [6, 7], [8, 9], [10, 11]])


/**
 * @param {number} t
 * @returns {number} The index of t's bin in TYPE_BINS
 */
function typeBin(t) {
  return TYPE_BINS.findIndex(([lo, hi]) => t >= lo && t <= hi)
}


/**
 * What the sample itself says by type, for galaxies that lack it: the
 * median (B-V)_T^0 of the SPARC galaxies RC3 has it for, and the share of
 * barred (SB) and weakly barred (SAB) galaxies among those whose bar family
 * RC3 or SIMBAD gives.  Bluer and later go together (Roberts & Haynes
 * 1994); a third to two thirds barred, as in the optical (de Vaucouleurs
 * 1963; Eskridge et al. 2000 in the near infrared).
 *
 * @param {Array<object>} rows The catalogue's galaxies
 * @returns {{bv: Array<number>, barred: Array<number>, weak: Array<number>}} By TYPE_BINS
 */
export function typeDefaults(rows) {
  const bv = TYPE_BINS.map(() => [])
  const fam = TYPE_BINS.map(() => ({B: 0, X: 0, A: 0}))
  for (const g of rows) {
    const k = typeBin(g.T)
    if (Number.isFinite(g.rc3?.BV0)) {
      bv[k].push(g.rc3.BV0)
    }
    const f = barFamily(g)
    if (f) {
      fam[k][f]++
    }
  }
  const median = (a) => {
    const s = [...a].sort((x, y) => x - y)
    return s.length ? s[Math.floor(s.length / 2)] : 0.5
  }
  return {
    bv: bv.map(median),
    barred: fam.map((c) => c.B / Math.max(c.A + c.B + c.X, 1)),
    weak: fam.map((c) => c.X / Math.max(c.A + c.B + c.X, 1)),
  }
}


/**
 * A galaxy's bar family as classified: RC3's (its type's second letter: A
 * unbarred, B barred, X mixed), else SIMBAD's morphological type (SA, SB,
 * SAB).
 *
 * @param {object} g A catalogue row
 * @returns {?string} 'A', 'B', 'X' or null
 */
export function barFamily(g) {
  const rc3 = /^\.?[SLI]([ABX])/.exec(g.rc3?.type ?? '')
  if (rc3) {
    return rc3[1]
  }
  const m = g.simbad?.morph ?? ''
  if (/SAB|S_AB|SX/.test(m)) {
    return 'X'
  }
  if (/SB/.test(m)) {
    return 'B'
  }
  if (/SA/.test(m)) {
    return 'A'
  }
  return null
}


/**
 * B-V to a colour temperature (Ballesteros 2012, EPL 97, 34009: a
 * blackbody fitted to the B and V passbands).
 *
 * @param {number} bv
 * @returns {number} K
 */
export function bvTemperature(bv) {
  return 4600 * ((1 / ((0.92 * bv) + 1.7)) + (1 / ((0.92 * bv) + 0.62)))
}


/**
 * @param {number} bv
 * @returns {Array<number>} The colour of light of that B-V: its colour
 *   temperature's blackbody (stellar.js, the stars' colour), at luma 1
 */
export function bvColor(bv) {
  return unitLuma(blackbodyColor(bvTemperature(bv)))
}


/**
 * The young population's share of the V light that gives a galaxy its
 * colour, the other components' shares and colours (COMPONENT_BV) given:
 * B/V adds by light, 10^(-0.4·(B-V)) per unit of V.
 *
 * @param {number} bv The galaxy's (B-V)^0
 * @param {number} bulge The bulge's and bar's share (and the thick disc's: old)
 * @returns {number} 0 to YOUNG_MAX
 */
export function youngShare(bv, bulge) {
  const ratio = (c) => Math.pow(10, -0.4 * c)
  const want = ratio(bv)
  const fixed = bulge * ratio(COMPONENT_BV.bulge)
  // want = fixed + (1 - bulge - y)·old + y·young
  const old = ratio(COMPONENT_BV.old)
  const young = ratio(COMPONENT_BV.young)
  const y = (want - fixed - ((1 - bulge) * old)) / (young - old)
  return Math.min(Math.max(y, 0), Math.min(YOUNG_MAX, 1 - bulge))
}


const BULGE_RE = new Map()


/**
 * The projected half-light radius of the ellipsoidal bulge exp(-r^(1/n)),
 * seen along its axis, over its scale a: the radius holding half of
 * Σ(R) = 2∫ exp(-(R² + z²)^(1/2n)) dz.  By quadrature, cached.
 *
 * @param {number} n
 * @returns {number}
 */
export function bulgeHalfLightOverA(n) {
  let k = BULGE_RE.get(n)
  if (k !== undefined) {
    return k
  }
  // Out to where r^(1/n) is 40: e^-40 of the centre.
  const rMax = Math.pow(40, n)
  const N = 400
  const radii = []
  const sigma = []
  for (let i = 0; i <= N; i++) {
    // Log-spaced radii from rMax·1e-6.
    radii.push(rMax * Math.pow(10, -6 + (6 * i / N)))
  }
  for (const R of radii) {
    let s = 0
    let zPrev = 0
    let fPrev = Math.exp(-Math.pow(R, 1 / n))
    for (let j = 1; j <= 200; j++) {
      const z = rMax * Math.pow(10, -6 + (6 * j / 200))
      const fz = Math.exp(-Math.pow(Math.hypot(R, z), 1 / n))
      s += 0.5 * (fPrev + fz) * (z - zPrev)
      zPrev = z
      fPrev = fz
    }
    sigma.push(2 * s)
  }
  const cum = [0]
  for (let i = 1; i < radii.length; i++) {
    cum.push(cum[i - 1] + (Math.PI * ((radii[i] * sigma[i]) + (radii[i - 1] * sigma[i - 1])) * (radii[i] - radii[i - 1])))
  }
  const half = cum[cum.length - 1] / 2
  const i = cum.findIndex((c) => c >= half)
  const t = (half - cum[i - 1]) / (cum[i] - cum[i - 1])
  k = radii[i - 1] + (t * (radii[i] - radii[i - 1]))
  BULGE_RE.set(n, k)
  return k
}


/**
 * The face-on V luminosity, L_sun, and where it came from: RC3's B_T^0 and
 * (B-V)_T^0 (corrected for Galactic and internal extinction) at SPARC's
 * distance, else L[3.6] by V_OVER_36 at the colour.
 *
 * @param {object} g A catalogue row
 * @param {number} bv Its (B-V)^0, measured or its type's
 * @returns {{L: number, source: string}}
 */
export function faceOnLuminosityV(g, bv) {
  const r = g.rc3
  if (Number.isFinite(r?.BT0) && Number.isFinite(r?.BV0)) {
    const v0 = r.BT0 - r.BV0
    const mu = 5 * Math.log10(g.D * 1e5)
    return {L: Math.pow(10, -0.4 * (v0 - mu - SUN_MV)), source: 'RC3'}
  }
  return {L: g.L36 * 1e9 * Math.pow(10, V_OVER_36.a + (V_OVER_36.b * bv)), source: 'L[3.6]'}
}


/**
 * The disc's measured profile over the exponential the shader draws, as a
 * function of radius: the 3.6 µm decomposition's disc (face on) over
 * exp(-R/h_R), normalised to 1 at h_R, held at its ends, and kept within
 * PROFILE_RATIO_RANGE.
 *
 * @param {Array<Array<number>>} disc [R kpc, SB] (the catalogue's)
 * @param {number} hR
 * @returns {?function(number): number}
 */
export function profileRatio(disc, hR) {
  if (!disc || disc.length < 4) {
    return null
  }
  const pts = disc.map(([r, sb]) => [r, Math.log(Math.max(sb, 1e-9)) + (r / hR)])
  const at = (r) => {
    if (r <= pts[0][0]) {
      return pts[0][1]
    }
    if (r >= pts[pts.length - 1][0]) {
      return pts[pts.length - 1][1]
    }
    let i = 1
    while (pts[i][0] < r) {
      i++
    }
    const t = (r - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0])
    return pts[i - 1][1] + (t * (pts[i][1] - pts[i - 1][1]))
  }
  const ref = at(hR)
  const [lo, hi] = PROFILE_RATIO_RANGE
  return (r) => Math.min(Math.max(Math.exp(at(r) - ref), lo), hi)
}


/** The measured profile's departure from the exponential is held within this (a noisy outer point aside). */
export const PROFILE_RATIO_RANGE = Object.freeze([0.05, 20])


/** The cosines of the inclination attenuationTable tabulates: face on to edge on. */
export const ATTENUATION_MU = Object.freeze([1, 0.75, 0.5, 0.25, 0.05])


/**
 * The share of a galaxy's light that leaves it toward a viewer at each of
 * ATTENUATION_MU's inclinations, for its far point (Galaxies.js), from its
 * spec as a stack of plane-parallel slabs: at each radius every disc's
 * light, exp(-|z|/h_z), under the dust above it, exp(-|z|/h_d), along a
 * line of sight 1/μ longer than the vertical; the bulge and bar behind half
 * the central column.  The arms' and clumps' structure is averaged out
 * (the map's mean), so a galaxy's point is a little dimmer than its march
 * where its dust is in lanes.  Near edge on a slab's path is longer than a
 * disc's chord: μ is taken no lower than 0.05.
 *
 * @param {object} spec
 * @returns {Array<number>} Transmitted fractions, by ATTENUATION_MU
 */
export function attenuationTable(spec) {
  const {fractions: fr, dust} = spec
  const discs = [
    [fr.thin, spec.thin.hR, spec.thin.hz],
    [fr.thick, spec.thick.hR, spec.thick.hz],
    [fr.young + fr.hii, spec.young.hR, spec.young.hz],
  ]
  const kappaAt = (r) => dust.kappa * Math.exp(-(r - dust.normR) / dust.hR)
  const NR = 48
  const NZ = 64
  const rMax = spec.bounds.r
  return ATTENUATION_MU.map((mu) => {
    let out = 0
    let total = 0
    for (let i = 0; i < NR; i++) {
      const r = (i + 0.5) * rMax / NR
      const k0 = kappaAt(r)
      for (const [f, hR, hz] of discs) {
        if (!(f > 0)) {
          continue
        }
        // The disc's share of its light in this ring, and its vertical
        // profile under the dust, z from -6 h_z to 6 h_z.
        const ring = f * (r / (hR * hR)) * Math.exp(-r / hR) * (rMax / NR)
        let seen = 0
        let all = 0
        for (let j = 0; j < NZ; j++) {
          const z = ((((j + 0.5) / NZ) * 2) - 1) * 6 * hz
          const emit = Math.exp(-Math.abs(z) / hz)
          // The dust's column from z to the viewer's side (+z).
          const above = z >= 0 ? k0 * dust.hz * Math.exp(-z / dust.hz) : k0 * dust.hz * (2 - Math.exp(z / dust.hz))
          seen += emit * Math.exp(-above / Math.max(mu, 0.05))
          all += emit
        }
        out += ring * seen / all
        total += ring
      }
    }
    const central = 2 * kappaAt(0) * dust.hz
    const middle = (fr.bulge + fr.bar) * 0.5 * (1 + Math.exp(-central / Math.max(mu, 0.05)))
    return (out + middle) / Math.max(total + fr.bulge + fr.bar, 1e-12)
  })
}


/**
 * The integrated colour of a galaxy's light (luma 1): its components'
 * colours by their shares.
 *
 * @param {object} spec
 * @returns {Array<number>}
 */
export function integratedColor(spec) {
  const {fractions: fr, colors} = spec
  const rgb = [0, 1, 2].map((c) => (fr.thin * colors.old[c]) + ((fr.thick + fr.bulge + fr.bar) * colors.bulge[c]) +
    (fr.young * colors.young[c]) + (fr.hii * colors.hii[c]))
  return unitLuma(rgb)
}


/**
 * A galaxy's place and turn in the catalogue frame (the stars', metres
 * from the Sun, J2000 ecliptic in the scene's axes): its position from
 * RA, Dec and distance, and its disc's axes from the position angle and
 * inclination.  The disc's major axis is its line of nodes, along the
 * position angle on the sky (from north through east); its normal is
 * tilted from the line of sight by the inclination about that axis.  Which
 * side of the disc is nearer, and so which way it turns as seen, isn't in
 * any of the catalogues: the seed picks it (`near`, `mirror`), as it picks
 * the position angle where none was measured.
 *
 * @param {object} g A catalogue row
 * @param {function(): number} rand The galaxy's seeded generator
 * @returns {{position: Array<number>, basis: Array<Array<number>>, pa: number, paMeasured: boolean,
 *   near: number, mirror: number}} basis: the galaxy's X, Y (its pole) and Z axes in the catalogue frame
 */
export function galaxyPlacement(g, rand) {
  const {toward, north, east} = skyBasis(g.ra, g.dec)
  const d = g.D * MPC_METER
  const paMeasured = Number.isFinite(g.pa)
  const pa = paMeasured ? g.pa : 180 * rand()
  const near = rand() < 0.5 ? 1 : -1
  const mirror = rand() < 0.5 ? 1 : -1
  const p = pa * Math.PI / 180
  const inc = g.inc * Math.PI / 180
  const major = [0, 1, 2].map((k) => (Math.cos(p) * north[k]) + (Math.sin(p) * east[k]))
  const minor = [0, 1, 2].map((k) => (-Math.sin(p) * north[k]) + (Math.cos(p) * east[k]))
  const pole = [0, 1, 2].map((k) => (-Math.cos(inc) * toward[k]) + (near * Math.sin(inc) * minor[k]))
  const z = cross(major, pole).map((v) => v * mirror)
  return {position: toward.map((v) => v * d), basis: [major, pole, z], pa, paMeasured, near, mirror}
}


/**
 * @param {Array<number>} a
 * @param {Array<number>} b
 * @returns {Array<number>}
 */
function cross(a, b) {
  return [(a[1] * b[2]) - (a[2] * b[1]), (a[2] * b[0]) - (a[0] * b[2]), (a[0] * b[1]) - (a[1] * b[0])]
}


/**
 * The galaxy's spec for galaxyModel.js, and what was measured and what
 * defaulted (Galaxies.md has the table).
 *
 * @param {object} g A catalogue row
 * @param {object} defaults typeDefaults' of the whole catalogue
 * @returns {{spec: object, meta: object}}
 */
export function sparcSpec(g, defaults) {
  const rand = prng(hashString(g.name))
  const t = Math.min(Math.max(Math.round(g.T), 0), 11)
  const fam = family(t)
  const bin = typeBin(t)
  const hR = g.Rdisk
  // The colour: RC3's, else the type's median in the sample.
  const bvMeasured = Number.isFinite(g.rc3?.BV0)
  const bv = bvMeasured ? g.rc3.BV0 : defaults.bv[bin]
  const lum = faceOnLuminosityV(g, bv)
  // The bulge's share of V from its share of [3.6], redder than the whole
  // by its colour (V_OVER_36's slope); its size from the decomposition.
  const bulge36 = g.L36 > 0 ? (g.L36bul ?? 0) / g.L36 : 0
  const bulgeV = Math.min(bulge36 * Math.pow(10, V_OVER_36.b * (COMPONENT_BV.bulge - bv)), 0.9)
  const n = BULGE_BY_TYPE.n[t]
  const bulgeA = g.bulgeRe > 0 ? g.bulgeRe / bulgeHalfLightOverA(n) : 0.1 * hR
  // The bar: classified, else drawn at the sample's odds for the type.
  let barFam = barFamily(g)
  const barMeasured = barFam !== null
  if (!barFam) {
    const u = rand()
    barFam = u < defaults.barred[bin] ? 'B' : u < defaults.barred[bin] + defaults.weak[bin] ? 'X' : 'A'
  } else {
    rand()
  }
  const barShare = barFam === 'B' ? BAR_DEFAULTS.strongShare : barFam === 'X' ? BAR_DEFAULTS.weakShare : 0
  const barHalf = hR * (t <= 3 ? BAR_DEFAULTS.early : t <= 6 ? BAR_DEFAULTS.mid : BAR_DEFAULTS.late)
  const barAngle = 360 * rand()
  // The thick disc, by the rotation speed: V_flat, else the curve's highest.
  const v = g.Vflat > 0 ? g.Vflat : (g.Vmax ?? 100)
  const tv = Math.min(Math.max((THICK_DISC.fast - v) / (THICK_DISC.fast - THICK_DISC.slow), 0), 1)
  const thickRatio = THICK_DISC.fastRatio + (tv * (THICK_DISC.slowRatio - THICK_DISC.fastRatio))
  // The young population by the colour, its HII regions with it.
  const old = bulgeV + barShare
  const young = fam === 'lenticular' ? 0 : youngShare(bv, Math.min(old, 0.95))
  const hii = young * HII_OVER_YOUNG
  const discs = Math.max(1 - old - young - hii, 0.02)
  const fractions = {
    bulge: bulgeV,
    bar: barShare,
    thin: discs / (1 + thickRatio),
    thick: discs * thickRatio / (1 + thickRatio),
    young: young,
    hii,
  }
  // Scales.
  const hz = hR / HR_OVER_HZ[t]
  const thin = {hR, hz, holeR: 1, holeDepth: 0}
  const thick = {hR: hR * THICK_DISC.hR, hz: hz * THICK_DISC.hz}
  const youngDisc = {hR: hR * YOUNG_DISC.hR, hz: hz * YOUNG_DISC.hz}
  const hiiDisc = {hz: hz * YOUNG_DISC.hiiHz}
  const bar = {
    angleDeg: barAngle, halfLength: barHalf, end: 0.06 * barHalf,
    x0: bulgeA, y0: bulgeA, z0: bulgeA * BULGE_BY_TYPE.flattening[t],
    width: 0.15 * barHalf, hz: 0.075 * barHalf, scale: 2 * barHalf, n, boxy: false,
  }
  const tau = TAU_FACE_ON[t]
  const dustHz = hz * DUST_OVER_STARS.hz
  const dustHR = hR * DUST_OVER_STARS.hR
  const dust = {
    hR: dustHR, hz: dustHz, holeR: 0, rgb: DUST.rgb, normR: hR,
    // The mid-plane's extinction at h_R that makes τ_V face on through the centre.
    kappa: tau / (2 * dustHz) * Math.exp(-hR / dustHR),
  }
  // The arms.
  const arms = []
  let flocculent = null
  const armStart = barFam === 'A' ? 0.6 * hR : barHalf
  const armOuter = [3.5 * hR, 5.5 * hR]
  if (fam === 'spiral' || fam === 'magellanic') {
    const m = fam === 'magellanic' ? 1 : t <= 4 ? 2 : t <= 6 ? (rand() < 0.6 ? 2 : 3) : (rand() < 0.5 ? 3 : 4)
    const pitch = fam === 'magellanic' ? 25 : PITCH_DEG[t]
    const tanPsi = Math.tan(pitch * Math.PI / 180)
    // The arms cross the bar's ends (or the bulge's edge), evenly round.
    const start = Math.max(armStart, 0.3 * hR)
    const phase = barAngle * Math.PI / 180
    const grand = t <= 4
    for (let k = 0; k < m; k++) {
      // ln(R/r0) = -β tanψ through (start, phase + 2πk/m).
      const beta = phase + (2 * Math.PI * k / m)
      arms.push({
        name: `arm ${k + 1}`, r0: start * Math.exp(beta * tanPsi), pitchDeg: pitch,
        amp: fam === 'magellanic' ? 0.5 : grand ? 1.0 : 0.75,
        rStart: start * 0.9, rRise: 0.4 * hR, old: t <= 5 ? 1 : 0,
      })
    }
    if (t >= 5) {
      flocculent = {cut: t >= 7 ? 0.5 : 0.35, perLnR: 3}
    }
  }
  // Star formation in clumps for the armless (and the Magellanic).
  const youngL = young * lum.L
  let clumpsSF = null
  if (fam === 'magellanic' || fam === 'irregular' || fam === 'bcd') {
    const offR = (fam === 'bcd' ? 0.1 : 0.3) * hR * rand()
    const offA = 2 * Math.PI * rand()
    clumpsSF = {
      count: Math.round(Math.min(Math.max(6 + (4 * Math.log10(Math.max(youngL, 1e6) / 1e7)), 6), 30)),
      hR: fam === 'bcd' ? 0.4 * hR : youngDisc.hR,
      offset: [offR * Math.cos(offA), offR * Math.sin(offA)],
      size: 0.12 * hR, knotsPer: 4, diffuse: 0.6, dust: 0.5,
    }
  }
  const a1 = LOPSIDED_A1[t]
  const lopsided = a1 > 0 ? {a1, r: 2 * hR, phi: 2 * Math.PI * rand()} : null
  // How far the volume and the map reach: 6 scale lengths (98% of an
  // exponential disc's light), and 5 of the bulge's half-light radii.
  const reach = Math.max(6 * hR, 5 * (g.bulgeRe ?? 0), 1.2 * barHalf)
  const yReach = Math.max(5 * thick.hz, 5 * (g.bulgeRe ?? 0) * BULGE_BY_TYPE.flattening[t], 0.3)
  const scale = hR / 2.6
  const spec = {
    name: g.name,
    L: lum.L,
    fractions,
    thin,
    thick,
    young: youngDisc,
    hii: hiiDisc,
    flare: null,
    warp: null,
    bar,
    arms,
    armOuter,
    armSigma: {a: ARM_SIGMA.a * scale, b: ARM_SIGMA.b},
    dust,
    colors: {
      old: bvColor(COMPONENT_BV.old),
      bulge: bvColor(COMPONENT_BV.bulge),
      young: bvColor(COMPONENT_BV.young),
      hii: MILKY_WAY.colors.hii,
    },
    map: {size: 512, halfKpc: reach},
    bounds: {r: reach, y: yReach},
    steps: {...STEPS, PLANE: Math.max(STEPS.PLANE * scale, 0.01), VERT_MIN: Math.max(STEPS.VERT_MIN * hz / 0.3, 0.002)},
    recipe: {
      ...SPIRAL_RECIPE,
      oldFloor: fam === 'spiral' ? SPIRAL_RECIPE.oldFloor : 1, clumpKpc: Math.min(SPIRAL_RECIPE.clumpKpc, 1.2 * hR),
      youngFloor: fam === 'lenticular' ? 0 : fam === 'spiral' ? SPIRAL_RECIPE.youngFloor : DIFFUSE_YOUNG,
      youngFloorR: [0.2 * hR, 0.8 * hR, 4 * hR, 6 * hR],
    },
    knots: {
      count: arms.length ? Math.round(Math.min(Math.max(700 * youngL / (0.18 * 2.5e10), 0), 900)) : 0,
      r: [armStart, armOuter[1]], seed: hashString(`${g.name} knots`),
    },
    clumpSeed: hashString(`${g.name} clumps`) % 100000,
    barLanes: barShare > 0 && dust.kappa > 0,
    flocculent,
    lopsided,
    clumpsSF,
    profileRatio: profileRatio(g.disc, hR),
  }
  return {
    spec,
    meta: {
      family: fam,
      t,
      luminositySource: lum.source,
      bvMeasured,
      bv,
      barFamily: barFam,
      barMeasured,
      bulgeMeasured: g.bulgeRe > 0,
      profileMeasured: Boolean(spec.profileRatio),
      arms: arms.length,
    },
  }
}

