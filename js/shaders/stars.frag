//uniform vec3 color;
uniform sampler2D texSampler;
varying vec3 vColor;
void main() {
  gl_FragColor = vec4(vColor, 1.);
  gl_FragColor = gl_FragColor * texture(texSampler, gl_PointCoord);
}
