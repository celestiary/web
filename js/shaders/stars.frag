// https://gamedev.stackexchange.com/questions/138384/how-do-i-avoid-using-the-wrong-texture2d-function-in-glsl
#if __VERSION__ < 130
#define TEXTURE2D texture2D
#else
#define TEXTURE2D texture
#endif

uniform sampler2D texSampler;
varying vec3 vColor;
void main() {
  gl_FragColor = vec4(vColor, 1.) * TEXTURE2D(texSampler, gl_PointCoord.xy);
}
