uniform sampler2D texSampler;
varying vec3 vColor;
void main() {
  gl_FragColor = vec4(vColor, 1.) * texture(texSampler, gl_PointCoord);
}
