attribute vec3 in_Position;
varying vec2 fragCoord;
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  fragCoord = position.xy;
}
