import {s10Value, surfaceBrightnessValue} from './eye.js'
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
 * The zodiacal light at 1 AU, in S10⊙ (V), as a function of the line of
 * sight's elongation from the Sun ε and its ecliptic latitude β: a fit to
 * Leinert et al. (1998)'s table of it (their Table 17), as recalled:
 *
 * - along the ecliptic, `base + scale·(90°/ε)^power`: about 2,000 at 30°
 *   from the Sun, 750 at 45°, 400 at 60°, 215 at 90° (21.9 mag/arcsec²),
 *   145 at 150°;
 * - the gegenschein, a glow of `gegenschein` round the antisolar point,
 *   `gegenscheinWidthDeg` wide, so 165 there;
 * - toward the ecliptic poles it falls to `pole`, 64 (23.3 mag/arcsec²),
 *   as e^(−|β|/latitudeWidthDeg) does, rescaled to reach the pole's value
 *   there;
 * - within `minElongationDeg` of the Sun it is held (the F-corona's, which
 *   the Sun's own glare covers).
 *
 * Its colour is sunlight's, a little reddened.  Away from 1 AU it goes as
 * r^−`heliocentricPower` (Helios, 0.3-1 AU: Leinert et al. 1981), and is
 * gone past the asteroid belt (`outerAU`: Pioneer 10 lost it beyond 3.3
 * AU, Hanner et al. 1974); and it fades as the camera leaves the dust's
 * plane (`heightAU`, a rough stand-in for the cloud's thickness).  These
 * are recalled values, to perhaps 30%.
 */
export const ZODIACAL = Object.freeze({
  base: 120,
  scale: 95,
  power: 2.72,
  pole: 64,
  gegenschein: 30,
  gegenscheinWidthDeg: 10,
  latitudeWidthDeg: 30,
  minElongationDeg: 3,
  heliocentricPower: 2.3,
  minAU: 0.3,
  outerAU: Object.freeze([2.8, 3.5]),
  heightAU: 0.5,
  color: Object.freeze(unitLuma([1.04, 1.0, 0.94])),
})


/**
 * @param {number} elongation ε, radians
 * @param {number} beta Ecliptic latitude, radians
 * @returns {number} The zodiacal light at 1 AU, S10⊙ (ZODIACAL)
 */
export function zodiacalS10(elongation, beta) {
  const z = ZODIACAL
  const e = Math.max(elongation / DEG, z.minElongationDeg)
  const ecliptic = z.base + (z.scale * ((90 / e) ** z.power)) +
    (z.gegenschein * Math.exp(-(((180 - e) / z.gegenscheinWidthDeg) ** 2)))
  const floor = Math.exp(-90 / z.latitudeWidthDeg)
  const across = (Math.exp(-Math.abs(beta / DEG) / z.latitudeWidthDeg) - floor) / (1 - floor)
  return z.pole + ((ecliptic - z.pole) * across)
}


/**
 * The zodiacal light's scale for a camera away from 1 AU in the ecliptic
 * (ZODIACAL), times what one S10⊙ is in exposure units at Earth's keyed
 * exposure: the factor the shader multiplies zodiacalS10 by.
 *
 * @param {number} rAU The camera's distance from the Sun, AU
 * @param {number} zAU Its height over the ecliptic plane, AU
 * @returns {number}
 */
export function zodiacalScale(rAU, zAU) {
  const z = ZODIACAL
  const r = Math.max(rAU, z.minAU)
  return s10Value(1) * (r ** -z.heliocentricPower) * (1 - smoothstep(z.outerAU[0], z.outerAU[1], rAU)) *
    Math.exp(-Math.abs(zAU) / z.heightAU)
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
 * GLSL: `vec3 zodiacalLight(vec3 ray)`, the zodiacal light along a view
 * ray (zodiacalS10 × uZodiacalScale × ZODIACAL.color), with `uniform vec3
 * uZodiacalSun` (the Sun's direction from the camera) and `uZodiacalPole`
 * (the ecliptic's north pole), both in view space, and `uniform float
 * uZodiacalScale` (zodiacalScale, pre-exposed by the caller); and `vec2
 * airglowPath(vec3 eye, vec3 dir, float tEnd)` (airglowPath), with
 * `uniform vec4 uAirglow` (the layer's inner and outer radii, m, and its
 * zenith value, pre-exposed, and 1 / its thickness).
 */
export const NIGHT_SKY_GLSL = `
uniform vec3 uZodiacalSun;
uniform vec3 uZodiacalPole;
uniform float uZodiacalScale;
uniform vec4 uAirglow;
uniform vec3 uAirglowColor;
vec3 zodiacalLight(vec3 ray) {
  if (!(uZodiacalScale > 0.0)) return vec3(0.0);
  float e = max(acos(clamp(dot(ray, uZodiacalSun), -1.0, 1.0)) * ${(180 / Math.PI).toFixed(8)},
    ${ZODIACAL.minElongationDeg.toFixed(1)});
  float ecliptic = ${ZODIACAL.base.toFixed(1)} + ${ZODIACAL.scale.toFixed(1)} * pow(90.0 / e, ${ZODIACAL.power.toFixed(4)})
    + ${ZODIACAL.gegenschein.toFixed(1)} * exp(-((180.0 - e) / ${ZODIACAL.gegenscheinWidthDeg.toFixed(1)})
      * ((180.0 - e) / ${ZODIACAL.gegenscheinWidthDeg.toFixed(1)}));
  float beta = asin(clamp(dot(ray, uZodiacalPole), -1.0, 1.0)) * ${(180 / Math.PI).toFixed(8)};
  float floorW = ${Math.exp(-90 / ZODIACAL.latitudeWidthDeg).toExponential(8)};
  float across = (exp(-abs(beta) / ${ZODIACAL.latitudeWidthDeg.toFixed(1)}) - floorW) / (1.0 - floorW);
  float s10 = ${ZODIACAL.pole.toFixed(1)} + (ecliptic - ${ZODIACAL.pole.toFixed(1)}) * across;
  return s10 * uZodiacalScale * vec3(${ZODIACAL.color.map((v) => v.toFixed(6)).join(', ')});
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
