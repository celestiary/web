/**
 * Cesium's terrain distance, carried to celestiary in its frame's alpha.
 *
 * Earth's Cesium globe is opaque, so its alpha says only "the globe is
 * here".  Celestiary's atmosphere pass needs more: how far away the ground
 * is, where Cesium's terrain rises above celestiary's sphere (a ridge over a
 * valley, above the sphere's horizon), or the pass takes the pixel for sky.
 * Cesium's own depth doesn't reach celestiary (its frames reach it through
 * its 8-bit globe framebuffer, colour only; HDR.md), so a post-process stage
 * (Cesium's public API, with the scene's depth texture) writes each globe
 * pixel's distance from the camera into alpha, and the composite's decode
 * pass turns it back into celestiary's depth.
 *
 * Encoding, 8 bits: 0 is "no globe"; 1..255 is 1 − e^(−d/D), so the steps
 * are even in how much haze a distance puts over the ground (at sea level
 * blue light falls to 1/e in ~30 km).  D grows with the camera's height,
 * as the ground seen gets farther: DISTANCE_SCALE_M + 5 h, 40 km at the
 * ground, 85 km at 9 km up, 140 km at 20 km (the highest the terrain's
 * distance is used from; CesiumLayers).  A step, at the distances in view,
 * is then a few hundred metres to a kilometre or so, and dithering hides
 * it; faster growth (e^(h/8 km) was tried) left steps of ~8 km from 37 km
 * up, which showed as rings of speckle over the ground.  The top levels
 * (from ~5.5 D: 220 km at the ground) read as "farther than that": no
 * depth, where the ground sphere's serves (CesiumLayers' decode).
 */


/** D at the ground, metres. */
export const DISTANCE_SCALE_M = 4e4
/** D's growth with the camera's height, metres per metre. */
const DISTANCE_SCALE_PER_HEIGHT = 5
/** D's cap, metres: beyond, the distance hardly changes the haze. */
const MAX_DISTANCE_SCALE_M = 2e6
/** Alpha's levels: 0 is "no globe", 1 to 255 the distance. */
export const DISTANCE_LEVELS = 255
const LEVELS = DISTANCE_LEVELS


/**
 * @param {number} heightM The camera's height over the body's surface
 * @returns {number} D for this frame, metres
 */
export function distanceScale(heightM) {
  return Math.min(MAX_DISTANCE_SCALE_M, DISTANCE_SCALE_M + (DISTANCE_SCALE_PER_HEIGHT * Math.max(0, heightM)))
}


/**
 * @param {number} d Distance, metres
 * @param {number} scale D
 * @returns {number} Alpha, 1/255 to 1 (0 is kept for "no globe")
 */
export function encodeDistance(d, scale) {
  return (1 + ((LEVELS - 1) * (1 - Math.exp(-d / scale)))) / LEVELS
}


/**
 * @param {number} a Alpha, as encodeDistance
 * @param {number} scale D
 * @returns {number} Distance, metres
 */
export function decodeDistance(a, scale) {
  const u = Math.min(((a * LEVELS) - 1) / (LEVELS - 1), MAX_U)
  return -scale * Math.log(1 - Math.max(u, 0))
}


// The largest encoded fraction decoded: 1 - e^-7, 7 D.
const MAX_U = 0.999


/** GLSL for Cesium's post-process stage: `float encodeDistance(float d, float scale)`. */
export const ENCODE_DISTANCE_GLSL = `
float encodeDistance(float d, float scale) {
  return (1.0 + ${LEVELS - 1}.0 * (1.0 - exp(-d / scale))) / ${LEVELS}.0;
}
`


/** GLSL for celestiary's decode pass: `float decodeDistance(float a, float scale)`. */
export const DECODE_DISTANCE_GLSL = `
float decodeDistance(float a, float scale) {
  float u = clamp((a * ${LEVELS}.0 - 1.0) / ${LEVELS - 1}.0, 0.0, ${MAX_U});
  return -scale * log(1.0 - u);
}
`


/**
 * Cesium PostProcessStage fragment shader: the colour as it was, and, where
 * the globe drew (alpha > 0), the encoded distance from the camera to it in
 * alpha.  `distanceScale` is a uniform.
 */
export const DISTANCE_STAGE_GLSL = `
uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
uniform float distanceScale;
in vec2 v_textureCoordinates;
${ENCODE_DISTANCE_GLSL}
void main() {
  vec4 color = texture(colorTexture, v_textureCoordinates);
  if (color.a <= 0.0) {
    out_FragColor = vec4(0.0);
    return;
  }
  // Cesium's raw depth (logarithmic when the scene uses it) to eye space.
  float depth = texture(depthTexture, v_textureCoordinates).r;
  vec4 eye = czm_windowToEyeCoordinates(gl_FragCoord.xy, depth);
  float d = length(eye.xyz / eye.w);
  // Half a level of noise before the 8-bit store, so the steps don't band.
  float noise = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  float a = encodeDistance(d, distanceScale) + noise / ${LEVELS}.0;
  out_FragColor = vec4(color.rgb, clamp(a, 1.0 / ${LEVELS}.0, 1.0));
}
`
