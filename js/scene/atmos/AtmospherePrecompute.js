// Precomputes Bruneton transmittance and in-scatter LUTs once per planet
// change via GPU render-to-texture; results are consumed by Atmosphere.js.
import {
  FloatType,
  HalfFloatType,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector3,
  WebGLRenderTarget,
} from 'three'
import {
  GROUND_LIGHT_ROWS, GROUND_LIGHT_W, MU_S_MIN, groundLightFor, groundMonth, monthsAlbedo, setBuiltAlbedo, setGroundLight,
} from './groundLight.js'


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
 * GLSL `float ozoneDensity(float h)`: the ozone layer's density at height h,
 * over its peak's (ozoneParams' tent, uOzoneProfile).  For the shaders that
 * declare uOzoneProfile.
 */
export const OZONE_GLSL = `
float ozoneDensity(float h) {
  float w = h < uOzoneProfile.y ? uOzoneProfile.y - uOzoneProfile.x : uOzoneProfile.z - uOzoneProfile.y;
  return max(1.0 - abs(h - uOzoneProfile.y) / max(w, 1.0), 0.0);
}
`


/**
 * Precomputes Bruneton transmittance LUT T(r, μ_sun) for the given atmosphere.
 *
 * Returns a 256×256 FloatType WebGLRenderTarget whose texture stores:
 *   R channel: Rayleigh density-weighted path length (odRlh) from (r, μ) to atmosphere top
 *   G channel: Mie density-weighted path length (odMie) from (r, μ) to atmosphere top
 *   B channel: the ozone layer's (odOzone, its tent profile: ozoneParams),
 *     as Bruneton's 2017 implementation keeps an absorption density; times
 *     the body's ozone absorption, zero for a body with none
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
      uOzoneProfile: {value: ozoneParams(atmos).profile},
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
uniform vec3  uOzoneProfile;

#define TRANSMIT_STEPS 500
${OZONE_GLSL}

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
  float odO = 0.0;
  float dt  = tMax / float(TRANSMIT_STEPS);
  for (int i = 0; i < TRANSMIT_STEPS; i++) {
    float t      = (float(i) + 0.5) * dt;
    vec3  pos    = origin + dir * t;
    float height = max(length(pos) - uGroundRadius, 0.0);
    odR += exp(-height / uRayleighScaleHeight) * dt;
    odM += exp(-height / uMieScaleHeight) * dt;
    odO += ozoneDensity(height) * dt;
  }

  // Store raw density-weighted path lengths (meters).
  // The scatter shader multiplies by kRlh, kMie and the ozone's absorption (vec3s).
  gl_FragColor = vec4(odR, odM, odO, 1.0);
}
`


/**
 * Precomputes Bruneton single-scatter in-scatter LUT S(r, μ_view, μ_sun).
 * Uses the transmittance LUT for shadow rays, replacing the entire primary-ray
 * i-loop in the fullscreen scatter pass — no loops at runtime.
 *
 * Returns a 2048×512 FloatType atlas WebGLRenderTarget whose texture stores:
 *   RGB = kRlh * totalRlh  (Rayleigh scatter, pre-multiplied), of the
 *         delta-M beam: through the extinction with the aerosol's narrow
 *         forward lobe taken as unscattered (composition.md, "The dust's
 *         forward peak"); the true one where there is no such lobe (Earth)
 *   A   = kMie * totalMie  (Mie scatter, red's: red's coefficient and
 *         transmittance), of the direct beam, through the true extinction:
 *         the narrow lobe's first order.  The pass takes it as grey, or for a
 *         body whose aerosol's extinction is per channel (Earth's) gives it
 *         the colour Bruneton's 2017 implementation does (the pass's mieColour)
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
  const rt = renderInScatter(renderer, atmos, rGround, transmittanceRT, false)
  if (mieParams(atmos).chroma) {
    // The Mie's colour, for an aerosol whose extinction is per channel
    // (Earth's): the in-scatter's Mie per channel over red's, so the pass
    // multiplies a by it in place of the reconstruction from the Rayleigh's
    // (mieColour), which takes the two to have travelled the same air.  The
    // aerosol's 1.2 km scale height puts it under nearly the whole column,
    // the gas's 8 km above most of it: through the disc from orbit the
    // reconstruction gave the Mie 1.65 times its blue, and at sunset by the
    // Sun 0.60 of it (composition.md, "The Mie's colour").  A ratio, so half
    // floats hold it; on the main atlas's texture, which the pass reads it
    // from (newAtmospherePass), and disposed with it.
    const mie = renderInScatter(renderer, atmos, rGround, transmittanceRT, true)
    rt.texture.userData.mieColour = mie.texture
    const dispose = rt.dispose.bind(rt)
    rt.dispose = () => {
      mie.dispose()
      dispose()
    }
  }
  return rt
}


/**
 * The in-scatter atlas, or with `mieColour` its Mie's colour (Mie per
 * channel over red's, in rgb, half floats), for precomputeInScatter.
 *
 * @param {object} renderer
 * @param {object} atmos
 * @param {number} rGround
 * @param {WebGLRenderTarget} transmittanceRT
 * @param {boolean} mieColour
 * @returns {WebGLRenderTarget}
 */
function renderInScatter(renderer, atmos, rGround, transmittanceRT, mieColour) {
  const W = 2048; const H = 512 // 64 r-slices × 32 mu_sun, 512 mu_view
  const rt = new WebGLRenderTarget(W, H, {type: mieColour ? HalfFloatType : FloatType})

  const mat = new ShaderMaterial({
    uniforms: {
      uGroundRadius: {value: rGround},
      uAtmosphereRadius: {value: rGround + atmos.height.scalar},
      uRayleighScaleHeight: {value: atmos.rayleighScaleHeight.scalar},
      uMieScaleHeight: {value: atmos.mieScaleHeight.scalar},
      uRayleigh: {value: new Vector3(...atmos.rayleigh)},
      uMieCoeff: {value: mieParams(atmos).extinction},
      uMieAlbedo: {value: mieParams(atmos).albedo},
      uMiePeakWeight: {value: mieParams(atmos).peakWeight},
      uOzone: {value: ozoneParams(atmos).absorption},
      uOzoneProfile: {value: ozoneParams(atmos).profile},
      tTransmittance: {value: transmittanceRT.texture},
    },
    vertexShader: INSCATTER_VERT,
    fragmentShader: INSCATTER_FRAG,
    defines: {MIE_COLOUR: mieColour ? 1 : 0},
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


// The Sun behind the planet: jOd stores density-weighted path lengths in
// metres, so the blocked Sun's must drive exp(-k*jOd) to zero for the
// smallest coefficient: Earth's Rayleigh red is about 6e-6 /m, and 1e6 m let
// e^-5.8 = 0.3% of the Sun through every blocked step, which the metered
// exposure (HDR.md) showed as a red sky with the Sun 35° under the horizon.
// 1e12 m is τ > 1e4 for any coefficient over 1e-8 /m (Mars's Rayleigh is
// 1.2e-7); exp underflows to 0, no NaN.  (Kept out of the shader's string,
// whose comments ship.)
const INSCATTER_FRAG = `
precision highp float;

varying vec2 vUv;

uniform float     uGroundRadius;
uniform float     uAtmosphereRadius;
uniform float     uRayleighScaleHeight;
uniform float     uMieScaleHeight;
uniform vec3      uRayleigh;
uniform vec3      uMieCoeff;
uniform vec3      uMieAlbedo;
uniform vec3      uOzone;
uniform vec3      uOzoneProfile;
uniform vec3      uMiePeakWeight;
uniform sampler2D tTransmittance;

#define R_SLICES        64
#define INSCATTER_STEPS 128

${STEP_INTEGRAL_GLSL}

${RSI_GLSL}

${OZONE_GLSL}

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
  vec3  totalMieRgb = vec3(0.0);
  // The ray's transmittance so far, per channel.
  vec3  T = vec3(1.0);
  // The delta-M beam's (composition.md, "The dust's forward peak"): the
  // aerosol's narrow forward lobe taken as unscattered, so its extinction
  // is the rest, (1 − albedo · peak share) of it.  The gas scatters that
  // beam; the narrow lobe's own first order is the Mie, of the direct beam.
  // With no narrow lobe (Earth) the two are one.
  vec3  kMieS = uMieCoeff * (1.0 - uMieAlbedo * uMiePeakWeight);
  vec3  Ts = vec3(1.0);

  for (int i = 0; i < INSCATTER_STEPS; i++) {
    vec3  iPos    = eyePos + rayDir * (iTime + iStepSize * 0.5);
    float iHeight = max(length(iPos) - uGroundRadius, 0.0);
    float dRlh    = exp(-iHeight / uRayleighScaleHeight);
    float dMie    = exp(-iHeight / uMieScaleHeight);
    vec3  kOz     = uOzone * ozoneDensity(iHeight);

    // Shadow: transmittance LUT lookup from iPos toward sun.
    // The transmittance LUT encodes only atmospheric opacity; it does NOT
    // account for the solid planet body.  Explicitly check if the sun ray is
    // blocked by the planet sphere and treat it as fully opaque if so.
    float iR   = length(iPos);
    float mu_s = dot(normalize(iPos), sunDir);
    vec3  jOd;
    vec2  pPlanet = rsi(iPos, sunDir, uGroundRadius);
    if (pPlanet.x > 0.0 && pPlanet.x < pPlanet.y) {
      // Sun behind the planet: opaque (the note above INSCATTER_FRAG).
      jOd = vec3(1.0e12);
    } else {
      jOd = texture2D(tTransmittance,
               vec2((iR - uGroundRadius) / (uAtmosphereRadius - uGroundRadius),
                    mu_s * 0.5 + 0.5)).rgb;
    }

    // The step's in-scatter: its density times the sunlight reaching it,
    // through the ray's transmittance so far and the step's own, integrated
    // exactly over the step (stepIntegral).
    vec3  sunT  = exp(-(uMieCoeff * jOd.g + uRayleigh * jOd.r + uOzone * jOd.b));
    vec3  sunTs = exp(-(kMieS * jOd.g + uRayleigh * jOd.r + uOzone * jOd.b));
    vec3  sigma = uRayleigh * dRlh + uMieCoeff * dMie + kOz;
    vec3  sigmaScaled = uRayleigh * dRlh + kMieS * dMie + kOz;
    vec3  w     = T * sunT * stepIntegral(sigma, iStepSize);
    vec3  ws    = Ts * sunTs * stepIntegral(sigmaScaled, iStepSize);
    totalRlh  += dRlh * ws;
    totalMie  += dMie * w.r;   // red's Mie (the pass gives it its colour)
    totalMieRgb += dMie * w;
    T         *= exp(-sigma * iStepSize);
    Ts        *= exp(-sigmaScaled * iStepSize);
    iTime     += iStepSize;
  }

#if MIE_COLOUR
  vec3 mieRgb = uMieCoeff * totalMieRgb;
  gl_FragColor = vec4(min(mieRgb / max(mieRgb.r, 1.0e-30), vec3(1.0e4)), 1.0);
#else
  // RGB = kRlh * totalRlh  (apply phase + sunIntensity at lookup time)
  // A   = kMie * totalMie
  gl_FragColor = vec4(uRayleigh * totalRlh, uMieCoeff.r * totalMie);
#endif
}
`


/**
 * The Mie (aerosol, dust) parameters of a body's atmosphere, with their
 * defaults, from its JSON (composition.md, "Per-body data"):
 *
 * - `miePeakPolarity`, `miePeakWeight` (one number or [r, g, b]; default
 *   0, none): a narrow forward lobe, the diffraction peak of grains much
 *   larger than the wavelength, with asymmetry g_n and its share f of the
 *   whole phase function.  The multiple-scattering precompute takes it as
 *   unscattered (delta-M); the pass draws its orders of scattering exactly
 *   enough near the Sun (composition.md, "The dust's forward peak").
 * - `miePolarity`: the broad forward lobe's asymmetry g, one number or
 *   [r, g, b] (Mars's dust scatters blue more sharply forward than red).
 * - `mieBackPolarity`, `mieForwardWeight`: a second, backward lobe with
 *   asymmetry g2 and the forward lobe's share w (two-term Henyey-Greenstein;
 *   w = 1, the default, is the one lobe Earth has always had).  These two
 *   lobes are the rest of the phase function, the (1 − f) not in the peak:
 *   P = f·CS(g_n) + (1 − f)·[w·CS(g) + (1 − w)·CS(g2)].
 * - `mieAlbedo`: the single-scattering albedo, one number or [r, g, b]; 1
 *   (the default) scatters everything it takes out of the beam.  Mars's
 *   dust absorbs blue.
 * - `mieCoeff`: the extinction per metre at the ground, one number (grey:
 *   Mars's dust, Titan's haze) or [r, g, b] (Earth's aerosol, its
 *   Ångström law at the channels' wavelengths).  `chroma` is 1 for the
 *   latter: the pass then gives the in-scatter table's Mie, red's, the
 *   colour of its coefficients and of the path's transmittance (Bruneton's
 *   2017 reconstruction: the pass's mieColour); a grey aerosol keeps red's for
 *   every channel, as its data was fitted with.
 *
 * @param {object} atmos A body's reified atmosphere props
 * @returns {{polarity: Vector3, backPolarity: number, forwardWeight: number, albedo: Vector3,
 *   peakPolarity: Vector3, peakWeight: Vector3, extinction: Vector3, chroma: number}}
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
    peakPolarity: vec(atmos.miePeakPolarity, 0),
    peakWeight: vec(atmos.miePeakWeight, 0),
    extinction: vec(atmos.mieCoeff, 0),
    chroma: Array.isArray(atmos.mieCoeff) ? 1 : 0,
  }
}


/**
 * A body's ozone layer (composition.md, "Per-body data"; BRUNETON.md, "The
 * ozone layer"): absorption only, no scattering, as Bruneton's 2017
 * implementation models it.  `atmosphere.ozone` gives `absorption`, the
 * absorption coefficient per metre at the layer's peak density in the three
 * channels, and the tent the density follows: 0 at `bottom`, 1 at `peak`, 0
 * at `top` (heights above the ground).  None for a body without: zero
 * absorption, and a tent that only keeps the profile finite.
 *
 * @param {object} atmos A body's reified atmosphere props
 * @returns {{absorption: Vector3, profile: Vector3, column: Vector3}} the
 *   absorption at the peak, the tent's (bottom, peak, top) in metres, and
 *   the vertical optical depth of the layer, per channel
 */
export function ozoneParams(atmos) {
  const o = atmos?.ozone
  const metres = (v) => (typeof v === 'object' && v !== null ? v.scalar : parseFloat(v))
  if (!o || !Array.isArray(o.absorption)) {
    return {absorption: new Vector3(), profile: new Vector3(0, 1, 2), column: new Vector3()}
  }
  const profile = new Vector3(metres(o.bottom), metres(o.peak), metres(o.top))
  const width = (profile.z - profile.x) / 2
  const absorption = new Vector3(...o.absorption)
  return {absorption, profile, column: absorption.clone().multiplyScalar(width)}
}


/**
 * How many orders of scattering in the narrow lobe the pass sums at most
 * (miePeakPhase), and the narrow lobe's optical depth it's capped at: at a
 * Martian sunset (τ 0.5, 20 air masses) it is about 5, and the orders past
 * 24 of a Poisson sum at 12 hold under 0.1% of it.
 */
export const PEAK_ORDERS = 24
export const PEAK_TAU_MAX = 12


/**
 * GLSL for the Mie phase function: `float csPhase(float mu, float g)`,
 * Cornette-Shanks for asymmetry g at mu = cos(scattering angle);
 * `vec3 miePhase(float mu, vec3 g1, float g2, float w)`, the broad lobes
 * per channel (mieParams); and `vec3 miePeakPhase(float mu, vec3 g, vec3
 * tau)`, the narrow lobe with its orders of scattering (composition.md,
 * "The dust's forward peak").  Shared by the pass and the precompute.
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
// The narrow lobe (asymmetry g per channel) scattered k ≥ 1 times along
// the light's path, over its first order: the sum of tau^(k−1)/k! times
// the lobe of asymmetry g^k, tau its optical depth on the path (a Poisson
// count of small-angle scatterings: the k-fold convolution of a
// Henyey-Greenstein lobe of g is the lobe of g^k, and nearly so for
// Cornette-Shanks).  The first order alone (tau 0) is the lobe.
vec3 miePeakPhase(float mu, vec3 g, vec3 tau) {
  vec3 sum  = vec3(0.0);
  vec3 gk   = vec3(1.0);
  vec3 term = vec3(1.0);  // tau^(k−1) / k!
  for (int k = 1; k <= ${PEAK_ORDERS}; k++) {
    gk *= g;
    sum += term * vec3(csPhase(mu, gk.r), csPhase(mu, gk.g), csPhase(mu, gk.b));
    term *= tau / float(k + 1);
    if (max(term.r, max(term.g, term.b)) < 1.0e-5) break;
  }
  return sum;
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
    uMieCoeff: {value: mie.extinction},
    uMieAlbedo: {value: mie.albedo},
    uOzone: {value: ozoneParams(atmos).absorption},
    uOzoneProfile: {value: ozoneParams(atmos).profile},
    uMiePolarity: {value: mie.polarity},
    uMieBackPolarity: {value: mie.backPolarity},
    uMieForwardWeight: {value: mie.forwardWeight},
    uMiePeakWeight: {value: mie.peakWeight},
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
 * An aerosol's narrow forward lobe (mieParams' peak) is truncated, delta-M
 * (Wiscombe 1977): its share of the scattering is taken as unscattered, so
 * the extinction here is (1 − albedo·f) of the true one, the scattering
 * (1 − f) of it, and the phase function the broad lobes alone.  64
 * directions can't resolve a lobe 3° wide, and the isotropic second
 * scattering would spread its light over the whole sky (composition.md,
 * "The dust's forward peak").
 *
 * @param {object} renderer
 * @param {object} atmos
 * @param {number} rGround
 * @param {WebGLRenderTarget} transmittanceRT
 * @param {number} bodyAlbedo The body's albedo (its JSON), for a body whose
 *   atmosphere gives no `groundAlbedo` (groundAlbedo, below)
 * @returns {WebGLRenderTarget} 64×64 RGBA FloatType: Ψ in rgb, over
 *   u = altitude, v = μ_sun·0.5 + 0.5
 */
export function precomputeMultiScatter(renderer, atmos, rGround, transmittanceRT, bodyAlbedo) {
  const albedo = groundAlbedo(atmos, bodyAlbedo)
  setBuiltAlbedo(atmos, albedo.toArray())
  const rt = renderLut(renderer, 64, 64, {
    ...atmosUniforms(atmos, rGround),
    uGroundAlbedo: {value: albedo},
    tTransmittance: {value: transmittanceRT.texture},
  }, MULTISCATTER_FRAG)
  // The ground's light (precomputeGroundLight), made with the tables it
  // reads and disposed with them, and registered for the body's surface
  // (groundLight.js) while they last: ThreeUi makes them for the body whose
  // air the pass draws.
  const ground = precomputeGroundLight(renderer, atmos, rGround, transmittanceRT, rt)
  setGroundLight(atmos, ground.texture)
  rt.texture.userData.groundLight = ground.texture
  const dispose = rt.dispose.bind(rt)
  rt.dispose = () => {
    if (groundLightFor(atmos) === ground.texture) {
      setGroundLight(atmos, null)
    }
    ground.dispose()
    dispose()
  }
  return rt
}


/**
 * Precomputes the ground's light (Bruneton 2017's ground irradiance; its
 * irradiance texture): over the Sun's zenith cosine and the height, the
 * Sun's transmittance to the point (the delta-M beam's, so an aerosol's
 * narrow lobe, scattered within a few degrees of the Sun, counts as the
 * Sun's light; none behind the planet), and the sky's irradiance on a level
 * surface there, both per unit of the Sun's irradiance above the air: the
 * single scattering of 64 directions over the upper hemisphere, marched
 * through the transmittance table, plus the light scattered more than once
 * (σ_s·Ψ along each, as the in-scatter's), weighted by their cosine.
 * Layout and lookup: groundLight.js.
 *
 * @param {object} renderer
 * @param {object} atmos
 * @param {number} rGround
 * @param {WebGLRenderTarget} transmittanceRT
 * @param {WebGLRenderTarget} multiScatterRT
 * @returns {WebGLRenderTarget} GROUND_LIGHT_W × 2·GROUND_LIGHT_ROWS, FloatType
 */
export function precomputeGroundLight(renderer, atmos, rGround, transmittanceRT, multiScatterRT) {
  return renderLut(renderer, GROUND_LIGHT_W, 2 * GROUND_LIGHT_ROWS, {
    ...atmosUniforms(atmos, rGround),
    tTransmittance: {value: transmittanceRT.texture},
    tMultiScatter: {value: multiScatterRT.texture},
  }, GROUND_LIGHT_FRAG)
}


/**
 * The albedo of the ground under the air, per channel: the Lambertian
 * reflector the multiple scattering (precomputeMultiScatter) and the
 * volumetric clouds' light from below (CloudVolume) take under every point.
 * The atmosphere's `groundAlbedo` (one number or [r, g, b]) where it gives
 * one, else the body's `albedo`.  That is a geometric albedo, the whole
 * disc's, its air and clouds in it: as the ground's it counts them twice
 * (composition.md, "The ground under the air").  Earth's is its drawn
 * ground's mean, the decoded Blue Marble's, one a month (textureMeans.json
 * `monthly`), at the simulation's month (groundLight.js groundMonth).
 *
 * @param {object} atmos A body's reified atmosphere props
 * @param {number} bodyAlbedo The body's albedo (its JSON)
 * @returns {Vector3}
 */
export function groundAlbedo(atmos, bodyAlbedo) {
  const a = monthsAlbedo(atmos?.groundAlbedo ?? bodyAlbedo ?? 0, groundMonth(atmos))
  return Array.isArray(a) ? new Vector3(...a) : new Vector3(a, a, a)
}


/**
 * Precomputes the multiply-scattered in-scatter atlas, laid out as
 * precomputeInScatter's: along the same rays, σ_s(x)·Ψ(x) through the
 * ray's transmittance to x, in rgb (no phase function: it's isotropic),
 * delta-M scaled as precomputeMultiScatter.  In a: the broad lobes' extra
 * single scattering of the delta-M beam (the Sun's light after any number
 * of scatterings in the narrow lobe) over the direct beam's, kMie times
 * the difference of the two integrals, red's, as precomputeInScatter's a:
 * the pass adds it with the broad lobes' phase.  Zero with no narrow lobe.
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
// planet.  The delta-M beam's: the aerosol's extinction less its narrow
// lobe's scattering (uMiePeakWeight; the whole of it with none).
const SUN_TRANSMITTANCE_GLSL = `
vec3 sunTransmittance(vec3 pos, vec3 sun) {
  float r = length(pos);
  float h = max(r - uGroundRadius, 0.0);
  vec2 pP = rsi(pos, sun, uGroundRadius);
  if (r >= uGroundRadius && pP.x > 0.0 && pP.x < pP.y) {
    return vec3(0.0);
  }
  vec3 od = texture2D(tTransmittance,
      vec2(h / (uAtmosphereRadius - uGroundRadius), dot(pos / r, sun) * 0.5 + 0.5)).rgb;
  return exp(-(uMieCoeff * (1.0 - uMieAlbedo * uMiePeakWeight) * od.g + uRayleigh * od.r + uOzone * od.b));
}
`


const GROUND_LIGHT_FRAG = `
precision highp float;
varying vec2 vUv;
uniform float     uGroundRadius;
uniform float     uAtmosphereRadius;
uniform float     uRayleighScaleHeight;
uniform float     uMieScaleHeight;
uniform vec3      uRayleigh;
uniform vec3      uMieCoeff;
uniform vec3      uMieAlbedo;
uniform vec3      uOzone;
uniform vec3      uOzoneProfile;
uniform vec3      uMiePolarity;
uniform float     uMieBackPolarity;
uniform float     uMieForwardWeight;
uniform vec3      uMiePeakWeight;
uniform sampler2D tTransmittance;
uniform sampler2D tMultiScatter;
#define DIRS  64
#define STEPS 24
#define PI 3.14159265
${RSI_GLSL}
${STEP_INTEGRAL_GLSL}
${MIE_PHASE_GLSL}
${OZONE_GLSL}
${SUN_TRANSMITTANCE_GLSL}
void main() {
  float fx   = (vUv.x * ${GROUND_LIGHT_W.toFixed(1)} - 0.5) / ${(GROUND_LIGHT_W - 1).toFixed(1)};
  float mu_s = ${MU_S_MIN.toFixed(1)} + ${(1 - MU_S_MIN).toFixed(1)} * fx;
  float row  = floor(vUv.y * ${(2 * GROUND_LIGHT_ROWS).toFixed(1)});
  bool  sky  = row >= ${GROUND_LIGHT_ROWS.toFixed(1)};
  float h_t  = mod(row, ${GROUND_LIGHT_ROWS.toFixed(1)}) / ${(GROUND_LIGHT_ROWS - 1).toFixed(1)};
  float r    = uGroundRadius + h_t * (uAtmosphereRadius - uGroundRadius) * 0.9999;
  vec3  x    = vec3(0.0, r, 0.0);
  vec3  sun  = vec3(sqrt(max(1.0 - mu_s * mu_s, 0.0)), mu_s, 0.0);
  if (!sky) {
    // None with the Sun under the horizon there (from the ground, rsi's
    // test is float32 noise).
    float muH = -sqrt(max(0.0, 1.0 - uGroundRadius * uGroundRadius / (r * r)));
    gl_FragColor = vec4(mu_s < muH ? vec3(0.0) : sunTransmittance(x, sun), 1.0);
    return;
  }
  vec3  kMieS = uMieCoeff * (1.0 - uMieAlbedo * uMiePeakWeight);
  vec3  sMieS = uMieCoeff * uMieAlbedo * (1.0 - uMiePeakWeight);
  vec3  E = vec3(0.0);
  for (int i = 0; i < DIRS; i++) {
    float z   = (float(i) + 0.5) / float(DIRS);
    float rho = sqrt(max(0.0, 1.0 - z * z));
    float phi = 2.39996323 * float(i);
    vec3  dir = vec3(rho * cos(phi), z, rho * sin(phi));
    float tMax = rsi(x, dir, uAtmosphereRadius).y;
    float nu  = dot(dir, sun);
    float pR  = 3.0 / (16.0 * PI) * (1.0 + nu * nu);
    vec3  pM  = miePhase(nu, uMiePolarity, uMieBackPolarity, uMieForwardWeight);
    vec3  T   = vec3(1.0);
    vec3  L   = vec3(0.0);
    float ds  = tMax / float(STEPS);
    for (int j = 0; j < STEPS; j++) {
      vec3  pos = x + dir * ((float(j) + 0.5) * ds);
      float h   = max(length(pos) - uGroundRadius, 0.0);
      float dR  = exp(-h / uRayleighScaleHeight);
      float dM  = exp(-h / uMieScaleHeight);
      vec3  sigma = uRayleigh * dR + kMieS * dM + uOzone * ozoneDensity(h);
      vec2  msUv = vec2(h / (uAtmosphereRadius - uGroundRadius), dot(pos / length(pos), sun) * 0.5 + 0.5);
      vec3  psi = texture2D(tMultiScatter, msUv).rgb;
      vec3  g = T * stepIntegral(sigma, ds);
      L += g * (sunTransmittance(pos, sun) * (uRayleigh * dR * pR + sMieS * dM * pM) + (uRayleigh * dR + sMieS * dM) * psi);
      T *= exp(-sigma * ds);
    }
    E += L * z;
  }
  gl_FragColor = vec4(E * 2.0 * PI / float(DIRS), 1.0);
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
uniform vec3      uMieCoeff;
uniform vec3      uMieAlbedo;
uniform vec3      uOzone;
uniform vec3      uOzoneProfile;
uniform vec3      uMiePolarity;
uniform float     uMieBackPolarity;
uniform float     uMieForwardWeight;
uniform vec3      uMiePeakWeight;
uniform vec3      uGroundAlbedo;
uniform sampler2D tTransmittance;

#define MS_DIRS  64
#define MS_STEPS 32
#define PI 3.14159265

${RSI_GLSL}
${STEP_INTEGRAL_GLSL}
${MIE_PHASE_GLSL}
${OZONE_GLSL}
${SUN_TRANSMITTANCE_GLSL}

void main() {
  float r    = uGroundRadius + vUv.x * (uAtmosphereRadius - uGroundRadius);
  float mu_s = vUv.y * 2.0 - 1.0;
  vec3  x    = vec3(0.0, r, 0.0);
  vec3  sun  = vec3(sqrt(max(1.0 - mu_s * mu_s, 0.0)), mu_s, 0.0);
  vec3  L    = vec3(0.0);  // the single-scattered radiance arriving at x, summed over directions
  vec3  f    = vec3(0.0);  // the share of light leaving x scattered again, summed
  // Delta-M: the narrow lobe's share of the aerosol's scattering taken as
  // unscattered, its extinction and scattering less that share, and its
  // phase function the broad lobes (miePhase).
  vec3  kMieS = uMieCoeff * (1.0 - uMieAlbedo * uMiePeakWeight);
  vec3  sMieS = uMieCoeff * uMieAlbedo * (1.0 - uMiePeakWeight);
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
      vec3  sigma  = uRayleigh * dR + kMieS * dM + uOzone * ozoneDensity(h);
      vec3  sigmaS = uRayleigh * dR + sMieS * dM;
      vec3  g = T * stepIntegral(sigma, ds);
      L += g * sunTransmittance(pos, sun) * (uRayleigh * dR * pR + sMieS * dM * pM);
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
uniform vec3      uMieCoeff;
uniform vec3      uMieAlbedo;
uniform vec3      uOzone;
uniform vec3      uOzoneProfile;
uniform vec3      uMiePeakWeight;
uniform sampler2D tTransmittance;
uniform sampler2D tMultiScatter;

#define R_SLICES        64
#define INSCATTER_STEPS 128

${RSI_GLSL}
${STEP_INTEGRAL_GLSL}
${BRUNETON_DECODE_GLSL}
${OZONE_GLSL}

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
    gl_FragColor = vec4(0.0);
    return;
  }
  // Delta-M (precomputeMultiScatter): the multiply-scattered light and the
  // broad lobes' single scattering of the delta-M beam travel through the
  // extinction less the narrow lobe's share; the direct beam, for the
  // difference in a, through the true one.
  vec3  kMieS = uMieCoeff * (1.0 - uMieAlbedo * uMiePeakWeight);
  vec3  sMieS = uMieCoeff * uMieAlbedo * (1.0 - uMiePeakWeight);
  vec3  total = vec3(0.0);
  float extraMie = 0.0;
  vec3  T  = vec3(1.0);
  vec3  Ts = vec3(1.0);
  for (int i = 0; i < INSCATTER_STEPS; i++) {
    vec3  iPos = eyePos + rayDir * (iTime + iStepSize * 0.5);
    float iR   = length(iPos);
    float h    = max(iR - uGroundRadius, 0.0);
    float dRlh = exp(-h / uRayleighScaleHeight);
    float dMie = exp(-h / uMieScaleHeight);
    vec3  kOz    = uOzone * ozoneDensity(h);
    vec3  sigma  = uRayleigh * dRlh + uMieCoeff * dMie + kOz;
    vec3  sigmaScaled = uRayleigh * dRlh + kMieS * dMie + kOz;
    vec3  sigmaS = uRayleigh * dRlh + sMieS * dMie;
    vec3  psi = texture2D(tMultiScatter,
        vec2(h / (uAtmosphereRadius - uGroundRadius), dot(iPos / iR, sunDir) * 0.5 + 0.5)).rgb;
    vec3  gs = Ts * stepIntegral(sigmaScaled, iStepSize);
    total += sigmaS * psi * Ts * stepIntegral(sigmaScaled, iStepSize);
    // The Sun at this step, as precomputeInScatter sees it (the same
    // blocked-Sun path), for the broad lobes' single scattering of the two
    // beams.
    vec3  jOd;
    vec2  pPlanet = rsi(iPos, sunDir, uGroundRadius);
    if (pPlanet.x > 0.0 && pPlanet.x < pPlanet.y) {
      jOd = vec3(1.0e12);
    } else {
      jOd = texture2D(tTransmittance,
          vec2(h / (uAtmosphereRadius - uGroundRadius), dot(iPos / iR, sunDir) * 0.5 + 0.5)).rgb;
    }
    vec3  sunT  = exp(-(uMieCoeff * jOd.g + uRayleigh * jOd.r + uOzone * jOd.b));
    vec3  sunTs = exp(-(kMieS * jOd.g + uRayleigh * jOd.r + uOzone * jOd.b));
    extraMie += dMie * ((gs * sunTs).r - (T * stepIntegral(sigma, iStepSize) * sunT).r);
    T     *= exp(-sigma * iStepSize);
    Ts    *= exp(-sigmaScaled * iStepSize);
    iTime += iStepSize;
  }
  gl_FragColor = vec4(total, uMieCoeff.r * extraMie);
}
`
