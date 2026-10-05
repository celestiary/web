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
// (stars.vert sets vBrightness so the pixels sum to the star's light),
// windowed to zero at the quad's edge, so that a bright star, whose
// Gaussian is over white across most of the quad, is a round saturated
// core with a soft halo and never the quad's square.
void main() {
  vec2 px = (gl_PointCoord.xy - 0.5) * vSize;
  float r2 = dot(px, px);
  float k = exp(-r2 / (2.0 * vSigma * vSigma));
  float half = vSize * 0.5;
  float edge = 1.0 - smoothstep(0.6 * half * half, half * half, r2);
  gl_FragColor = vec4(vColor * vBrightness * k * edge, 1.);
}
