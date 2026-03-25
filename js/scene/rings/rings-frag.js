// Fragment shader for planetary rings.
// Features:
//   - Alpha-texture transparency for ring gaps (Cassini Division etc.)
//   - Blinn-Phong specular for ice-particle glint
//   - Henyey-Greenstein forward scatter (rings brighten when backlit)
//   - Analytical planet-shadow-on-rings: sphere intersection test
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
uniform float uSunIntensity;

varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;

void main() {
  float alpha = texture2D(uAlphaMap, vUv).r;
  if (alpha < 0.01) discard;
  vec3 color = texture2D(uColorMap, vUv).rgb;

  // Diffuse: rings receive light on both faces.
  vec3 norm = normalize(vWorldNormal);
  float nDotL = abs(dot(norm, uSunDir));
  float diffuse = max(nDotL, 0.05);

  // Specular ice glint (Blinn-Phong, high shininess for icy particles).
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  vec3 halfVec = normalize(uSunDir + viewDir);
  float spec = pow(max(dot(norm, halfVec), 0.0), 60.0);
  // Also check the back face normal so both faces glint.
  spec = max(spec, pow(max(dot(-norm, halfVec), 0.0), 60.0));
  vec3 specular = vec3(spec) * 0.25;

  // Forward scatter (Henyey-Greenstein, g=0.7).
  // Rings are brightest when the camera looks toward the sun through them.
  // cosTheta is negative when camera is between sun and rings.
  float cosTheta = dot(-uSunDir, viewDir);
  const float g = 0.7;
  float hg = (1.0 - g * g) / pow(max(1.0 + g * g - 2.0 * g * cosTheta, 0.001), 1.5);
  float scatter = hg * 0.15;

  // Planet shadow on rings: ray from ring fragment toward sun, sphere test.
  // oc = vector from planet center to ring fragment.
  vec3 oc = vWorldPos - uPlanetCenter;
  // b = projection of oc onto sunDir (negative when planet is sunward of fragment).
  float b = dot(oc, uSunDir);
  // c = |oc|^2 - R^2  (positive when fragment is outside the planet).
  float c = dot(oc, oc) - uPlanetRadius * uPlanetRadius;
  float disc = b * b - c;
  // disc > 0: ray hits planet sphere; b < 0: planet is between fragment and sun.
  float inShadow = (disc > 0.0 && b < 0.0) ? 1.0 : 0.0;
  // 15% ambient leaks into the shadow umbra.
  float shadowFactor = 1.0 - inShadow * 0.85;

  vec3 lit = (color * diffuse + specular + color * scatter) * shadowFactor * uSunIntensity;
  gl_FragColor = vec4(lit, alpha);
}
`
