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
uniform float uFovDegrees;      // vertical
uniform float uViewportHeight;  // pixels
uniform float uExposureRelative;
uniform float MIN_STAR_SIZE_PX;
uniform float MAX_STAR_SIZE_PX;
uniform float STAR_MAGNIFY_2;
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
// The mean of the star sprite's texture (star_glow.png) over its area.
const float GLOW_MEAN = 0.0914;
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
  float dist = -mvPosition.z;
  float distSq = dist * dist;

  // Inverse-square law: the star's illuminance here, E = lumens / (4π d²).
  float illuminance = lumens / (fourPi * distSq);

  // The sprite's size: the look's law, by the star's radius and distance
  // (larger than ~250 px makes no difference).
  float maxDist = 9.461e15*2e4;
  float lDist = log(-mvPosition.z);
  float lMaxDist = log(maxDist);
  float cLDist = clamp(lDist, 0., lMaxDist);
  float art = STAR_MAGNIFY_2;
  float scaledSize = art * radius / cLDist;
  float cSize = clamp(
    scaledSize, MIN_STAR_SIZE_PX, MAX_STAR_SIZE_PX);
  gl_PointSize = cSize;

  // The star's light over one pixel, in exposure units, spread over the
  // sprite.
  float radPerPx = max(radians(uFovDegrees) / max(uViewportHeight, 1.), EYE_POINT_RAD);
  float pointSolidAngle = radPerPx * radPerPx;
  float value = DISPLAY_GAIN * PI * (illuminance / SUN_ILLUMINANCE_1AU) / pointSolidAngle * uExposureRelative;
  vBrightness = min(value / (GLOW_MEAN * cSize * cSize), MAX_VALUE);

  gl_Position  = projectionMatrix * mvPosition;
}
