// Runtime atmospheric rendering: sphere mesh (guide page) and fullscreen
// post-process pass that looks up precomputed Bruneton LUTs each frame.
import {
  AddEquation,
  AdditiveBlending,
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
import {sphere} from '../shapes'


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
        uMiePolarity: {value: atmos.miePolarity},
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
                * (2.0 + pol2) / pow(1.0 + pol2 - 2.0 * polarity * mu, 1.5);

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
varying vec3 vNormal;
varying vec3 eyeVector;
uniform float atmOpacity;
uniform float atmPowFactor;
uniform float atmMultiplier;

void main() {
    // Starting from the rim to the center at the back, dotP would increase from 0 to 1
    float dotP = dot( vNormal, eyeVector );
    // This factor is to create the effect of a realistic thickening of the atmosphere coloring
    float factor = pow(dotP, atmPowFactor) * atmMultiplier;
    // Adding in a bit of dotP to the color to make it whiter while the color intensifies
    float intensity = dotP;
    vec3 atmColor = vec3(intensity, intensity, intensity);
    // use atmOpacity to control the overall intensity of the atmospheric color
    gl_FragColor = vec4(atmColor, atmOpacity) * factor;
}`,
      uniforms: {
        atmOpacity: {value: 0.9},
        atmPowFactor: {value: 1.1},
        atmMultiplier: {value: 9.5},
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
      // toneMapped: false,
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
      tDiffuse:                 {value: null},
      tDepth:                   {value: null},
      uNear:                    {value: 0.1},
      uFar:                     {value: 1e20},
      uProjectionMatrixInverse: {value: new Matrix4()},
      uPlanetCenter:            {value: new Vector3()},
      uSunDirection:            {value: new Vector3(0, 1, 0)},
      uSunIntensity:            {value: 22},
      uGroundRadius:            {value: 1},
      uAtmosphereRadius:        {value: 1}, // = uGroundRadius → no-op when no atmosphere
      uRayleigh:                {value: new Vector3()},
      uRayleighScaleHeight:     {value: 1},
      uMieCoeff:                {value: 0},
      uMieScaleHeight:          {value: 1},
      uMiePolarity:             {value: 0},
      tTransmittance:           {value: null},
      uUseTransmittanceLUT:     {value: 0.0},
      tInScatter:               {value: null},
      uUseInScatterLUT:         {value: 0.0},
    },
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: FULLSCREEN_FRAG,
    depthTest: false,
    depthWrite: false,
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
uniform float     uSunIntensity;
uniform float     uGroundRadius;
uniform float     uAtmosphereRadius;
uniform vec3      uRayleigh;
uniform float     uRayleighScaleHeight;
uniform float     uMieCoeff;
uniform float     uMieScaleHeight;
uniform float     uMiePolarity;
uniform sampler2D tTransmittance;
uniform float     uUseTransmittanceLUT;
uniform sampler2D tInScatter;
uniform float     uUseInScatterLUT;

#define PI        3.141592
#define I_STEPS   64
#define J_STEPS   8
#define R_SLICES  64.0

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
float bruneton_encode_mu_v(float r, float mu_v, float rG, float rA) {
  float rho  = sqrt(max(0.0, r*r - rG*rG));
  float H    = sqrt(max(0.0, rA*rA - rG*rG));
  float mu_h = (r > 0.0) ? -rho/r : 0.0;
  if (mu_v >= mu_h) {
    float disc = max(0.0, r*r*mu_v*mu_v - r*r + rA*rA);
    float d    = -r*mu_v + sqrt(disc);
    float dMin = rA - r;
    float dMax = rho + H;
    float u    = (dMax > dMin) ? (dMax - d) / (dMax - dMin) : 1.0;
    return 0.5 + 0.5*clamp(u, 0.0, 1.0);
  } else {
    float disc = max(0.0, r*r*mu_v*mu_v - r*r + rG*rG);
    float d    = -r*mu_v - sqrt(disc);
    float dMin = r - rG;
    float dMax = rho;
    float u    = (dMax > dMin) ? (d - dMin) / (dMax - dMin) : 0.0;
    return 0.5*clamp(u, 0.0, 1.0);
  }
}

// Trilinear in-scatter atlas lookup.
// Atlas: 64 r-slices × 32 μ_sun steps = 2048px wide, 512 μ_view steps tall.
// Manual r-slice blend; GPU handles μ_sun/μ_view bilinear within each slice.
vec4 sampleInScatter(float r, float mu_view, float mu_sun) {
  float r_t    = clamp((r - uGroundRadius) / (uAtmosphereRadius - uGroundRadius), 0.0, 1.0);
  float r_f    = r_t * (R_SLICES - 1.0);
  float r0     = floor(r_f);
  float r1     = min(r0 + 1.0, R_SLICES - 1.0);
  float rBlend = fract(r_f);

  float mu_s_t = mu_sun  * 0.5 + 0.5;
  float mu_v_t = bruneton_encode_mu_v(r, mu_view, uGroundRadius, uAtmosphereRadius);

  // Each tile is (atlasWidth / R_SLICES) = 2048/64 = 32 texels wide.
  // Clamp mu_s_t half a texel inward from each tile edge so the GPU bilinear
  // filter cannot bleed across tile boundaries (which hold unrelated r-slices).
  // Without this, mu_sun = -1 samples half from the previous tile's mu_sun = +1
  // edge (bright dayside scatter), producing a spurious glow at the anti-solar pt.
  const float TILE_HALF = 0.5 / 32.0;  // 32 texels per tile (atlas 2048 / R_SLICES 64)
  mu_s_t = clamp(mu_s_t, TILE_HALF, 1.0 - TILE_HALF);

  vec4 s0 = texture2D(tInScatter, vec2((r0 + mu_s_t) / R_SLICES, mu_v_t));
  vec4 s1 = texture2D(tInScatter, vec2((r1 + mu_s_t) / R_SLICES, mu_v_t));
  return mix(s0, s1, rBlend);
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
                * (2.0 + pol2) / pow(1.0 + pol2 - 2.0 * polarity * mu, 1.5);

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

  vec3 eyePos = -uPlanetCenter;             // camera in planet-centred space

  // ── Phase 2: in-scatter LUT path (no loops, smooth) ──────────────────────
  if (uUseInScatterLUT > 0.5) {
    // Use the ray's atmosphere entry point as the LUT index.
    // When camera is inside atmosphere: t_entry=0 → entryPos=eyePos (camera).
    // When camera is outside: t_entry=p.x → entryPos on atmosphere sphere.
    vec2 pAtm = rsi(eyePos, rayDir, uAtmosphereRadius);
    if (pAtm.x > pAtm.y) {
      // Ray misses atmosphere entirely — pass scene through unchanged.
      gl_FragColor = texture2D(tDiffuse, vUv);
      return;
    }
    float t_entry = max(pAtm.x, 0.0);
    vec3  entryPos = eyePos + rayDir * t_entry;
    float r_e  = length(entryPos);
    vec3  zen  = normalize(entryPos);
    float mu_v = dot(rayDir, zen);
    float mu_s = dot(zen, uSunDirection);

    // Gap-pixel fix: at low altitude some pixels have no tessellated surface
    // but the math ground sphere would block them.  The LUT gives near-zero
    // scatter for sub-horizon rays (short path to surface), letting stars bleed
    // through.  For these gap pixels only, clamp mu_v to the local horizon
    // angle so we use the maximum-path (near-tangent) scatter instead.
    // For all other pixels (real surface, sky, from-space) mu_v is used as-is.
    //
    // Use tMax (linearised depth distance) rather than raw depthSample to
    // detect background pixels.  When dynamicNear is very small (e.g. 1 m
    // during descent), the depth buffer is heavily compressed and real surface
    // pixels at ~10 km get depthSample ≈ 0.9999, falsely triggering the clamp
    // for the entire visible surface and flooding the screen with horizon haze.
    // tMax is independent of near-plane compression: background = ~1e15 m,
    // any in-atmosphere surface << uAtmosphereRadius * 2.
    // pAtm.x <= 0 means the camera is inside the atmosphere sphere.
    // Gap pixels only occur at low altitude (camera inside), so skip the
    // clamp entirely when the camera is outside the atmosphere — otherwise
    // distant surface pixels (tMax >> uAtmosphereRadius) also trigger it,
    // blanketing the whole planet in haze from far away.
    bool  insideAtm = (pAtm.x <= 0.0);
    vec2  tG_ray  = rsi(eyePos, rayDir, uGroundRadius);
    bool  isGap   = insideAtm
                    && (tMax > uAtmosphereRadius * 2.0)
                    && (tG_ray.x > 0.0 && tG_ray.x <= tG_ray.y);
    float mu_horiz = -sqrt(max(0.0, 1.0 - uGroundRadius*uGroundRadius / (r_e*r_e)));
    float mu_v_lut = isGap ? max(mu_v, mu_horiz) : mu_v;

    // In-scatter from atlas (trilinear, no loops)
    vec4  inS   = sampleInScatter(r_e, mu_v_lut, mu_s);
    float mu    = dot(rayDir, uSunDirection);
    float mumu  = mu * mu;
    float pol2  = uMiePolarity * uMiePolarity;
    float pRlh  = 3.0/(16.0*PI) * (1.0 + mumu);
    float pMie  = 3.0/(8.0*PI) * ((1.0-pol2)*(1.0+mumu))
                  * (2.0+pol2) / pow(1.0+pol2 - 2.0*uMiePolarity*mu, 1.5);
    vec3 scattered = uSunIntensity * (pRlh * inS.rgb + vec3(pMie * inS.a));

    // Extinction alpha via transmittance LUT along view ray.
    // Use the same mu_v_lut clamp (horizon angle) so extinction matches scatter.
    vec2 uvT_v    = transmittanceUV(r_e, mu_v_lut, uGroundRadius, uAtmosphereRadius);
    vec2 odView   = texture2D(tTransmittance, uvT_v).rg;
    vec3 extVec   = uRayleigh * odView.r + vec3(uMieCoeff * odView.g);
    float alpha   = 1.0 - exp(-max(extVec.r, max(extVec.g, extVec.b)));

    // Alpha boost when camera is inside atmosphere (sky rays)
    if (uAtmosphereRadius > uGroundRadius) {
      float camDist = length(eyePos);
      if (camDist < uAtmosphereRadius) {
        vec2 tG = rsi(eyePos, rayDir, uGroundRadius);
        if (!(tG.x > 0.0 && tG.x <= tG.y)) {
          float depth = 1.0 - (camDist - uGroundRadius)
                            / (uAtmosphereRadius - uGroundRadius);
          alpha = max(alpha, clamp(depth, 0.0, 1.0));
        }
      }
    }

    vec3 color = 1.0 - exp(-scattered);
    vec4 scene = texture2D(tDiffuse, vUv);
    gl_FragColor = vec4(color + scene.rgb * (1.0 - alpha), 1.0);
    return;
  }

  // ── Fallback: ray-march scatter (i-loop + j-loop or j-LUT) ───────────────
  vec4 result = scatter(rayDir, eyePos, uSunDirection, uSunIntensity,
                        uGroundRadius, uAtmosphereRadius,
                        uRayleigh, uRayleighScaleHeight,
                        uMieCoeff, uMieScaleHeight, uMiePolarity,
                        tMax);

  if (uAtmosphereRadius > uGroundRadius) {
    float camDist = length(eyePos);
    if (camDist < uAtmosphereRadius) {
      vec2 tG = rsi(eyePos, rayDir, uGroundRadius);
      bool hitsGround = tG.x > 0.0 && tG.x <= tG.y;
      if (!hitsGround) {
        float depth = 1.0 - (camDist - uGroundRadius)
                          / (uAtmosphereRadius - uGroundRadius);
        result.a = max(result.a, clamp(depth, 0.0, 1.0));
      }
    }
  }

  vec3 color = 1.0 - exp(-result.rgb);
  vec4 scene = texture2D(tDiffuse, vUv);
  gl_FragColor = vec4(color + scene.rgb * (1.0 - result.a), 1.0);
}
`
