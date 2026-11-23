import {EMITTED_GLSL, HDR_MAX_VALUE, LUMINOUS_GLOW_MAX, LUMINOUS_SHOULDER_GLSL} from '../hdr.js'
import {EUV_VIEW, RADIAL_FIRST, RADIAL_SAMPLES, VIEW_GLSL} from './activityView.js'
import {CORONA_GLSL, CORONA_SAMPLES} from './corona.js'
import {CAMERA, NAKED_EYE} from '../observer/instrument.js'


/**
 * The Sun's light off its disc (js/scene/Sun.md): the K-corona (Thomson
 * scattering, corona.js) with the CMEs' strands, which come in a target
 * of their own (cme/CmeCloud.js), the chromosphere and prominences (Balmer
 * emission, emission.js), and the eye's glare (glare.js).  All in exposure
 * units: uDiscValue is the disc's mean radiance at this frame's exposure,
 * and every layer is a ratio to it.
 */


export const MAX_PROMINENCES = 16
// The corona's shell, solar radii: past LASCO C3's 30.
export const CORONA_RADII = 40


// The shell is drawn at the far plane, one step of the 24-bit depth buffer
// inside it.  At the Sun's distance its back faces are on the far plane's
// boundary anyway (the projection's z/w is 1 − 2n/d, n the near plane:
// 1 − 1e-9 from the ground), and the GPU's rounding put some triangles past
// it, clipped: wedges of corona missing (HDR.md tells the stars' version of
// this).  At 1 − 6e-8 it is behind every body nearer than ~10¹³ m from
// space and every body nearer than 3e9 m from the ground (the Moon's depth
// is 1 − 2.8e-7 there), so the Moon still hides it in an eclipse; a planet
// right behind the Sun would hide it too (a superior conjunction's
// corner case).
export const CORONA_VERTEX = `
void main() {
  vec4 clip = projectionMatrix * (modelViewMatrix * vec4(position, 1.0));
  gl_Position = vec4(clip.xy, clip.w * (1.0 - 1.0e-7), clip.w);
}`


export const CORONA_FRAGMENT = `
${EMITTED_GLSL}
${LUMINOUS_SHOULDER_GLSL}
${VIEW_GLSL}
${CORONA_GLSL}
// Each pixel's ray from its window position: the shell's vertices are
// ~2e11 m away, and their view positions, interpolated, put whole
// triangles' rays off by more than a solar radius on SwiftShader (wedges of
// the corona missing, taken for the disc).
uniform mat4 uProjectionInverse;
uniform vec4 uViewport;

// The Sun's centre from the camera, in view space and solar radii.
uniform vec3 uSunCentre;
// View space to the Sun's Carrington frame (sunFrame.js).
uniform mat3 uViewToBody;
// The current sheet: its pole in the Carrington frame, the warp's
// amplitude (in sin latitude) and phases, and the rays' contrast.
uniform vec3 uSheetPole;
uniform float uSheetWarp;
uniform vec3 uWarpPhase;
uniform float uRays;
// The disc's mean radiance at this exposure, and its colour (Y = 1).
uniform float uDiscValue;
uniform vec3 uSunColor;
// Balmer emission's colour and luminance per nm of Hα's equivalent width,
// over the disc's mean (emission.js balmerPerNm).
uniform vec3 uBalmer;
// The farthest impact radius worth marching at this exposure, and a
// coronagraph's occulting disc (solar radii; 1 for none).
uniform float uMaxRho;
uniform float uOcculter;
// The chromosphere: Hα at the limb (nm), its scale height, the spicules'
// Hα and scale height (solar radii).
uniform vec4 uChromo;
uniform float uPromCount;
uniform vec4 uPromCentre[${MAX_PROMINENCES}];
uniform vec4 uPromTangent[${MAX_PROMINENCES}];
uniform vec4 uPromShape[${MAX_PROMINENCES}];
// The CMEs (cme/CmeCloud.js): their K-corona over the mean corona's (r),
// their cool plasma's depth (b), and that times its Hα (g) and its He II
// (a); the threads' and the puffs'; 0 for none.
uniform sampler2D uCmeColumn;
uniform sampler2D uCmeFog;
uniform float uCmeOn;
// Days, for the prominences' slow motion.
uniform float uDays;
// The activity view (activityView.js): on (x), the corona's level (y), the
// cool plasma's per nm of Hα (z), the table's white (w); the radial
// filter's table, log10 of the mean corona by log radius.
uniform vec4 uView;
uniform float uRadialRef[${RADIAL_SAMPLES}];

const int SAMPLES = ${CORONA_SAMPLES};
const float CORONA_RADII = ${CORONA_RADII.toFixed(1)};
const float HDR_MAX_VALUE = ${HDR_MAX_VALUE.toExponential()};
const float PI = 3.14159265;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

// Value noise on a lattice, smooth, in [0, 1].
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = p - i;
  f = f * f * (3.0 - 2.0 * f);
  float a = mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x);
  float b = mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x);
  float c = mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x);
  float d = mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x);
  return mix(mix(a, b, f.y), mix(c, d, f.y), f.z);
}

// The sine of the latitude from the current sheet at a Carrington-frame
// direction: the tilted dipole's, plus the warp's low-order terms.
float sheetSin(vec3 u) {
  float lon = atan(-u.z, u.x);
  float c = sqrt(max(1.0 - u.y * u.y, 0.0));
  float warp = c * c * sin(2.0 * lon + uWarpPhase.x) + c * c * c * sin(3.0 * lon + uWarpPhase.y) * 0.6;
  return clamp(dot(u, uSheetPole) + uSheetWarp * warp, -1.0, 1.0);
}

// Rays and plumes: radial structure, noise on the direction only.
float rays(vec3 u) {
  float n = vnoise(u * 23.0) * 0.65 + vnoise(u * 61.0) * 0.35;
  return max(1.0 + uRays * (2.0 * n - 1.0), 0.1);
}

float coronaDensity(vec3 x, float r) {
  vec3 u = uViewToBody * (x / r);
  float s = sheetSin(u);
  return saitoDensity(r, s) * streamerFactor(r, s) * rays(u);
}

// The mean corona's brightness at an impact radius.
float radialRef(float rho) {
  float x = clamp(log(max(rho, ${RADIAL_FIRST.toFixed(2)}) / ${RADIAL_FIRST.toFixed(2)}) /
      log(CORONA_RADII / ${RADIAL_FIRST.toFixed(2)}), 0.0, 1.0) * ${(RADIAL_SAMPLES - 1).toFixed(1)};
  int i = int(min(floor(x), ${(RADIAL_SAMPLES - 2).toFixed(1)}));
  return pow(10.0, mix(uRadialRef[i], uRadialRef[i + 1], x - float(i)));
}

// Hα along a ray through one prominence: a sheet of thickness w over the
// line on the surface through its centre along its tangent, its top a
// rounded hedge of height h, threaded.  The emission grows with the path
// through it, saturating (Hα is optically thick in a prominence) past
// 30 Mm (0.043 radii).
float prominence(vec3 cam, vec3 d, float tStar, float rho, float pix, int i) {
  vec4 cH = uPromCentre[i];
  vec4 tL = uPromTangent[i];
  vec4 sh = uPromShape[i];
  float h = cH.w;
  if (rho > 1.0 + h) {
    return 0.0;
  }
  vec3 C = cH.xyz;
  vec3 T = tL.xyz;
  float L = tL.w;
  vec3 N = normalize(cross(T, C));
  float w = sh.x;
  float dn = dot(d, N);
  float p0 = dot(cam - C, N);
  // The ray's stretch within the shell under the prominence's top.
  float span = sqrt(max((1.0 + h) * (1.0 + h) - rho * rho, 0.0));
  float ta = tStar - span;
  float tb = tStar + span;
  if (abs(dn) > 1.0e-5) {
    float t1 = (-0.5 * w - p0) / dn;
    float t2 = (0.5 * w - p0) / dn;
    ta = max(ta, min(t1, t2));
    tb = min(tb, max(t1, t2));
  } else if (abs(p0) > 0.5 * w) {
    return 0.0;
  }
  // And within its length along the filament.
  float dl = dot(d, T);
  float l0 = dot(cam - C, T);
  if (abs(dl) > 1.0e-5) {
    float t1 = (-L - l0) / dl;
    float t2 = (L - l0) / dl;
    ta = max(ta, min(t1, t2));
    tb = min(tb, max(t1, t2));
  } else if (abs(l0) > L) {
    return 0.0;
  }
  if (tb <= ta) {
    return 0.0;
  }
  float path = 0.0;
  const int STEPS = 4;
  float dt = (tb - ta) / float(STEPS);
  for (int k = 0; k < STEPS; k++) {
    vec3 p = cam + d * (ta + (float(k) + 0.5) * dt);
    float s = dot(p - C, T) / L;
    float z = (length(p) - 1.0) / h;
    // On its own side of the star (the sheet's plane runs through the centre).
    if (abs(s) >= 1.0 || z <= 0.0 || dot(p, C) <= 0.0) {
      continue;
    }
    float top = sqrt(1.0 - s * s) * (0.6 + 0.4 * vnoise(vec3(s * 5.0, sh.z * 31.0, uDays * 0.2)));
    if (z >= top) {
      continue;
    }
    // Vertical threads: fast along the filament, slow in height.
    // Faded to their mean where they are under a few pixels apart.
    float threads = mix(0.35 + 0.65 * vnoise(vec3(s * L * 900.0, z * 3.0 - uDays * 2.0, sh.z * 13.0)), 0.675,
        smoothstep(0.3, 1.0, pix * 900.0 / 3.0));
    path += dt * threads * smoothstep(top, top * 0.8, z);
  }
  // He II 304 Å is far thicker than Hα: a few megametres saturate it.
  if (uView.x > 0.5) {
    return sh.y * (1.0 - exp(-path / 0.006));
  }
  return sh.y * (1.0 - exp(-path / 0.043)) / (1.0 - exp(-1.0));
}

// The chromosphere's Hα at an impact height, averaged over the pixel's
// radial footprint (it is a few megametres thick: under a pixel from
// afar): its base, of scale height H, and the spicules', of Hs.
float chromosphere(float rho, float pix) {
  float a = max(rho - 0.5 * pix - 1.0, 0.0);
  float b = max(rho + 0.5 * pix - 1.0, a + 1.0e-7);
  float H = uChromo.y;
  float Hs = uChromo.w;
  float base = uChromo.x * H * (exp(-a / H) - exp(-b / H)) / (b - a);
  float spic = uChromo.z * Hs * (exp(-a / Hs) - exp(-b / Hs)) / (b - a);
  return base + spic;
}

void main() {
  vec2 ndc = 2.0 * (gl_FragCoord.xy - uViewport.xy) / uViewport.zw - 1.0;
  // On the near plane: the far plane's w is 1/far, nothing in float32.
  vec4 v = uProjectionInverse * vec4(ndc, -1.0, 1.0);
  vec3 d = normalize(v.xyz / v.w);
  vec3 cam = -uSunCentre;
  float tStar = -dot(cam, d);
  vec3 q = cam + tStar * d;
  float rho = length(q);
  // The pixel's footprint in impact radius, taken before any branch.
  float pix = max(fwidth(rho), 1.0e-6);
  // Out of a coronagraph's field, or of the view's while the disc is small.
  if (rho < uOcculter || rho > uMaxRho || (uView.x > 0.5 && uView.y + uView.z <= 0.0)) {
    discard;
  }
  float thetaEnd = atan(sqrt(max(CORONA_RADII * CORONA_RADII - rho * rho, 0.0)), rho);
  float thetaCam = atan(-tStar, rho);
  float th0 = max(thetaCam, -thetaEnd);
  vec3 color = vec3(0.0);
  float viewLevel = 0.0;
  // The CMEs' particles: their column with the corona's own.
  vec2 uv = (gl_FragCoord.xy - uViewport.xy) / uViewport.zw;
  vec4 cme = uCmeOn > 0.5 ? texture2D(uCmeColumn, uv) : vec4(0.0);
  // In the view at the gain a coronagraph's difference gives them.
  float k = (cme.r + (uCmeOn > 0.5 ? texture2D(uCmeFog, uv).r : 0.0)) * radialRef(rho) *
      (uView.x > 0.5 ? ${EUV_VIEW.cme.toFixed(1)} : 1.0);
  if (th0 < thetaEnd) {
    float dth = (thetaEnd - th0) / float(SAMPLES);
    float sum = 0.0;
    for (int i = 0; i < SAMPLES; i++) {
      float th = th0 + (float(i) + 0.5) * dth;
      float c = cos(th);
      float r = rho / c;
      vec3 x = q + d * (rho * tan(th));
      float st = sin(th);
      sum += coronaDensity(x, r) * dilution(r) * (1.0 + st * st);
    }
    k += THOMSON_FACTOR * sum * dth / rho;
  }
  if (uView.x > 0.5) {
    // The coronagraph's radial filter, its contrast raised; a little of
    // the corona's fall left in.
    float x = k / radialRef(rho) * inversesqrt(rho);
    viewLevel += uView.y * x * x / (x + 0.35);
  } else {
    color += uSunColor * k;
  }
  // Balmer emission: an erupting prominence's threads, saturating where
  // they pile up; and near the limb, where the camera isn't past it, the
  // chromosphere and the prominences.
  float e = cme.b > 1.0e-4 ? (uView.x > 0.5 ? cme.a : cme.g) / cme.b * (1.0 - exp(-cme.b)) : 0.0;
  if (rho < 1.2 && tStar > 0.0) {
    e += chromosphere(rho, pix);
    for (int i = 0; i < ${MAX_PROMINENCES}; i++) {
      if (float(i) >= uPromCount) {
        break;
      }
      e += prominence(cam, d, tStar, rho, pix, i);
    }
  }
  if (uView.x > 0.5) {
    viewLevel += uView.z * e;
  } else {
    color += uBalmer * e;
  }
  // In the view, the levels' sum through the colour table.
  if (uView.x > 0.5) {
    color = viewColor(viewLevel);
  }
  float scale = uView.x > 0.5 ? uView.w * luminousShoulder(uDiscValue) : uDiscValue;
  vec3 value = min(color * scale, vec3(HDR_MAX_VALUE));
  gl_FragColor = vec4(emitted(value), 1.0);
}
`


export const GLARE_VERTEX = `
varying vec2 vNdc;
void main() {
  vNdc = position.xy;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`


export const GLARE_FRAGMENT = `
${EMITTED_GLSL}
${NAKED_EYE.psf.glareGlsl}
${CAMERA.psf.glareGlsl}
varying vec2 vNdc;
uniform mat4 uProjectionInverse;
// The disc's centre and two directions across it, in view space; its
// angular radius (rad) and solid angle (sr); its visible share; its
// radiance at this exposure and its colour.
uniform vec3 uSunDir;
uniform vec3 uAcross1;
uniform vec3 uAcross2;
uniform float uDiscRadius;
uniform float uDiscSolidAngle;
uniform float uVisible;
uniform float uDiscValue;
uniform vec3 uSunColor;
// Whether the source is in the eye's field: 1 to 90° from the view axis,
// 0 at 100° (glare.js glareFieldWeight).
uniform float uFieldWeight;
// The instrument's glare: 0 the eye's, 1 a camera's (glare.js GLARE_MODEL_*).
uniform float uGlareModel;
const float LUMINOUS_GLOW_MAX = ${LUMINOUS_GLOW_MAX.toExponential()};
const float RAD_TO_DEG = 57.2957795;

float angleDeg(vec3 a, vec3 b) {
  return atan(length(cross(a, b)), dot(a, b)) * RAD_TO_DEG;
}

float veilOf(float thetaDeg) {
  return uGlareModel > 0.5 ? cameraGlareFunction(thetaDeg) : glareFunction(thetaDeg);
}

void main() {
  // On the near plane: the far plane's w is 1/far, nothing in float32.
  vec4 v = uProjectionInverse * vec4(vNdc, -1.0, 1.0);
  vec3 dir = normalize(v.xyz / v.w);
  float centreDeg = angleDeg(dir, uSunDir);
  // Over the disc itself the veil is a small share of its own light: none.
  if (centreDeg < uDiscRadius * RAD_TO_DEG) {
    discard;
  }
  float f;
  if (uDiscRadius < 0.0035) {
    f = veilOf(centreDeg);
  } else {
    // A resolved disc: its light in equal-area parts, each at its own angle
    // (a sixteenth at the centre, then rings of 6 and 12 at 0.49 and 0.84
    // of its radius).  Exact far out; near the limb within a factor of a
    // few of the disc's true integral (Sun.md, "Glare").
    f = 0.0625 * veilOf(centreDeg);
    for (int k = 0; k < 6; k++) {
      float a = float(k) * 1.04719755 + 0.5236;
      vec3 p = normalize(uSunDir + 0.49 * uDiscRadius * (cos(a) * uAcross1 + sin(a) * uAcross2));
      f += 0.06 * veilOf(angleDeg(dir, p));
    }
    for (int k = 0; k < 12; k++) {
      float a = float(k) * 0.52359878;
      vec3 p = normalize(uSunDir + 0.843 * uDiscRadius * (cos(a) * uAcross1 + sin(a) * uAcross2));
      f += 0.048125 * veilOf(angleDeg(dir, p));
    }
  }
  float veil = min(uDiscValue * uVisible * uFieldWeight * uDiscSolidAngle * f, LUMINOUS_GLOW_MAX);
  gl_FragColor = vec4(emitted(uSunColor * veil), 1.0);
}
`
