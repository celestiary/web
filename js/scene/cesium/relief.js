/**
 * The Moon's relief in Cesium's tileset shader: the LOLA normal map
 * (`moon_normal.jpg`, js/scene/Planet.md "Relief") sampled by the fragment's
 * selenographic longitude and latitude, and turned into the normal the Sun's
 * light (and earthshine) are taken against (CESIUM.md, "Tiles and lighting").
 *
 * The map is celestiary's own: 2048×1024 equirectangular, planetocentric,
 * -180° at the left edge and +90° (north) at the top, so its centre column
 * is the prime meridian and east runs right, as `moon.jpg`'s.  Each texel
 * holds a tangent-space normal: x east, y north, z out.
 *
 * Cesium's Moon frame is the same body-fixed frame (frames.js): +X through
 * longitude 0, +Y through 90°E, +Z north, so for a fragment at ECEF
 * position p: longitude = atan2(y, x), latitude = asin(z / |p|), and the
 * tangent frame is east = Z × p (normalized), up = p / |p|, north = up × east.
 *
 * `RELIEF_GLSL` is the shader's version of this module's JS (`lonLat`,
 * `reliefFrame`, `reliefStrength`, `perturbedNormal`), which the tests run
 * at known points; the GLSL can't run under bun, so the two are kept
 * line for line and checked together on the Moon's craters in a render.
 */


/**
 * Where the map's slopes fade out as the view magnifies them, in log2 texels
 * per pixel: full strength down to 2 pixels a texel (`RELIEF_FADE_START`),
 * none from 8 (`RELIEF_FADE_END`), where its 5.3 km bilinear texels would
 * show as blocks over the tiles' imagery.  The user's telescope views (4.6
 * to 6.7 km a pixel) are at about one texel a pixel, full.  The fade is of
 * the map's own resolution, not a blend with the tiles' geometry: the
 * shader never takes a normal from that (CESIUM.md), so nothing is counted
 * twice.
 */
export const RELIEF_FADE_START = -1
export const RELIEF_FADE_END = -3


const TWO_PI = 2 * Math.PI
// Nearer the pole than this, longitude has no direction: east is arbitrary
// there, and the map's own polar row is a point.
const POLE_RHO2 = 1e-8


/**
 * @param {Array<number>} p Position in the Moon's ECEF frame, any length
 * @returns {{lon: number, lat: number}} Longitude (east positive,
 *   -π to π) and planetocentric latitude, radians
 */
export function lonLat(p) {
  const r = Math.hypot(p[0], p[1], p[2])
  return {lon: Math.atan2(p[1], p[0]), lat: Math.asin(Math.min(Math.max(p[2] / r, -1), 1))}
}


/**
 * Where a longitude and latitude fall in the map image: u from the left
 * edge (-180°) and v from the top (+90°), 0 to 1, as image rows run.  (The
 * shader's own v counts from the bottom, because Cesium uploads its
 * textures flipped; relief.test.js and the render fix them to this.)
 *
 * @param {number} lon East longitude, radians
 * @param {number} lat Latitude, radians
 * @returns {{u: number, v: number}}
 */
export function imageUv(lon, lat) {
  return {u: (lon / TWO_PI) + 0.5, v: 0.5 - (lat / Math.PI)}
}


/**
 * @param {Array<number>} p Position in the Moon's ECEF frame
 * @returns {{east: Array<number>, north: Array<number>, up: Array<number>}}
 *   The surface's unit axes at p, in that frame
 */
export function reliefFrame(p) {
  const r = Math.hypot(p[0], p[1], p[2])
  const up = [p[0] / r, p[1] / r, p[2] / r]
  const rho = Math.sqrt(Math.max((up[0] * up[0]) + (up[1] * up[1]), POLE_RHO2))
  const east = [-up[1] / rho, up[0] / rho, 0]
  // up × east
  const north = [
    (up[1] * east[2]) - (up[2] * east[1]),
    (up[2] * east[0]) - (up[0] * east[2]),
    (up[0] * east[1]) - (up[1] * east[0]),
  ]
  return {east, north, up}
}


/**
 * How much of the map's slope to apply, by how many of its texels a pixel
 * spans (a pixel on the ground, in texels, the larger of its two edges).
 *
 * @param {number} texelsPerPixel
 * @returns {number} 0 to 1: 1 from 2 pixels a texel down to 1 and beyond
 *   (minified, where the mip chain is already the average), 0 from 8
 *   pixels a texel on, smooth between
 */
export function reliefStrength(texelsPerPixel) {
  const lod = Math.log2(Math.max(texelsPerPixel, 1e-6))
  const t = Math.min(Math.max((lod - RELIEF_FADE_END) / (RELIEF_FADE_START - RELIEF_FADE_END), 0), 1)
  return t * t * (3 - (2 * t))
}


/**
 * The normal to light, in the Moon's ECEF frame.
 *
 * @param {Array<number>} p Position in the Moon's ECEF frame
 * @param {Array<number>} texel The map's colour at p, 0 to 1 per channel
 * @param {number} [strength] 0 to 1: 0 is the smooth sphere's normal
 * @returns {Array<number>} Unit normal
 */
export function perturbedNormal(p, texel, strength = 1) {
  const {east, north, up} = reliefFrame(p)
  const m = [
    strength * ((texel[0] * 2) - 1),
    strength * ((texel[1] * 2) - 1),
    1 + (strength * ((texel[2] * 2) - 2)),
  ]
  const n = [0, 1, 2].map((i) => (east[i] * m[0]) + (north[i] * m[1]) + (up[i] * m[2]))
  const len = Math.hypot(...n)
  return n.map((x) => x / len)
}


/**
 * The shader function: `reliefNormal(positionWC)` is the unit normal in the
 * Moon's ECEF frame (the smooth sphere's `up` where the map is not yet
 * loaded, or faded out).  Needs the `u_reliefMap` sampler uniform, and
 * `u_reliefScale` (0 to 1) for the effect as a whole.
 *
 * The map is sampled with `textureGrad`, from the gradients of longitude
 * and latitude taken through the continuous unit position, not the
 * discontinuous `atan` (at ±180° a plain `texture` would pick the smallest
 * mip along a seam).  Cesium's textures are uploaded flipped, so v counts
 * from the bottom.  The default texture Cesium binds until the image is in
 * is 1×1: no relief until it isn't.
 */
export const RELIEF_GLSL = `
const float RELIEF_PI = 3.14159265358979;
vec3 reliefNormal(vec3 p) {
  vec3 up = normalize(p);
  float rho2 = max(dot(up.xy, up.xy), 1e-8);
  float rho = sqrt(rho2);
  vec3 east = vec3(-up.y, up.x, 0.0) / rho;
  vec3 north = cross(up, east);
  vec2 uv = vec2(atan(up.y, up.x) / (2.0 * RELIEF_PI) + 0.5, asin(clamp(up.z, -1.0, 1.0)) / RELIEF_PI + 0.5);
  // d(lon, lat) per pixel, over 2π and π: the map's u and v.
  vec3 dx = dFdx(up);
  vec3 dy = dFdy(up);
  vec2 gx = vec2((up.x * dx.y - up.y * dx.x) / rho2 / (2.0 * RELIEF_PI), dx.z / rho / RELIEF_PI);
  vec2 gy = vec2((up.x * dy.y - up.y * dy.x) / rho2 / (2.0 * RELIEF_PI), dy.z / rho / RELIEF_PI);
  vec2 size = vec2(textureSize(u_reliefMap, 0));
  float texelsPerPixel = max(length(gx * size), length(gy * size));
  float lod = log2(max(texelsPerPixel, 1e-6));
  float strength = u_reliefScale * (size.x > 1.5 ? smoothstep(${RELIEF_FADE_END.toFixed(1)}, ${RELIEF_FADE_START.toFixed(1)}, lod) : 0.0);
  vec3 texel = textureGrad(u_reliefMap, uv, gx, gy).xyz;
  vec3 m = vec3(strength * (texel.xy * 2.0 - 1.0), 1.0 + strength * (texel.z * 2.0 - 2.0));
  return normalize(east * m.x + north * m.y + up * m.z);
}
`
