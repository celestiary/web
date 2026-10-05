import {
  AdditiveBlending,
  CustomBlending,
  NormalBlending,
  ShaderChunk,
  SrcAlphaFactor,
} from 'three'


/**
 * One HDR pipeline (HDR.md): the scene renders into a linear, half-float
 * buffer in exposure units, and one tone map, PBR Neutral, runs last, in the
 * atmosphere pass.
 *
 * - The scene pass tone-maps by exposure only (installExposureOnlyToneMapping).
 * - neutral / NEUTRAL_GLSL: the final tone map.
 * - neutralInverse / NEUTRAL_INVERSE_GLSL: its exact inverse, for content
 *   whose values are meant as display values (stars, labels, lines), so the
 *   final tone map gives them back unchanged (sceneReferred).
 *
 * The JS functions mirror the GLSL, for tests and for anything computed on
 * the CPU.
 */


// PBR Neutral's constants (Khronos; three's NeutralToneMapping).
const START_COMPRESSION = 0.8 - 0.04
const DESATURATION = 0.15
const TOE_END = 0.08
const TOE_OFFSET = 0.04
// Display values at or over this are clamped before inverting: N(x) only
// approaches 1, and N⁻¹(0.999) ≈ 58 is already far into the shoulder.
export const MAX_DISPLAY = 0.999


/**
 * PBR Neutral, without the exposure multiply (the buffer holds exposed values).
 *
 * @param {Array<number>} rgb Scene-referred, exposure units
 * @returns {Array<number>} Display values, 0 to 1
 */
export function neutral(rgb) {
  const x = Math.min(...rgb)
  const offset = x < TOE_END ? x - (6.25 * x * x) : TOE_OFFSET
  let c = rgb.map((v) => v - offset)
  const peak = Math.max(...c)
  if (peak < START_COMPRESSION) {
    return c
  }
  const d = 1 - START_COMPRESSION
  const newPeak = 1 - (d * d / (peak + d - START_COMPRESSION))
  c = c.map((v) => v * newPeak / peak)
  const g = 1 - (1 / ((DESATURATION * (peak - newPeak)) + 1))
  return c.map((v) => (v * (1 - g)) + (newPeak * g))
}


/**
 * The exact inverse of neutral.
 *
 * @param {Array<number>} display Display values, 0 to 1
 * @returns {Array<number>} Scene-referred values that neutral maps to them
 */
export function neutralInverse(display) {
  let c = display.map((v) => Math.max(v, 0))
  const q0 = Math.max(...c)
  if (q0 >= START_COMPRESSION) {
    // PBR Neutral desaturates what it compresses, so a bright saturated
    // colour (a pure blue line at 1) is outside what it can produce: the
    // exact inverse would need negative channels.  Keep the hue, and scale
    // the colour down to the brightest the tone map can show at that
    // saturation (maxNeutralPeak).
    const q = Math.min(q0, MAX_DISPLAY, maxNeutralPeak(Math.min(...c) / q0))
    const y = c.map((v) => v * q / q0)
    const d = 1 - START_COMPRESSION
    const peak = START_COMPRESSION - d + (d * d / (1 - q))
    const g = 1 - (1 / ((DESATURATION * (peak - q)) + 1))
    c = y.map((v) => (v - (g * q)) / (1 - g) * peak / q)
  }
  const m = Math.max(Math.min(...c), 0)
  const offset = m >= TOE_OFFSET ? TOE_OFFSET : (0.4 * Math.sqrt(m)) - m
  return c.map((v) => v + offset)
}


/**
 * The brightest peak PBR Neutral can put out for a colour of this
 * saturation: its shoulder mixes toward white by g, so a colour whose
 * weakest channel is `rho` of its strongest needs g ≤ rho.  With u = 1 − q,
 * p − q = K where g = 1 − 1/(0.15·K + 1), and p = 0.52 + 0.0576/u, so
 * u + 0.0576/u = K + 0.48.  0.76 (no shoulder) for a pure primary, 1 for
 * grey.
 *
 * @param {number} rho min channel over max channel, 0 to 1
 * @returns {number}
 */
export function maxNeutralPeak(rho) {
  if (rho >= 1) {
    return 1
  }
  const d = 1 - START_COMPRESSION
  const k = rho / (DESATURATION * (1 - rho))
  const b = k + (2 * d)
  const u = (b - Math.sqrt(Math.max((b * b) - (4 * d * d), 0))) / 2
  return Math.max(1 - u, START_COMPRESSION)
}


/** GLSL: vec3 neutralToneMap(vec3), as neutral(). */
export const NEUTRAL_GLSL = `
vec3 neutralToneMap(vec3 color) {
  const float startCompression = ${START_COMPRESSION.toFixed(2)};
  const float desaturation = ${DESATURATION.toFixed(2)};
  float x = min(color.r, min(color.g, color.b));
  float offset = x < ${TOE_END.toFixed(2)} ? x - 6.25 * x * x : ${TOE_OFFSET.toFixed(2)};
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < startCompression) return color;
  float d = 1.0 - startCompression;
  float newPeak = 1.0 - d * d / (peak + d - startCompression);
  color *= newPeak / peak;
  float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
  return mix(color, vec3(newPeak), g);
}
`


/** GLSL: vec3 neutralInverse(vec3), as neutralInverse(). */
export const NEUTRAL_INVERSE_GLSL = `
vec3 neutralInverse(vec3 y) {
  const float startCompression = ${START_COMPRESSION.toFixed(2)};
  const float desaturation = ${DESATURATION.toFixed(2)};
  y = max(y, vec3(0.0));
  vec3 c = y;
  float q0 = max(y.r, max(y.g, y.b));
  if (q0 >= startCompression) {
    // Out of the tone map's gamut (bright and saturated): keep the hue,
    // scale to the brightest it can show (maxNeutralPeak in hdr.js).
    float d = 1.0 - startCompression;
    float rho = min(y.r, min(y.g, y.b)) / q0;
    float k = rho / (desaturation * max(1.0 - rho, 1.0e-6));
    float b = k + 2.0 * d;
    float u = (b - sqrt(max(b * b - 4.0 * d * d, 0.0))) * 0.5;
    float q = min(q0, min(${MAX_DISPLAY}, max(1.0 - u, startCompression)));
    y *= q / q0;
    float peak = startCompression - d + d * d / (1.0 - q);
    float g = 1.0 - 1.0 / (desaturation * (peak - q) + 1.0);
    c = (y - g * q) / (1.0 - g) * peak / q;
  }
  float m = max(min(c.r, min(c.g, c.b)), 0.0);
  float offset = m >= ${TOE_OFFSET.toFixed(2)} ? ${TOE_OFFSET.toFixed(2)} : 0.4 * sqrt(m) - m;
  return c + offset;
}
`


/**
 * The most the HDR scene buffer holds: half-float's largest value, rounded
 * down.  Everything written into it is clamped here (the scene pass,
 * Cesium's decode, the stars, the Sun's disc): past it a value becomes
 * Inf, the tone map makes NaN of it, the pixel goes black, and the metered
 * exposure, reading black, holds the gain that overflowed it.
 */
export const HDR_MAX_VALUE = 6.0e4


/**
 * The scene pass's tone mapping: exposure only.  three's
 * LinearToneMapping saturates to 1, which would clip the HDR buffer; its
 * CustomToneMapping hook is replaced with a plain multiply, clamped to what
 * the buffer holds (HDR_MAX_VALUE).  Global (three's shader chunks are),
 * and harmless to anything not using CustomToneMapping.
 */
export function installExposureOnlyToneMapping() {
  const custom = 'vec3 CustomToneMapping( vec3 color ) { return color; }'
  if (ShaderChunk.tonemapping_pars_fragment.includes(custom)) {
    ShaderChunk.tonemapping_pars_fragment = ShaderChunk.tonemapping_pars_fragment.replace(
        custom, `vec3 CustomToneMapping( vec3 color ) { return min(toneMappingExposure * color, vec3(${HDR_MAX_VALUE.toFixed(1)})); }`)
  }
}


/**
 * Whether display-referred materials convert their output to scene-referred
 * values right now: 1 while drawing into the HDR scene buffer, 0 otherwise
 * (the label overlay, drawn to the screen after the tone map; the whole LDR
 * fallback).  Shared by every material sceneReferred() wraps; ThreeUi sets it
 * around its passes.
 */
export const sceneReferredUniform = {value: 0}


/**
 * Shared by the materials of absolute brightness (the stars, the Milky Way,
 * the Sun's disc; HDR.md "Physical stars"): the renderer's exposure over
 * Earth's keyed one (exposure.js exposureRelative), and the viewport's
 * height and vertical field of view, for a pixel's solid angle.  ThreeUi
 * sets them each frame.
 */
export const absoluteUniforms = {
  uExposureRelative: {value: 1},
  uViewportHeight: {value: 1024},
  uFovDegrees: {value: 45},
  // The user's gain on the stars' light (ThreeUi.setStarGain): 1 is
  // physical.
  uStarGain: {value: 1},
}


/**
 * Make a material that writes display values (stars, labels, lines: drawn
 * `toneMapped: false`) write, while sceneReferredUniform is on, the
 * scene-referred values the final tone map turns back into them: N⁻¹ of its
 * output.  Under SrcAlpha blending, the premultiplied colour's: the blend
 * scales by alpha after the shader.
 *
 * Wraps the shader at compile time: `main` is renamed and called from a new
 * `main` that converts gl_FragColor, so the material's own shader (built-in
 * or ShaderMaterial, loaded now or later) is untouched.  Chains any
 * onBeforeCompile the material already has.
 *
 * A built-in material that is tone-mapped (`toneMapped`, the default) is
 * scene-referred already, and left alone.
 *
 * @param {object} material A three.js Material
 * @returns {object} The material
 */
export function sceneReferred(material) {
  if (!material.isShaderMaterial && material.toneMapped !== false) {
    return material
  }
  const before = material.onBeforeCompile
  const previousKey = material.customProgramCacheKey
  material.onBeforeCompile = (shader, renderer) => {
    before?.call(material, shader, renderer)
    shader.uniforms.uSceneReferred = sceneReferredUniform
    shader.fragmentShader = wrapMain(shader.fragmentShader, alphaScaled(material))
  }
  material.customProgramCacheKey = () =>
    `sceneReferred:${alphaScaled(material)}:${previousKey.call(material)}`
  material.needsUpdate = true
  return material
}


/**
 * @param {object} material
 * @returns {boolean} Whether its colour is scaled by its alpha when blended
 */
export function alphaScaled(material) {
  if (material.premultipliedAlpha) {
    return false
  }
  switch (material.blending) {
    case NormalBlending: return material.transparent === true
    case AdditiveBlending: return true
    case CustomBlending: return material.blendSrc === SrcAlphaFactor
    default: return false
  }
}


/**
 * @param {string} fragmentShader
 * @param {boolean} premultiply Invert the premultiplied colour
 * @returns {string} The shader with its main wrapped to convert gl_FragColor
 */
export function wrapMain(fragmentShader, premultiply) {
  const renamed = fragmentShader.replace(/void\s+main\s*\(\s*(void)?\s*\)/, 'void displayReferredMain()')
  if (renamed === fragmentShader) {
    return fragmentShader
  }
  const convert = premultiply ?
    `float a = gl_FragColor.a;
    if (a > 0.0) {
      gl_FragColor.rgb = neutralInverse(min(gl_FragColor.rgb * a, vec3(1.0))) / a;
    }` :
    'gl_FragColor.rgb = neutralInverse(min(gl_FragColor.rgb, vec3(1.0)));'
  return `uniform float uSceneReferred;
${NEUTRAL_INVERSE_GLSL}
${renamed}
void main() {
  displayReferredMain();
  if (uSceneReferred > 0.5) {
    gl_FragColor.rgb = max(gl_FragColor.rgb, vec3(0.0));
    ${convert}
  }
}
`
}


/**
 * @param {object} renderer WebGLRenderer
 * @returns {boolean} Whether half-float colour targets can be rendered to
 *   (and blended): WebGL2 with EXT_color_buffer_float, or
 *   EXT_color_buffer_half_float.  `?hdr=0` in the page's URL says no, to
 *   test the LDR fallback.
 */
export function hdrSupported(renderer) {
  try {
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('hdr') === '0') {
      return false
    }
    const ext = renderer.extensions
    return Boolean(renderer.capabilities?.isWebGL2 !== false &&
      (ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float')))
  } catch {
    return false
  }
}
