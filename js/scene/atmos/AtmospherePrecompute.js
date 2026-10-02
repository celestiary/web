// Precomputes Bruneton transmittance and in-scatter LUTs once per planet
// change via GPU render-to-texture; results are consumed by Atmosphere.js.
import {
  FloatType,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector3,
  WebGLRenderTarget,
} from 'three'


/**
 * GLSL `vec3 stepIntegral(vec3 sigma, float ds)`: the integral over a step
 * of length ds (metres) of e^(−sigma·s), per channel, for a constant
 * extinction sigma (per metre): (1 − e^(−sigma·ds)) / sigma, or ds where
 * sigma·ds is too small for that quotient to be exact in float32.  With it
 * a march's in-scatter is exact for the step's density, however thick the
 * step: summing e^(−τ) at the end of each step (the first cut) lost 11% of
 * each step's in-scatter at Mars's horizon, and a third of a 280 km
 * ground-level segment's.  Shared by the in-scatter precompute and the
 * atmosphere pass's segment march, so the two agree where they meet.
 */
export const STEP_INTEGRAL_GLSL = `
vec3 stepIntegral(vec3 sigma, float ds) {
  vec3 od = sigma * ds;
  vec3 exact = (1.0 - exp(-od)) / max(sigma, vec3(1.0e-30));
  vec3 series = ds * (1.0 - 0.5 * od);
  return mix(exact, series, step(od, vec3(1.0e-3)));
}
`


/**
 * Precomputes Bruneton transmittance LUT T(r, μ_sun) for the given atmosphere.
 *
 * Returns a 256×256 FloatType WebGLRenderTarget whose texture stores:
 *   R channel: Rayleigh density-weighted path length (odRlh) from (r, μ) to atmosphere top
 *   G channel: Mie density-weighted path length (odMie) from (r, μ) to atmosphere top
 *   Both channels = 0 when the sun ray is blocked by the planet.
 *
 * UV parameterisation:
 *   u = (r - rGround) / (rAtmos - rGround)   altitude ∈ [0,1]
 *   v = mu * 0.5 + 0.5                        cos(sun zenith) ∈ [0,1]
 *
 * @param {object} renderer
 * @param {object} atmos  reified atmosphere props (height.scalar, rayleighScaleHeight.scalar, mieScaleHeight.scalar)
 * @param {number} rGround  planet radius in meters
 * @returns {WebGLRenderTarget}  256×64 RGBA FloatType LUT
 */
export function precomputeTransmittance(renderer, atmos, rGround) {
  const W = 256; const H = 256
  const rt = new WebGLRenderTarget(W, H, {type: FloatType})

  const mat = new ShaderMaterial({
    uniforms: {
      uGroundRadius: {value: rGround},
      uAtmosphereRadius: {value: rGround + atmos.height.scalar},
      uRayleighScaleHeight: {value: atmos.rayleighScaleHeight.scalar},
      uMieScaleHeight: {value: atmos.mieScaleHeight.scalar},
    },
    vertexShader: TRANSMIT_VERT,
    fragmentShader: TRANSMIT_FRAG,
    depthTest: false,
    depthWrite: false,
  })

  const scene = new Scene()
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const geo = new PlaneGeometry(2, 2)
  const mesh = new Mesh(geo, mat)
  mesh.frustumCulled = false
  scene.add(mesh)

  renderer.setRenderTarget(rt)
  renderer.render(scene, camera)
  renderer.setRenderTarget(null)

  mat.dispose()
  geo.dispose()

  return rt
}


const TRANSMIT_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

const TRANSMIT_FRAG = `
precision highp float;

varying vec2 vUv;

uniform float uGroundRadius;
uniform float uAtmosphereRadius;
uniform float uRayleighScaleHeight;
uniform float uMieScaleHeight;

#define TRANSMIT_STEPS 500

vec2 rsi(vec3 r0, vec3 rd, float sr) {
  float a = dot(rd, rd);
  float b = 2.0 * dot(rd, r0);
  float c = dot(r0, r0) - sr * sr;
  float d = b*b - 4.0*a*c;
  if (d < 0.0) return vec2(1e5, -1e5);
  return vec2((-b - sqrt(d)) / (2.0*a),
              (-b + sqrt(d)) / (2.0*a));
}

void main() {
  // UV → (r, mu): altitude and cos(sun zenith angle)
  float r  = uGroundRadius + vUv.x * (uAtmosphereRadius - uGroundRadius);
  float mu = vUv.y * 2.0 - 1.0;

  // Ray origin: point at radius r above planet center
  vec3 origin = vec3(0.0, r, 0.0);
  // Ray direction with zenith cosine = mu (in the Y-up frame, zenith = +Y)
  vec3 dir    = vec3(sqrt(max(1.0 - mu * mu, 0.0)), mu, 0.0);

  // Integrate to ground (if ray hits it) or atmosphere exit.
  // For downward/sub-horizon rays, integrating to ground gives large optical
  // depths → attn≈0 in the scatter loop (correct physical shadowing).
  // Returning (0,0) for blocked rays was wrong: it zeroed out shadow contribution
  // instead of attenuating it, causing over-bright lighting under the horizon.
  float tMax;
  vec2 pG = rsi(origin, dir, uGroundRadius);
  if (pG.x > 0.0 && pG.x < pG.y) {
    tMax = pG.x;   // integrate to ground surface
  } else {
    vec2 pA = rsi(origin, dir, uAtmosphereRadius);
    tMax = pA.y;   // integrate to atmosphere exit
  }
  if (tMax <= 0.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  float odR = 0.0;
  float odM = 0.0;
  float dt  = tMax / float(TRANSMIT_STEPS);
  for (int i = 0; i < TRANSMIT_STEPS; i++) {
    float t      = (float(i) + 0.5) * dt;
    vec3  pos    = origin + dir * t;
    float height = max(length(pos) - uGroundRadius, 0.0);
    odR += exp(-height / uRayleighScaleHeight) * dt;
    odM += exp(-height / uMieScaleHeight) * dt;
  }

  // Store raw density-weighted path lengths (meters).
  // The scatter shader multiplies by kRlh (vec3) and kMie (float) respectively.
  gl_FragColor = vec4(odR, odM, 0.0, 1.0);
}
`


/**
 * Precomputes Bruneton single-scatter in-scatter LUT S(r, μ_view, μ_sun).
 * Uses the transmittance LUT for shadow rays, replacing the entire primary-ray
 * i-loop in the fullscreen scatter pass — no loops at runtime.
 *
 * Returns a 2048×512 FloatType atlas WebGLRenderTarget whose texture stores:
 *   RGB = kRlh * totalRlh  (Rayleigh scatter, pre-multiplied)
 *   A   = kMie * totalMie  (Mie scatter, grayscale approximation)
 *
 * Atlas layout: 64 r-slices × 32 μ_sun steps = 2048px wide, 512 μ_view steps tall.
 * Lookup: x = (r_slice + μ_sun_t) / R_SLICES,  y = μ_view_t
 * Manual r-slice blend in the fullscreen shader for trilinear interpolation.
 *
 * @param {object} renderer
 * @param {object} atmos  reified atmosphere props
 * @param {number} rGround  planet radius in meters
 * @param {WebGLRenderTarget} transmittanceRT  output of precomputeTransmittance
 * @returns {WebGLRenderTarget}  2048×512 RGBA FloatType atlas
 */
export function precomputeInScatter(renderer, atmos, rGround, transmittanceRT) {
  const W = 2048; const H = 512 // 64 r-slices × 32 mu_sun, 512 mu_view
  const rt = new WebGLRenderTarget(W, H, {type: FloatType})

  const mat = new ShaderMaterial({
    uniforms: {
      uGroundRadius: {value: rGround},
      uAtmosphereRadius: {value: rGround + atmos.height.scalar},
      uRayleighScaleHeight: {value: atmos.rayleighScaleHeight.scalar},
      uMieScaleHeight: {value: atmos.mieScaleHeight.scalar},
      uRayleigh: {value: new Vector3(...atmos.rayleigh)},
      uMieCoeff: {value: atmos.mieCoeff},
      tTransmittance: {value: transmittanceRT.texture},
    },
    vertexShader: INSCATTER_VERT,
    fragmentShader: INSCATTER_FRAG,
    depthTest: false,
    depthWrite: false,
  })

  const scene = new Scene()
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const geo = new PlaneGeometry(2, 2)
  const mesh = new Mesh(geo, mat)
  mesh.frustumCulled = false
  scene.add(mesh)

  renderer.setRenderTarget(rt)
  renderer.render(scene, camera)
  renderer.setRenderTarget(null)

  mat.dispose()
  geo.dispose()

  return rt
}


const INSCATTER_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

// Ray-sphere intersection (sphere at the origin): `vec2 rsi(r0, rd, sr)`,
// (tNear, tFar); no intersection when tNear > tFar.
const RSI_GLSL = `
vec2 rsi(vec3 r0, vec3 rd, float sr) {
  float a = dot(rd, rd);
  float b = 2.0 * dot(rd, r0);
  float c = dot(r0, r0) - sr * sr;
  float d = b*b - 4.0*a*c;
  if (d < 0.0) return vec2(1e5, -1e5);
  return vec2((-b - sqrt(d)) / (2.0*a),
              (-b + sqrt(d)) / (2.0*a));
}
`


// The in-scatter atlas's row decode, `float bruneton_decode_mu_v(r, t, rG, rA)`
// (the inverse of the pass's encode).
const BRUNETON_DECODE_GLSL = `
// Bruneton horizon-aware mu_view decode.
// t ∈ [0.5, 1.0] → sky rays (mu_v ≥ local horizon), rows concentrated near horizon.
// t ∈ [0.0, 0.5) → ground rays (mu_v < local horizon).
// Parameterises by ray path length to atmosphere top / ground surface so that
// angles near the horizon — where scatter changes fastest — get the most rows.
float bruneton_decode_mu_v(float r, float t, float rG, float rA) {
  float rho = sqrt(max(0.0, r*r - rG*rG));
  float H   = sqrt(max(0.0, rA*rA - rG*rG));
  if (t >= 0.5) {
    float u    = 2.0*t - 1.0;             // [0,1]: 0=horizon, 1=zenith
    float dMin = rA - r;
    float dMax = rho + H;
    float d    = dMax - u*(dMax - dMin);   // d_max at horizon, d_min at zenith
    return (rA*rA - r*r - d*d) / max(2.0*r*d, 1e-3);
  } else {
    float u    = 2.0*t;                    // [0,1]: 0=nadir, 1=horizon
    float dMin = r - rG;
    float dMax = rho;
    float d    = dMin + u*max(dMax - dMin, 0.0);
    return (rG*rG - r*r - d*d) / max(2.0*r*d, 1e-3);
  }
}
`


const INSCATTER_FRAG = `
precision highp float;

varying vec2 vUv;

uniform float     uGroundRadius;
uniform float     uAtmosphereRadius;
uniform float     uRayleighScaleHeight;
uniform float     uMieScaleHeight;
uniform vec3      uRayleigh;
uniform float     uMieCoeff;
uniform sampler2D tTransmittance;

#define R_SLICES        64
#define INSCATTER_STEPS 128

${STEP_INTEGRAL_GLSL}

${RSI_GLSL}

${BRUNETON_DECODE_GLSL}

void main() {
  // Decode atlas UV → (r, mu_view, mu_sun)
  // Atlas x: [0,1] covers R_SLICES tiles each 1/R_SLICES wide.
  // Within each tile: x position = mu_sun_t ∈ [0,1].
  // Atlas y: Bruneton horizon-aware mu_view_t ∈ [0,1] (r must be decoded first).
  float atlas_x = vUv.x * float(R_SLICES);
  float r_idx   = floor(atlas_x);
  float mu_sun  = fract(atlas_x) * 2.0 - 1.0;
  float r_t     = r_idx / float(R_SLICES - 1);
  float r       = uGroundRadius + r_t * (uAtmosphereRadius - uGroundRadius);
  // The ground slice's ground rows (r = rG, looking below the horizon): a
  // ray from the ground into the ground has no length, so no in-scatter.
  // The decode is degenerate there (d = dMin = dMax = 0 gives mu_view = 0,
  // a horizontal ray, and rsi finds no ground ahead of a ray that grazes it
  // at t = 0), and integrated the whole horizon: a bright, yellow glow over
  // the ground whenever the camera was below the next slice (1.3 km on
  // Earth), since the lookup blends slices by altitude.
  if (vUv.y < 0.5 && r_idx < 0.5) {
    gl_FragColor = vec4(0.0);
    return;
  }
  float mu_view = bruneton_decode_mu_v(r, vUv.y, uGroundRadius, uAtmosphereRadius);

  // Primary ray from (0, r, 0) with zenith cosine mu_view
  vec3 eyePos = vec3(0.0, r, 0.0);
  vec3 rayDir = vec3(sqrt(max(1.0 - mu_view*mu_view, 0.0)), mu_view, 0.0);
  // Sun direction: zenith cosine mu_sun at the origin (0, r, 0)
  vec3 sunDir = vec3(sqrt(max(1.0 - mu_sun*mu_sun, 0.0)), mu_sun, 0.0);

  // Clip primary ray at atmosphere exit and ground
  vec2 p  = rsi(eyePos, rayDir, uAtmosphereRadius);
  vec2 pG = rsi(eyePos, rayDir, uGroundRadius);
  if (pG.x > 0.0 && pG.x < pG.y) p.y = min(p.y, pG.x);

  float iTime     = max(p.x, 0.0);
  float iStepSize = (p.y - iTime) / float(INSCATTER_STEPS);
  if (iStepSize <= 0.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  vec3  totalRlh = vec3(0.0);
  float totalMie = 0.0;
  // The ray's transmittance so far, per channel.
  vec3  T = vec3(1.0);

  for (int i = 0; i < INSCATTER_STEPS; i++) {
    vec3  iPos    = eyePos + rayDir * (iTime + iStepSize * 0.5);
    float iHeight = max(length(iPos) - uGroundRadius, 0.0);
    float dRlh    = exp(-iHeight / uRayleighScaleHeight);
    float dMie    = exp(-iHeight / uMieScaleHeight);

    // Shadow: transmittance LUT lookup from iPos toward sun.
    // The transmittance LUT encodes only atmospheric opacity; it does NOT
    // account for the solid planet body.  Explicitly check if the sun ray is
    // blocked by the planet sphere and treat it as fully opaque if so.
    float iR   = length(iPos);
    float mu_s = dot(normalize(iPos), sunDir);
    vec2  jOd;
    vec2  pPlanet = rsi(iPos, sunDir, uGroundRadius);
    if (pPlanet.x > 0.0 && pPlanet.x < pPlanet.y) {
      // Sun is behind the planet body — completely opaque.
      // jOd stores density-weighted path lengths in metres, so this must
      // drive exp(-k*jOd) to zero for the smallest coefficient: Earth's
      // Rayleigh red is 5.8e-6 /m, and 1e6 m let e^-5.8 = 0.3% of the Sun
      // through every blocked step, which the metered exposure (HDR.md)
      // showed as a red sky with the Sun 35° under the horizon.  1e12 m
      // is τ > 1e4 for any coefficient over 1e-8 /m (Mars's Rayleigh is
      // 1.2e-7); exp underflows to 0, no NaN.
      jOd = vec2(1.0e12, 1.0e12);
    } else {
      jOd = texture2D(tTransmittance,
               vec2((iR - uGroundRadius) / (uAtmosphereRadius - uGroundRadius),
                    mu_s * 0.5 + 0.5)).rg;
    }

    // The step's in-scatter: its density times the sunlight reaching it,
    // through the ray's transmittance so far and the step's own, integrated
    // exactly over the step (stepIntegral).
    vec3  sunT  = exp(-(uMieCoeff * jOd.g + uRayleigh * jOd.r));
    vec3  sigma = uRayleigh * dRlh + vec3(uMieCoeff * dMie);
    vec3  w     = T * sunT * stepIntegral(sigma, iStepSize);
    totalRlh  += dRlh * w;
    totalMie  += dMie * w.r;   // grayscale Mie (kMie is wavelength-independent)
    T         *= exp(-sigma * iStepSize);
    iTime     += iStepSize;
  }

  // RGB = kRlh * totalRlh  (apply phase + sunIntensity at lookup time)
  // A   = kMie * totalMie
  gl_FragColor = vec4(uRayleigh * totalRlh, uMieCoeff * totalMie);
}
`


/**
 * The Mie (aerosol, dust) parameters of a body's atmosphere, with their
 * defaults, from its JSON (composition.md, "Per-body data"):
 *
 * - `miePolarity`: the forward lobe's asymmetry g, one number or [r, g, b]
 *   (Mars's dust scatters blue more sharply forward than red, which is the
 *   bluish aureole round the Sun).
 * - `mieBackPolarity`, `mieForwardWeight`: a second, backward lobe with
 *   asymmetry g2 and the forward lobe's share w (two-term Henyey-Greenstein;
 *   w = 1, the default, is the one lobe Earth has always had).
 * - `mieAlbedo`: the single-scattering albedo, one number or [r, g, b]; 1
 *   (the default) scatters everything it takes out of the beam.  Mars's
 *   dust absorbs blue.
 *
 * @param {object} atmos A body's reified atmosphere props
 * @returns {{polarity: Vector3, backPolarity: number, forwardWeight: number, albedo: Vector3}}
 */
export function mieParams(atmos) {
  const vec = (v, dflt) => {
    const a = Array.isArray(v) ? v : [v ?? dflt, v ?? dflt, v ?? dflt]
    return new Vector3(...a)
  }
  return {
    polarity: vec(atmos.miePolarity, 0),
    backPolarity: atmos.mieBackPolarity ?? 0,
    forwardWeight: atmos.mieForwardWeight ?? 1,
    albedo: vec(atmos.mieAlbedo, 1),
  }
}


/**
 * GLSL for the Mie phase function: `float csPhase(float mu, float g)`,
 * Cornette-Shanks for asymmetry g at mu = cos(scattering angle), and
 * `vec3 miePhase(float mu, vec3 g1, float g2, float w)`, the two-term form
 * per channel (mieParams).  Shared by the pass and the precompute.
 */
export const MIE_PHASE_GLSL = `
float csPhase(float mu, float g) {
  float g2 = g * g;
  return 3.0 / (8.0 * 3.14159265) * ((1.0 - g2) * (1.0 + mu * mu))
      / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * g * mu, 1.5));
}
vec3 miePhase(float mu, vec3 g1, float g2, float w) {
  return w * vec3(csPhase(mu, g1.r), csPhase(mu, g1.g), csPhase(mu, g1.b)) + (1.0 - w) * csPhase(mu, g2);
}
`


/**
 * The uniforms every precompute of an atmosphere shares.
 *
 * @param {object} atmos
 * @param {number} rGround
 * @returns {object}
 */
function atmosUniforms(atmos, rGround) {
  const mie = mieParams(atmos)
  return {
    uGroundRadius: {value: rGround},
    uAtmosphereRadius: {value: rGround + atmos.height.scalar},
    uRayleighScaleHeight: {value: atmos.rayleighScaleHeight.scalar},
    uMieScaleHeight: {value: atmos.mieScaleHeight.scalar},
    uRayleigh: {value: new Vector3(...atmos.rayleigh)},
    uMieCoeff: {value: atmos.mieCoeff},
    uMieAlbedo: {value: mie.albedo},
    uMiePolarity: {value: mie.polarity},
    uMieBackPolarity: {value: mie.backPolarity},
    uMieForwardWeight: {value: mie.forwardWeight},
  }
}


/**
 * Render a fullscreen fragment shader into a new float render target.
 *
 * @param {object} renderer
 * @param {number} width
 * @param {number} height
 * @param {object} uniforms
 * @param {string} fragmentShader
 * @returns {WebGLRenderTarget}
 */
function renderLut(renderer, width, height, uniforms, fragmentShader) {
  const rt = new WebGLRenderTarget(width, height, {type: FloatType})
  const mat = new ShaderMaterial({
    uniforms, vertexShader: INSCATTER_VERT, fragmentShader, depthTest: false, depthWrite: false,
  })
  const scene = new Scene()
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const geo = new PlaneGeometry(2, 2)
  const mesh = new Mesh(geo, mat)
  mesh.frustumCulled = false
  scene.add(mesh)
  renderer.setRenderTarget(rt)
  renderer.render(scene, camera)
  renderer.setRenderTarget(null)
  mat.dispose()
  geo.dispose()
  return rt
}


/**
 * Precomputes the multiple-scattering factor Ψ(r, μ_sun): the radiance,
 * per unit of the Sun's irradiance, that a point at radius r with the Sun
 * at zenith cosine μ_sun receives from the light scattered twice or more,
 * taken as isotropic from the second scattering on (Hillaire 2020, "A
 * Scalable and Production Ready Sky and Atmosphere Rendering Technique",
 * EGSR; BRUNETON.md).  Per texel: the single-scattered radiance arriving
 * from 64 directions (through the transmittance LUT for the Sun; the
 * sunlit ground's reflection, with the body's albedo, where a direction
 * meets it), averaged, over one minus the average fraction of light
 * scattered again before it escapes: the geometric sum of all orders.
 * The in-scatter along a ray then adds σ_s·Ψ per metre (precomputeInScatterMs,
 * the pass's march).
 *
 * @param {object} renderer
 * @param {object} atmos
 * @param {number} rGround
 * @param {WebGLRenderTarget} transmittanceRT
 * @param {number} groundAlbedo The body's albedo (its JSON)
 * @returns {WebGLRenderTarget} 64×64 RGBA FloatType: Ψ in rgb, over
 *   u = altitude, v = μ_sun·0.5 + 0.5
 */
export function precomputeMultiScatter(renderer, atmos, rGround, transmittanceRT, groundAlbedo) {
  return renderLut(renderer, 64, 64, {
    ...atmosUniforms(atmos, rGround),
    uGroundAlbedo: {value: groundAlbedo},
    tTransmittance: {value: transmittanceRT.texture},
  }, MULTISCATTER_FRAG)
}


/**
 * Precomputes the multiply-scattered in-scatter atlas, laid out as
 * precomputeInScatter's: along the same rays, σ_s(x)·Ψ(x) through the
 * ray's transmittance to x, in rgb (no phase function: it's isotropic).
 *
 * @param {object} renderer
 * @param {object} atmos
 * @param {number} rGround
 * @param {WebGLRenderTarget} transmittanceRT
 * @param {WebGLRenderTarget} multiScatterRT precomputeMultiScatter's
 * @returns {WebGLRenderTarget} 2048×512 RGBA FloatType atlas
 */
export function precomputeInScatterMs(renderer, atmos, rGround, transmittanceRT, multiScatterRT) {
  return renderLut(renderer, 2048, 512, {
    ...atmosUniforms(atmos, rGround),
    tTransmittance: {value: transmittanceRT.texture},
    tMultiScatter: {value: multiScatterRT.texture},
  }, INSCATTER_MS_FRAG)
}


// The Sun's transmittance to a point, through the LUT: none behind the
// planet.
const SUN_TRANSMITTANCE_GLSL = `
vec3 sunTransmittance(vec3 pos, vec3 sun) {
  float r = length(pos);
  float h = max(r - uGroundRadius, 0.0);
  vec2 pP = rsi(pos, sun, uGroundRadius);
  if (r >= uGroundRadius && pP.x > 0.0 && pP.x < pP.y) {
    return vec3(0.0);
  }
  vec2 od = texture2D(tTransmittance,
      vec2(h / (uAtmosphereRadius - uGroundRadius), dot(pos / r, sun) * 0.5 + 0.5)).rg;
  return exp(-(uMieCoeff * od.g + uRayleigh * od.r));
}
`


const MULTISCATTER_FRAG = `
precision highp float;

varying vec2 vUv;

uniform float     uGroundRadius;
uniform float     uAtmosphereRadius;
uniform float     uRayleighScaleHeight;
uniform float     uMieScaleHeight;
uniform vec3      uRayleigh;
uniform float     uMieCoeff;
uniform vec3      uMieAlbedo;
uniform vec3      uMiePolarity;
uniform float     uMieBackPolarity;
uniform float     uMieForwardWeight;
uniform float     uGroundAlbedo;
uniform sampler2D tTransmittance;

#define MS_DIRS  64
#define MS_STEPS 32
#define PI 3.14159265

${RSI_GLSL}
${STEP_INTEGRAL_GLSL}
${MIE_PHASE_GLSL}
${SUN_TRANSMITTANCE_GLSL}

void main() {
  float r    = uGroundRadius + vUv.x * (uAtmosphereRadius - uGroundRadius);
  float mu_s = vUv.y * 2.0 - 1.0;
  vec3  x    = vec3(0.0, r, 0.0);
  vec3  sun  = vec3(sqrt(max(1.0 - mu_s * mu_s, 0.0)), mu_s, 0.0);
  vec3  L    = vec3(0.0);  // the single-scattered radiance arriving at x, summed over directions
  vec3  f    = vec3(0.0);  // the share of light leaving x scattered again, summed
  const float GOLDEN = 2.39996323;
  for (int i = 0; i < MS_DIRS; i++) {
    // A direction of a Fibonacci sphere.
    float z   = 1.0 - 2.0 * (float(i) + 0.5) / float(MS_DIRS);
    float rho = sqrt(max(0.0, 1.0 - z * z));
    float phi = GOLDEN * float(i);
    vec3  dir = vec3(rho * cos(phi), z, rho * sin(phi));
    vec2  pG  = rsi(x, dir, uGroundRadius);
    bool  ground = pG.x > 0.0 && pG.x < pG.y;
    float tMax = ground ? pG.x : rsi(x, dir, uAtmosphereRadius).y;
    float nu   = dot(dir, sun);
    float pR   = 3.0 / (16.0 * PI) * (1.0 + nu * nu);
    vec3  pM   = miePhase(nu, uMiePolarity, uMieBackPolarity, uMieForwardWeight);
    vec3  T    = vec3(1.0);
    float ds   = tMax / float(MS_STEPS);
    for (int j = 0; j < MS_STEPS; j++) {
      vec3  pos = x + dir * ((float(j) + 0.5) * ds);
      float h   = max(length(pos) - uGroundRadius, 0.0);
      float dR  = exp(-h / uRayleighScaleHeight);
      float dM  = exp(-h / uMieScaleHeight);
      vec3  sigma  = uRayleigh * dR + vec3(uMieCoeff * dM);
      vec3  sigmaS = uRayleigh * dR + uMieCoeff * uMieAlbedo * dM;
      vec3  g = T * stepIntegral(sigma, ds);
      L += g * sunTransmittance(pos, sun) * (uRayleigh * dR * pR + uMieCoeff * uMieAlbedo * dM * pM);
      f += g * sigmaS;
      T *= exp(-sigma * ds);
    }
    if (ground) {
      // The sunlit ground, a Lambertian reflector of the body's albedo.
      vec3  xg = x + dir * tMax;
      float c  = max(dot(normalize(xg), sun), 0.0);
      L += T * sunTransmittance(xg, sun) * uGroundAlbedo / PI * c;
    }
  }
  L /= float(MS_DIRS);
  f /= float(MS_DIRS);
  gl_FragColor = vec4(L / max(1.0 - f, 1.0e-3), 1.0);
}
`


const INSCATTER_MS_FRAG = `
precision highp float;

varying vec2 vUv;

uniform float     uGroundRadius;
uniform float     uAtmosphereRadius;
uniform float     uRayleighScaleHeight;
uniform float     uMieScaleHeight;
uniform vec3      uRayleigh;
uniform float     uMieCoeff;
uniform vec3      uMieAlbedo;
uniform sampler2D tTransmittance;
uniform sampler2D tMultiScatter;

#define R_SLICES        64
#define INSCATTER_STEPS 128

${RSI_GLSL}
${STEP_INTEGRAL_GLSL}
${BRUNETON_DECODE_GLSL}

void main() {
  float atlas_x = vUv.x * float(R_SLICES);
  float r_idx   = floor(atlas_x);
  float mu_sun  = fract(atlas_x) * 2.0 - 1.0;
  float r_t     = r_idx / float(R_SLICES - 1);
  float r       = uGroundRadius + r_t * (uAtmosphereRadius - uGroundRadius);
  // The ground slice's ground rows: zero, as in the single-scatter atlas.
  if (vUv.y < 0.5 && r_idx < 0.5) {
    gl_FragColor = vec4(0.0);
    return;
  }
  float mu_view = bruneton_decode_mu_v(r, vUv.y, uGroundRadius, uAtmosphereRadius);
  vec3 eyePos = vec3(0.0, r, 0.0);
  vec3 rayDir = vec3(sqrt(max(1.0 - mu_view*mu_view, 0.0)), mu_view, 0.0);
  vec3 sunDir = vec3(sqrt(max(1.0 - mu_sun*mu_sun, 0.0)), mu_sun, 0.0);
  vec2 p  = rsi(eyePos, rayDir, uAtmosphereRadius);
  vec2 pG = rsi(eyePos, rayDir, uGroundRadius);
  if (pG.x > 0.0 && pG.x < pG.y) p.y = min(p.y, pG.x);
  float iTime     = max(p.x, 0.0);
  float iStepSize = (p.y - iTime) / float(INSCATTER_STEPS);
  if (iStepSize <= 0.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  vec3 total = vec3(0.0);
  vec3 T = vec3(1.0);
  for (int i = 0; i < INSCATTER_STEPS; i++) {
    vec3  iPos = eyePos + rayDir * (iTime + iStepSize * 0.5);
    float iR   = length(iPos);
    float h    = max(iR - uGroundRadius, 0.0);
    float dRlh = exp(-h / uRayleighScaleHeight);
    float dMie = exp(-h / uMieScaleHeight);
    vec3  sigma  = uRayleigh * dRlh + vec3(uMieCoeff * dMie);
    vec3  sigmaS = uRayleigh * dRlh + uMieCoeff * uMieAlbedo * dMie;
    vec3  psi = texture2D(tMultiScatter,
        vec2(h / (uAtmosphereRadius - uGroundRadius), dot(iPos / iR, sunDir) * 0.5 + 0.5)).rgb;
    total += sigmaS * psi * T * stepIntegral(sigma, iStepSize);
    T     *= exp(-sigma * iStepSize);
    iTime += iStepSize;
  }
  gl_FragColor = vec4(total, 1.0);
}
`
