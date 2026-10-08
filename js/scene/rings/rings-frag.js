import {RING_PHOTOMETRY_GLSL} from './ringPhotometry.js'


// Fragment shader for planetary rings, lit in exposure units (rings.md,
// "Lighting: the rings in exposure units"; ringPhotometry.js):
//   - the colour map is the particles' single-scattering albedo (times
//     uAlbedoScale), the opacity map the normal optical depth;
//   - a slab of particles scattering the Sun's light once, from the lit face
//     or through it to the unlit one, with the particles' backscattering
//     phase function;
//   - the planet's shadow: a sphere test along the ray to the Sun;
//   - the background shows through e^(−τ/μ): the colour is premultiplied.
export const FRAG = /* glsl */`
uniform sampler2D uColorMap;
uniform sampler2D uAlphaMap;
// Direction from planet toward sun, world space, updated per frame.
uniform vec3 uSunDir;
// Planet center in world space, updated per frame.
uniform vec3 uPlanetCenter;
uniform float uPlanetRadius;
uniform float uInnerRadius;
uniform float uOuterRadius;
// A white Lambertian's radiance facing the Sun at the planet, E/π, in
// three's units: I/F times this is the radiance, which the renderer's
// exposure scales as it does every lit surface.
uniform float uSunRadiance;
uniform float uAlbedoScale;

varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;

${RING_PHOTOMETRY_GLSL}

void main() {
  float opacity = texture2D(uAlphaMap, vUv).r;
  if (opacity < 0.01) discard;
  vec3 albedo = uAlbedoScale * texture2D(uColorMap, vUv).rgb;
  float tau = ringTau(opacity);

  vec3 norm = normalize(vWorldNormal);
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float sunSide = dot(norm, uSunDir);
  float viewSide = dot(norm, viewDir);
  float mu0 = max(abs(sunSide), 1e-3);
  float mu = max(abs(viewSide), 1e-3);
  bool litFace = sunSide * viewSide > 0.0;
  vec3 iOverF = albedo * (ringPhase(dot(uSunDir, viewDir)) / 4.0) * ringSlabFactor(tau, mu0, mu, litFace);

  // Planet shadow on rings: ray from ring fragment toward sun, sphere test.
  // oc = vector from planet center to ring fragment.
  vec3 oc = vWorldPos - uPlanetCenter;
  // b = projection of oc onto sunDir (negative when planet is sunward of fragment).
  float b = dot(oc, uSunDir);
  // c = |oc|^2 - R^2  (positive when fragment is outside the planet).
  float c = dot(oc, oc) - uPlanetRadius * uPlanetRadius;
  float disc = b * b - c;
  // disc > 0: ray hits planet sphere; b < 0: planet is between fragment and sun.
  // No sunlight there (the planet's own light on the rings isn't modelled).
  float sunlit = (disc > 0.0 && b < 0.0) ? 0.0 : 1.0;

  // The share of the background the layer hides along the view.
  float cover = 1.0 - exp(-tau / mu);
  gl_FragColor = vec4(iOverF * uSunRadiance * sunlit, cover);
  #include <tonemapping_fragment>
}
`
