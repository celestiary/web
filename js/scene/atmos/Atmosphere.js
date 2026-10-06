// Runtime atmospheric rendering: sphere mesh (guide page) and fullscreen
// post-process pass that looks up precomputed Bruneton LUTs each frame.
import {
  AddEquation,
  AdditiveBlending,
  AlwaysDepth,
  BackSide,
  CustomBlending,
  DoubleSide,
  FrontSide,
  Matrix4,
  Mesh,
  Object3D,
  OneFactor,
  OneMinusSrcAlphaFactor,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
} from 'three'
import {EMITTED_GLSL, LUMINOUS_SHOULDER_GLSL, NEUTRAL_GLSL, absoluteUniforms} from '../hdr.js'
import {sphere} from '../shapes'
import {MIE_PHASE_GLSL, STEP_INTEGRAL_GLSL, mieParams} from './AtmospherePrecompute.js'


/**
 * Physical Rayleigh/Mie atmosphere rendered as a sphere shell around a planet.
 * Works from any camera distance (from space or low orbit).
 *
 * Shader adapted from Rye Terrell's glsl-atmosphere, modified for from-space
 * rendering: primary ray starts at atmosphere entry (iTime = max(p.x, 0))
 * instead of at the camera, so all samples land inside the atmosphere volume.
 *
 * All shading is done in view space (camera at origin) to avoid precision
 * loss from subtracting large AU-scale world positions on the GPU.
 *
 * @param {number} planetRadius meters
 * @param {object} atmos atmosphere params from planet JSON
 * @returns {Mesh}
 */
export function newPhysicalAtmosphere(planetRadius, atmos) {
  const physRadius = planetRadius + (atmos.height?.scalar ?? atmos.height)
  // Geometry sphere is much larger than the physical atmosphere so the camera
  // is always inside it.  This prevents a visible gap between the atmosphere
  // sphere's lower silhouette edge and the planet surface when the camera is
  // above the physical atmosphere height (which would cause FrontSide to only
  // render the upper hemisphere, leaving a dark band near the horizon).
  // The scatter shader uses physRadius (uAtmosphereRadius) for physics; the
  // geometry radius only determines which fragments are generated.
  const geomRadius = planetRadius * 10
  const mesh = sphere({
    radius: geomRadius,
    matr: new ShaderMaterial({
      uniforms: {
        uPlanetCenter: {value: new Vector3()},
        uSunDirection: {value: new Vector3(0, 1, 0)},
        uSunIntensity: {value: atmos.sunIntensity ?? 22},
        uGroundRadius: {value: planetRadius},
        uAtmosphereRadius: {value: physRadius},
        uRayleigh: {value: new Vector3(...atmos.rayleigh)},
        uRayleighScaleHeight: {value: atmos.rayleighScaleHeight?.scalar ?? atmos.rayleighScaleHeight},
        uMieCoeff: {value: atmos.mieCoeff},
        uMieScaleHeight: {value: atmos.mieScaleHeight?.scalar ?? atmos.mieScaleHeight},
        // The forward lobe's red asymmetry: this shader's Mie is one lobe.
        uMiePolarity: {value: mieParams(atmos).polarity.x},
      },
      vertexShader: PHYS_VERT,
      fragmentShader: PHYS_FRAG,
      // CustomBlending: final = scatter_rgb * 1 + background_rgb * (1 - alpha)
      //   = L_scatter + background * exp(-tau)
      // This is the correct single-scatter rendering equation: forward-scattered
      // light added to background attenuated by the column transmittance.
      // AdditiveBlending (old) could never occlude stars; this can.
      blending: CustomBlending,
      blendEquation: AddEquation,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
      // depthTest: false — atmosphere sphere never occludes geometry; planet
      // occlusion is handled in the shader via the tGround clip.
      depthTest: false,
      depthWrite: false,
      transparent: true,
    }),
  })
  mesh.renderOrder = 2

  // Temp vectors allocated once per mesh to avoid GC pressure each frame
  const _pWorld = new Vector3()
  const _camWorld = new Vector3()

  mesh.onBeforeRender = (renderer, scene, camera) => {
    const u = mesh.material.uniforms
    // Planet center in view space.  Computed in JS (float64) to avoid
    // catastrophic cancellation when subtracting nearby AU-scale positions.
    mesh.getWorldPosition(_pWorld)
    u.uPlanetCenter.value.copy(_pWorld).applyMatrix4(camera.matrixWorldInverse)
    // Sun direction in view space: sun is at world origin, so direction from
    // planet to sun is just -planetWorldPos, rotated to view space.
    u.uSunDirection.value
        .copy(_pWorld).negate().normalize()
        .transformDirection(camera.matrixWorldInverse)
    // DoubleSide from inside prevents winding-flip culling gaps; FrontSide
    // from outside avoids rendering the far-side atmosphere twice.
    camera.getWorldPosition(_camWorld)
    const side = _camWorld.distanceTo(_pWorld) < geomRadius ? DoubleSide : FrontSide
    mesh.material.side = side
  }
  return mesh
}


const PHYS_VERT = `
varying vec3 vViewPos;
void main() {
  vViewPos = (modelViewMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * vec4(vViewPos, 1.0);
}
`

const PHYS_FRAG = `
precision highp float;

varying vec3 vViewPos;

uniform vec3  uPlanetCenter;
uniform vec3  uSunDirection;
uniform float uSunIntensity;
uniform float uGroundRadius;
uniform float uAtmosphereRadius;
uniform vec3  uRayleigh;
uniform float uRayleighScaleHeight;
uniform float uMieCoeff;
uniform float uMieScaleHeight;
uniform float uMiePolarity;

#define PI      3.141592
#define I_STEPS 16
#define J_STEPS 8

// Ray-sphere intersection (sphere centered at origin).
// Returns (tNear, tFar); no intersection when tNear > tFar.
vec2 rsi(vec3 r0, vec3 rd, float sr) {
  float a = dot(rd, rd);
  float b = 2.0 * dot(rd, r0);
  float c = dot(r0, r0) - sr * sr;
  float d = b*b - 4.0*a*c;
  if (d < 0.0) return vec2(1e5, -1e5);
  return vec2((-b - sqrt(d)) / (2.0*a),
              (-b + sqrt(d)) / (2.0*a));
}

// Returns vec4: rgb = scattered light, a = extinction alpha (1 - transmittance).
// Blending: final = rgb + background * (1 - a)  =  L_scatter + background * T
vec4 scatter(
    vec3 rayDir, vec3 eyePos, vec3 sunDir, float sunIntensity,
    float rPlanet, float rAtmos,
    vec3 kRlh, float shRlh, float kMie, float shMie, float polarity) {

  rayDir = normalize(rayDir);
  sunDir = normalize(sunDir);

  vec2 p = rsi(eyePos, rayDir, rAtmos);
  if (p.x > p.y) return vec4(0.0);
  // Clip primary ray at planet surface — only when the intersection is ahead
  // of the camera. When the ray points away from the planet (upward), both
  // planet intersections are behind the camera (negative t). Without this
  // guard, rsi().x is a large negative number, min() clips p.y to it, making
  // iStepSize negative → scatter returns vec3(0) → black sky (glass cap).
  vec2 tGround2 = rsi(eyePos, rayDir, rPlanet);
  if (tGround2.x > 0.0 && tGround2.x <= tGround2.y) {
    p.y = min(p.y, tGround2.x);
  }

  // Start from atmosphere entry (or camera if already inside atmosphere).
  // Original Terrell code used iTime=0 (designed for eye inside atmosphere);
  // max(p.x, 0) makes it work from space too.
  float iTime = max(p.x, 0.0);
  float iStepSize = (p.y - iTime) / float(I_STEPS);
  if (iStepSize <= 0.0) return vec4(0.0);

  float mu    = dot(rayDir, sunDir);
  float mumu  = mu * mu;
  float pol2  = polarity * polarity;
  float pRlh  = 3.0 / (16.0 * PI) * (1.0 + mumu);
  float pMie  = 3.0 / (8.0 * PI) * ((1.0 - pol2) * (1.0 + mumu))
                / ((2.0 + pol2) * pow(1.0 + pol2 - 2.0 * polarity * mu, 1.5));

  vec3  totalRlh = vec3(0.0);
  vec3  totalMie = vec3(0.0);
  float iOdRlh   = 0.0;
  float iOdMie   = 0.0;

  for (int i = 0; i < I_STEPS; i++) {
    vec3  iPos    = eyePos + rayDir * (iTime + iStepSize * 0.5);
    float iHeight = max(length(iPos) - rPlanet, 0.0);
    float odRlh   = exp(-iHeight / shRlh) * iStepSize;
    float odMie   = exp(-iHeight / shMie) * iStepSize;
    iOdRlh += odRlh;
    iOdMie += odMie;

    float jStepSize = rsi(iPos, sunDir, rAtmos).y / float(J_STEPS);
    float jTime     = 0.0;
    float jOdRlh    = 0.0;
    float jOdMie    = 0.0;
    for (int j = 0; j < J_STEPS; j++) {
      vec3  jPos    = iPos + sunDir * (jTime + jStepSize * 0.5);
      float jHeight = max(length(jPos) - rPlanet, 0.0);
      jOdRlh += exp(-jHeight / shRlh) * jStepSize;
      jOdMie += exp(-jHeight / shMie) * jStepSize;
      jTime  += jStepSize;
    }

    vec3 attn = exp(-(kMie * (iOdMie + jOdMie) + kRlh * (iOdRlh + jOdRlh)));
    totalRlh += odRlh * attn;
    totalMie += odMie * attn;
    iTime    += iStepSize;
  }

  // Extinction alpha: fraction of background light removed by the atmosphere.
  // iOdRlh/iOdMie are the total accumulated primary-ray optical depths.
  // Use max channel (blue, highest Rayleigh) so the sky is opaque where most
  // scatter occurs. background transmittance = 1 - alpha = exp(-tau_max).
  vec3 extinction = kRlh * iOdRlh + vec3(kMie * iOdMie);
  float alpha = 1.0 - exp(-max(extinction.x, max(extinction.y, extinction.z)));

  return vec4(sunIntensity * (pRlh * kRlh * totalRlh + pMie * kMie * totalMie), alpha);
}

void main() {
  // Eye position relative to planet center (both in view space)
  vec3 eyePos = -uPlanetCenter;
  vec3 rayDir = normalize(vViewPos); // ray from camera (view origin) to fragment

  vec4 result = scatter(rayDir, eyePos, uSunDirection, uSunIntensity,
                        uGroundRadius, uAtmosphereRadius,
                        uRayleigh, uRayleighScaleHeight,
                        uMieCoeff, uMieScaleHeight, uMiePolarity);

  // When camera is inside the physical atmosphere, the upward ray path is
  // short (camera-to-atmosphere-top), giving low optical depth and a
  // transparent sky overhead. Boost alpha proportional to how deep inside
  // the atmosphere the camera is, so stars don't bleed through the sky.
  // This has no effect from outside the atmosphere (camDist >= uAtmosphereRadius).
  float camDist = length(eyePos);
  if (camDist < uAtmosphereRadius) {
    vec2 tG = rsi(eyePos, rayDir, uGroundRadius);
    bool hitsGround = tG.x > 0.0 && tG.x <= tG.y;
    if (!hitsGround) {
      float depth = 1.0 - (camDist - uGroundRadius) / (uAtmosphereRadius - uGroundRadius);
      result.a = max(result.a, clamp(depth, 0.0, 1.0));
    }
  }

  vec3 color = 1.0 - exp(-result.rgb);
  gl_FragColor = vec4(color, result.a);
}
`


/**
 * @param {number} radiusMeters
 * @returns {Object3D}
 */
export function newAtmosphere(radiusMeters) {
  // https://franky-arkon-digital.medium.com/make-your-own-earth-in-three-js-8b875e281b1e
  const shape = sphere({
    radius: radiusMeters,
    // wireframe: true,
    // color: 0x0000ff,
    // The Sun's limb glow, in exposure units as its disc is (Star.js,
    // star-shaders.js): the disc's radiance times the shell's falloff.
    // As a glow in display values it stayed white while the metered
    // exposure brought the disc down to show its granulation: a bright
    // rim round a grey disc (the user's preview).
    matr: new ShaderMaterial({
      vertexShader: `varying vec3 vNormal;
varying vec3 eyeVector;

void main() {
    // modelMatrix transforms the coordinates local to the model into world space
    vec4 mvPos = modelViewMatrix * vec4( position, 1.0 );

    // normalMatrix is a matrix that is used to transform normals from object space to view space.
    vNormal = normalize( normalMatrix * normal );

    // vector pointing from camera to vertex in view space
    eyeVector = normalize(mvPos.xyz);

    gl_Position = projectionMatrix * mvPos;
}`,
      fragmentShader: `// reference from https://youtu.be/vM8M4QloVL0?si=CKD5ELVrRm3GjDnN
${LUMINOUS_SHOULDER_GLSL}
${EMITTED_GLSL}
varying vec3 vNormal;
varying vec3 eyeVector;
uniform float atmOpacity;
uniform float atmPowFactor;
uniform float atmMultiplier;
uniform float uExposureRelative;

void main() {
    // Starting from the rim to the center at the back, dotP would increase from 0 to 1.
    // Never under 0: at the silhouette's vertices the interpolated normal dips
    // below it, and pow() of a negative is NaN, which a clamp turns into the
    // buffer's ceiling on a GPU whose min() drops the NaN: a ring of white
    // dots round the Sun, one per segment (the user's preview).
    float dotP = max(dot( vNormal, eyeVector ), 0.0);
    // This factor is to create the effect of a realistic thickening of the atmosphere coloring
    float factor = pow(dotP, atmPowFactor) * atmMultiplier;
    // Adding in a bit of dotP to the color to make it whiter while the color intensifies
    float intensity = dotP;
    // The disc's radiance (star-shaders.js SUN_RADIANCE, within the
    // half-float buffer), so the glow follows the exposure as the disc does.
    float radiance = luminousShoulder(1.5 * 46238.0 * uExposureRelative);
    vec3 atmColor = vec3(intensity, intensity, intensity) * radiance;
    // use atmOpacity to control the overall intensity of the atmospheric color;
    // within the half-float buffer (the shell's factor reaches 9.5, and a
    // value past 65504 is Inf, NaN through the tone map, a black pixel).
    // The glow adds to the disc where the depth buffer can't tell its rim
    // from the shell (hdr.js LUMINOUS_CEILING): held to what the buffer has
    // left over the disc's ceiling, so the sum never overflows half-float.
    // Premultiplied here (the additive blend adds it as is), with nothing
    // under what the buffer holds as a normal value (hdr.js emitted).
    vec3 glow = min(atmColor * factor, vec3(LUMINOUS_GLOW_MAX)) * min(atmOpacity * factor, 1.0);
    gl_FragColor = vec4(emitted(glow), 1.0);
}`,
      uniforms: {
        atmOpacity: {value: 0.9},
        atmPowFactor: {value: 1.1},
        atmMultiplier: {value: 9.5},
        uExposureRelative: absoluteUniforms.uExposureRelative,
      },
      // Such that it does not overlays on top of the earth; this points the
      // normal in opposite direction in vertex shader
      side: BackSide,
      // Notice that by default, Three.js uses NormalBlending, where if your
      // opacity of the output color gets lower, the displayed color might get
      // whiter.
      // This works better than setting transparent: true, because it avoids a
      // weird dark edge around the earth
      blending: AdditiveBlending,
      depthTest: true,
      depthWrite: false,
      transparent: true,
      toneMapped: false,
    }),
  })
  return shape
}


/**
 * Creates a fullscreen-quad Mesh for use as a post-process atmosphere pass.
 * The caller is responsible for updating uniforms each frame via
 * ThreeUI._updateAtmUniforms().
 *
 * @returns {Mesh}
 */
export function newAtmospherePass() {
  const geo = new PlaneGeometry(2, 2)
  const mat = new ShaderMaterial({
    uniforms: {
      tDiffuse: {value: null},
      tDepth: {value: null},
      uNear: {value: 0.1},
      uFar: {value: 1e20},
      uProjectionMatrixInverse: {value: new Matrix4()},
      uPlanetCenter: {value: new Vector3()},
      uSunDirection: {value: new Vector3(0, 1, 0)},
      uSunIntensity: {value: 22},
      uGroundRadius: {value: 1},
      uAtmosphereRadius: {value: 1}, // = uGroundRadius → no-op when no atmosphere
      uRayleigh: {value: new Vector3()},
      uRayleighScaleHeight: {value: 1},
      uMieCoeff: {value: 0},
      uMieScaleHeight: {value: 1},
      // The Mie phase function and albedo per channel (AtmospherePrecompute
      // mieParams; composition.md "Per-body data").
      uMiePolarity: {value: new Vector3()},
      uMieBackPolarity: {value: 0},
      uMieForwardWeight: {value: 1},
      uMieAlbedo: {value: new Vector3(1, 1, 1)},
      tTransmittance: {value: null},
      uUseTransmittanceLUT: {value: 0.0},
      tInScatter: {value: null},
      // The multiply-scattered in-scatter atlas, and the multiple-scattering
      // factor Ψ(r, μ_sun) the march integrates (precomputeMultiScatter).
      tInScatterMs: {value: null},
      tMultiScatter: {value: null},
      uUseInScatterLUT: {value: 0.0},
      // Hard kill-switch.  When false the shader composites the scene RT
      // unchanged — no rsi(), no scatter, no risk of float32 overflow at
      // interstellar distances.  Set by ThreeUI._updateAtmUniforms.
      uAtmEnabled: {value: 0.0},
      // How much of the pass to apply, 0 to 1: less while a Cesium layer's
      // own atmosphere fades in over it (CesiumLayers.atmosphereShare).
      uAtmStrength: {value: 1.0},
      // 1: tDiffuse is the linear HDR scene, in exposure units, and this pass
      // composites the sky with it there and tone-maps once, last (HDR.md).
      // 0: the LDR fallback: tDiffuse holds display values; no tone map.
      uHdr: {value: 0.0},
      // Carries the in-scatter (times uSunIntensity) into exposure units at
      // the renderer's current exposure: 1 when the planet is the exposure
      // target (exposure.js skyExposure; HDR.md).
      uSkyExposure: {value: 1.0},
      // A probe (composition.md, "Probing the pass"): 0 renders; 1 to 5
      // write the pass's intermediates as raw floats, for a float target.
      uDebug: {value: 0.0},
    },
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: FULLSCREEN_FRAG,
    // Writes the scene's depth to the screen (gl_FragDepth) so the label
    // overlay drawn after it (ThreeUI.render) is depth-tested as it would
    // be in the scene.  A depth test that always passes, as writes need
    // the test on.
    depthTest: true,
    depthFunc: AlwaysDepth,
    depthWrite: true,
    toneMapped: false,
  })
  const mesh = new Mesh(geo, mat)
  mesh.frustumCulled = false
  return mesh
}


const FULLSCREEN_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

const FULLSCREEN_FRAG = `
precision highp float;

varying vec2 vUv;

uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform float     uNear;
uniform float     uFar;
uniform mat4      uProjectionMatrixInverse;
uniform vec3      uPlanetCenter;
uniform vec3      uSunDirection;
uniform float     uSunIntensity;  // the body's sky gain (HDR.md)
uniform float     uGroundRadius;
uniform float     uAtmosphereRadius;
uniform vec3      uRayleigh;
uniform float     uRayleighScaleHeight;
uniform float     uMieCoeff;
uniform float     uMieScaleHeight;
uniform vec3      uMiePolarity;
uniform float     uMieBackPolarity;
uniform float     uMieForwardWeight;
uniform vec3      uMieAlbedo;
uniform sampler2D tTransmittance;
uniform float     uUseTransmittanceLUT;
uniform sampler2D tInScatter;
uniform sampler2D tInScatterMs;
uniform sampler2D tMultiScatter;
uniform float     uUseInScatterLUT;
uniform float     uAtmEnabled;
uniform float     uAtmStrength;
uniform float     uHdr;
uniform float     uSkyExposure;
uniform float     uDebug;

#define PI        3.141592
#define I_STEPS   64
#define J_STEPS   8
#define R_SLICES  64.0
#define SEG_STEPS 16

${NEUTRAL_GLSL}
${MIE_PHASE_GLSL}

// The scene with no atmosphere over it, to the screen: the one tone map
// (HDR), or as it is (the LDR fallback's scene is display values already).
vec4 sceneToScreen(vec3 scene) {
  // The metering's view (uDebug 7, ThreeUi._meter) wants the linear scene
  // on every path: tone-mapped, a body rendered 1e5 over white would read
  // as 1 and the meter would call it dark, and run away.
  return vec4(uHdr > 0.5 && uDebug < 6.5 ? neutralToneMap(scene) : scene, 1.0);
}

// The sky over the scene: in-scatter plus the scene through the
// transmittance, faded by uAtmStrength, to the screen.  sky is in exposure
// units, as the HDR scene is: composited there, then tone-mapped once.  The
// LDR fallback's scene is display values, so the sky is tone-mapped alone
// and added to it.
vec4 atmToScreen(vec3 scene, vec3 sky, vec3 transmittance) {
  if (uHdr > 0.5) {
    return vec4(neutralToneMap(mix(scene, sky + scene * transmittance, uAtmStrength)), 1.0);
  }
  return vec4(mix(scene, neutralToneMap(sky) + scene * transmittance, uAtmStrength), 1.0);
}

// Map (r, mu_sun) → UV for the precomputed transmittance LUT.
// Simple linear parameterisation.
vec2 transmittanceUV(float r, float mu_s, float rG, float rA) {
  return vec2(
    (r  - rG) / (rA - rG),
    mu_s * 0.5 + 0.5
  );
}

// Bruneton horizon-aware mu_view encode (inverse of bruneton_decode_mu_v in precompute).
// Concentrates atlas rows near the local horizon where scatter changes fastest.
// ground says which side of the horizon the ray is on (it meets the ground
// sphere ahead, or not): the caller decides it once, from the ray's
// geometry, so a ray clamped to the horizon itself (a gap in the ground)
// lands in the sky rows by construction.  Deciding it here, by comparing
// mu_v with the horizon's cosine recomputed from r (r² − rG² loses most of
// its bits in float32 a metre over a 3,000 km sphere), put such rays on
// either side from one frame to the next, and the ground side of the ground
// slice is zero: a black band flickered at the horizon on Mars and at the
// Dead Sea, on a real GPU (SwiftShader happened to round the other way).
float bruneton_encode_mu_v(float r, float mu_v, float rG, float rA, bool ground) {
  float rho  = sqrt(max(0.0, (r - rG) * (r + rG)));
  float H    = sqrt(max(0.0, (rA - rG) * (rA + rG)));
  if (!ground) {
    float disc = max(0.0, r*r*mu_v*mu_v + (rA - r) * (rA + r));
    float d    = -r*mu_v + sqrt(disc);
    float dMin = rA - r;
    float dMax = rho + H;
    float u    = (dMax > dMin) ? (dMax - d) / (dMax - dMin) : 1.0;
    return 0.5 + 0.5*clamp(u, 0.0, 1.0);
  } else {
    float disc = max(0.0, r*r*mu_v*mu_v - rho * rho);
    float d    = -r*mu_v - sqrt(disc);
    float dMin = r - rG;
    float dMax = rho;
    float u    = (dMax > dMin) ? (d - dMin) / (dMax - dMin) : 0.0;
    return 0.5*clamp(u, 0.0, 1.0);
  }
}

// Trilinear in-scatter atlas lookup: single scattering (Rayleigh rgb, Mie
// a; the phase functions apply at lookup), and the multiply-scattered
// in-scatter (ms, rgb, isotropic) from its own atlas at the same place.
// Atlas: 64 r-slices × 32 μ_sun steps = 2048px wide, 512 μ_view steps tall.
// Manual r-slice blend; GPU handles μ_sun/μ_view bilinear within each slice.
vec4 sampleInScatter(float r, float mu_view, float mu_sun, bool ground, out vec3 ms) {
  float r_t    = clamp((r - uGroundRadius) / (uAtmosphereRadius - uGroundRadius), 0.0, 1.0);
  float r_f    = r_t * (R_SLICES - 1.0);
  float r0     = floor(r_f);
  float r1     = min(r0 + 1.0, R_SLICES - 1.0);
  float rBlend = fract(r_f);

  float mu_s_t = mu_sun  * 0.5 + 0.5;
  float mu_v_t = bruneton_encode_mu_v(r, mu_view, uGroundRadius, uAtmosphereRadius, ground);
  // Keep a sky ray in the sky rows and a ground ray in the ground rows: at
  // the horizon (v = 0.5) the filter blended the horizon's in-scatter, the
  // brightest, with a ground ray's, the dimmest, and a ray clamped to the
  // horizon (a gap in the ground, isGap) drew a dark band there: low over
  // Cesium's Mars, between its terrain's horizon and the sphere's.
  const float ROW_HALF = 0.5 / 512.0;  // half a row (atlas 512 rows tall)
  mu_v_t = ground ? min(mu_v_t, 0.5 - ROW_HALF) : max(mu_v_t, 0.5 + ROW_HALF);

  // Each tile is (atlasWidth / R_SLICES) = 2048/64 = 32 texels wide.
  // Clamp mu_s_t half a texel inward from each tile edge so the GPU bilinear
  // filter cannot bleed across tile boundaries (which hold unrelated r-slices).
  // Without this, mu_sun = -1 samples half from the previous tile's mu_sun = +1
  // edge (bright dayside scatter), producing a spurious glow at the anti-solar pt.
  const float TILE_HALF = 0.5 / 32.0;  // 32 texels per tile (atlas 2048 / R_SLICES 64)
  mu_s_t = clamp(mu_s_t, TILE_HALF, 1.0 - TILE_HALF);

  vec2 uv0 = vec2((r0 + mu_s_t) / R_SLICES, mu_v_t);
  vec2 uv1 = vec2((r1 + mu_s_t) / R_SLICES, mu_v_t);
  ms = mix(texture2D(tInScatterMs, uv0).rgb, texture2D(tInScatterMs, uv1).rgb, rBlend);
  return mix(texture2D(tInScatter, uv0), texture2D(tInScatter, uv1), rBlend);
}

vec2 rsi(vec3 r0, vec3 rd, float sr);

${STEP_INTEGRAL_GLSL}

// Single scattering (as the in-scatter table stores it: Rayleigh rgb
// already times its coefficients, Mie in a) and transmittance along the view
// ray from the eye to a point tMax away, by a march, as
// AtmospherePrecompute integrates the table: each step's sunlight through
// the transmittance table, and the step's own extinction integrated exactly
// for its density (a segment from an eye below the sphere to where its ray
// leaves it can be 100 km of ground-density air, and a step of that at the
// end-of-step attenuation lost a third of the in-scatter).  Heights below
// the ground sphere (Cesium's terrain under a datum, a camera there, and the
// faces of a ground mesh, which sag inside its sphere) count at the sphere's
// density, as the tables do: e^(−h/H) below it put five times Earth's Mie
// density at the bottom of the ground sphere's 2 km sag and doubled the
// haze from 37 km.
void marchSegment(vec3 eye, vec3 dir, float tMax, out vec4 inS, out vec3 ms, out vec3 T) {
  float ds = tMax / float(SEG_STEPS);
  vec3  totalR = vec3(0.0);
  float totalM = 0.0;
  ms = vec3(0.0);
  T = vec3(1.0);
  for (int i = 0; i < SEG_STEPS; i++) {
    vec3  pos = eye + dir * ((float(i) + 0.5) * ds);
    float r   = length(pos);
    float h   = max(r - uGroundRadius, 0.0);
    float dR  = exp(-h / uRayleighScaleHeight);
    float dM  = exp(-h / uMieScaleHeight);
    vec2  jOd;
    vec2  pPlanet = rsi(pos, uSunDirection, uGroundRadius);
    // The Sun behind the planet: from above the sphere, the ray to it meets
    // the sphere ahead; from below it (a march from an eye or to terrain
    // under the datum, where every ray to the Sun leaves the sphere), the
    // Sun is under the local horizontal.  Reading the table there instead
    // gave a Sun 47° under the horizon a 200 m path to the ground, and the
    // Dead Sea a blue sky at midnight once the metered exposure lifted it.
    bool sunBlocked = r >= uGroundRadius ?
        (pPlanet.x > 0.0 && pPlanet.x < pPlanet.y) : dot(pos, uSunDirection) < 0.0;
    if (sunBlocked) {
      // Enough path for the smallest coefficient (AtmospherePrecompute:
      // 1e6 m let 0.3% of the Sun through in Earth's red).
      jOd = vec2(1.0e12);
    } else {
      jOd = texture2D(tTransmittance,
          vec2(h / (uAtmosphereRadius - uGroundRadius), dot(pos / r, uSunDirection) * 0.5 + 0.5)).rg;
    }
    vec3 sunT  = exp(-(uMieCoeff * jOd.g + uRayleigh * jOd.r));
    vec3 sigma = uRayleigh * dR + vec3(uMieCoeff * dM);
    vec3 g     = T * stepIntegral(sigma, ds);
    vec3 w     = g * sunT;
    totalR += dR * w;
    totalM += dM * w.r;
    // The light scattered twice or more, isotropic: the step's scattering
    // coefficient times the multiple-scattering factor there
    // (precomputeMultiScatter).
    vec3 psi = texture2D(tMultiScatter,
        vec2(h / (uAtmosphereRadius - uGroundRadius), dot(pos / r, uSunDirection) * 0.5 + 0.5)).rgb;
    ms += (uRayleigh * dR + uMieCoeff * uMieAlbedo * dM) * psi * g;
    T *= exp(-sigma * ds);
  }
  inS = vec4(uRayleigh * totalR, uMieCoeff * totalM);
}

vec2 rsi(vec3 r0, vec3 rd, float sr) {
  float a = dot(rd, rd);
  float b = 2.0 * dot(rd, r0);
  float c = dot(r0, r0) - sr * sr;
  float d = b*b - 4.0*a*c;
  if (d < 0.0) return vec2(1e5, -1e5);
  return vec2((-b - sqrt(d)) / (2.0*a),
              (-b + sqrt(d)) / (2.0*a));
}

vec4 scatter(
    vec3 rayDir, vec3 eyePos, vec3 sunDir, float sunIntensity,
    float rPlanet, float rAtmos,
    vec3 kRlh, float shRlh, float kMie, float shMie, float polarity,
    float tMax) {

  rayDir = normalize(rayDir);
  sunDir = normalize(sunDir);

  vec2 p = rsi(eyePos, rayDir, rAtmos);
  if (p.x > p.y) return vec4(0.0);

  // Clip to the actual rendered surface depth.  The planet surface writes to
  // the depth buffer (depthWrite:true), so tMax is accurate for surface pixels.
  // For background/star pixels (depthWrite:false) tMax = 1e15 >> rAtmos, so
  // scatter clips naturally at the atmosphere exit — no sphere math needed.
  p.y = min(p.y, tMax);

  float iTime = max(p.x, 0.0);
  float iStepSize = (p.y - iTime) / float(I_STEPS);
  if (iStepSize <= 0.0) return vec4(0.0);

  float mu    = dot(rayDir, sunDir);
  float mumu  = mu * mu;
  float pol2  = polarity * polarity;
  float pRlh  = 3.0 / (16.0 * PI) * (1.0 + mumu);
  float pMie  = 3.0 / (8.0 * PI) * ((1.0 - pol2) * (1.0 + mumu))
                / ((2.0 + pol2) * pow(1.0 + pol2 - 2.0 * polarity * mu, 1.5));

  vec3  totalRlh = vec3(0.0);
  vec3  totalMie = vec3(0.0);
  float iOdRlh   = 0.0;
  float iOdMie   = 0.0;

  for (int i = 0; i < I_STEPS; i++) {
    vec3  iPos    = eyePos + rayDir * (iTime + iStepSize * 0.5);
    float iHeight = max(length(iPos) - rPlanet, 0.0);
    float odRlh   = exp(-iHeight / shRlh) * iStepSize;
    float odMie   = exp(-iHeight / shMie) * iStepSize;
    iOdRlh += odRlh;
    iOdMie += odMie;

    float jOdRlh = 0.0;
    float jOdMie = 0.0;
    if (uUseTransmittanceLUT > 0.5) {
      // Bruneton LUT lookup: one texture sample replaces the entire j-loop.
      float iR   = length(iPos);
      float mu_s = dot(normalize(iPos), sunDir);
      vec2  uvT  = transmittanceUV(iR, mu_s, rPlanet, rAtmos);
      vec2  jOd  = texture2D(tTransmittance, uvT).rg;
      jOdRlh = jOd.r;
      jOdMie = jOd.g;
    } else {
      float jStepSize = rsi(iPos, sunDir, rAtmos).y / float(J_STEPS);
      float jTime     = 0.0;
      for (int j = 0; j < J_STEPS; j++) {
        vec3  jPos    = iPos + sunDir * (jTime + jStepSize * 0.5);
        float jHeight = max(length(jPos) - rPlanet, 0.0);
        jOdRlh += exp(-jHeight / shRlh) * jStepSize;
        jOdMie += exp(-jHeight / shMie) * jStepSize;
        jTime  += jStepSize;
      }
    }

    vec3 attn = exp(-(kMie * (iOdMie + jOdMie) + kRlh * (iOdRlh + jOdRlh)));
    totalRlh += odRlh * attn;
    totalMie += odMie * attn;
    iTime    += iStepSize;
  }

  vec3 extinction = kRlh * iOdRlh + vec3(kMie * iOdMie);
  float alpha = 1.0 - exp(-max(extinction.x, max(extinction.y, extinction.z)));

  return vec4(sunIntensity * (pRlh * kRlh * totalRlh + pMie * kMie * totalMie), alpha);
}

void main() {
  // The scene's depth, for the label overlay after this pass.  First, as
  // every path out of main() must write it.
  gl_FragDepth = texture2D(tDepth, vUv).r;
  // Hard kill-switch: when the camera is too far for the in-shader rsi() to
  // remain numerically stable (or there's simply no atmosphere target), pass
  // the scene through unchanged.  Must happen before any rsi() / scatter()
  // call — eyePos² overflows float32 once |eyePos| ≳ 1.8e19 m, and a sentinel
  // "push planet far away" value would itself trip that limit.
  if (uAtmEnabled < 0.5) {
    gl_FragColor = sceneToScreen(texture2D(tDiffuse, vUv).rgb);
    return;
  }
  vec2 ndc = vUv * 2.0 - 1.0;
  float depthSample = texture2D(tDepth, vUv).r;

  // Ray direction: reconstruct from the NEAR plane (z = -1 in NDC) so we never
  // square a value of magnitude ~uFar (= 1.9e20 m) — that would overflow float32
  // (max ~3.4e38).  The view-space direction is the same for any depth; only the
  // magnitude differs, and we compute that separately below.
  vec4 viewDir4 = uProjectionMatrixInverse * vec4(ndc, -1.0, 1.0);
  viewDir4 /= viewDir4.w;
  vec3 rayDir = normalize(viewDir4.xyz);

  // Distance to the pixel: linearise the depth buffer value.
  // Clamp the effective far to 1e15 m (far larger than any atmosphere, but safe
  // to square in float32) so background pixels don't cause overflow.
  float scatterFar = min(uFar, 1.0e15);
  float z_ndc = depthSample * 2.0 - 1.0;
  float tMax = (2.0 * uNear * scatterFar)
               / (uNear + scatterFar - z_ndc * (scatterFar - uNear));
  tMax = max(tMax, uNear);
  // The 24-bit depth buffer's step at this depth: depth ≈ 1 − near/z, so
  // one step (2⁻²⁴) is z²/near·2⁻²⁴ of distance.  From afar it's coarse
  // (≈ 200 km at Jupiter from 1.5 Gm, with near = 600 km), as coarse as an
  // atmosphere shell is thick.
  float tMaxErr = tMax * tMax / uNear * (2.0 / 16777216.0);
  // That is the pixel's view-space depth; along the ray it's farther by
  // 1/cos of the ray's angle off the view axis (−Z), as the ray-sphere
  // distances it's compared with are.
  float invCos = 1.0 / max(-rayDir.z, 1.0e-6);
  tMax *= invCos;
  tMaxErr *= invCos;

  vec3 eyePos = -uPlanetCenter;             // camera in planet-centred space

  // ── Phase 2: in-scatter LUT path (no loops, smooth) ──────────────────────
  if (uUseInScatterLUT > 0.5) {
    // The tables cover the shell from the ground sphere to the atmosphere's
    // top.  Where a ray starts outside it, the pass gets it there itself and
    // looks the table up from where it enters: from above, at the
    // atmosphere's top (entryPos); from below the sphere (a camera low over
    // Cesium's Mars, whose terrain is mostly under the datum, or at the Dead
    // Sea), by marching the air to where the ray leaves the sphere, then the
    // table from there, where the ray is a sky ray (it points outward) well
    // inside the sky rows.  Nothing is moved: the first cut of #141 lifted
    // the eye to the sphere, which put its horizon within float32 noise of
    // the rays clamped to it, and those flickered black (see
    // bruneton_encode_mu_v).
    vec2 pAtm = rsi(eyePos, rayDir, uAtmosphereRadius);
    if (pAtm.x > pAtm.y) {
      // Ray misses atmosphere entirely — pass scene through unchanged.
      gl_FragColor = sceneToScreen(texture2D(tDiffuse, vUv).rgb);
      return;
    }
    float t_entry = max(pAtm.x, 0.0);
    if (tMax + tMaxErr < t_entry) {
      // Something in front of the atmosphere (Phobos before Mars): the ray
      // ends before it enters, so no in-scatter or extinction.  Only when
      // it's in front by more than the depth buffer can resolve: the
      // planet's own surface, a shell's thickness behind the entry, read
      // as in front of it from afar and speckled the disc.
      gl_FragColor = sceneToScreen(texture2D(tDiffuse, vUv).rgb);
      return;
    }
    float rEye = length(eyePos);
    bool  eyeBelow = rEye < uGroundRadius;
    // pAtm.x <= 0 means the camera is inside the atmosphere sphere.
    bool  insideAtm = (pAtm.x <= 0.0);
    // Nothing drew here (the cleared far plane): sky, or a gap in the ground.
    bool  background = depthSample >= 1.0;
    // A body drew here beyond where the ray leaves the atmosphere (the
    // daytime Moon, the Sun's disc): the whole ray's air is before it, so
    // the table's full ray, not a march to it.  Geometry only: #85's
    // exemption of such bodies from the eye-adaptation boost went with
    // the boost (#86 PR B); the day sky covers the Moon by its light.
    // From inside the atmosphere, past it unless the depth puts it surely
    // inside (rayEnd.js): from the ground the near plane is metres, and a
    // planet hundreds of Gm off sits within a step or two of the far plane,
    // where the depth's distance is noise (Jupiter from 156 m: one step
    // under far, 1.5 Gm ± 3.4 Gm).  Taken as inside, those pixels marched
    // a segment of that length with no air in its samples, and showed
    // Jupiter unextinguished, in bright dashes along the depth's rounding
    // contours.  From outside, past only when surely past: the planet's own
    // limb, seen from afar through coarse depth, stays ground.
    float tEnd = insideAtm ? tMax + tMaxErr : tMax - tMaxErr;
    bool  pastAtmosphere = !background && tEnd > pAtm.y;
    // A surface drawn inside the atmosphere, seen from inside it:
    // celestiary's own ground, and Cesium's terrain, which rises above the
    // sphere and sinks below it.  The air is the segment from the eye to
    // it, single scattering and transmittance marched along it as the
    // in-scatter table integrates them (marchSegment), from the camera where
    // it is.  The table's ray ends at the sphere or the atmosphere's top,
    // wherever the surface is, and it is linear in mu, coarse at the
    // horizon: the first cuts of #141 took the table's in-scatter and depth
    // along the view ray and cut them at the surface, which drew a seam
    // through near terrain at the sphere's horizon (sky rays above it,
    // ground rays below), and left the ground under a camera below the
    // datum without haze.  Sky pixels keep the table.
    bool  shortRay = insideAtm && !background && !pastAtmosphere;
    // The ray's zenith cosine at the eye, and whether it goes under the
    // sphere's horizon: from above, it meets the sphere ahead; from below,
    // it heads down into it (every ray from inside leaves the sphere
    // somewhere, but a downward one only on the far side of the planet).
    float mu_e = dot(rayDir, eyePos) / rEye;
    vec2  tG_ray = rsi(eyePos, rayDir, uGroundRadius);
    bool  underHorizon = eyeBelow ? mu_e < 0.0 : (tG_ray.x > 0.0 && tG_ray.x <= tG_ray.y);
    // Gap pixels: at low altitude some pixels have no tessellated surface
    // (sub-pixel holes in the ground mesh; Cesium's terrain below the
    // datum, the band between its horizon and the sphere's) but the
    // geometric ground would block them.  They get the horizon's haze: the
    // ray clamped to the horizon, a sky ray.  Only from inside the
    // atmosphere: from space, distant surface pixels would trigger it and
    // blanket the planet in haze.
    bool  isGap = insideAtm && background && underHorizon;
    // A body beyond the atmosphere under the sphere's horizon (the Moon
    // rising over the Dead Sea's far shore, which lies below the sphere)
    // sees the horizon's air too.
    bool  atHorizon = underHorizon && (isGap || pastAtmosphere);

    vec4  inS;
    vec3  inSMs;
    vec3  transmittance;
    // For the eye-adaptation boost, below: the eye's altitude.
    float camAlt = rEye - uGroundRadius;
    if (shortRay) {
      marchSegment(eyePos, rayDir, tMax, inS, inSMs, transmittance);
    } else if (eyeBelow) {
      // From below the sphere: the ray to where it leaves the sphere, then
      // the table from there.  A ray under the horizon (a gap, or a body
      // beyond) counts as the horizontal one from the eye: it leaves the
      // sphere where that would, the limit of the horizon from just above
      // the sphere as the eye crosses it.
      float mu_x = atHorizon ? 0.0 : mu_e;
      float tExit = -rEye * mu_x + sqrt(max(0.0, rEye * rEye * (mu_x * mu_x - 1.0) + uGroundRadius * uGroundRadius));
      // The ray's zenith cosine where it leaves the sphere: r·mu there is
      // the eye's plus the distance travelled.
      float mu_exit = clamp((rEye * mu_x + tExit) / uGroundRadius, 0.0, 1.0);
      vec3  zenExit = normalize(eyePos + rayDir * tExit);
      float mu_sExit = dot(zenExit, uSunDirection);
      vec4  inSBelow;
      vec3  msBelow;
      vec3  msAbove;
      vec3  tBelow;
      marchSegment(eyePos, rayDir, tExit, inSBelow, msBelow, tBelow);
      vec4  inSAbove = sampleInScatter(uGroundRadius, mu_exit, mu_sExit, false, msAbove);
      vec2  odAbove  = texture2D(tTransmittance, transmittanceUV(uGroundRadius, mu_exit, uGroundRadius, uAtmosphereRadius)).rg;
      inS = inSBelow + vec4(tBelow * inSAbove.rgb, tBelow.r * inSAbove.a);
      inSMs = msBelow + tBelow * msAbove;
      transmittance = tBelow * exp(-(uRayleigh * odAbove.r + vec3(uMieCoeff * odAbove.g)));
    } else {
      // Use the ray's atmosphere entry point as the LUT index.
      // When camera is inside atmosphere: t_entry=0 → entryPos=eyePos (camera).
      // When camera is outside: t_entry=p.x → entryPos on atmosphere sphere.
      vec3  entryPos = eyePos + rayDir * t_entry;
      float r_e  = length(entryPos);
      vec3  zen  = normalize(entryPos);
      float mu_v = dot(rayDir, zen);
      float mu_s = dot(zen, uSunDirection);
      camAlt = r_e - uGroundRadius;
      // A ray clamped to the horizon (atHorizon) is a sky ray at the
      // horizon's cosine; a ray that meets the sphere with the eye outside
      // the atmosphere (the disc from orbit, holes in it included) is a
      // ground ray.
      float mu_horiz = -sqrt(max(0.0, 1.0 - uGroundRadius * uGroundRadius / (r_e * r_e)));
      float mu_lut = atHorizon ? max(mu_v, mu_horiz) : mu_v;
      bool  ground = underHorizon && !atHorizon;
      inS = sampleInScatter(r_e, mu_lut, mu_s, ground, inSMs);
      // Extinction via the transmittance LUT along the view ray, to where
      // its ray ends.  Trust the LUT: at zenith from sea level the
      // visible-band optical depth is ~0.15, giving ~86% transmittance for
      // the background (stars, milky way, distant planets).  Earlier revs
      // forced alpha to ~1 whenever the camera was inside the atmosphere;
      // that made the day sky look opaque blue but blocked stars on the
      // night side.  Per channel: dimming red and green by blue's
      // extinction too (one alpha from the strongest channel, as before)
      // greyed whatever lay behind — Jupiter's and Venus's cloud decks —
      // once exposure stopped washing them out.
      vec2 odView = texture2D(tTransmittance, transmittanceUV(r_e, mu_lut, uGroundRadius, uAtmosphereRadius)).rg;
      transmittance = exp(-(uRayleigh * odView.r + vec3(uMieCoeff * odView.g)));
    }
    float mu    = dot(rayDir, uSunDirection);
    float pRlh  = 3.0/(16.0*PI) * (1.0 + mu * mu);
    // The Mie phase per channel (miePhase: Cornette-Shanks, two lobes), and
    // the dust's single-scattering albedo: the atlas's Mie is what the beam
    // lost, of which the albedo's share was scattered.  Then the multiply
    // scattered light, isotropic, from its own atlas.
    vec3 pMie   = miePhase(mu, uMiePolarity, uMieBackPolarity, uMieForwardWeight) * uMieAlbedo;
    vec3 scattered = uSunIntensity * (pRlh * inS.rgb + pMie * inS.a + inSMs);

    // The transmittance is the physical one, whole: the stars behind the
    // day sky are hidden by its light, not by a boost, now that they're in
    // exposure units (HDR.md, "Physical stars"); #86's PR B removed the
    // eye-adaptation boost, its altitude weight, the 0.08 floor and the
    // exemption of bodies beyond the atmosphere (the daytime Moon).
    // TODO(future): tune the surface-vs-atmosphere blend coloring.  From
    // space looking at the day side, the LUT inscatter mixes additively
    // with the surface texture: where atmospheric column is thick (limb)
    // the inscatter hue dominates; where thin (overhead/disc centre) the
    // surface shows.  The transition reads OK but the saturation/hue
    // balance over land vs ocean isn't perfectly tuned, and the coastal
    // hand-off looks slightly washed.  Plausible knobs: per-channel
    // inscatter scaling, a soft saturation curve on (color + scene*T),
    // or eventually proper aerial-perspective integration over the
    // segment from surface depth back to the camera.
    // Gap-pixel hard occlusion: when isGap is true we KNOW the geometric
    // ground is in front of whatever the depth buffer recorded — i.e. a
    // sub-pixel rasterization gap let the background (sun, stars, distant
    // planets) leak through where Earth's tessellated surface should have
    // covered.  Zero transmittance so the scene contribution drops out and
    // the gap shows only inscatter (bright haze by day, dark by night) —
    // visually matches the surrounding surface and gives a crisp horizon
    // edge.
    if (isGap) {
      transmittance = vec3(0.0);
    }

    // The sky in exposure units: the in-scatter per unit of the Sun's
    // irradiance, times the irradiance and the exposure (uSkyExposure), with
    // uSunIntensity as the body's gain over single scattering (HDR.md).
    vec3 sky = scattered * uSkyExposure;
    if (uDebug > 6.5) {
      // The metering's view (ThreeUi._meter): the linear composite, in
      // exposure units, before the tone map.
      gl_FragColor = vec4(mix(texture2D(tDiffuse, vUv).rgb, sky + texture2D(tDiffuse, vUv).rgb * transmittance,
          uAtmStrength), 1.0);
      return;
    }
    if (uDebug > 0.5) {
      // The probe's intermediates, raw (composition.md).
      if (uDebug < 1.5) gl_FragColor = vec4(transmittance, 1.0);
      else if (uDebug < 2.5) gl_FragColor = vec4(sky, 1.0);
      else if (uDebug < 3.5) gl_FragColor = vec4(depthSample, tMax,
          (isGap ? 1.0 : 0.0) + (pastAtmosphere ? 2.0 : 0.0) + (shortRay ? 4.0 : 0.0) + (eyeBelow ? 8.0 : 0.0)
          + (underHorizon ? 16.0 : 0.0), 1.0);
      else if (uDebug < 4.5) gl_FragColor = inS;
      else if (uDebug < 5.5) gl_FragColor = vec4(inSMs, 1.0);
      else gl_FragColor = vec4(mu_e, dot(normalize(eyePos), uSunDirection), camAlt, texture2D(tDiffuse, vUv).r);
      return;
    }
    gl_FragColor = atmToScreen(texture2D(tDiffuse, vUv).rgb, sky, transmittance);
    return;
  }

  // ── Fallback: ray-march scatter (i-loop + j-loop or j-LUT) ───────────────
  // result.a is the extinction alpha along the view ray; trust it directly
  // (no inside-atmosphere depth boost — see the LUT branch above for why).
  vec4 result = scatter(rayDir, eyePos, uSunDirection, uSunIntensity,
                        uGroundRadius, uAtmosphereRadius,
                        uRayleigh, uRayleighScaleHeight,
                        uMieCoeff, uMieScaleHeight, uMiePolarity.r,
                        tMax);
  // The physical extinction, whole (the LUT branch, above).
  gl_FragColor = atmToScreen(texture2D(tDiffuse, vUv).rgb, result.rgb * uSkyExposure, vec3(1.0 - result.a));
}
`
