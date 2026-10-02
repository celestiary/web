// Physical star brightness (js/scene/HDR.md, "Physical stars"): a star's
// pixel value is its illuminance over the Sun's at 1 AU, times
// π·DISPLAY_GAIN over the solid angle its light lands in (a point source's
// light over that patch is its radiance), times the exposure over Earth's
// keyed one (uExposureRelative).  The patch is a pixel, or the eye's
// resolution where that's coarser: dark adapted, the eye resolves a point
// no finer than about 10 arcmin (rod acuity, ~20/200), so a 1080 px
// screen (2.5 arcmin a pixel at 45°) and a 300 px test viewport (9
// arcmin) show the same star field; per pixel alone, the screen would show
// it 13× brighter.  Spread over its sprite, whose texture integrates to
// GLOW_MEAN of its area, so the sprite's total is the star's light whatever
// its size.
//
// The sprite's size is the light's: MIN_STAR_SIZE_PX (3 px, about the
// eye's patch on a 1080 px screen) up to the value a pixel shows as white
// (1), and growing with the log of the value above it, as a saturated
// point blooms in the eye and on a sensor, so the brightest stars are
// bigger, with their light conserved; MAX_STAR_SIZE_PX caps it.  The
// sprite was sized by the star's radius (the catalogue's, from its
// luminosity), which spread a luminous star's light over a blob (Deneb
// 110 px, Rigel 85) that the physical value made invisible.
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
varying float vBrightness;        // Pass brightness to fragment

const float PI = 3.14159265;
const float fourPi = 4. * PI;
// The Sun's illuminance at 1 AU in the catalog's units: its lumens
// (StarsCatalog, 3.0e28) over 4π AU².
const float SUN_ILLUMINANCE_1AU = 3.0e28 / (fourPi * 1.495978707e11 * 1.495978707e11);
const float DISPLAY_GAIN = 1.5;
// The mean of the star sprite's texture (star_glow.png) over its area:
// 0.098 sampled finely, 0.145 at the 3×3 samples of a 3 px sprite (the
// samples a third of the way in see the core's shoulder).
const float GLOW_MEAN = 0.098;
const float GLOW_MEAN_3PX = 0.145;
// The sprite grows this many pixels per decade of light over a white
// pixel's.
const float BLOOM_PX_PER_DECADE = 3.0;
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

  // The star's light over the eye's patch, in exposure units.
  float radPerPx = max(radians(uFovDegrees) / max(uViewportHeight, 1.), EYE_POINT_RAD);
  float pointSolidAngle = radPerPx * radPerPx;
  float value = DISPLAY_GAIN * PI * (illuminance / SUN_ILLUMINANCE_1AU) / pointSolidAngle * uExposureRelative;

  // The sprite's size from the light (bloom), and the light spread over it.
  float decadesOverWhite = max(log2(max(value, 1.0e-30)) / log2(10.0), 0.0);
  float cSize = clamp(MIN_STAR_SIZE_PX + BLOOM_PX_PER_DECADE * decadesOverWhite, MIN_STAR_SIZE_PX, MAX_STAR_SIZE_PX);
  gl_PointSize = cSize;
  float glowMean = cSize < 4.0 ? GLOW_MEAN_3PX : GLOW_MEAN;
  vBrightness = min(value / (glowMean * cSize * cSize), MAX_VALUE);

  gl_Position  = projectionMatrix * mvPosition;
}
