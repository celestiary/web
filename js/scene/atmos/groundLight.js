// The ground's light through the air (composition.md, "The ground's light"):
// Bruneton's ground irradiance, the Sun's light times its transmittance to
// the point, plus the sky's irradiance, from a table the precompute makes
// with the body's others (AtmospherePrecompute precomputeGroundLight).  The
// table is a body's while its air is the atmosphere pass's (ThreeUi builds
// one body's tables at a time); a surface whose body has no table lit is
// lit by the Sun above the air, as before.


/**
 * The table's layout: GROUND_LIGHT_W columns over the Sun's zenith cosine
 * from MU_S_MIN to 1, and two halves of GROUND_LIGHT_ROWS rows over the
 * height from the ground to the air's top: the lower the Sun's transmittance
 * to the point (delta-M, the planet's shadow in it), the upper the sky's
 * irradiance on a level surface, both per unit of the Sun's irradiance above
 * the air.
 */
export const GROUND_LIGHT_W = 128
export const GROUND_LIGHT_ROWS = 32
export const MU_S_MIN = -0.2


const tables = new Map()
// The simulation's month for a body whose ground follows it (Earth's
// texture_monthly; Planet.monthlyMap sets it), and the ground's albedo each
// body's tables were made with.
const months = new Map()
const built = new Map()


/**
 * How far the month's ground albedo may move from the one the tables were
 * made with before they are made again, in any channel: Earth's months
 * step by 0.0004 to 0.014, and 0.004 of albedo moves the sky by under
 * 0.5% (composition.md, "The ground's albedo by the month").
 */
export const GROUND_ALBEDO_REBUILD = 0.004


/**
 * @param {object} atmos
 * @param {number} month 1 to 12
 */
export function setGroundMonth(atmos, month) {
  months.set(atmos, month)
}


/**
 * @param {object} [atmos]
 * @returns {number} The body's month, 1 (January) until one is set
 */
export function groundMonth(atmos) {
  return months.get(atmos) ?? 1
}


/**
 * The atmosphere's `groundAlbedo` at the month: one number, [r, g, b], or
 * twelve of either, January first.
 *
 * @param {number|Array} a
 * @param {number} month 1 to 12
 * @returns {Array<number>|number}
 */
export function monthsAlbedo(a, month) {
  return Array.isArray(a) && a.length === 12 ? a[month - 1] : a
}


/**
 * @param {object} atmos
 * @param {Array<number>} albedo [r, g, b], the ground's the tables were made with
 */
export function setBuiltAlbedo(atmos, albedo) {
  built.set(atmos, albedo)
}


/**
 * Whether the body's tables want making again for the month's ground: its
 * albedo off theirs by more than GROUND_ALBEDO_REBUILD in a channel.
 *
 * @param {object} atmos
 * @param {Array<number>} albedo [r, g, b] now (AtmospherePrecompute groundAlbedo)
 * @returns {boolean}
 */
export function groundAlbedoStale(atmos, albedo) {
  const b = built.get(atmos)
  return Boolean(b) && albedo.some((v, i) => Math.abs(v - b[i]) > GROUND_ALBEDO_REBUILD)
}


/**
 * @param {object} atmos A body's atmosphere props (the key: the object)
 * @param {object|null} texture Its ground-light table's, or null to forget it
 */
export function setGroundLight(atmos, texture) {
  if (texture) {
    tables.set(atmos, texture)
  } else {
    tables.delete(atmos)
  }
}


/**
 * @param {object} [atmos]
 * @returns {object|null} The table's texture, while the body's air is the pass's
 */
export function groundLightFor(atmos) {
  return (atmos && tables.get(atmos)) ?? null
}


/**
 * @returns {object} The uniforms of GROUND_LIGHT_GLSL
 */
export function newGroundLightUniforms() {
  return {tGroundLight: {value: null}, uGroundLightOn: {value: 0}}
}


/**
 * Points the uniforms at the body's table, or off when it has none now.
 *
 * @param {object} uniforms newGroundLightUniforms'
 * @param {object} [atmos] The body's atmosphere props
 */
export function updateGroundLight(uniforms, atmos) {
  const t = groundLightFor(atmos)
  uniforms.tGroundLight.value = t
  uniforms.uGroundLightOn.value = t ? 1 : 0
}


// `groundSunT(h, mu)` and `groundSky(h, mu)`: the table at a height over the
// air's (0 to 1) and the Sun's zenith cosine; 1 and 0 with no table.
export const GROUND_LIGHT_GLSL = `
uniform sampler2D tGroundLight;
uniform float uGroundLightOn;
vec2 groundLightUv(float h, float mu, float half0) {
  float x = clamp((mu - ${MU_S_MIN.toFixed(1)}) / ${(1 - MU_S_MIN).toFixed(1)}, 0.0, 1.0) * ${(GROUND_LIGHT_W - 1).toFixed(1)} + 0.5;
  float y = clamp(h, 0.0, 1.0) * ${(GROUND_LIGHT_ROWS - 1).toFixed(1)} + 0.5 + half0;
  return vec2(x / ${GROUND_LIGHT_W.toFixed(1)}, y / ${(2 * GROUND_LIGHT_ROWS).toFixed(1)});
}
vec3 groundSunT(float h, float mu) {
  if (uGroundLightOn < 0.5) return vec3(1.0);
  return mu < ${MU_S_MIN.toFixed(1)} ? vec3(0.0) : texture2D(tGroundLight, groundLightUv(h, mu, 0.0)).rgb;
}
vec3 groundSky(float h, float mu) {
  if (uGroundLightOn < 0.5) return vec3(0.0);
  return texture2D(tGroundLight, groundLightUv(h, mu, ${GROUND_LIGHT_ROWS.toFixed(1)})).rgb;
}
`


/**
 * The planet material's mod (Planet.js): the Sun's direct light times its
 * transmittance to the ground, and the sky's irradiance as diffuse light,
 * Bruneton's (1 + n·up) / 2 of it on a tilted normal.  `up` is the
 * fragment's geometric normal (the sphere's, vNormal), the Sun's direction
 * the light's; three's point light carries the Sun's irradiance.
 *
 * @param {object} uniforms newGroundLightUniforms'
 * @param {string} lightsBegin three's lights_fragment_begin chunk
 * @returns {Function} An onBeforeCompile mod
 */
export function groundLightShaderMod(uniforms, lightsBegin) {
  const call = 'getPointLightInfo( pointLight, geometryPosition, directLight );'
  if (!lightsBegin.includes(call)) {
    throw new Error('groundLight: three\'s point-light call not found')
  }
  return (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
${GROUND_LIGHT_GLSL}`)
        .replace('#include <lights_fragment_begin>', `vec3 groundSkyE = vec3(0.0);
vec3 groundUp = normalize(vNormal);
${lightsBegin.replace(call, `${call}
{ float gMu = dot(groundUp, directLight.direction);
  groundSkyE += directLight.color * groundSky(0.0, gMu) * 0.5 * (1.0 + dot(geometryNormal, groundUp));
  directLight.color *= groundSunT(0.0, gMu); }`)}`)
        .replace('#include <lights_fragment_end>', `irradiance += groundSkyE;
#include <lights_fragment_end>`)
  }
}
