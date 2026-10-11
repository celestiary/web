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
 * The toe's curvature: under TOE_END a grey x shows as this × x² (6.25),
 * so its slope is twice that times x (eye.js, the extended response).
 */
export const NEUTRAL_TOE_CURVATURE = TOE_OFFSET / (TOE_END * TOE_END)
/** Where the toe ends, in exposure units: a grey there shows as TOE_OFFSET (0.04). */
export const NEUTRAL_TOE_END = TOE_END


/**
 * PBR Neutral, without the exposure multiply (the buffer holds exposed values).
 *
 * @param {Array<number>} rgb Scene-referred, exposure units
 * @returns {Array<number>} Display values, 0 to 1
 */
export function neutral(rgb) {
  if (!rgb.every(Number.isFinite)) {
    // As the GLSL: a non-finite value is the white point, not NaN.
    return rgb.map(() => 1)
  }
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
  // A non-finite input shows as the white point, never as the NaN the
  // curve makes of Inf (a black pixel): the Sun's disc went black inside
  // its limb where the buffer overflowed (HDR.md, "The Sun's disc").
  if (any(isnan(color)) || any(isinf(color))) {
    return vec3(1.0);
  }
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
 * The least the HDR scene buffer holds as a normal half-float, 2^-14.
 * Under it a value is subnormal: a GPU may flush it to zero (ANGLE on
 * Metal does; SwiftShader keeps it), and one that keeps it has 10 bits of
 * mantissa or fewer.  Emitted radiance under it is written as zero
 * (emitted / EMITTED_GLSL), so every GPU holds the same buffer, and
 * nothing visible goes: it is 1/65 of a display step (1/255) through the
 * tone map.  With the frame's gain in the buffer (HDR.md,
 * "Pre-exposure") what falls under it is a star fainter than magnitude
 * 15 or the outskirts of the Milky Way's disc, invisible either way.
 */
export const HDR_MIN_NORMAL = 2 ** -14


/**
 * Emitted radiance as the buffer takes it (EMITTED_GLSL): each channel
 * under HDR_MIN_NORMAL is zero.
 *
 * @param {Array<number>} rgb Exposure units
 * @returns {Array<number>}
 */
export function emitted(rgb) {
  return rgb.map((v) => (v >= HDR_MIN_NORMAL ? v : 0))
}


/** GLSL: vec3 emitted(vec3), as emitted(). */
export const EMITTED_GLSL = `
const float HDR_MIN_NORMAL = ${HDR_MIN_NORMAL.toExponential(6)};
vec3 emitted(vec3 radiance) {
  return radiance * step(vec3(HDR_MIN_NORMAL), radiance);
}
`


/**
 * A self-luminous source's radiance within the half-float buffer, with a
 * shoulder rather than a clamp: itself to LUMINOUS_KNEE, then compressed
 * toward LUMINOUS_CEILING (at most it, 1e4 under the buffer's
 * HDR_MAX_VALUE for what adds on the same pixel), so the Sun's disc keeps its
 * granulation and limb darkening in the buffer at any exposure, and so
 * the disc, its glow and its point sprite, which add, stay under the
 * buffer's 65,504 (over it a half-float is Inf, NaN through the tone
 * map, a black pixel: the user's black Sun inside a bright limb).
 * Monotone and continuous, with slope 1 at the knee.
 *
 * @param {number} radiance In exposure units
 * @returns {number} Within [0, LUMINOUS_CEILING]
 */
export function luminousShoulder(radiance) {
  if (!(radiance > LUMINOUS_KNEE)) {
    return Math.max(radiance, 0)
  }
  const span = LUMINOUS_CEILING - LUMINOUS_KNEE
  return LUMINOUS_CEILING - (span * Math.exp(-(radiance - LUMINOUS_KNEE) / span))
}


/**
 * The luminous shoulder's ceiling, in exposure units: what a disc may
 * reach, leaving LUMINOUS_GLOW_MAX of the buffer's HDR_MAX_VALUE for
 * what adds on the same pixel.  At 71 Gm the depth buffer can't tell the
 * Sun's rim from its glow shell 0.07 radii behind it, so the glow added
 * to the rim: with the disc at 6e4 the red channel passed 65,504, Inf in
 * half-float, NaN once sampled, 29 pixels round the disc (the user's
 * white specks, black before the tone map's guard).
 */
export const LUMINOUS_CEILING = 5e4
/** The most the Sun's glow shell adds to a pixel (newAtmosphere), in exposure units. */
export const LUMINOUS_GLOW_MAX = HDR_MAX_VALUE - LUMINOUS_CEILING
/** Where the luminous shoulder begins, in exposure units. */
export const LUMINOUS_KNEE = 3e4


/** GLSL: float luminousShoulder(float), as luminousShoulder(). */
export const LUMINOUS_SHOULDER_GLSL = `
float luminousShoulder(float radiance) {
  const float knee = ${LUMINOUS_KNEE.toExponential()};
  const float ceiling = ${LUMINOUS_CEILING.toExponential()};
  if (!(radiance > knee)) {
    return max(radiance, 0.0);
  }
  float span = ceiling - knee;
  return ceiling - span * exp(-(radiance - knee) / span);
}
const float LUMINOUS_GLOW_MAX = ${LUMINOUS_GLOW_MAX.toExponential()};
`


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
 * the Sun's disc and its glow; HDR.md "Physical stars"): the exposure the
 * frame renders with over Earth's keyed one (exposure.js exposureRelative:
 * the target-keyed exposure over Earth's, times the metered gain), and the
 * viewport's height and vertical field of view, for a pixel's solid angle.
 * ThreeUi sets them each frame, before the scene pass.
 *
 * uExposureRelative is the pre-exposure (HDR.md, "Pre-exposure"): every
 * emitted source multiplies its radiance by it before writing the buffer,
 * as a lit surface is multiplied by the renderer's exposure, so the buffer
 * holds the frame as exposed and the meter divides its readback by the
 * same gain (ThreeUi._renderedGain).
 */
export const absoluteUniforms = {
  uExposureRelative: {value: 1},
  uViewportHeight: {value: 1024},
  uFovDegrees: {value: 45},
  // The user's gain on the stars' light (ThreeUi.setLimitingMagnitude): 1
  // is the naked eye's limit.
  uStarGain: {value: 1},
  // The eye's patch's side, radians (exposure.js EYE_POINT_RAD; ThreeUi
  // sets it).
  uEyePointRad: {value: 10 / 60 * Math.PI / 180},
  // What the camera sees of the Sun's disc past the bodies in front (an
  // eclipse; sun/SunLayers.js): the Sun's point, the catalogue's origin,
  // dims with it (shaders/stars.vert).  From the ground the stars' depth
  // pull (FAR_PLANE_INSIDE) puts them in front of the Moon, so its depth
  // can't hide the Sun's point.
  uSunVisible: {value: 1},
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
