attribute float size;
attribute vec3 color;

varying vec3 vColor;

float sigmoid(float x) {
  return 2./(1. + exp2(-x)) - 1.;
}

const vec3 unitVec = vec3(1., 1., 1.);
const float maxDist = 100000000000000.0;
const float lMaxDist = log(maxDist);

void main() {
  vColor = color;
  vec3 pos = position;
  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  float cDist = clamp(-mvPosition.z, 0., maxDist);
  float lDist = log(cDist + 2.72);
  float close = 3. * (lMaxDist - lDist) / lMaxDist;
  // vColor = clamp(close * unitVec, 0.5, 1.);

  // Not sure why this is neeed.. scene sizes should be properly
  // scaled.  This makes big stars a little too big, but I like it.
  float art = 300000000.;
  float scaledSize = art * size / cDist;
  // Larger than 250 doesn't seem to make a difference.
  float cSize = clamp(scaledSize, 2., 250.);
  gl_PointSize = cSize;

  gl_Position = projectionMatrix * mvPosition;
}
