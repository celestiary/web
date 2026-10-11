// Physical star brightness (js/scene/HDR.md, "Physical stars"): a star's
// light is its illuminance over the Sun's at 1 AU, times π·DISPLAY_GAIN,
// times the exposure over Earth's keyed one (uExposureRelative), and lands
// in the eye's patch: a pixel, or the dark-adapted eye's resolution of a
// point (10 arcmin) where a pixel is finer.  Over that patch it is a
// radiance L = light / Ω_patch, in exposure units.  The sprite is the
// patch in pixels (1 px on a 300 px test viewport at 45°, 4 px on a 1080
// px screen), so the two show the same field; its pixels carry
// L × patch² in all, over a Gaussian kernel (shaders/stars.frag) a
// quarter of the patch wide, so the light is conserved whatever the
// kernel's width.  Past the value a pixel shows as white (1) the kernel
// widens BLOOM_SIGMA_PX_PER_DECADE per decade of light, as a saturated
// point blooms in the eye and on a sensor: the brightest stars are
// bigger, their light still conserved.  A texture
// did this before: its flat core is 6% of the sprite's half-width, so a
// 2 px sprite sampled it at 0.06 and a 4 px one at 0.27, and mipmaps
// flattened a 3 px sprite's peak to a third: a mag 4 star reached 10 of
// 255 where the arithmetic gave 97, two magnitudes lost.
uniform float uFovDegrees;      // vertical
uniform float uViewportHeight;  // pixels
uniform float uExposureRelative;
uniform float MIN_STAR_SIZE_PX;
uniform float MAX_STAR_SIZE_PX;
// RTE (Relative-To-Eye): camera position in star catalog coordinates (the
// Points' local frame, J2000; see rte.js), split into
// high (Math.fround) and low (residual) parts.  Together they carry full float64
// precision so that (position - camera) is computed without subtractive cancellation
// even at light-year distances.
uniform vec3 uCamPosWorldHigh;
uniform vec3 uCamPosWorldLow;

attribute vec3 color;
attribute float radius;
attribute float lumens;
attribute vec3 positionLow; // float64 residual: star.xyz - Math.fround(star.xyz)
#ifdef POINT_MOTION
// A point population's space motion (js/scene/Gaia.md, "Frame and epoch"):
// its velocity, km/s in the catalogue frame, over the Julian years from
// its epoch to the date.  A star moves in a straight line, exact to the
// linear model the positions were carried by.
attribute vec3 velocity;
uniform float uMotionYears;
// km/s for a Julian year, in metres.
const float KM_S_YEAR_M = 3.15576e10;
#endif

varying vec3 vColor;
varying float vBrightness;        // the kernel's peak, exposure units
varying float vSize;              // the sprite's side, px
varying float vSigma;             // the kernel's width, px

const float PI = 3.14159265;
const float fourPi = 4. * PI;
// The Sun's illuminance at 1 AU in the catalog's units: its lumens
// (StarsCatalog, 3.0e28) over 4π AU².
const float SUN_ILLUMINANCE_1AU = 3.0e28 / (fourPi * 1.495978707e11 * 1.495978707e11);
const float DISPLAY_GAIN = 1.5;
// The kernel's width is this fraction of the patch: narrower than the
// patch, as a point's spread on a sensor or the retina is narrower than
// the eye's resolution element (which detects, not blurs), so the peak is
// patch² / 2πσ² = 2.5 × the patch's radiance and a faint star's light
// stays above the tone map's toe instead of dying in it across a wide
// halo: the user saw a magnitude fewer stars at σ = 0.4 × patch.
const float KERNEL_SIGMA_PER_PATCH = 0.25;
// And never narrower than this, in pixels, so the peak doesn't depend on
// where the star falls between pixel centres (0.6: the nearest centre,
// at most 0.7 px off, reads 0.5 of the peak at worst, 0.85 typically).
const float KERNEL_SIGMA_MIN_PX = 0.6;
// The kernel's width grows this many pixels per decade of light over a
// white pixel's (bloom): a saturated core, whose radius grows with the
// log of the light, and a halo.
const float BLOOM_SIGMA_PX_PER_DECADE = 0.75;
// The quad holds the kernel out to where it falls under this value
// (exposure units: under 1 of 255 through the tone map), and its edge
// window (stars.frag) takes it to zero inside the quad, so a star is
// round at every exposure; a quad that saturated to its edge was a square.
const float VISIBLE_VALUE = 0.004;
// The saturated core's largest radius, in patches: the eye's glare has a
// core of about 20′ with the halo falling off round it, whatever the
// light (the Sun from 52 AU was a 120 px disc without this); past the
// cap the light is lost, as it is to a saturated retina.
const float GLARE_CORE_PATCHES = 2.0;
// Every star's z is pulled this far inside the far plane (in NDC, after
// clipToW1's divide; a fraction of w before it).  The camera's far plane
// is the galaxy's scale and its near plane metres, so the projection's (f + n) / (f - n) is 1 in
// float32 and a star's clip z is d - 2n, which rounds to d = w for any
// star: on the far-plane boundary exactly.  A GPU whose perspective
// divide is an approximate reciprocal lands z / w on either side of 1 by
// the bits of w, and the star is clipped or not with the camera's
// position (Alnilam gone at one yaw and back at the next, on an M2;
// SwiftShader divides exactly).  8 ulps of 1 inside (2^-23 each) is 8
// steps of the 24-bit depth buffer: still behind every planet that was
// in front (only one past 8 AU, a sub-pixel point, shares the stars'
// depth), and over the Milky Way, which pins its z to the far plane.
const float FAR_PLANE_INSIDE = 0.999999;
// Clip coordinates leave this shader divided through to w = 1 (as
// wideLines.js does): the same point and depth, with w out of the
// rasterizer's way.  w is the star's distance along the view axis in
// metres, and past sqrt(FLT_MAX) = 2^64 m (1,950 ly) its square is Inf in
// float32, so no GPU's clipping or varying setup can overflow on it.  (A
// precaution: Alnilam's loss on the user's M2 was the inverse square's
// folding, below.)  A star behind the eye (w ≤ 0) would turn round in the
// divide, so it is culled, as the clipper had it.
const vec4 CULLED = vec4(0.0, 0.0, 2.0, 1.0);
vec4 clipToW1(vec4 clip) {
  if (!(clip.w > 0.0)) {
    return CULLED;
  }
  return vec4(clip.xy / clip.w, min(clip.z / clip.w, FAR_PLANE_INSIDE), 1.0);
}
// A user's gain on every star's light (ThreeUi.setStarGain; 1 is physical).
uniform float uStarGain;
// Half-float's largest value, the scene buffer's.
const float MAX_VALUE = 6.0e4;
// The eye's resolution of a point, dark adapted: 10 arcmin, in radians.
const float EYE_POINT_RAD = 10.0 / 60.0 * PI / 180.0;
// The naked eye's field, INITIAL_FOV (45°): tan of its half.
const float TAN_HALF_EYE_FOV = 0.41421356;

void main() {
  vColor = color;

  // RTE: compute star position relative to camera eye in catalog space.
  // highDiff and lowDiff have matched magnitudes so float32 arithmetic is exact.
  // Then rotate only: mat3(modelViewMatrix) is the model's rotation (the
  // StellarFrame's J2000 -> date precession) and the view's, without the
  // translation, which the camera uniforms already carry.
  vec3 highDiff = position - uCamPosWorldHigh;
  vec3 lowDiff = positionLow - uCamPosWorldLow;
  vec3 eyePos = highDiff + lowDiff;
#ifdef POINT_MOTION
  // Added to the eye-relative vector, in float32: its rounding is 6e-8 of
  // the star's distance from the eye, an angle far under a pixel.
  eyePos += velocity * (uMotionYears * KM_S_YEAR_M);
#endif
  vec4 mvPosition = vec4(mat3(modelViewMatrix) * eyePos, 1.);
  // Inverse-square law: the star's illuminance here, E = lumens / (4π d²),
  // d the distance along the view axis.  Never as a square of d: under
  // fast math (Metal) a compiler may cancel scale factors, so the old
  // (lumens·1e-18) / (4π·(z·1e-9)²) became lumens / z² with z in metres,
  // Inf past 2^64 m (1,950 ly): every star that far from the camera
  // went black on the user's M2 (Alnilam within 9.4° of the view axis;
  // Thabit and Na'ir al Saif as the camera backed off past 1,950 ly from
  // them), while SwiftShader, computing it as written, drew them.  In
  // logs no algebra can make a square of d again, and the max() keeps
  // the scale from being folded through.  (Before that 4π·d² in metres
  // overflowed past 550 ly.)  Nothing else here squares or dots a vector
  // in metres; keep it so.
  float distGm = max(-mvPosition.z * 1.0e-9, 1.0e-30);
  float illuminance = exp2(log2(lumens * (1.0e-18 / fourPi)) - 2.0 * log2(distGm));

  // The star's radiance over the eye's patch, in exposure units, and the
  // patch in pixels.  A field narrower than the naked eye's (45°) is a
  // telescope's, magnifying by the ratio of the tangents: the eye's 10′ on
  // the screen is 10′ over that on the sky, which the star's light lands
  // in (HDR.md, "A telescope's field").  At 10′ on the sky whatever the
  // field, a star at 0.91° was a Gaussian 40 px wide, nothing on screen.
  float magnification = max(TAN_HALF_EYE_FOV / tan(radians(uFovDegrees) * 0.5), 1.0);
  float pxRad = radians(uFovDegrees) / max(uViewportHeight, 1.);
  float patchRad = max(pxRad, EYE_POINT_RAD / magnification);
  float patchPx = max(floor(patchRad / pxRad + 0.5), 1.0);
  float value = DISPLAY_GAIN * PI * (illuminance / SUN_ILLUMINANCE_1AU) / (patchRad * patchRad)
      * uExposureRelative * uStarGain;

  // A resolved disc (the Sun from within a few AU; its mesh draws the
  // surface) is no point: the sprite's light fades as the disc outgrows
  // the patch, so the mesh and a halo take over from the point.
  float discRad = 2.0 * radius / max(-mvPosition.z, 1.0);
  value *= min(1.0, (patchRad * patchRad) / max(discRad * discRad, 1.0e-30));

  // The kernel: the light, L × patch², over a Gaussian of width
  // KERNEL_SIGMA_PER_PATCH × patch (at least KERNEL_SIGMA_MIN_PX), plus
  // the bloom, whose sum over the pixels is 2πσ²; its peak may pass
  // white, and the radius where it does is the saturated core.  The quad
  // holds the kernel out to where it falls under VISIBLE_VALUE, so it is
  // as large as the visible star and no larger.
  float light = value * patchPx * patchPx;
  float sigma0 = max(KERNEL_SIGMA_PER_PATCH * patchPx, KERNEL_SIGMA_MIN_PX);
  float peak0 = light / (2.0 * PI * sigma0 * sigma0);
  if (patchPx < 1.5 && peak0 < 1.0) {
    // The pixel is the patch (a coarse viewport: a 300 px test render),
    // so the star is the one pixel it falls in, showing L flat (vSigma 0
    // tells stars.frag): a Gaussian narrower than a pixel sampled at the
    // pixel's centre read 0.2-1 of the peak with where the star fell,
    // and the faint end with it.  Past white the bloom takes over.
    vSigma = 0.0;
    vSize = 1.0;
    gl_PointSize = 1.0;
    vBrightness = min(value, MAX_VALUE);
    gl_Position = clipToW1(projectionMatrix * mvPosition);
    return;
  }
  float decadesOverWhite = max(log2(max(peak0, 1.0e-30)) / log2(10.0), 0.0);
  vSigma = sigma0 + BLOOM_SIGMA_PX_PER_DECADE * decadesOverWhite;
  float kernelSum = 2.0 * PI * vSigma * vSigma;
  float peak = min(light / kernelSum, MAX_VALUE);
  // The glare cap: the peak is at most what puts the kernel at white
  // (0.76, the tone map's shoulder) GLARE_CORE_PATCHES patches out.
  float coreMax = GLARE_CORE_PATCHES * patchPx;
  peak = min(peak, 0.76 * exp(coreMax * coreMax / (2.0 * vSigma * vSigma)));
  float visibleRadius = vSigma * sqrt(2.0 * log(max(peak / VISIBLE_VALUE, 1.0)));
  vSize = clamp(2.0 * visibleRadius + 2.0, MIN_STAR_SIZE_PX, MAX_STAR_SIZE_PX);
  gl_PointSize = vSize;
  vBrightness = peak;

  gl_Position = clipToW1(projectionMatrix * mvPosition);
}
