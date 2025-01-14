// Allows camera zoom into stars
uniform float cameraFovDegrees;
uniform float cameraExposure;

attribute vec3 color;
attribute float radius;
attribute float lumens;

varying vec3 vColor;
varying float vBrightness;        // Pass brightness to fragment

const float sunAbsMag = 4.83;     // Sun’s absolute magnitude in V-band
const float screenHeight = 1024.; // TODO
const float maxStarSizePixels = 5.;

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
  // This is useful for zooming in on a star during a flyby, and maybe
  // neat to see relative sizes eg in a multi-star system.
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
  //    Assume cameraFovDegrees is vertical FOV. So each radian
  //    in vertical FOV spans `resolution.y` pixels.
  // ------------------------------------------------
  float cameraFovRad = radians(cameraFovDegrees);
  float pixelsPerRad = screenHeight / cameraFovRad;
  float physicalSizeInPixels  = angularDiameter * pixelsPerRad;

  // Final point size: blend of mostly brightness and some physical size
  float sizeInPixels = physicalSizeInPixels * 1e6;

  vBrightness  = 2.5; // TODO: illuminance * cameraExposure;
  gl_PointSize = clamp(sizeInPixels, 0.1, maxStarSizePixels);
  gl_Position  = projectionMatrix * mvPosition;
}
