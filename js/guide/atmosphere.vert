varying vec3 vPosition;

void main() {
  //vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vPosition = position;
  //gl_Position = projectionMatrix * mvPosition;
  gl_Position = vec4(position, 1.0);
}
