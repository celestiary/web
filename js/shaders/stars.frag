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
varying float vWingScale;
varying float vDegPerPx;

// The least the half-float scene buffer holds as a normal value (hdr.js
// HDR_MIN_NORMAL, 2^-14; a test keeps them equal): a channel under it is
// written as zero, so a GPU that flushes subnormals and one that keeps
// them hold the same buffer.  Nothing visible goes: it is 1/65 of a
// display step.
const float HDR_MIN_NORMAL = 6.103516e-5;
// The rods' pool round a point, as the eye's angle: half the eye's patch
// (exposure.js STAR_POOL_RADIUS_DEG, 5′).  The wing is windowed in from
// half of it to all of it; a test keeps the constant equal.
const float POOL_RADIUS_DEG = 0.080752;
// The eye's PSF, per steradian: the CIE total glare equation (sun/glare.js
// eyePsf, EYE_PSF_GLSL carries the same constants; a test compares them).
// Two lobes of the optics (0.0046° and 0.045°) and the scattered light.
float eyePsf(float thetaDeg) {
  float t = max(thetaDeg, 0.0);
  float a1 = t / 0.0046;
  float a2 = t / 0.045;
  float q = 1.0 + (t / 0.1) * (t / 0.1);
  float l1 = 1.0 + a1 * a1;
  float l2 = 1.0 + a2 * a2;
  float optics = 0.998698 * (9.2e6 / (l1 * sqrt(l1)) + 1.5e5 / (l2 * sqrt(l2)));
  float scatter = 1.026031 * (400.0 / q + 3.0e-8 * t * t + 0.50 * (1300.0 / (q * sqrt(q)) + 0.8 / sqrt(q)));
  float field = 1.0 - smoothstep(90.0, 100.0, t);
  return field * (optics + scatter + 0.001250);
}

vec3 emitted(vec3 radiance) {
  return radiance * step(vec3(HDR_MIN_NORMAL), radiance);
}

// The star's kernel (HDR.md, "Physical stars"): the pooled core, a
// Gaussian over the sprite in pixels from its centre whose pixels sum to
// the star's pooled light (stars.vert sets vBrightness), plus the wing,
// the eye's veil round the star, vWingScale × eyePsf at the pixel's angle
// from it, windowed in past the pool; both windowed to zero at the quad's
// edge, so a bright star, whose wing is over white across most of the
// quad, is a round saturated core in a halo and never the quad's square.
void main() {
  vec2 px = (gl_PointCoord.xy - 0.5) * vSize;
  float r2 = dot(px, px);
  float r = sqrt(r2);
  float thetaDeg = r * vDegPerPx;
  float wing = vWingScale * eyePsf(thetaDeg) * smoothstep(0.5 * POOL_RADIUS_DEG, POOL_RADIUS_DEG, thetaDeg);
  float core;
  if (vSigma <= 0.0) {
    // One pixel, flat: the pixel is the patch (stars.vert).  The centre
    // pixel of the quad is the one the star falls in.
    core = (r2 < 0.25) ? vBrightness : 0.0;
  } else {
    core = vBrightness * exp(-r2 / (2.0 * vSigma * vSigma));
  }
  // (Not `half`: a GLSL ES reserved word, which failed the compile and
  // drew no stars at all.)
  float halfSize = vSize * 0.5;
  float edge = 1.0 - smoothstep(0.6 * halfSize * halfSize, halfSize * halfSize, r2);
  gl_FragColor = vec4(emitted(vColor * ((core + wing) * edge)), 1.);
}
