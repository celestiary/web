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
// The rods' pool round a point, as the eye's angle in degrees: half the
// eye's patch, 5′ (observer/instrument.js, through hdr.js absoluteUniforms).
// The wing is windowed in from half of it to all of it.
uniform float uPoolRadiusDeg;
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
  return optics + scatter + 0.001250;
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
// The wing at a point of the sprite, pixels from the star: the PSF at its
// angle in the eye, windowed in past the pool.
float wingAt(vec2 p) {
  float thetaDeg = length(p) * vDegPerPx;
  return eyePsf(thetaDeg) * smoothstep(0.5 * uPoolRadiusDeg, uPoolRadiusDeg, thetaDeg);
}

void main() {
  vec2 px = (gl_PointCoord.xy - 0.5) * vSize;
  float r2 = dot(px, px);
  float wing;
  if (r2 < 9.0) {
    // Within 3 px of the star the wing is steep against a pixel (the
    // 0.045° lobe is 2.7′ wide, a pixel 2.5-9′), so a pixel's value is its
    // mean over four points of the pixel, not its centre's: point-sampled,
    // a star's summed light moved 5-10% with its sub-pixel position on a
    // 300 px viewport, and the first ring's brightness with it.
    wing = 0.25 * (wingAt(px + vec2(-0.25, -0.25)) + wingAt(px + vec2(0.25, -0.25)) +
        wingAt(px + vec2(-0.25, 0.25)) + wingAt(px + vec2(0.25, 0.25)));
  } else {
    wing = wingAt(px);
  }
  wing *= vWingScale;
  float core;
  if (vSigma <= 0.0) {
    // One pixel, flat: the pixel is the patch (stars.vert).  The pixel
    // the star falls in is the one whose centre is within half a pixel of
    // it on both axes: its square, not a disc (a star at a pixel's corner
    // is 0.71 px from its centre, and had no core pixel at all), and a
    // half-open window a little off the half pixel, so that exactly one of
    // the quad's pixels, a pixel apart, falls in it however the rasterizer
    // rounds: it snaps a point's centre to a subpixel grid (SwiftShader's
    // is 1/16 px), which puts a star near a pixel's edge at half a pixel
    // from two centres, and gl_PointCoord over a 3 px quad is thirds, so
    // those two read -0.5000001 and 0.4999999: neither in [-0.5, 0.5), and
    // 11% of the magnitude 6 stars, 1 in 9 of magnitude 5, had no core.
    const float EDGE = 1.0e-3;
    bool own = px.x > -0.5 - EDGE && px.x < 0.5 - EDGE && px.y > -0.5 - EDGE && px.y < 0.5 - EDGE;
    core = own ? vBrightness : 0.0;
    // That pixel is the pool: it carries the pooled light and no wing
    // (the wing's window begins inside it), so the limit star reads its
    // calibrated value there exactly, as the measurements take it.
    wing = own ? 0.0 : wing;
  } else {
    core = vBrightness * exp(-r2 / (2.0 * vSigma * vSigma));
  }
  // (Not `half`: a GLSL ES reserved word, which failed the compile and
  // drew no stars at all.)
  float halfSize = vSize * 0.5;
  float edge = 1.0 - smoothstep(0.6 * halfSize * halfSize, halfSize * halfSize, r2);
  gl_FragColor = vec4(emitted(vColor * ((core + wing) * edge)), 1.);
}
