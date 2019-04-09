uniform float amplitude;
attribute float size;
attribute vec3 customColor;
varying vec3 vColor;
void main() {
  vColor = customColor;
  vec3 pos = position;
  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  float dist = mvPosition.z;
  float scaledSize = size / -dist;
  gl_PointSize = clamp(scaledSize, 1., 100.);
  gl_Position = projectionMatrix * mvPosition;
}
