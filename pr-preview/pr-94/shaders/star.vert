uniform float iScale;
uniform float iTime;
varying vec3 vTexCoord3D;
void main() {
  // Time is being used here to morph the noise field.
  vTexCoord3D = iScale * ( position.xyz + vec3( iTime, iTime, iTime ) );
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
