// Vertex shader for planetary rings.
// Computes radial UV from geometry position (ring is in XY plane before mesh rotation).
// Passes world position and world normal to fragment shader for lighting/shadow.
export const VERT = /* glsl */`
uniform float uInnerRadius;
uniform float uOuterRadius;

varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;

void main() {
  // Ring geometry lies in XY plane; radius is distance from center in that plane.
  float r = length(position.xy);
  // u = 0 at inner edge, u = 1 at outer edge; v = 0.5 (texture is a 1-D strip).
  vUv = vec2((r - uInnerRadius) / (uOuterRadius - uInnerRadius), 0.5);
  vec4 worldPos4 = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos4.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`
