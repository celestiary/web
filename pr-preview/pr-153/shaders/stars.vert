// Physical star brightness (js/scene/HDR.md, "Physical stars"): a star's
// light is its illuminance over the Sun's at 1 AU, times π·DISPLAY_GAIN,
// times the exposure over Earth's keyed one (uExposureRelative), and lands
// in the eye's patch: a pixel, or the dark-adapted eye's resolution of a
// point (10 arcmin) where a pixel is finer.  Over that patch it is a
// radiance L = light / Ω_patch, in exposure units.  The sprite is the
// patch in pixels (1 px on a 300 px test viewport at 45°, 4 px on a 1080
// px screen), so the two show the same field; its pixels carry
// L × patch² in all, over a Gaussian kernel (shaders/stars.frag), so the
// light is conserved whatever the kernel's width.  Past the value a pixel
// shows as white (1) the sprite grows BLOOM_PX_PER_DECADE per decade of
// light, as a saturated point blooms in the eye and on a sensor: the
// brightest stars are bigger, their light still conserved.  A texture
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
// The kernel's width grows this many pixels per decade of light over a
// white pixel's (bloom): a saturated core, whose radius grows with the
// log of the light, and a halo.
const float BLOOM_SIGMA_PX_PER_DECADE = 0.75;
// The quad holds the kernel out to where it falls under this value
// (exposure units: under 1 of 255 through the tone map), and its edge
// window (stars.frag) takes it to zero inside the quad, so a star is
// round at every exposure; a quad that saturated to its edge was a square.
const float VISIBLE_VALUE = 0.004;
// A user's gain on every star's light (ThreeUi.setStarGain; 1 is physical).
uniform float uStarGain;
// Half-float's largest value, the scene buffer's.
const float MAX_VALUE = 6.0e4;
// The eye's resolution of a point, dark adapted: 10 arcmin, in radians.
const float EYE_POINT_RAD = 10.0 / 60.0 * PI / 180.0;

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
  vec4 mvPosition = vec4(mat3(modelViewMatrix) * eyePos, 1.);
  // Inverse-square law: the star's illuminance here, E = lumens / (4π d²),
  // with d in Gm: d² in metres overflowed float32 past 1,900 ly and
  // zeroed Deneb, Rigel and every star beyond.
  float distGm = -mvPosition.z * 1.0e-9;
  float illuminance = (lumens * 1.0e-18) / (fourPi * distGm * distGm);

  // The star's radiance over the eye's patch, in exposure units, and the
  // patch in pixels.
  float pxRad = radians(uFovDegrees) / max(uViewportHeight, 1.);
  float patchRad = max(pxRad, EYE_POINT_RAD);
  float patchPx = max(floor(patchRad / pxRad + 0.5), 1.0);
  float value = DISPLAY_GAIN * PI * (illuminance / SUN_ILLUMINANCE_1AU) / (patchRad * patchRad)
      * uExposureRelative * uStarGain;

  // A resolved disc (the Sun from within a few AU; its mesh draws the
  // surface) is no point: the sprite's light fades as the disc outgrows
  // the patch, so the mesh and a halo take over from the point.
  float discRad = 2.0 * radius / max(-mvPosition.z, 1.0);
  value *= min(1.0, (patchRad * patchRad) / max(discRad * discRad, 1.0e-30));

  // The kernel: the light, L × patch², over a Gaussian whose width is the
  // patch's, plus the bloom, and whose sum over the pixels is 2πσ²; its
  // peak may pass white, and the radius where it does is the saturated
  // core.  The quad holds the kernel out
  // to where it falls under VISIBLE_VALUE, so it is as large as the
  // visible star and no larger.
  float decadesOverWhite = max(log2(max(value, 1.0e-30)) / log2(10.0), 0.0);
  // σ = 0.4 × patch: the Gaussian's sum, 2πσ², is then patch², one for a
  // one-pixel patch, so the pixel shows L and the law is continuous as
  // the light crosses white and the bloom begins.
  vSigma = 0.4 * patchPx + BLOOM_SIGMA_PX_PER_DECADE * decadesOverWhite;
  float light = value * patchPx * patchPx;
  float kernelSum = 2.0 * PI * vSigma * vSigma;
  float peak = min(light / kernelSum, MAX_VALUE);
  float visibleRadius = vSigma * sqrt(2.0 * log(max(peak / VISIBLE_VALUE, 1.0)));
  vSize = clamp(2.0 * visibleRadius + 2.0, MIN_STAR_SIZE_PX, MAX_STAR_SIZE_PX);
  gl_PointSize = vSize;
  vBrightness = peak;

  gl_Position  = projectionMatrix * mvPosition;
}
