uniform float CAMERA_FOV_DEGREES; // Allows zoom into stars
uniform float CAMERA_EXPOSURE;
uniform float MIN_BRIGHT;
uniform float MAX_BRIGHT;
uniform float MIN_STAR_SIZE_PX;
uniform float MAX_STAR_SIZE_PX;
uniform float STAR_MAGNIFY;
uniform float STAR_MAGNIFY_2;

attribute vec3 color;
attribute float radius;
attribute float lumens;

varying vec3 vColor;
varying float vBrightness;        // Pass brightness to fragment

const float screenHeight = 1024.; // TODO

const vec3 unitVec = vec3(1., 1., 1.);
const float twoTau = 2. * 6.2831853070;

void main() {
  vColor = color;
  vec3 pos = position;
  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.);
  float dist = -mvPosition.z;
  float distSq = dist * dist;

  // -----------------------------------
  // 2) Inverse-square law for brightness at distance
  //    E = lumens / (4π * dist^2)
  // -----------------------------------
  float illuminance = lumens / (twoTau * distSq);

  //// Physical size
  // This is useful for zooming in on a star during a flyby,
  // and maybe neat to see relative sizes eg in a multi-star
  // system.
  // ------------------------------------------------
  // 1) Compute angular diameter of the star (radians)
  //    Approximation if dist >> radius:
  //       angularDiameter ≈ 2 * radius / dist
  //    For smaller distances, you might do a more precise:
  //       2.0 * atan(radius / dist)
  // ------------------------------------------------
  float angularDiameter = 2. * radius / dist;
  // or: float angularDiameter = 2. * atan(radius / dist);

  // ------------------------------------------------
  // 2) Convert angular diameter to *pixel* size
  //    Assume CAMERA_FOV_DEGREES is vertical FOV. So each radian
  //    in vertical FOV spans `resolution.y` pixels.
  // ------------------------------------------------
  float cameraFovRad = radians(CAMERA_FOV_DEGREES);
  float pixelsPerRad = screenHeight / cameraFovRad;
  float physicalSizeInPixels  = angularDiameter * pixelsPerRad;

  // Final point size: blend of mostly brightness and some
  // physical size
  float sizeInPixels = physicalSizeInPixels * STAR_MAGNIFY;
  // gl_PointSize = clamp(
  //   sizeInPixels, MIN_STAR_SIZE_PX, MAX_STAR_SIZE_PX);

  vBrightness = clamp(
    illuminance * CAMERA_EXPOSURE,
    MIN_BRIGHT,
    MAX_BRIGHT
  );

  // But this looks better
  float maxDist = 9.461e15*2e4;
  float cDist = clamp(dist, 0., maxDist);

  float lDist = log(-mvPosition.z);
  float lMaxDist = log(maxDist);
  float cLDist = clamp(lDist, 0., lMaxDist);

  float art = STAR_MAGNIFY_2;
  float scaledSize = art * radius / cLDist;
  // Larger than 250 doesn't seem to make a difference.
  float cSize = clamp(
    scaledSize, MIN_STAR_SIZE_PX, MAX_STAR_SIZE_PX);
  gl_PointSize = cSize;
  
  gl_Position  = projectionMatrix * mvPosition;
}
