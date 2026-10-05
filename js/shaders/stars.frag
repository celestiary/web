// https://gamedev.stackexchange.com/questions/138384/how-do-i-avoid-using-the-wrong-texture2d-function-in-glsl
#if __VERSION__ < 130
#define TEXTURE2D texture2D
#else
#define TEXTURE2D texture
#endif

varying vec3 vColor;
varying float vBrightness;
varying float vSize;
varying float vSigma;

// The star's kernel: a Gaussian over the sprite, in pixels from its centre
// (stars.vert sets vBrightness so the pixels sum to the star's light).
void main() {
  vec2 px = (gl_PointCoord.xy - 0.5) * vSize;
  float k = exp(-dot(px, px) / (2.0 * vSigma * vSigma));
  gl_FragColor = vec4(vColor * vBrightness * k, 1.);
}
