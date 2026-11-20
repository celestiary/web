/**
 * A coronal mass ejection's shape and what it is made of (js/scene/Sun.md,
 * "CMEs"): a flux rope, the graduated cylindrical shell of Thernisien,
 * Howard & Vourlidas (2006, ApJ 652, 763; Thernisien 2011, ApJS 194, 33),
 * a "hollow croissant" on two legs rooted in the Sun, expanding with its
 * front, and the classic three parts (Illing & Hundhausen 1985): the
 * bright front, compressed corona draped over the rope; the cavity, the
 * rope's interior; and the core, the prominence that erupted, at the
 * rope's sunward side.
 *
 * It is drawn as particles of two sorts, each carrying a fixed share of
 * the CME's electrons.  Its plasma is frozen to the field, so the rope and
 * the core are the field's lines: **threads**, each a soft tube along a
 * path, helices wound round the rope's axis and a tight twisted bundle
 * for the core.  The front is **puffs**, soft blobs lying on the shells
 * draped over the rope's leading side.  Their sum along a line of sight
 * is the CME's electron column, which Thomson-scatters the disc's light
 * as the corona's does (corona.js): the picture is physical, and so is
 * its depth, since every particle is where it is in three dimensions.
 *
 * This file is the model in JS (the strands' parameters, the shape, and
 * the mirror the tests read) and in GLSL (the vertex shader's); keep the
 * two the same.  CmeCloud.js draws it.
 *
 * It is in the CMEs' chunk, loaded when one is first in view, so it
 * imports nothing the page's first load has: what it needs of that
 * (corona.js's dilution, sunRandom.js's generator and hash2) is handed to
 * cmeModel(), as the cloud's is (SunLayers CME_DEPS).  A module both
 * imported would be split into a file of its own for the first load to
 * fetch (esbuild/budget.js).
 */


export const KIND_ROPE = 0
export const KIND_SHEATH = 1
export const KIND_CORE = 2
// How many particles of each kind a CME is drawn with, and the share of
// its electrons each kind carries (a model: the front holds most of a
// CME's mass, its core a fifth: Vourlidas et al. 2013 find the core 10-30%).
export const STRANDS = Object.freeze([1400, 900, 500])
export const SHARE = Object.freeze([0.35, 0.5, 0.15])
// Each strand is drawn in this many segments.
export const SEGMENTS = 48
// The rope's axis runs over this range of its parameter ψ, a little short
// of ±π/2, where it meets the surface.
export const PSI_MAX = 1.45
// The rope's tube: its radius over the axis's distance from the centre,
// far out (the shell model's aspect ratio κ, 0.2-0.5 in Thernisien et al.
// 2009's fits), from the CME's apparent half-width w as sin(0.7 w) over the
// front's edge, held to this range; and the legs' half-angle α, 2(w − δ),
// δ the front's own angular half-width, held to this range (radians).
export const KAPPA = Object.freeze([0.16, 0.36])
export const ALPHA = Object.freeze([0.14, 1.3])
// The tube grows in from nothing as the rope lifts off: × H / (H + 0.5),
// H the axis's height over the surface in radii (a model: a CME starts the
// size of its active region and swells faster than it rises at first);
// and it narrows to this share of itself at the feet.
export const GROW_HEIGHT = 0.5
export const FOOT_TAPER = 0.35
// The front's outer edge, in tube radii from the axis: the CME's `front`
// (its leading edge) is the axis's apex plus this.
export const SHEATH_EDGE = 1.45
// The core's centre, in tube radii from the axis, sunward; and its radius.
export const CORE_OFFSET = -0.42
export const CORE_RADIUS = 0.38
// The rope's field turns this many times round its axis from foot to foot
// (a model: one to three turns), the core's 1.8 times as many.
export const TWIST = Object.freeze([1.2, 2.8])
export const CORE_TWIST = 1.8
// A strand's light along itself, by kind: faded to its ends, sin(πq)^p (a
// rope's thread holds nearly to its feet); fainter down the legs,
// cos(ψ)^m; knotted, 1 ± 0.6.
export const ENDS_POWER = Object.freeze([0.25, 0.6, 0.5])
export const LEG_POWER = Object.freeze([0.5, 0, 0.8])
export const KNOTS = 0.6

// A CME's bright core is the prominence that erupted under it: of 186
// prominence eruptions at Nobeyama, 72% went with a CME (Gopalswamy et al.
// 2003, ApJ 586, 562).  Here that share of the CMEs have a core of cool
// plasma, which shines as the prominences do, by scattering the disc's
// light in its lines, so its light falls with the disc's dilution, W(r) =
// (1 − √(1 − 1/r²)) / 2, from a prominence's at the surface:
// - in Hα (white light): a bright prominence's 0.02 nm (twice the typical
//   0.01) while the line is thick, then with its optical depth, 30 at the
//   start and falling with the cube of its size, (0.1 / (0.1 + h))³, h its
//   height in radii (a model: the plasma thins as it swells, and ionises),
//   so a thousandth of it is left a radius and a half up;
// - in He II 304 Å (the activity view): 5 times the quiet disc at the
//   start, as bright as plage, the line thick all the way (its depth in a
//   prominence is in the thousands), so with the dilution alone: 1 at 2
//   radii, a tenth at 5 (a model of the pictures: erupting prominences
//   are followed to a few radii in 304 Å).
// It is followed to 6 radii.
export const ERUPTIVE_SHARE = 0.72
export const ERUPTION_HALPHA_NM = 0.02
export const ERUPTION_DEPTH = Object.freeze({depth: 30, size: 0.1, index: 3})
export const ERUPTION_304_LEVEL = 5
export const ERUPTION_MAX_HEIGHT = 6
const STREAM_ERUPTIONS = 5
const DEG = Math.PI / 180
const TAU = 2 * Math.PI


const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi)


/**
 * @param {number} H The axis's apex height over the surface, radii
 * @param {number} kappa
 * @returns {number} The tube's radius over the axis's distance from the centre
 */
export function tubeScale(H, kappa) {
  return kappa * H / (H + GROW_HEIGHT)
}


/**
 * @param {number} H
 * @param {number} kappa
 * @returns {number} The front's leading edge, radii from the centre
 */
export function frontRadius(H, kappa) {
  return (1 + H) * (1 + (SHEATH_EDGE * tubeScale(H, kappa)))
}


/**
 * The axis's apex height for a leading edge at a radius (bisection: the
 * edge grows with the height).
 *
 * @param {number} front radii from the centre
 * @param {number} kappa
 * @returns {number} H, at least 0.02
 */
export function solveApex(front, kappa) {
  let lo = 0
  let hi = Math.max(front, 1)
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2
    if (frontRadius(mid, kappa) < front) {
      lo = mid
    } else {
      hi = mid
    }
  }
  return Math.max((lo + hi) / 2, 0.02)
}


/**
 * The model's two functions that need the first load's modules.
 *
 * @param {object} deps {dilution, generator, hash2}
 * @returns {{shapeOf: Function, buildStrands: Function}}
 */
export function cmeModel(deps) {
  return {
    shapeOf: (cme, seed = 0) => shapeOf(deps, cme, seed),
    buildStrands: (seed = 20240417) => buildStrands(deps, seed),
  }
}


/**
 * A CME's shape now, from its record (solarEvents.js cmesAt) and the
 * star's seed: the same for a date in every session.
 *
 * @param {object} deps {dilution, hash2}
 * @param {object} cme {launch, width (half-angle, rad), front (radii)}
 * @param {number} seed
 * @returns {object} {kappa, alpha, H, tube: the tube's scale now, twist
 *     (turns), tilt (the axis from east, rad), theta, phase (the strands'
 *     turn and wobble for this CME), flip (±1), core: the core's distance
 *     from the centre, halpha: its cool plasma's Hα in nm, and euv: its
 *     level in He II 304 Å over the quiet disc; both 0 for none}
 */
function shapeOf({dilution, hash2}, cme, seed) {
  const diluted = (r) => dilution(r) / (4 * r * r)
  const u = (n) => hash2(Math.floor(cme.launch / 1000) + (n * 7919), seed + STREAM_ERUPTIONS) / 4294967296
  const kappa = clamp(Math.sin(0.7 * cme.width) / SHEATH_EDGE, KAPPA[0], KAPPA[1])
  const edge = Math.asin(Math.min(SHEATH_EDGE * kappa, 0.95))
  const alpha = clamp(2 * (cme.width - edge), ALPHA[0], ALPHA[1])
  const H = solveApex(Math.max(cme.front, 1), kappa)
  const tube = tubeScale(H, kappa)
  const core = (1 + H) * (1 + (CORE_OFFSET * tube))
  const height = Math.max(core - 1, 0.03)
  // The disc's light there, W(r), the share of the sky it fills, over a
  // prominence's at the surface; none past
  // the height it is followed to, or for a CME without a prominence.
  const lit = u(0) < ERUPTIVE_SHARE ?
    clamp((ERUPTION_MAX_HEIGHT - height) / 1.5, 0, 1) * diluted(1 + height) / diluted(1.03) : 0
  const {depth, size, index} = ERUPTION_DEPTH
  return {
    kappa, alpha, H, tube, core,
    halpha: ERUPTION_HALPHA_NM * lit * Math.min(1, depth * ((size / (size + height)) ** index)),
    euv: ERUPTION_304_LEVEL * lit,
    twist: TWIST[0] + ((TWIST[1] - TWIST[0]) * u(4)),
    tilt: (u(2) - 0.5) * 80 * DEG,
    theta: TAU * u(5),
    phase: TAU * u(6),
    flip: u(7) < 0.5 ? -1 : 1,
  }
}


/**
 * A strand's light along itself, before its knots: faded to its ends and
 * down the legs.
 *
 * @param {number} q 0 to 1 along the strand
 * @param {number} psi The axis's parameter there
 * @param {number} kind
 * @returns {number}
 */
export function envelope(q, psi, kind) {
  const ends = Math.max(Math.sin(Math.PI * q), 0) ** ENDS_POWER[kind]
  const m = LEG_POWER[kind]
  return m > 0 ? ends * (Math.max(Math.cos(psi), 0) ** m) : ends
}


/**
 * The particles every CME is drawn with: each one's path on the rope, its
 * tube, its wobble and its share of the electrons.  Seeded, the threads
 * and the puffs each in a random order, so that any first n of them are a
 * fair sample (the cloud draws fewer when a CME is small on screen).
 *
 * Per particle, four vec4s (the shader's instanced attributes):
 * - path: ψ at its two ends, θ at its start, and the turn of θ along it
 *   for a rope of one turn;
 * - tube: its distance from the axis and its offset along the outward
 *   normal (tube radii), its own radius σ (tube radii), and its share of
 *   the CME's electrons over its envelope's integral;
 * - wobble: its radial wobble's amplitude, frequency and phase, and its
 *   turn of θ that doesn't follow the rope's twist (a puff's);
 * - extra: its kind, its share of the CME's electrons, and two spare.
 *
 * @param {object} deps {generator}
 * @param {number} seed
 * @returns {{threads: object, puffs: object}} Each {count, path, tube,
 *     wobble, extra (Float32Arrays)}
 */
function buildStrands({generator}, seed) {
  const rng = generator(seed)
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(rng(), 1e-12))) * Math.cos(TAU * rng())
  const logUniform = (lo, hi) => lo * ((hi / lo) ** rng())
  const strands = []
  const unitTurn = (psi0, psi1) => TAU * (psi1 - psi0) / (2 * PSI_MAX)
  // The rope's threads: helices on its shell, most of them foot to foot.
  for (let i = 0; i < STRANDS[KIND_ROPE]; i++) {
    let psi0 = -PSI_MAX
    let psi1 = PSI_MAX
    if (rng() > 0.65) {
      const centre = (rng() - 0.5) * 2 * PSI_MAX
      const half = 0.35 + (0.65 * rng())
      psi0 = Math.max(centre - half, -PSI_MAX)
      psi1 = Math.min(centre + half, PSI_MAX)
    }
    const sigma = logUniform(0.012, 0.09)
    strands.push({
      kind: KIND_ROPE, psi0, psi1,
      theta0: TAU * rng(),
      turn: unitTurn(psi0, psi1) * (1 + (0.3 * (rng() - 0.5))),
      fixed: 0,
      rho: clamp(0.95 + (0.13 * gauss()), 0.7, 1.2),
      offset: 0,
      sigma,
      weight: (sigma ** 0.7) * (0.4 + (1.2 * rng())),
      amp: 0.03 + (0.09 * rng()), freq: 4 + (10 * rng()), phase: TAU * rng(),
    })
  }
  // The front's puffs: soft blobs, a little longer one way than the others,
  // lying any way on the shells draped over the rope's leading side, most
  // near its nose.  Their path is only the way they are stretched.
  for (let i = 0; i < STRANDS[KIND_SHEATH]; i++) {
    const psiC = (rng() - 0.5) * 2 * 1.3
    const thetaC = (rng() - 0.5) * 2 * 2.0
    const way = TAU * rng()
    const half = 0.15 + (0.2 * rng())
    const sigma = 0.1 + (0.14 * rng())
    const dTheta = 1.2 * half * Math.sin(way)
    strands.push({
      kind: KIND_SHEATH,
      psi0: clamp(psiC - (half * Math.cos(way)), -PSI_MAX, PSI_MAX),
      psi1: clamp(psiC + (half * Math.cos(way)), -PSI_MAX, PSI_MAX),
      theta0: thetaC - dTheta,
      turn: 0,
      fixed: 2 * dTheta,
      rho: 1.08 + (0.5 * (rng() ** 2)),
      offset: 0,
      sigma,
      weight: sigma * sigma * (Math.cos(psiC) ** 0.8) * (0.35 + (0.65 * (Math.cos(thetaC / 2) ** 2))) * (0.5 + rng()),
      amp: 0.02 + (0.04 * rng()), freq: 2 + (4 * rng()), phase: TAU * rng(),
    })
  }
  // The core's threads: a tight bundle at the rope's sunward side, more
  // twisted than the rope, about its apex.
  for (let i = 0; i < STRANDS[KIND_CORE]; i++) {
    const centre = clamp(0.5 * gauss(), -1, 1)
    const half = 0.3 + (0.6 * rng())
    const psi0 = Math.max(centre - half, -1.3)
    const psi1 = Math.min(centre + half, 1.3)
    const sigma = logUniform(0.01, 0.04)
    strands.push({
      kind: KIND_CORE, psi0, psi1,
      theta0: TAU * rng(),
      turn: CORE_TWIST * unitTurn(psi0, psi1) * (1 + (0.4 * (rng() - 0.5))),
      fixed: 0,
      rho: CORE_RADIUS * Math.sqrt(rng()),
      offset: CORE_OFFSET,
      sigma,
      weight: (sigma ** 0.7) * (0.3 + (1.4 * rng())),
      amp: 0.05 + (0.15 * rng()), freq: 5 + (12 * rng()), phase: TAU * rng(),
    })
  }
  // Each kind's weights to its share; each strand's share over its
  // envelope's integral, so its light along q integrates to the share.
  const totals = [0, 0, 0]
  for (const s of strands) {
    totals[s.kind] += s.weight
  }
  for (const s of strands) {
    const n = 24
    let integral = 0
    for (let k = 0; k < n; k++) {
      const q = (k + 0.5) / n
      integral += envelope(q, s.psi0 + ((s.psi1 - s.psi0) * q), s.kind) / n
    }
    s.share = SHARE[s.kind] * s.weight / totals[s.kind]
    s.density = s.share / Math.max(integral, 1e-6)
  }
  // The threads and the puffs apart (they are drawn differently), each in
  // a random order (Fisher-Yates).
  const pack = (list) => {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      const tmp = list[i]
      list[i] = list[j]
      list[j] = tmp
    }
    const count = list.length
    const out = {count, path: new Float32Array(4 * count), tube: new Float32Array(4 * count),
      wobble: new Float32Array(4 * count), extra: new Float32Array(4 * count)}
    list.forEach((s, i) => {
      out.path.set([s.psi0, s.psi1, s.theta0, s.turn], 4 * i)
      out.tube.set([s.rho, s.offset, s.sigma, s.density], 4 * i)
      out.wobble.set([s.amp, s.freq, s.phase, s.fixed], 4 * i)
      out.extra.set([s.kind, s.share, 0, 0], 4 * i)
    })
    return out
  }
  return {
    threads: pack(strands.filter((s) => s.kind !== KIND_SHEATH)),
    puffs: pack(strands.filter((s) => s.kind === KIND_SHEATH)),
  }
}


/**
 * A point on a strand, in radii from the star's centre, by its components
 * along the CME's own directions: its axis at the apex (T), outward (d),
 * and B = d × T.  As the shader's strandPoint.
 *
 * @param {object} strands buildStrands' threads or puffs
 * @param {number} i Which one
 * @param {number} q 0 to 1 along it
 * @param {object} shape shapeOf's
 * @returns {{point: Array<number>, psi: number, tube: number}} The point,
 *     the axis's parameter there, and the tube's radius there (radii)
 */
export function strandPoint(strands, i, q, shape) {
  const [psi0, psi1, theta0, turn] = strands.path.subarray(4 * i, (4 * i) + 4)
  const [rho0, offset] = strands.tube.subarray(4 * i, (4 * i) + 2)
  const [amp, freq, phase, fixed] = strands.wobble.subarray(4 * i, (4 * i) + 4)
  const kind = strands.extra[4 * i]
  const psi = shape.flip * (psi0 + ((psi1 - psi0) * q))
  const spin = kind === KIND_SHEATH ? 0 : shape.theta
  const theta = theta0 + spin + (((shape.twist * turn) + fixed) * q)
  const rho = rho0 * (1 + (amp * Math.sin((freq * q) + phase + shape.phase)))
  const sp = Math.sin(psi)
  const cp = Math.cos(psi)
  const phi = shape.alpha * sp
  const r = 1 + (shape.H * cp)
  // The radial and the turning directions in the axis's plane (x, y).
  const er = [Math.sin(phi), Math.cos(phi)]
  const ephi = [Math.cos(phi), -Math.sin(phi)]
  let tx = (-shape.H * sp * er[0]) + (r * shape.alpha * cp * ephi[0])
  let ty = (-shape.H * sp * er[1]) + (r * shape.alpha * cp * ephi[1])
  const tl = Math.hypot(tx, ty) || 1
  tx /= tl
  ty /= tl
  // The outward normal, t × B: with t = tx T + ty d and B = d × T, tx d − ty T.
  const n = [-ty, tx]
  const tube = shape.tube * r * (FOOT_TAPER + ((1 - FOOT_TAPER) * cp))
  const along = offset + (rho * Math.cos(theta))
  return {
    point: [
      (r * er[0]) + (tube * along * n[0]),
      (r * er[1]) + (tube * along * n[1]),
      tube * rho * Math.sin(theta),
    ],
    psi,
    tube,
  }
}


/**
 * GLSL: the same.  The caller declares the instanced attributes aPath,
 * aTube, aWobble, aExtra, and the uniforms uT, uD, uB (the CME's frame),
 * uShape (alpha, H, tube, twist) and uSeed (theta, phase, flip, the knots'
 * drift).
 */
export const STRAND_GLSL = `
const float FOOT_TAPER = ${FOOT_TAPER.toFixed(3)};
const float KNOTS = ${KNOTS.toFixed(3)};

vec3 strandPoint(float q, out float psi, out float tube) {
  psi = uSeed.z * mix(aPath.x, aPath.y, q);
  float spin = aExtra.x == 1.0 ? 0.0 : uSeed.x;
  float theta = aPath.z + spin + (uShape.w * aPath.w + aWobble.w) * q;
  float rho = aTube.x * (1.0 + aWobble.x * sin(aWobble.y * q + aWobble.z + uSeed.y));
  float sp = sin(psi);
  float cp = cos(psi);
  float phi = uShape.x * sp;
  float r = 1.0 + uShape.y * cp;
  vec3 er = sin(phi) * uT + cos(phi) * uD;
  vec3 ephi = cos(phi) * uT - sin(phi) * uD;
  vec3 t = normalize((-uShape.y * sp) * er + (r * uShape.x * cp) * ephi);
  vec3 n = cross(t, uB);
  tube = uShape.z * r * (FOOT_TAPER + (1.0 - FOOT_TAPER) * cp);
  return r * er + tube * ((aTube.y + rho * cos(theta)) * n + rho * sin(theta) * uB);
}

float strandEnvelope(float q, float psi) {
  vec2 pm = aExtra.x == 0.0 ? vec2(${ENDS_POWER[0].toFixed(2)}, ${LEG_POWER[0].toFixed(2)}) :
      (aExtra.x == 1.0 ? vec2(${ENDS_POWER[1].toFixed(2)}, ${LEG_POWER[1].toFixed(2)}) :
      vec2(${ENDS_POWER[2].toFixed(2)}, ${LEG_POWER[2].toFixed(2)}));
  float ends = pow(max(sin(3.14159265 * q), 0.0), pm.x);
  float m = pm.y;
  float legs = m > 0.0 ? pow(max(cos(psi), 0.0), m) : 1.0;
  float knots = 1.0 + KNOTS * sin(aWobble.y * 2.7 * q + aWobble.z * 5.1 - uSeed.w);
  return ends * legs * knots;
}
`
