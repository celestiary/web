import {
  BufferGeometry,
  ClampToEdgeWrapping,
  Data3DTexture,
  DataTexture,
  DataUtils,
  Float32BufferAttribute,
  GLSL3,
  HalfFloatType,
  LinearFilter,
  Matrix3,
  Matrix4,
  Mesh,
  NoBlending,
  OrthographicCamera,
  RedFormat,
  RepeatWrapping,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
} from 'three'
import {perf} from '../../perf/perf.js'
import {detailNoise, shapeNoise} from './cloudNoise.js'
import {
  DIRECT_SHARE, EDDINGTON_SOURCE_SCALE, MU_SUN_MIN, cloudParams, deltaEddington, deltaScaled, deltaScaledAsymmetry,
  eddingtonGamma, phaseTable,
} from './cloudPhysics.js'
import {CLOUD_HEIGHT_M, FAR_FIELD_FADE_M, VOLUME_FADE_M, fadeOver} from './CloudShell.js'


/**
 * Earth's volumetric clouds, up close (#169; atmos/clouds.md): a ray march
 * through the low cloud layer, seeded by the day's coverage map
 * (CloudMap.js) where the far-field shell (CloudShell.js) fades out, lit
 * by the Sun through the atmosphere's transmittance and by the sky's
 * diffuse light from its multiple-scattering table, with the cloud's own
 * multiple scattering as the delta-Eddington field of the local column
 * (cloudPhysics.js).
 *
 * The march draws at a fraction of the frame's size into a half-float
 * target of two textures: the cloud's radiance per unit of the Sun's
 * irradiance, premultiplied, with its transmittance in alpha; and the
 * cloud's mean distance along the ray with the ground's shadow under it.
 * The previous frame's result is reprojected and blended in (the march's
 * start is jittered each frame), so the march converges over a few frames
 * and a still view is smooth.  The atmosphere pass composites it: the air
 * marched to the cloud, the cloud, and the sky beyond through the cloud's
 * transmittance (Atmosphere.js, CLOUDS).  Nothing is drawn, nor costs a
 * GL call, from above the far-field band (share), nor in the LDR fallback.
 */
export default class CloudVolume {
  /**
   * @param {number} groundRadius The body's radius, metres
   * @param {object} cloudMap A CloudMap (the coverage texture)
   * @param {object} [opts]
   * @param {object} [opts.params] cloudPhysics BODY_CLOUDS entry (Earth's by default)
   * @param {boolean} [opts.generate] Build the noise textures (default: in
   *   a browser); tests skip it
   * @param {string} [opts.search] The page's query string, for the options
   */
  constructor(groundRadius, cloudMap, {params = cloudParams('earth'), generate = typeof requestAnimationFrame === 'function',
    search = typeof location !== 'undefined' ? location.search : ''} = {}) {
    this.groundRadius = groundRadius
    this.cloudMap = cloudMap
    this.params = params
    this.options = cloudOptions(search)
    // The noise textures are built between frames (update); until then
    // the far-field shell stays and nothing is drawn here.
    this.ready = false
    this.status = {shapeSlices: 0, detailSlices: 0, ms: 0, frames: 0, drawn: false}
    this._shape = null
    this._detail = null
    this._steps = null
    this._target = [null, null]
    this._frame = 0
    this._prev = null
    this._size = new Vector2()
    this._inverse = new Matrix4()
    this._camToBody = new Matrix4()
    this._eye = new Vector3()
    this._sun = new Vector3()
    this._viewToBody = new Matrix3()
    this._prevViewToBody = new Matrix3()
    this._prevEye = new Vector3()
    this._scene = new Scene()
    this._camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
    this.material = newMarchMaterial(params, groundRadius, cloudMap.texture)
    const mesh = new Mesh(fullScreenTriangle(), this.material)
    mesh.frustumCulled = false
    this._scene.add(mesh)
    if (generate && params) {
      this._startGeneration()
    }
  }


  /** Begin building the noise textures, a slice a step (update). */
  _startGeneration() {
    this._shape = shapeNoise()
    this._detail = detailNoise()
    const shape = this._shape
    const detail = this._detail
    const status = this.status
    this._steps = (function* () {
      while (!shape.steps.next().done) {
        status.shapeSlices++
        yield
      }
      while (!detail.steps.next().done) {
        status.detailSlices++
        yield
      }
    })()
  }


  /**
   * Build the noise textures a little further, within a time budget: called
   * every frame (the cloud shell's preAnimCb).  Uploads them when done.
   *
   * @param {number} [budgetMs]
   */
  update(budgetMs = GENERATE_BUDGET_MS) {
    if (this.ready || !this._steps) {
      return
    }
    const start = performance.now()
    let next = this._steps.next()
    while (!next.done && performance.now() - start < budgetMs) {
      next = this._steps.next()
    }
    this.status.ms += performance.now() - start
    if (next.done) {
      const u = this.material.uniforms
      u.tShape.value = noiseTexture(this._shape)
      u.tDetail.value = noiseTexture(this._detail)
      this._steps = null
      this.ready = true
      this._readyAt = performance.now()
    }
  }


  /**
   * Build the textures now, whole, and count the volume as in: for tools
   * that render by hand (tools/parity, the probes), where waiting for the
   * frame loop's budget would take minutes on SwiftShader.
   */
  finish() {
    if (this._steps) {
      this.update(Infinity)
    }
    this._readyAt = -Infinity
  }


  /**
   * How far the volume has come in, 0 to 1: nothing until its textures are
   * built, then eased in over READY_FADE_MS, so a camera already under the
   * far-field band sees the shell give way to the volume rather than one
   * replace the other in a frame.  0 for good when switched off.
   *
   * @param {number} [nowMs]
   * @returns {number}
   */
  readiness(nowMs = performance.now()) {
    if (!this.ready || this.options.off || !this.params) {
      return 0
    }
    return Math.min(Math.max((nowMs - this._readyAt) / READY_FADE_MS, 0), 1)
  }


  /**
   * How much of the clouds this volume draws, 0 to 1, against the far-field
   * shell's share (CloudShell.farFieldOpacity): the complement of the
   * shell's, over the band where the shell fades out, times its readiness;
   * nothing above the band.
   *
   * @param {number} cameraHeightM The camera's height over the ground sphere
   * @returns {number}
   */
  share(cameraHeightM) {
    return volumeShare(cameraHeightM) * this.readiness()
  }


  /**
   * Draw the clouds for this frame, if any can show.
   *
   * @param {object} args
   * @param {object} args.renderer
   * @param {object} args.camera
   * @param {object} args.node The body's rotating node (the shell's parent)
   * @param {object} args.sceneRT The scene buffer, for its depth
   * @param {object} args.atmosphere The body's atmosphere: {atmos, transmittance,
   *   multiScatter} (its data, and the two tables' textures)
   * @param {Vector3} args.sunWorld The Sun's world position
   * @returns {{clouds: object, data: object}|null} The two textures, or null
   *   when nothing was drawn (the atmosphere pass composites nothing)
   */
  render({renderer, camera, node, sceneRT, atmosphere, sunWorld}) {
    this.status.drawn = false
    this._inverse.copy(node.matrixWorld).invert()
    camera.getWorldPosition(this._eye).applyMatrix4(this._inverse)
    const height = this._eye.length() - this.groundRadius
    const share = this.share(height)
    if (share <= 0 || !atmosphere?.transmittance || !atmosphere.multiScatter) {
      this._prev = null
      return null
    }
    const u = this.material.uniforms
    // The camera's rotation into the body frame (the node has no scale).
    this._camToBody.multiplyMatrices(this._inverse, camera.matrixWorld)
    this._viewToBody.setFromMatrix4(this._camToBody)
    this._sun.copy(sunWorld).applyMatrix4(this._inverse).normalize()
    u.uEye.value.copy(this._eye)
    u.uSun.value.copy(this._sun)
    u.uViewToBody.value.copy(this._viewToBody)
    const p = camera.projectionMatrix.elements
    u.uProj.value.set(p[0], p[5], p[8], p[9])
    u.uNear.value = camera.near
    u.uFar.value = camera.far
    u.tDepth.value = sceneRT.depthTexture
    u.uOpacity.value = share
    const {atmos, transmittance, multiScatter} = atmosphere
    u.tTransmittance.value = transmittance.texture
    u.tMultiScatter.value = multiScatter.texture
    u.uAtmosphereRadius.value = this.groundRadius + atmos.height.scalar
    u.uRayleigh.value.set(...atmos.rayleigh)
    u.uMieCoeff.value = atmos.mieCoeff
    // The ground under the cloud reflects what the cloud passes (the
    // body's albedo stands for the ground's).
    u.uGroundAlbedo.value = node.props.albedo ?? 0
    // The targets, at the frame's fraction.
    renderer.getDrawingBufferSize(this._size)
    const scale = this.options.scale
    const w = Math.max(1, Math.round(this._size.x * scale))
    const h = Math.max(1, Math.round(this._size.y * scale))
    const index = this._frame % 2
    if (!this._target[index] || this._target[index].width !== w || this._target[index].height !== h) {
      this._target[index]?.dispose()
      this._target[index] = new WebGLRenderTarget(w, h, {
        count: 2, type: HalfFloatType, depthBuffer: false, stencilBuffer: false,
        minFilter: LinearFilter, magFilter: LinearFilter, generateMipmaps: false,
      })
      this._prev = null
    }
    const target = this._target[index]
    const history = this._target[1 - index]
    u.uTargetSize.value.set(w, h)
    u.uFrame.value = this._frame % JITTER_FRAMES
    // Reprojection: the previous frame's view, relative to this eye.
    const prev = this._prev
    const temporal = prev && history && history.width === w && history.height === h && !this.options.noTemporal
    if (temporal) {
      u.tHistory.value = history.textures[0]
      u.tHistoryData.value = history.textures[1]
      u.uHistoryWeight.value = HISTORY_WEIGHT
      u.uPrevEyeDelta.value.copy(this._eye).sub(prev.eye)
      u.uBodyToPrevView.value.copy(prev.viewToBody).transpose()
      u.uPrevProj.value.copy(prev.proj)
    } else {
      u.uHistoryWeight.value = 0
      u.tHistory.value = null
      u.tHistoryData.value = null
    }
    const current = renderer.getRenderTarget()
    const autoClear = renderer.autoClear
    renderer.autoClear = false
    perf.begin('clouds.volume')
    renderer.setRenderTarget(target)
    renderer.render(this._scene, this._camera)
    renderer.setRenderTarget(current)
    perf.end('clouds.volume')
    renderer.autoClear = autoClear
    this._prev = {eye: this._eye.clone(), viewToBody: this._viewToBody.clone(), proj: u.uProj.value.clone()}
    this._frame++
    this.status.frames++
    this.status.drawn = true
    return {clouds: target.textures[0], data: target.textures[1]}
  }
}


/** The noise generation's time budget per frame, ms. */
export const GENERATE_BUDGET_MS = 6
/** How long the volume takes to come in once its textures are built, ms. */
export const READY_FADE_MS = 1500
/** How much of the frame's width and height the march draws at, by default. */
export const DEFAULT_SCALE = 0.5
/** The reprojected history's weight in the blend, when it is valid. */
export const HISTORY_WEIGHT = 0.9
/** The jitter sequence's length, frames. */
export const JITTER_FRAMES = 8
/** The most samples a ray takes, coarse and fine together. */
export const MAX_STEPS = 80
/** The farthest the march goes from the eye, metres: beyond, the air hides the cloud. */
export const MAX_DISTANCE_M = 120000
/** The shape noise repeats every this many metres; the detail noise likewise. */
export const SHAPE_SCALE_M = 24000
export const DETAIL_SCALE_M = 1500


/**
 * The volume's share of the clouds at a camera height: 0 above the
 * far-field band, coming in over the whole shell through the band's upper
 * half (CloudShell.VOLUME_FADE_M), 1 from there down; the shell then
 * leaves from under it (CloudShell.shellOpacity).
 *
 * @param {number} cameraHeightM
 * @returns {number}
 */
export function volumeShare(cameraHeightM) {
  if (cameraHeightM >= CLOUD_HEIGHT_M + FAR_FIELD_FADE_M[0]) {
    return 0
  }
  return 1 - fadeOver(cameraHeightM, VOLUME_FADE_M)
}


/**
 * The page's options for the clouds: `?clouds=off` draws no volume (the
 * shell as before, gone under 10 km), `clouds=full` marches at the frame's
 * full size, `clouds=quarter` at a quarter, `clouds=notemporal` keeps no
 * history (each frame alone, for measuring the march).  Several join with
 * commas.
 *
 * @param {string} search The query string
 * @returns {{off: boolean, scale: number, noTemporal: boolean}}
 */
export function cloudOptions(search) {
  const value = new URLSearchParams(search ?? '').get('clouds') ?? ''
  const flags = new Set(value.split(',').map((s) => s.trim()))
  let scale = DEFAULT_SCALE
  if (flags.has('full')) {
    scale = 1
  } else if (flags.has('quarter')) {
    scale = 0.25
  }
  return {off: flags.has('off'), scale, noTemporal: flags.has('notemporal')}
}


/**
 * @param {{data: Uint8Array, size: number}} noise cloudNoise's
 * @returns {Data3DTexture} Tiling, filtered
 */
function noiseTexture(noise) {
  const tex = new Data3DTexture(noise.data, noise.size, noise.size, noise.size)
  tex.format = RGBAFormat
  tex.type = UnsignedByteType
  tex.wrapS = tex.wrapT = tex.wrapR = RepeatWrapping
  tex.minFilter = tex.magFilter = LinearFilter
  tex.generateMipmaps = false
  tex.unpackAlignment = 1
  tex.needsUpdate = true
  return tex
}


/**
 * @param {object} phase A cloudPhase fixture
 * @returns {DataTexture} The peak-less phase function over the scattering
 *   angle, 0 to 180° across, one row, half-float
 */
function phaseTexture(phase) {
  const {data, width} = phaseTable(phase)
  const half = new Uint16Array(width)
  for (let i = 0; i < width; i++) {
    half[i] = DataUtils.toHalfFloat(data[i])
  }
  const tex = new DataTexture(half, width, 1, RedFormat, HalfFloatType)
  tex.wrapS = tex.wrapT = ClampToEdgeWrapping
  tex.minFilter = tex.magFilter = LinearFilter
  tex.generateMipmaps = false
  tex.needsUpdate = true
  return tex
}


/** @returns {BufferGeometry} One triangle covering clip space, with its uv */
function fullScreenTriangle() {
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3))
  g.setAttribute('uv', new Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2))
  return g
}


/**
 * @param {object|null} params cloudPhysics BODY_CLOUDS entry
 * @param {number} groundRadius
 * @param {object} coverage The coverage map's texture
 * @returns {ShaderMaterial}
 */
function newMarchMaterial(params, groundRadius, coverage) {
  const phase = params?.phase
  const f = phase?.peak.share ?? 0
  const g = phase ? deltaScaledAsymmetry(phase.asymmetry, f) : 0.7
  const layer = params?.layer ?? {base: 0, top: 1, towerTop: 2}
  const albedo = params?.albedo ?? [1, 1, 1]
  const extinction = params?.extinction ?? [0, 0]
  // The Eddington closure's constants for this g: the delta-Eddington g,
  // its τ scale, its γ and the source's scale (cloudPhysics.js).
  const edd = deltaEddington(1, g)
  return new ShaderMaterial({
    name: 'cloud volume',
    glslVersion: GLSL3,
    uniforms: {
      tDepth: {value: null},
      uNear: {value: 1},
      uFar: {value: 1e15},
      uProj: {value: new Vector4(1, 1, 0, 0)},
      uViewToBody: {value: new Matrix3()},
      uEye: {value: new Vector3()},
      uSun: {value: new Vector3(1, 0, 0)},
      uGroundRadius: {value: groundRadius},
      uBaseRadius: {value: groundRadius + layer.base},
      uTopRadius: {value: groundRadius + layer.top},
      uTowerRadius: {value: groundRadius + layer.towerTop},
      tCoverage: {value: coverage},
      tShape: {value: null},
      tDetail: {value: null},
      tPhase: {value: phase ? phaseTexture(phase) : null},
      uShapeScale: {value: SHAPE_SCALE_M},
      uDetailScale: {value: DETAIL_SCALE_M},
      // The delta-scaled extinction of the stratiform and the convective
      // cloud, per metre.
      uExtinction: {value: new Vector2(deltaScaled(extinction[0], 1, f), deltaScaled(extinction[1], 1, f))},
      uAlbedo: {value: new Vector3(...albedo)},
      // (g', 1 − g'², γ, the source scale), for the Eddington field.
      uEddington: {value: new Vector4(edd.g, edd.tau, eddingtonGamma(edd.g), EDDINGTON_SOURCE_SCALE)},
      uOpacity: {value: 0},
      tTransmittance: {value: null},
      tMultiScatter: {value: null},
      uAtmosphereRadius: {value: groundRadius + 1},
      uRayleigh: {value: new Vector3()},
      uMieCoeff: {value: 0},
      uGroundAlbedo: {value: 0},
      uTargetSize: {value: new Vector2(1, 1)},
      uFrame: {value: 0},
      uSteps: {value: MAX_STEPS},
      uMaxDistance: {value: MAX_DISTANCE_M},
      tHistory: {value: null},
      tHistoryData: {value: null},
      uHistoryWeight: {value: 0},
      uPrevEyeDelta: {value: new Vector3()},
      uBodyToPrevView: {value: new Matrix3()},
      uPrevProj: {value: new Vector4(1, 1, 0, 0)},
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    blending: NoBlending,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })
}


const VERT = `
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

// The march.  Body frame: the planet's centre at the origin, +Y its north
// pole, +X its prime meridian; the coverage map as CloudShell reads it.
// Distances in metres; the eye is ~6.4e6 m from the origin, within float32's
// half-metre there.
const FRAG = `
precision highp float;
precision highp sampler3D;

in vec2 vUv;
layout(location = 0) out vec4 outCloud;
layout(location = 1) out vec4 outData;

uniform sampler2D tDepth;
uniform float uNear;
uniform float uFar;
uniform vec4  uProj;
uniform mat3  uViewToBody;
uniform vec3  uEye;
uniform vec3  uSun;
uniform float uGroundRadius;
uniform float uBaseRadius;
uniform float uTopRadius;
uniform float uTowerRadius;
uniform sampler2D tCoverage;
uniform sampler3D tShape;
uniform sampler3D tDetail;
uniform sampler2D tPhase;
uniform float uShapeScale;
uniform float uDetailScale;
uniform vec2  uExtinction;
uniform vec3  uAlbedo;
uniform vec4  uEddington;
uniform float uOpacity;
uniform sampler2D tTransmittance;
uniform sampler2D tMultiScatter;
uniform float uAtmosphereRadius;
uniform vec3  uRayleigh;
uniform float uMieCoeff;
uniform float uGroundAlbedo;
uniform vec2  uTargetSize;
uniform float uFrame;
uniform int   uSteps;
uniform float uMaxDistance;
uniform sampler2D tHistory;
uniform sampler2D tHistoryData;
uniform float uHistoryWeight;
uniform vec3  uPrevEyeDelta;
uniform mat3  uBodyToPrevView;
uniform vec4  uPrevProj;

#define PI 3.141592653589793
#define MAX_STEPS ${MAX_STEPS}
// The coarse step's floor and ceiling and the fine step's ceiling, metres,
// and the clear fine steps before the march goes coarse again.  A coarse
// step is bounded so that backing up one on contact can be re-marched fine
// within the budget: a ray along the horizon reaches MAX_STEPS × COARSE_MAX
// out, past which the air has hazed the clouds over.
#define COARSE_MIN 80.0
#define COARSE_MAX 1000.0
#define FINE_MAX 60.0
#define FINE_MISSES 6
#define LIGHT_STEPS 5
// The distance channel's unit: km, within half-float's range.
#define DIST_SCALE 0.001
#define SHADOW_STEPS 6
// The light march's reach toward the Sun, and the shadow's, metres.
#define LIGHT_REACH 6000.0
#define SHADOW_REACH 12000.0
#define MU_SUN_MIN ${MU_SUN_MIN.toFixed(3)}
#define DIRECT_SHARE ${DIRECT_SHARE.toFixed(3)}
// The coverage map's mip for the large-scale cloud (the convective share):
// level 3 of a 2560-wide map is 128 km a texel.
#define COARSE_LOD 3.0

vec2 rsi(vec3 r0, vec3 rd, float sr) {
  float b = dot(rd, r0);
  float c = dot(r0, r0) - sr * sr;
  float d = b * b - c;
  if (d < 0.0) return vec2(1e5, -1e5);
  float s = sqrt(d);
  return vec2(-b - s, -b + s);
}

// The coverage map's uv for a direction in the body frame (CloudShell).
vec2 mapUv(vec3 n) {
  return vec2(fract(atan(n.z, -n.x) / (2.0 * PI)), acos(clamp(n.y, -1.0, 1.0)) / PI);
}

float remap(float x, float lo, float hi, float newLo, float newHi) {
  return newLo + (newHi - newLo) * clamp((x - lo) / (hi - lo), 0.0, 1.0);
}

// Interleaved gradient noise (Jimenez 2014), stepped by the frame, for the
// march's start: the history blend averages the sequence out.
float jitter(vec2 frag) {
  vec2 f = frag + 5.588238 * uFrame;
  return fract(52.9829189 * fract(dot(f, vec2(0.06711056, 0.00583715))));
}

// The cloud's vertical profile: up from the base over its lowest tenth,
// flat-topped where stratiform, tapering where convective.
float heightProfile(float hf, float conv) {
  return smoothstep(0.0, 0.1, hf) * (1.0 - smoothstep(mix(0.85, 0.55, conv), 1.0, hf));
}

// The cloud's extinction at p, per metre (delta-scaled), and the
// convective share there.  The map's coverage c thresholds the equalised
// shape noise (so c of the sky is cloud), under the profile; the detail
// noise erodes the edges (Schneider & Vos 2015).  The large-scale
// coverage picks the convective cloud, whose tops rise toward the tower
// height where the shape noise is strongest.
float extinction(vec3 p, bool withDetail, out float conv) {
  float r = length(p);
  vec3  n = p / r;
  vec2  uv = mapUv(n);
  float c = texture(tCoverage, uv).r;
  conv = 0.0;
  if (c <= 0.0 || r < uBaseRadius) return 0.0;
  float coarse = textureLod(tCoverage, uv, COARSE_LOD).r;
  conv = smoothstep(0.7, 0.95, coarse);
  vec4  s = texture(tShape, p / uShapeScale);
  float top = mix(uTopRadius, uTowerRadius, conv * smoothstep(0.6, 1.0, s.r));
  float hf = (r - uBaseRadius) / (top - uBaseRadius);
  if (hf >= 1.0) return 0.0;
  float base = remap(s.r, 1.0 - c, 1.0, 0.0, 1.0) * heightProfile(hf, conv);
  if (base <= 0.0) return 0.0;
  if (withDetail) {
    vec4  d = texture(tDetail, p / uDetailScale);
    float fbm = 0.625 * d.r + 0.25 * d.g + 0.125 * d.b;
    // Wispy at the base, billowy higher up.
    float erode = mix(fbm, 1.0 - fbm, clamp(hf * 4.0, 0.0, 1.0));
    base = remap(base, erode * 0.35, 1.0, 0.0, 1.0);
  }
  return base * mix(uExtinction.x, uExtinction.y, conv);
}

// The cloud's optical depth from p toward the Sun: LIGHT_STEPS samples of
// the shape (no detail), each twice the last's length, to the layer's exit
// or LIGHT_REACH.
float lightDepth(vec3 p, float j) {
  float reach = min(max(rsi(p, uSun, uTowerRadius).y, 0.0), LIGHT_REACH);
  float ds = reach / 31.0;
  float t = 0.0;
  float tau = 0.0;
  float conv;
  for (int i = 0; i < LIGHT_STEPS; i++) {
    float step = ds * exp2(float(i));
    tau += extinction(p + uSun * (t + (0.3 + 0.4 * j) * step), false, conv) * step;
    t += step;
  }
  return tau;
}

// The delta-Eddington slab (cloudPhysics.js eddingtonSlab): its
// transmittance of a beam at cosine mu, in the slab's scaled units.
float slabT(float tauE, float mu) {
  float gE = uEddington.x;
  float gamma = uEddington.z;
  mu = max(mu, MU_SUN_MIN);
  float direct = exp(-tauE / mu);
  float k = (2.0 * gamma + 1.5 * gE) * mu;
  return (1.0 + direct + k * (1.0 - direct)) / (2.0 + 2.0 * gamma * tauE);
}

// The diffuse field's source at depth tau into a slab of tauStar (both
// delta-M scaled), toward a direction of cosine muView from the vertical
// (cloudPhysics.js eddingtonSource).
float eddingtonSource(float tau, float tauStar, float muView, float mu) {
  float gE = uEddington.x;
  float scaleTau = uEddington.y;
  float gamma = uEddington.z;
  float tE = tau * scaleTau;
  float T = slabT(tauStar * scaleTau, mu);
  mu = max(mu, MU_SUN_MIN);
  float direct = exp(-tE / mu);
  float k = (2.0 * gamma + 1.5 * gE) * mu;
  float net = direct - T;
  float total = -k * direct - 2.0 * gamma * T * tE + (1.0 - T) + k;
  float i0 = total / (2.0 * PI);
  float i1 = 3.0 * net / (4.0 * PI);
  return max(i0 + gE * muView * i1, 0.0) * uEddington.w;
}

// The air's table coordinates at a height and a Sun cosine.
vec2 airUv(float h, float mu) {
  return vec2(clamp(h / (uAtmosphereRadius - uGroundRadius), 0.0, 1.0), mu * 0.5 + 0.5);
}

// The Sun's transmittance through the air to a point: the table's optical
// depths (AtmospherePrecompute), none with the Sun under its horizon.
vec3 sunThroughAir(vec3 p) {
  float r = length(p);
  vec2  pG = rsi(p, uSun, uGroundRadius);
  if (pG.x > 0.0 && pG.x < pG.y) return vec3(0.0);
  vec2 od = texture(tTransmittance, airUv(r - uGroundRadius, dot(p / r, uSun))).rg;
  return exp(-(uMieCoeff * od.g + uRayleigh * od.r));
}

// The ground's shadow under the cloud at g: the cloud's optical depth
// along the Sun's path up through the layer, coarse, through the slab's
// transmittance, for the direct beam's share.
float groundShadow(vec3 g, float j) {
  float r = length(g);
  float sunUp = dot(g / r, uSun);
  if (sunUp <= 0.0) return 0.0;
  float t0 = max(rsi(g, uSun, uBaseRadius).y, 0.0);
  float t1 = min(rsi(g, uSun, uTowerRadius).y, t0 + SHADOW_REACH);
  if (t1 <= t0) return 0.0;
  float ds = (t1 - t0) / float(SHADOW_STEPS);
  float tau = 0.0;
  float conv;
  for (int i = 0; i < SHADOW_STEPS; i++) {
    tau += extinction(g + uSun * (t0 + (float(i) + j) * ds), false, conv) * ds;
  }
  float tE = tau * uEddington.y;
  return DIRECT_SHARE * (1.0 - slabT(tE, 1.0)) * smoothstep(0.0, 0.05, sunUp);
}

void main() {
  vec2 frag = vUv * uTargetSize;
  // The view ray, from the projection (MilkyWay.js), into the body frame.
  vec2 ndc = vUv * 2.0 - 1.0;
  vec3 view = normalize(vec3((ndc.x + uProj.z) / uProj.x, (ndc.y + uProj.w) / uProj.y, -1.0));
  vec3 dir = normalize(uViewToBody * view);
  // Where the ray ends: the scene's depth (the ground, Cesium's terrain),
  // linearised as the atmosphere pass does, along the ray.
  float depthSample = texture(tDepth, vUv).r;
  float far = min(uFar, 1.0e15);
  float zNdc = depthSample * 2.0 - 1.0;
  float tMax = depthSample >= 1.0 ? 1.0e15 : (2.0 * uNear * far) / (uNear + far - zNdc * (far - uNear)) / max(-view.z, 1.0e-6);

  outCloud = vec4(0.0, 0.0, 0.0, 1.0);
  outData = vec4(0.0, 0.0, 0.0, 1.0);

  // The slab: between the base sphere and the towers' top.
  vec2 tOuter = rsi(uEye, dir, uTowerRadius);
  vec2 tInner = rsi(uEye, dir, uBaseRadius);
  float rEye = length(uEye);
  float start;
  float end;
  if (rEye < uBaseRadius) {
    start = max(tInner.y, 0.0);
    end = tOuter.y;
  } else if (rEye < uTowerRadius) {
    start = 0.0;
    end = (tInner.x > 0.0 && tInner.x < tInner.y) ? tInner.x : tOuter.y;
  } else {
    if (tOuter.x > tOuter.y || tOuter.y <= 0.0) return;
    start = max(tOuter.x, 0.0);
    end = (tInner.x > 0.0 && tInner.x < tInner.y) ? tInner.x : tOuter.y;
  }
  end = min(end, min(tMax, uMaxDistance));
  float j = jitter(frag);
  // The ground's shadow, where the ray reaches the ground.
  float shadow = 0.0;
  if (tMax < uMaxDistance) {
    shadow = groundShadow(uEye + dir * tMax, j);
  }
  if (end <= start) {
    outData = vec4(max(start, 1.0) * DIST_SCALE, shadow * uOpacity, 0.0, 1.0);
    return;
  }

  // The march: coarse steps through clear air, on the shape alone, and
  // fine ones with the detail through cloud (Schneider & Vos 2015): a
  // coarse step that meets cloud goes back and resumes fine, and after
  // FINE_MISSES clear fine steps the march goes coarse again.  A step
  // through cloud is a fraction of an optical depth, where one coarse
  // step would be opaque and band the cloud's face at the step.
  float len = end - start;
  float coarse = clamp(len / float(uSteps / 2), COARSE_MIN, COARSE_MAX);
  // A fine step is at most FINE_MAX: 1.5 of a stratocumulus's optical
  // depth, so a cloud's face falls across several (the march leaves a
  // thick cloud within a few, at a transmittance of 0.005).
  float fine = min(coarse * 0.25, FINE_MAX);
  float cosTheta = dot(dir, uSun);
  float single = texture(tPhase, vec2(acos(clamp(cosTheta, -1.0, 1.0)) / PI, 0.5)).r;
  // The Sun through the air at the ray's entry (the layer is thin against
  // the air), and the sky's diffuse light there.
  vec3  entry = uEye + dir * start;
  float hEntry = length(entry) - uGroundRadius;
  float muEntry = dot(normalize(entry), uSun);
  vec3  sunLight = sunThroughAir(entry);
  vec3  ambient = texture(tMultiScatter, airUv(hEntry, muEntry)).rgb;
  vec3  rgb = vec3(0.0);
  float T = 1.0;
  float distSum = 0.0;
  float alphaSum = 0.0;
  float t = start + j * coarse;
  float ds = coarse;
  int misses = 0;
  for (int i = 0; i < MAX_STEPS; i++) {
    if (i >= uSteps || t >= end || T < 0.005) break;
    vec3  p = uEye + dir * t;
    float conv;
    bool  isFine = ds < coarse;
    float ext = extinction(p, isFine, conv);
    if (ext > 0.0 && !isFine) {
      // Contact: back up a coarse step and come on fine.
      t = max(t - coarse, start);
      ds = fine;
      misses = 0;
      continue;
    }
    if (ext <= 0.0) {
      if (isFine && ++misses > FINE_MISSES) {
        ds = coarse;
      }
    } else {
      misses = 0;
      float r = length(p);
      vec3  up = p / r;
      float mu0 = dot(up, uSun);
      float tauS = lightDepth(p, j);
      // The local column's optical depths: to the top along the vertical
      // (the Sun's path projected), and to the base (the density tapering).
      float tauA = tauS * max(mu0, MU_SUN_MIN);
      float tauB = ext * max(r - uBaseRadius, 0.0) * 0.5;
      float muView = dot(up, -dir);
      // The beam's single scattering, per unit of its irradiance; the
      // Eddington field, per unit of the beam's flux on the slab, E·μ₀.
      float src = single * exp(-tauS) + max(mu0, 0.0) * eddingtonSource(tauA, tauA + tauB, muView, mu0);
      // The diffuse light from outside the cloud: the sky's (and the
      // sunlit ground's, in Ψ) from above through the depth to the top, and
      // from below the ground's reflection of what the whole column passes,
      // through the depth to the base: under an overcast the ground is in
      // the cloud's shadow, not the Sun's.
      float tauStar = (tauA + tauB) * uEddington.y;
      vec3  fromAbove = ambient * slabT(tauA * uEddington.y, 1.0);
      vec3  fromBelow = sunLight * (uGroundAlbedo * max(mu0, 0.0) * slabT(tauStar, mu0) / PI) * slabT(tauB * uEddington.y, 1.0);
      vec3  source = uAlbedo * (src * sunLight + fromAbove + fromBelow);
      float a = 1.0 - exp(-ext * ds);
      rgb += T * a * source;
      distSum += T * a * t;
      alphaSum += T * a;
      T *= 1.0 - a;
    }
    t += ds;
  }
  // A ray that left at the transmittance floor is opaque: the sky beyond
  // it, and the Sun's disc, which is 1e9 of a sunlit white, don't show
  // through what is left of it.
  if (T < 0.005) T = 0.0;
  // The cloud's mean distance; with no cloud, the slab's middle, so the
  // history has a place to reproject to and the pass's march somewhere
  // sensible to stop at the edge of a cloud.
  float dist = alphaSum > 0.0 ? distSum / alphaSum : 0.5 * (start + end);
  vec4 cloud = vec4(rgb * uOpacity, 1.0 - (1.0 - T) * uOpacity);
  // The distance in km: the target is half-float, whose top is 65,504.
  vec4 data = vec4(dist * DIST_SCALE, shadow * uOpacity, 0.0, 1.0);

  // The previous frame's result at this cloud's place, blended in where it
  // reprojects inside the frame and agrees on the distance.
  if (uHistoryWeight > 0.0) {
    vec3 q = uBodyToPrevView * (dir * dist + uPrevEyeDelta);
    if (q.z < 0.0) {
      vec2 ndcPrev = vec2(uPrevProj.x * q.x / -q.z - uPrevProj.z, uPrevProj.y * q.y / -q.z - uPrevProj.w);
      vec2 uvPrev = ndcPrev * 0.5 + 0.5;
      if (all(greaterThan(uvPrev, vec2(0.0))) && all(lessThan(uvPrev, vec2(1.0)))) {
        vec4  hist = texture(tHistory, uvPrev);
        vec2  histData = texture(tHistoryData, uvPrev).rg;
        float disagree = abs(histData.x / DIST_SCALE - length(q)) / (length(q) + 100.0);
        float w = uHistoryWeight * (1.0 - smoothstep(0.1, 0.3, disagree));
        cloud = mix(cloud, hist, w);
        // The ground's shadow too: its few jittered samples converge the
        // same way.
        data.y = mix(data.y, histData.y, w);
      }
    }
  }
  outCloud = cloud;
  outData = data;
}
`
