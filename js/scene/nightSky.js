import {surfaceBrightnessValue} from './eye.js'
import {smoothstep} from './exposure.js'


/**
 * The night sky's own light, besides the galaxy's (MilkyWay.md): the
 * zodiacal light and the gegenschein, sunlight scattered by the
 * interplanetary dust, from anywhere in the inner solar system; and
 * airglow, the upper atmosphere's own emission, where a body has it (#186;
 * HDR.md, "The night sky's own light").  Both in exposure units at Earth's
 * keyed exposure, as the galaxy's light is, so the meter reads them as
 * light and the eye adapts to them.  The atmosphere pass draws them
 * (atmos/Atmosphere.js, NIGHT_SKY_GLSL), over the scene and behind its
 * bodies, through the air's transmittance.
 */


const DEG = Math.PI / 180


/**
 * @param {Array<number>} rgb
 * @returns {Array<number>} The colour scaled to luma 1
 */
function unitLuma(rgb) {
  const l = (0.2126 * rgb[0]) + (0.7152 * rgb[1]) + (0.0722 * rgb[2])
  return rgb.map((v) => v / l)
}


/**
 * Leinert et al. (1998)'s table of the zodiacal light seen from 1 AU in the
 * ecliptic (their Table 17), in S10⊙ (V), as a function of the line of
 * sight's elongation from the Sun ε and its ecliptic latitude β: a fit to it
 * as recalled, the reference the dust cloud (ZODIACAL_CLOUD) is normalised to
 * and tested against, not drawn:
 *
 * - along the ecliptic, `base + scale·(90°/ε)^power`: about 2,000 at 30°
 *   from the Sun, 750 at 45°, 400 at 60°, 215 at 90° (21.95 mag/arcsec²),
 *   145 at 150°;
 * - the gegenschein, a glow of `gegenschein` round the antisolar point,
 *   `gegenscheinWidthDeg` wide, so 165 there;
 * - toward the ecliptic poles it falls to `pole`, 64 (23.3 mag/arcsec²), as
 *   e^(−|β|/latitudeWidthDeg) does, rescaled to reach the pole's value there.
 *
 * Recalled values, to perhaps 30%.
 */
export const LEINERT = Object.freeze({
  base: 120,
  scale: 95,
  power: 2.72,
  pole: 64,
  gegenschein: 30,
  gegenscheinWidthDeg: 10,
  latitudeWidthDeg: 30,
})


/**
 * @param {number} elongation ε, radians (5° at least)
 * @param {number} beta Ecliptic latitude, radians
 * @returns {number} The zodiacal light seen from 1 AU, S10⊙ (LEINERT)
 */
export function leinertS10(elongation, beta) {
  const z = LEINERT
  const e = Math.max(elongation / DEG, 5)
  const ecliptic = z.base + (z.scale * ((90 / e) ** z.power)) +
    (z.gegenschein * Math.exp(-(((180 - e) / z.gegenscheinWidthDeg) ** 2)))
  const floor = Math.exp(-90 / z.latitudeWidthDeg)
  const across = (Math.exp(-Math.abs(beta / DEG) / z.latitudeWidthDeg) - floor) / (1 - floor)
  return z.pole + ((ecliptic - z.pole) * across)
}


/**
 * The interplanetary dust cloud, in 3D (#186's second cut): the smooth cloud
 * of Kelsall et al. (1998, COBE/DIRBE), its density n ∝ r^−α·f(ζ), α = 1.34,
 * with ζ = |Z|/r the height over its symmetry plane over the distance from the
 * Sun and f Kelsall's "widened fan", e^(−β·g^γ) with g = ζ²/2μ under μ and
 * ζ − μ/2 over it; the plane inclined 2.03° to the ecliptic, its ascending
 * node at 77.7°.  Sunlight falls as r^−2 and is scattered by Hong (1985)'s
 * phase function for the visible, three Henyey-Greenstein lobes (forward
 * 0.665 at g 0.7, backward 0.33 at −0.2, and 0.005 at −0.81, the
 * gegenschein's).  The brightness along a ray from anywhere is the
 * integral of density × sunlight × phase (zodiacalAlong), normalised so that
 * from 1 AU, 90° from the Sun in the ecliptic, it is LEINERT's 215 S10⊙; its
 * other anchors it reproduces as tested (nightSky.test.js).
 *
 * The first cut drew LEINERT's table, scaled as r^−2.3 with a fade off the
 * ecliptic, from anywhere: a viewer's table can't be moved, and away from 1
 * AU or off the plane the light round the Sun came out as a disc with a hard
 * rim (its elongation cut-off, held at 3°) or a blob 15° across (the user's
 * preview from 0.8 and 2.1 AU, 24° over the ecliptic).
 *
 * The cloud is gone past the asteroid belt (`outerAU`: Pioneer 10 lost the
 * zodiacal light beyond 3.3 AU, Hanner et al. 1974; Kelsall's cloud ends at
 * 5.2 AU).  Inside `minImpactAU` of the Sun (2 solar radii, the F-corona,
 * 0.5° from 1 AU) the integral is held: the Sun's disc and glow are there.
 */
export const ZODIACAL_CLOUD = Object.freeze({
  alpha: 1.34,
  fanBeta: 4.14,
  fanGamma: 0.942,
  fanMu: 0.189,
  inclinationDeg: 2.03,
  nodeDeg: 77.7,
  phase: Object.freeze([Object.freeze([0.665, 0.7]), Object.freeze([0.33, -0.2]), Object.freeze([0.005, -0.81])]),
  minImpactAU: 0.0093,
  outerAU: Object.freeze([3.3, 5.2]),
  steps: 32,
  color: Object.freeze(unitLuma([1.04, 1.0, 0.94])),
})


/**
 * The cloud's symmetry plane's normal, in the scene's ecliptic axes (X the
 * equinox, Y the ecliptic's north pole, Z = −ecliptic Y: celestialFrame.js).
 *
 * @returns {Array<number>}
 */
export function cloudNormal() {
  const i = ZODIACAL_CLOUD.inclinationDeg * DEG
  const node = ZODIACAL_CLOUD.nodeDeg * DEG
  // Ecliptic (x, y, z) = (sin i sin Ω, −sin i cos Ω, cos i); scene = (x, z, −y).
  return [Math.sin(i) * Math.sin(node), Math.cos(i), Math.sin(i) * Math.cos(node)]
}


/**
 * @param {number} zeta |Z|/r
 * @returns {number} Kelsall's widened fan, 1 in the plane
 */
export function fanProfile(zeta) {
  const {fanBeta, fanGamma, fanMu} = ZODIACAL_CLOUD
  const g = zeta < fanMu ? (zeta * zeta) / (2 * fanMu) : zeta - (fanMu / 2)
  return Math.exp(-fanBeta * (g ** fanGamma))
}


/**
 * @param {number} mu The cosine of the scattering angle, 1 forward
 * @returns {number} Hong (1985)'s phase function, up to a constant
 */
export function hongPhase(mu) {
  let p = 0
  for (const [w, g] of ZODIACAL_CLOUD.phase) {
    p += w * (1 - (g * g)) / (((1 + (g * g)) - (2 * g * mu)) ** 1.5)
  }
  return p
}


/**
 * The dust's scattered sunlight along a ray, unnormalised.  With the ray's
 * closest approach b to the Sun, a point on it is at r = b·sec φ, and
 * density × sunlight × path is b^−(α+1)·cos^α φ dφ: smooth in φ, so a
 * midpoint sum over φ from the eye's angle to 90° (the ray's far end)
 * takes it in `steps` steps wherever the Sun is.  The scattering angle's
 * cosine is −sin φ, and the height over the plane over r is cos φ·(q̂·n) +
 * sin φ·(d·n), q̂ the closest approach's direction.  The same arithmetic as
 * ZODIACAL_GLSL.
 *
 * @param {Array<number>} o The eye from the Sun, AU, scene ecliptic axes
 * @param {Array<number>} d The ray, unit
 * @returns {number}
 */
export function zodiacalRaw(o, d) {
  const c = ZODIACAL_CLOUD
  const n = cloudNormal()
  const tc = -((o[0] * d[0]) + (o[1] * d[1]) + (o[2] * d[2]))
  const q = [o[0] + (d[0] * tc), o[1] + (d[1] * tc), o[2] + (d[2] * tc)]
  const b0 = Math.hypot(...q)
  const b = Math.max(b0, c.minImpactAU)
  const qn = b0 > 1e-9 ? ((q[0] * n[0]) + (q[1] * n[1]) + (q[2] * n[2])) / b0 : 0
  const dn = (d[0] * n[0]) + (d[1] * n[1]) + (d[2] * n[2])
  const phi0 = Math.atan2(-tc, b)
  const dphi = ((Math.PI / 2) - phi0) / c.steps
  let sum = 0
  for (let k = 0; k < c.steps; k++) {
    const phi = phi0 + ((k + 0.5) * dphi)
    const cos = Math.cos(phi)
    const sin = Math.sin(phi)
    const r = b / cos
    const zeta = Math.abs((cos * qn) + (sin * dn))
    const outer = 1 - smoothstep(c.outerAU[0], c.outerAU[1], r)
    sum += (cos ** c.alpha) * fanProfile(zeta) * hongPhase(-sin) * outer
  }
  return sum * dphi * (b ** -(c.alpha + 1))
}


/**
 * The zodiacal light along a ray, S10⊙.
 *
 * @param {Array<number>} o The eye from the Sun, AU, scene ecliptic axes
 * @param {Array<number>} d The ray, unit
 * @returns {number}
 */
export function zodiacalAlong(o, d) {
  return zodiacalRaw(o, d) * zodiacalNorm()
}


let norm = null


/** @returns {number} The cloud's normalisation, S10⊙ per unit of zodiacalRaw */
export function zodiacalNorm() {
  if (norm === null) {
    norm = leinertS10(90 * DEG, 0) / zodiacalRaw([1, 0, 0], [0, 0, 1])
  }
  return norm
}


/**
 * The brightest the zodiacal light can be from a point: toward the Sun,
 * where the integral is held at minImpactAU.  For the skip of the night sky
 * by day (ThreeUi).
 *
 * @param {Array<number>} o The eye from the Sun, AU
 * @returns {number} S10⊙
 */
export function zodiacalBrightest(o) {
  const r = Math.hypot(...o)
  if (!(r > 1e-9)) {
    return zodiacalAlong([0, 0, 0], [1, 0, 0])
  }
  return zodiacalAlong(o, o.map((v) => -v / r))
}


/**
 * Earth's airglow (earth.json `atmosphere.airglow`): its zenith brightness
 * in V, from the emission layer at about 90 km (O I 557.7 nm at 97, Na at
 * 92, OH at 87) seen through it once.  22.4 mag/arcsec² at the zenith: the
 * natural sky at a dark site, 21.9-22.0 at solar minimum, less the
 * zodiacal light and the integrated starlight; airglow doubles from solar
 * minimum (22.6-22.8) to maximum (21.6-22.0) (Leinert et al. 1998; Benn &
 * Ellison 1998; Krisciunas 1997; recalled).  Its colour in V is the
 * green line's and sodium's.
 */
export const AIRGLOW_COLOR = Object.freeze(unitLuma([0.8, 1.0, 0.55]))


/**
 * The length of a ray inside a sphere, between two distances along it.
 *
 * @param {Array<number>} eye Relative to the sphere's centre
 * @param {Array<number>} dir Unit
 * @param {number} radius
 * @param {number} t0
 * @param {number} t1
 * @returns {number}
 */
function insideLength(eye, dir, radius, t0, t1) {
  const b = (eye[0] * dir[0]) + (eye[1] * dir[1]) + (eye[2] * dir[2])
  const c = (eye[0] ** 2) + (eye[1] ** 2) + (eye[2] ** 2) - (radius * radius)
  const disc = (b * b) - c
  if (!(disc > 0)) {
    return 0
  }
  const s = Math.sqrt(disc)
  return Math.max(0, Math.min(t1, -b + s) - Math.max(t0, -b - s))
}


/**
 * The airglow layer's path along a ray, over its thickness: 1 looking
 * straight up through it, the van Rhijn factor 1/√(1 − (R/(R+h))²sin²z)
 * at a zenith angle z from under it (5.7 at the horizon for 90 km, before
 * the air's extinction), and finite at its limb, where a thin-shell formula
 * isn't.  The ray is cut at tEnd (the ground, a surface), and its path is
 * split where it passes closest to the planet's centre: from above the
 * atmosphere, the near crossing is in front of the air and the far one
 * behind it (the shader dims only the far one by the air's transmittance).
 * The same arithmetic as NIGHT_SKY_GLSL's.
 *
 * @param {Array<number>} eye The camera relative to the planet's centre, m
 * @param {Array<number>} dir The ray, unit
 * @param {number} height The layer's centre over the ground sphere, m
 * @param {number} thickness The layer's thickness, m
 * @param {number} groundRadius m
 * @param {number} [tEnd] Where the ray ends, m
 * @returns {{near: number, far: number}} Each part's path over the thickness
 */
export function airglowPath(eye, dir, height, thickness, groundRadius, tEnd = Infinity) {
  const rIn = groundRadius + height - (thickness / 2)
  const rOut = rIn + thickness
  const tc = -((eye[0] * dir[0]) + (eye[1] * dir[1]) + (eye[2] * dir[2]))
  const part = (t0, t1) => (t1 > t0 ?
    (insideLength(eye, dir, rOut, t0, t1) - insideLength(eye, dir, rIn, t0, t1)) / thickness : 0)
  return {near: part(0, Math.min(tc, tEnd)), far: part(Math.max(tc, 0), tEnd)}
}


/**
 * A body's airglow, from its atmosphere's `airglow` (earth.json): the
 * zenith brightness in exposure units at Earth's keyed exposure, and the
 * layer's height and thickness.  Null for a body without.
 *
 * @param {object} atmosphere The body's props.atmosphere
 * @returns {{zenithValue: number, height: number, thickness: number}|null}
 */
export function airglowOf(atmosphere) {
  const a = atmosphere?.airglow
  if (!a || !(a.zenithMag > 0)) {
    return null
  }
  const metres = (v) => (typeof v === 'object' && v !== null ? v.scalar : Number(v))
  return {
    zenithValue: surfaceBrightnessValue(a.zenithMag),
    height: metres(a.height),
    thickness: metres(a.thickness),
  }
}


/**
 * The zodiacal light's cache holds S10⊙ × this, in half floats: 64 at the
 * poles is 0.064, and the brightest, by the Sun, a few 1e6, under 1e4.
 */
export const ZODIACAL_STORE = 1e-3


/**
 * GLSL: `float zodiacalAlong(vec3 o, vec3 d)`, zodiacalAlong (S10⊙), for the
 * zodiacal light's cache (ZodiacalLight.js).  The same arithmetic.
 *
 * @returns {string}
 */
export function zodiacalGlsl() {
  const c = ZODIACAL_CLOUD
  const n = cloudNormal()
  const f = (v) => Number(v).toExponential(8)
  const lobes = c.phase.map(([w, g]) =>
    `${f(w * (1 - (g * g)))} / pow(${f(1 + (g * g))} - ${f(2 * g)} * mu, 1.5)`).join(' + ')
  return `
const vec3 ZL_NORMAL = vec3(${n.map(f).join(', ')});
float zlFan(float zeta) {
  float g = zeta < ${f(c.fanMu)} ? zeta * zeta / ${f(2 * c.fanMu)} : zeta - ${f(c.fanMu / 2)};
  return exp(-${f(c.fanBeta)} * pow(max(g, 1.0e-12), ${f(c.fanGamma)}));
}
float zlPhase(float mu) {
  return ${lobes};
}
float zodiacalAlong(vec3 o, vec3 d) {
  float tc = -dot(o, d);
  vec3 q = o + d * tc;
  float b0 = length(q);
  float b = max(b0, ${f(c.minImpactAU)});
  float qn = b0 > 1.0e-9 ? dot(q, ZL_NORMAL) / b0 : 0.0;
  float dn = dot(d, ZL_NORMAL);
  float phi0 = atan(-tc, b);
  float dphi = (${f(Math.PI / 2)} - phi0) / ${f(c.steps)};
  float sum = 0.0;
  for (int k = 0; k < ${c.steps}; k++) {
    float phi = phi0 + (float(k) + 0.5) * dphi;
    float cs = cos(phi);
    float sn = sin(phi);
    float r = b / cs;
    float zeta = abs(cs * qn + sn * dn);
    float t = clamp((r - ${f(c.outerAU[0])}) / ${f(c.outerAU[1] - c.outerAU[0])}, 0.0, 1.0);
    float outer = 1.0 - t * t * (3.0 - 2.0 * t);
    sum += pow(cs, ${f(c.alpha)}) * zlFan(zeta) * zlPhase(-sn) * outer;
  }
  return sum * dphi * pow(b, -${f(c.alpha + 1)}) * ${f(zodiacalNorm())};
}
`
}


/**
 * GLSL: `vec3 zodiacalLight()`, the zodiacal light at this pixel from its
 * cache (ZodiacalLight.js; `uniform sampler2D uZodiacal`), times `uniform
 * float uZodiacalScale` (an S10⊙ in exposure units at Earth's keyed
 * exposure over ZODIACAL_STORE; 0 while it's skipped) and its colour; and
 * `vec2 airglowPath(vec3 eye, vec3 dir, float tEnd)` (airglowPath), with
 * `uniform vec4 uAirglow` (the layer's inner and outer radii, m, and its
 * zenith value, pre-exposed, and 1 / its thickness).  Needs `varying vec2
 * vUv`.
 */
export const NIGHT_SKY_GLSL = `
uniform sampler2D uZodiacal;
uniform float uZodiacalScale;
uniform vec4 uAirglow;
uniform vec3 uAirglowColor;
vec3 zodiacalLight() {
  if (!(uZodiacalScale > 0.0)) return vec3(0.0);
  return texture2D(uZodiacal, vUv).r * uZodiacalScale * vec3(${ZODIACAL_CLOUD.color.map((v) => v.toFixed(6)).join(', ')});
}
float insideLength(vec3 eye, vec3 dir, float radius, float t0, float t1) {
  float b = dot(eye, dir);
  float c = dot(eye, eye) - radius * radius;
  float disc = b * b - c;
  if (!(disc > 0.0)) return 0.0;
  float s = sqrt(disc);
  return max(0.0, min(t1, -b + s) - max(t0, -b - s));
}
vec2 airglowPath(vec3 eye, vec3 dir, float tEnd) {
  if (!(uAirglow.z > 0.0)) return vec2(0.0);
  float tc = -dot(eye, dir);
  float t1 = min(tc, tEnd);
  float t2 = max(tc, 0.0);
  float nearPath = t1 > 0.0 ?
    insideLength(eye, dir, uAirglow.y, 0.0, t1) - insideLength(eye, dir, uAirglow.x, 0.0, t1) : 0.0;
  float farPath = tEnd > t2 ?
    insideLength(eye, dir, uAirglow.y, t2, tEnd) - insideLength(eye, dir, uAirglow.x, t2, tEnd) : 0.0;
  return vec2(nearPath, farPath) * uAirglow.w;
}
`
