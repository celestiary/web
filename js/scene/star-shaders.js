import {EMITTED_GLSL, LUMINOUS_CEILING, LUMINOUS_SHOULDER_GLSL} from './hdr.js'
import {BLACKBODY_GLSL} from './stellar.js'
import {MAX_FLARES, MAX_REGIONS} from './sun/limits.js'


/**
 * A star's photosphere (js/scene/Stars.md): each fragment's temperature,
 * from the star's effective temperature and its surface structure
 * (granules, mesogranules, supergranules and their network, spots and
 * faculae), through a blackbody (stellar.js) to a colour and a luminance,
 * times the limb darkening, times the disc's mean radiance in exposure
 * units (HDR.md, "Physical stars").
 *
 * The geometry is a unit sphere (Star.js scales the mesh), so `position`
 * is the direction from the star's centre in its own frame, whose y axis
 * is its rotation axis.
 */
export const VERTEX_SHADER = `
varying vec3 vUnit;
varying vec3 vViewPos;
varying vec3 vViewNormal;
void main() {
  vUnit = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewPos = mv.xyz;
  vViewNormal = normalMatrix * normal;
  gl_Position = projectionMatrix * mv;
}`


export const FRAGMENT_SHADER = `
${LUMINOUS_SHOULDER_GLSL}
${EMITTED_GLSL}
${BLACKBODY_GLSL}
varying vec3 vUnit;
varying vec3 vViewPos;
varying vec3 vViewNormal;

uniform float uExposureRelative;
// The star's effective temperature, K, and its disc's mean radiance in
// exposure units at Earth's keyed exposure (the Sun's 69,357 times its
// surface brightness over the Sun's; Star.js).
uniform float uTeff;
uniform float uRadiance;
// A rotating star (starParams.js rocheModel): its equatorial radius over
// its polar one (the mesh is scaled so), Ω² in units of GM / R_pole³ (0
// for no rotation), and the gravity-darkening exponent β.  uTeff and
// uRadiance are then the pole's.
uniform float uOblate;
uniform float uOmega2;
uniform float uBeta;
// The limb darkening, per channel: the power-2 law's c and α, and its mean
// over the disc, which the law is divided by so the disc's mean is uRadiance.
uniform vec3 uLimbC;
uniform vec3 uLimbAlpha;
uniform vec3 uLimbMean;
// Granules across the radius, and each layer's rms temperature
// fluctuation, δT/T: granules, mesogranules (5× the granules' size),
// supergranules (25×) and the supergranules' bright network.
uniform float uGranuleFreq;
uniform float uGranuleDT;
uniform float uMesoDT;
uniform float uSuperDT;
uniform float uNetworkDT;
// Spots: the cells across the radius their lattice has, each cell's chance
// of a spot, its largest radius in cells, the umbra's and penumbra's
// temperature deficits (K), the faculae's δT/T, and the band of |sin
// latitude| the active regions are in.
uniform float uSpotFreq;
uniform float uSpotProb;
uniform float uSpotRadius;
uniform float uUmbraDT;
uniform float uPenumbraDT;
uniform float uFaculaDT;
uniform vec2 uSpotBelt;
// The star's own pattern (starSeed.js): an offset of the noise domain, and
// the active regions' threshold.
uniform vec3 uSeedOffset;
uniform float uSpotBias;
uniform float iTime;
// The Sun's own active regions and flares, by date (sun/SunLayers.js; Sun.md):
// in region mode the spots are each region's leading and following spot
// (body-frame centre, radius in radians), not the lattice's, and white-light
// flare kernels (centre, radius; contrast at this moment) brighten the disc.
const int MAX_REGIONS = ${MAX_REGIONS};
const int MAX_FLARE_KERNELS = ${2 * MAX_FLARES};
uniform float uRegionMode;
uniform float uRegionCount;
uniform vec4 uSpotL[MAX_REGIONS];
uniform vec4 uSpotF[MAX_REGIONS];
uniform float uFlareCount;
uniform vec4 uFlareKernel[MAX_FLARE_KERNELS];
uniform vec4 uFlareContrast[MAX_FLARE_KERNELS];

const float LUMINOUS_CEILING = ${LUMINOUS_CEILING.toExponential()};
const float TAU = 6.28318531;

// Simplex noise: Ian McEwan, Ashima Arts, MIT License,
// https://github.com/ashima/webgl-noise
vec4 permute(vec4 x) {
  return mod(((x * 34.0) + 1.0) * x, 289.0);
}

vec4 taylorInvSqrt(vec4 r) {
  return 1.79284291400159 - 0.85373472095314 * r;
}

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + 1.0 * C.xxx;
  vec3 x2 = x0 - i2 + 2.0 * C.xxx;
  vec3 x3 = x0 - 1. + 3.0 * C.xxx;
  i = mod(i, 289.0);
  vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
      + i.y + vec4(0.0, i1.y, i2.y, 1.0))
      + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 1.0 / 7.0;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

// A hash of a lattice cell to three numbers in [0, 1) (Dave Hoskins,
// "Hash without Sine", MIT License).
vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}

// Convection cells: the distances to the nearest and second-nearest of a
// jittered lattice's points (Worley's F1 and F2), the points wandering
// with time so the cells evolve.  F2 - F1 is 0 on a cell's boundary, the
// dark intergranular lane where the cooled gas sinks.
vec2 cells(vec3 p, float t) {
  vec3 i = floor(p);
  vec3 f = p - i;
  float f1 = 8.0;
  float f2 = 8.0;
  for (int z = -1; z <= 1; z++) {
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec3 o = vec3(float(x), float(y), float(z));
        vec3 h = hash33(i + o);
        vec3 d = o + 0.5 + 0.4 * sin(t + TAU * h) - f;
        float dd = dot(d, d);
        if (dd < f1) {
          f2 = f1;
          f1 = dd;
        } else if (dd < f2) {
          f2 = dd;
        }
      }
    }
  }
  return sqrt(vec2(f1, f2));
}

// A granule's brightness, normalised to a mean of 0 and an rms of 1 over
// the surface (the constants measured over 3x10^5 points: Stars.md): bright
// at the cell's centre, falling into a dark lane at its edge.
const float GRANULE_MEAN = 0.5577;
const float GRANULE_RMS = 0.3310;
float granule(vec2 f) {
  float g = smoothstep(0.0, 0.2, f.y - f.x) * (1.0 - 0.35 * f.x);
  return (g - GRANULE_MEAN) / GRANULE_RMS;
}

// Gravity darkening (von Zeipel 1924): the effective temperature over the
// pole's, (g_eff / g_pole)^β, g_eff the Roche model's gravity less the
// centrifugal acceleration at this point of the spheroid, in units of
// GM / R_pole² (starParams.js effectiveGravity).
float gravityDarkening(vec3 unit) {
  if (uOmega2 <= 0.0) {
    return 1.0;
  }
  vec2 xy = vec2(length(unit.xz) * uOblate, unit.y);
  float r = length(xy);
  float sinT = xy.x / r;
  float cosT = xy.y / r;
  float gr = -1.0 / (r * r) + uOmega2 * r * sinT * sinT;
  float gt = uOmega2 * r * sinT * cosT;
  return pow(length(vec2(gr, gt)), uBeta);
}

// Band-limiting: a feature of the given frequency (cycles per noise
// coordinate) is faded out as it shrinks toward the pixel's footprint
// (noise coordinates per pixel), from 6 px down to 2.5 px a cycle, so a
// small disc shows the mean surface (each layer's mean is 0) and the
// structure comes in as it resolves, without aliasing into speckle.
float resolved(float frequency, float footprint) {
  return 1.0 - smoothstep(0.15, 0.4, frequency * footprint);
}

float footprintOf(vec3 p) {
  return max(length(dFdx(p)), length(dFdy(p)));
}

// The nearest spot's distance from its centre over its radius (under 1 in
// the spot), or a large number for none: a lattice whose cells each hold
// a spot with chance uSpotProb, of a random radius up to uSpotRadius
// cells, scaled by the active region's strength where it falls.
float spotDistance(vec3 p, float scale) {
  vec3 i = floor(p);
  vec3 f = p - i;
  float best = 8.0;
  for (int z = -1; z <= 1; z++) {
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec3 o = vec3(float(x), float(y), float(z));
        vec3 h = hash33(i + o + 71.0);
        if (h.x < uSpotProb) {
          vec3 c = o + 0.25 + 0.5 * h.yzx;
          float r = uSpotRadius * (0.35 + 0.65 * h.z) * scale;
          best = min(best, length(c - f) / max(r, 1.0e-4));
        }
      }
    }
  }
  return best;
}

void main(void) {
  vec3 unit = normalize(vUnit);
  vec3 n = normalize(vViewNormal);
  float mu = clamp(dot(n, normalize(-vViewPos)), 0.0, 1.0);

  // Granules, mesogranules and supergranules, each in its own coordinates
  // (cells per radius), each a different patch of the field (the seed).
  vec3 pg = unit * uGranuleFreq + uSeedOffset;
  float fpg = footprintOf(pg);
  float granSeen = resolved(1.0, fpg);
  // Warped a little, so the cells are rounded, irregular granules rather
  // than a Voronoi diagram's straight-edged polygons.
  if (granSeen > 0.0) {
    vec3 q = pg * 0.7;
    pg += 0.22 * vec3(snoise(q), snoise(q + 17.0), snoise(q + 31.0));
  }
  float gran = granSeen > 0.0 ? granule(cells(pg, iTime)) * granSeen : 0.0;
  vec3 pm = unit * (uGranuleFreq / 5.0) + uSeedOffset.zxy;
  float meso = snoise(pm + 0.2 * iTime) * 1.4 * resolved(1.0, footprintOf(pm));
  vec3 ps = unit * (uGranuleFreq / 25.0) + uSeedOffset.yzx;
  float fps = footprintOf(ps);
  vec2 sup = cells(ps, 0.05 * iTime);
  float superCell = granule(sup) * resolved(1.0, fps);
  // The network: the supergranules' boundaries, where the field gathers.
  float network = (1.0 - smoothstep(0.0, 0.03, sup.y - sup.x)) * resolved(4.0, fps);
  float limb = (1.0 - mu) * (1.0 - mu);
  float dT = uGranuleDT * gran + uMesoDT * meso + uSuperDT * superCell + uNetworkDT * network * limb;

  // Active regions: a smooth field over the star, in the latitude belt,
  // over a threshold (the seed moves it); spots in them, and faculae
  // round the spots and over them, bright toward the limb.
  float lat = abs(unit.y);
  float belt = smoothstep(uSpotBelt.x - 0.05, uSpotBelt.x + 0.05, lat) *
      (1.0 - smoothstep(uSpotBelt.y - 0.08, uSpotBelt.y + 0.08, lat));
  float activity = smoothstep(0.0, 0.6, snoise(unit * 2.5 + uSeedOffset * 0.01) * 2.7 - uSpotBias + 1.2) * belt;
  float teffHere = uTeff * gravityDarkening(unit);
  float temp = teffHere * (1.0 + dT);
  if (uRegionMode > 0.5) {
    // The regions' spots: the nearest spot's distance over its radius, and
    // the plage round each region, out past its spots.
    float s = 8.0;
    float spotR = 1.0;
    float plage = 0.0;
    for (int i = 0; i < MAX_REGIONS; i++) {
      if (float(i) >= uRegionCount) {
        break;
      }
      vec4 L = uSpotL[i];
      vec4 F = uSpotF[i];
      float sep = length(L.xyz - F.xyz);
      float ext = 0.6 * sep + 6.0 * max(L.w, F.w) + 0.01;
      float dm = length(unit - normalize(L.xyz + F.xyz));
      if (dm > ext) {
        continue;
      }
      // Ragged edges, the following spot's more than the leader's.
      float dL = length(unit - L.xyz) / max(L.w, 1.0e-5) * (1.0 + 0.12 * snoise(unit * (2.5 / max(L.w, 1.0e-3))));
      float dF = length(unit - F.xyz) / max(F.w, 1.0e-5) * (1.0 + 0.3 * snoise(unit * (2.0 / max(F.w, 1.0e-3)) + 7.0));
      if (dL < s) {
        s = dL;
        spotR = L.w;
      }
      if (dF < s) {
        s = dF;
        spotR = F.w;
      }
      plage = max(plage, 1.0 - smoothstep(0.3 * ext, ext, dm));
    }
    if (s < 8.0 || plage > 0.0) {
      float fpu = footprintOf(unit);
      float edge = clamp(fpu / max(spotR, 1.0e-5), 0.05, 0.5);
      // A region's spots fade only under ~1.5 px of radius: at a full disc's
      // scale the groups are dots, as in a white-light full-disc image.
      float seen = resolved(0.25 / max(spotR, 1.0e-5), fpu);
      float umbra = 1.0 - smoothstep(0.42 - edge * 0.42, 0.42 + edge * 0.42, s);
      float spot = 1.0 - smoothstep(1.0 - edge, 1.0 + edge, s);
      float fil = 1.0 + 0.3 * snoise(unit * (9.0 / max(spotR, 1.0e-3))) * resolved(9.0 / max(spotR, 1.0e-3), fpu);
      temp -= mix(uPenumbraDT * fil, uUmbraDT, umbra) * spot * seen;
      float near = (1.0 - smoothstep(1.0, 2.5, s)) * (1.0 - spot);
      temp += teffHere * uFaculaDT * (0.4 * plage + near * seen) * limb;
    }
  } else if (uSpotProb > 0.0 && activity > 0.0) {
    vec3 psp = unit * uSpotFreq + uSeedOffset.zyx * 0.1;
    // A spot's edge is softened over a pixel, at most half its radius;
    // past that the spots fade as they go under a few pixels (their light
    // is a small share of the disc's), not into blocks of the 2×2 pixel
    // quads the footprint is taken over.
    float fpsp = footprintOf(psp);
    float edge = clamp(fpsp / max(uSpotRadius, 1.0e-4), 0.05, 0.5);
    float seen = resolved(0.5 / max(uSpotRadius, 1.0e-4), fpsp);
    float s = spotDistance(psp, activity);
    float umbra = 1.0 - smoothstep(0.42 - edge * 0.42, 0.42 + edge * 0.42, s);
    float spot = 1.0 - smoothstep(1.0 - edge, 1.0 + edge, s);
    // Penumbral filaments: streaks across the penumbra, where resolved.
    float fil = 1.0 + 0.3 * snoise(psp * 9.0) * resolved(9.0, fpsp);
    temp -= mix(uPenumbraDT * fil, uUmbraDT, umbra) * spot * seen;
    float plage = activity * (1.0 - smoothstep(1.0, 2.5, s)) * (1.0 - spot);
    temp += teffHere * uFaculaDT * (0.4 * activity + plage * seen) * limb;
  }

  // The colour and luminance at this temperature, the luminance relative to
  // the effective temperature's: so a granule's, a spot's or a facula's
  // brightness and colour are a blackbody's at its temperature.
  vec4 bb = blackbody(temp);
  vec4 bb0 = blackbody(uTeff);
  vec3 surface = bb.rgb * exp2(bb.a - bb0.a);
  // White-light flare kernels: a 10,000 K continuum over the photosphere,
  // at their contrast now (sun/emission.js flareContrast).
  for (int i = 0; i < MAX_FLARE_KERNELS; i++) {
    if (float(i) >= uFlareCount) {
      break;
    }
    vec4 k = uFlareKernel[i];
    float r = length(unit - k.xyz) / max(k.w, 1.0e-6);
    if (r < 3.0) {
      vec4 bbF = blackbody(10000.0);
      surface += bbF.rgb * (uFlareContrast[i].x * exp(-r * r));
    }
  }
  vec3 limbDark = (1.0 - uLimbC * (1.0 - pow(vec3(max(mu, 1.0e-4)), uLimbAlpha))) / uLimbMean;

  // Pre-exposed (uExposureRelative carries the frame's gain), within the
  // half-float buffer through the luminous shoulder (hdr.js), which keeps
  // the structure at any exposure; the brightest channel held to its
  // ceiling (a hot star's blue is twice its luminance).
  float base = luminousShoulder(uRadiance * uExposureRelative);
  vec3 disc = surface * limbDark * base;
  float peak = max(disc.r, max(disc.g, disc.b));
  disc *= min(1.0, LUMINOUS_CEILING / max(peak, 1.0e-30));
  gl_FragColor = vec4(emitted(max(disc, vec3(0.0))), 1.0);
}
`
