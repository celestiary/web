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

vec2 rsi(vec3 r0, vec3 rd, float sr) {
  float a = dot(rd, rd);
  float b = 2.0 * dot(rd, r0);
  float c = dot(r0, r0) - sr * sr;
  float d = b*b - 4.0*a*c;
  if (d < 0.0) return vec2(1e5, -1e5);
  return vec2((-b - sqrt(d)) / (2.0*a),
              (-b + sqrt(d)) / (2.0*a));
}

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
  float iOdRlh   = 0.0;
  float iOdMie   = 0.0;

  for (int i = 0; i < INSCATTER_STEPS; i++) {
    vec3  iPos    = eyePos + rayDir * (iTime + iStepSize * 0.5);
    float iHeight = max(length(iPos) - uGroundRadius, 0.0);
    float odRlh   = exp(-iHeight / uRayleighScaleHeight) * iStepSize;
    float odMie   = exp(-iHeight / uMieScaleHeight) * iStepSize;
    iOdRlh += odRlh;
    iOdMie += odMie;

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
      // jOd stores density-weighted path lengths in metres; kMie ~ 2e-5 m⁻¹
      // so we need jOd >> 1/kMie ~ 5e4 m to drive exp(-k*jOd) to zero.
      // 1e6 m gives τ_Mie ≈ 21, τ_Rayleigh ≈ 33 → attn < 1e-9.
      jOd = vec2(1.0e6, 1.0e6);
    } else {
      jOd = texture2D(tTransmittance,
               vec2((iR - uGroundRadius) / (uAtmosphereRadius - uGroundRadius),
                    mu_s * 0.5 + 0.5)).rg;
    }

    vec3  attn = exp(-(uMieCoeff*(iOdMie + jOd.g) + uRayleigh*(iOdRlh + jOd.r)));
    totalRlh  += odRlh * attn;
    totalMie  += odMie * attn.r;   // grayscale Mie (kMie is wavelength-independent)
    iTime     += iStepSize;
  }

  // RGB = kRlh * totalRlh  (apply phase + sunIntensity at lookup time)
  // A   = kMie * totalMie
  gl_FragColor = vec4(uRayleigh * totalRlh, uMieCoeff * totalMie);
}
`
