import {
  AdditiveBlending,
  BufferGeometry,
  Float32BufferAttribute,
  // GLSL3,
  Mesh,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three'


/**
 */
export default class AtmosphereObject3D extends Mesh {
  /** @param atmos An Atmosphere parameters object. */
  constructor(atmos) {
    super(makeGeometry(), makeMaterial(atmos))
    this.atmosphere = atmos
  }


  /** @override */
  onBeforeRender() {
    const u = this.material.uniforms
    const atmos = this.atmosphere
    u.uEyePos.value.y = atmos.EyeHeight
    u.uSunPos.value.y = atmos.SunY
    u.uSunIntensity.value = atmos.SunIntensity
    u.uGroundElevation.value = atmos.GroundElevation
    u.uAtmosphereHeight.value = atmos.AtmosphereHeight
    u.uRayleighScatteringCoeff.value.set(
        atmos.RayleighRed,
        atmos.RayleighGreen,
        atmos.RayleighBlue)
    u.uRayleighScaleHeight.value = atmos.RayleighScaleHeight
    u.uMieScatteringCoeff.value = atmos.MieScatteringCoeff
    u.uMieScaleHeight.value = atmos.MieScaleHeight
    u.uMiePolarity.value = atmos.MiePolarity
  }
}


/**
 * @returns {BufferGeometry}
 */
function makeGeometry() {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute([
    -1, -1, -1,
    1, -1, -1,
    1, 1, -1,

    -1, -1, -1,
    1, 1, -1,
    -1, 1, -1],
  3))
  return geometry
}


/**
 * @returns {ShaderMaterial}
 */
function makeMaterial(atmos) {
  const kLengthUnitInMeters = 1000
  const viewDistanceMeters = 9e3
  const viewZenithAngleRadians = 1.47
  const viewAzimuthAngleRadians = -0.1
  const kFovY = Math.PI / 4 // Original: 50 / 180 * Math.PI
  const kTanFovY = Math.tan(kFovY / 2)
  const aspectRatio = 1 // this.canvas.width / this.canvas.height;
  const viewFromClip = new Float32Array(16)
  const modelFromView = new Float32Array(16)
  viewFromClip.set([
    kTanFovY * aspectRatio, 0, 0, 0,
    0, kTanFovY, 0, 0,
    0, 0, 0, -1,
    0, 0, 1, 1])

  const cosZ = Math.cos(viewZenithAngleRadians)
  const sinZ = Math.sin(viewZenithAngleRadians)
  const cosA = Math.cos(viewAzimuthAngleRadians)
  const sinA = Math.sin(viewAzimuthAngleRadians)
  const viewDistance = viewDistanceMeters / kLengthUnitInMeters
  modelFromView.set([
    -sinA, -cosZ * cosA, sinZ * cosA, sinZ * cosA * viewDistance,
    cosA, -cosZ * sinA, sinZ * sinA, sinZ * sinA * viewDistance,
    0, sinZ, cosZ, cosZ * viewDistance,
    0, 0, 0, 1])
  // const sunPos = -10
  return new ShaderMaterial({
    uniforms: {
      model_from_view: {value: modelFromView},
      view_from_clip: {value: viewFromClip},
      uEyePos: {value: new Vector3(0, atmos.EyeHeight, 0)},
      uSunPos: {value: new Vector3(0, atmos.SunY, -1)},
      earth_center: {value: new Vector3(0, 0, atmos.EyeHeight)},
      sun_direction: {value: new Vector3(0, atmos.SunY, 0)},
      sun_size: {value: new Vector2(1, 1)},
      // TODO: same as sun
      camera: {value: new Vector3(0, atmos.SunY, -1)},
      uSunIntensity: {value: atmos.SunIntensity},
      uGroundElevation: {value: atmos.GroundElevation},
      uAtmosphereHeight: {value: atmos.AtmosphereHeight},
      uRayleighScatteringCoeff: {
        value: new Vector3(
            atmos.RayleighRed,
            atmos.RayleighGreen,
            atmos.RayleighBlue),
      },
      uRayleighScaleHeight: {value: atmos.RayleighScaleHeight},
      uMieScatteringCoeff: {value: atmos.MieScatteringCoeff},
      uMieScaleHeight: {value: atmos.MieScaleHeight},
      uMiePolarity: {value: atmos.MiePolarity},
    },
    //    glslVersion: GLSL3,
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    blending: AdditiveBlending,
  })
}


const VERTEX_SHADER = `varying vec3 vPosition;

uniform mat4 model_from_view;
uniform mat4 view_from_clip;
layout(location = 0) in vec4 vertex;
//out vec3 view_ray;
void main() {
  //view_ray = (model_from_view * vec4((view_from_clip * vertex).xyz, 0.0)).xyz;
  vec4 mvPosition = modelViewMatrix * vec4(position, 0.0);
  vPosition = position;
  gl_Position = projectionMatrix * mvPosition;
  //gl_Position = vec4(position, 1.0);
}
`

// Adapted From https://github.com/wwwtyro/glsl-atmosphere
// Thanks Rye!
// License:
//   The Unlicense
//   A license with no conditions whatsoever which dedicates works to
//   the public domain. Unlicensed works, modifications, and larger
//   works may be distributed under different terms and without source
//   code.
//   https://github.com/wwwtyro/glsl-atmosphere/blob/master/LICENSE
const FRAGMENT_SHADER = `precision highp float;

varying vec3 vPosition;

uniform vec3 uSunPos;
uniform vec3 uEyePos;
uniform float uSunIntensity;
uniform float uGroundElevation;
uniform float uAtmosphereHeight;
uniform vec3 uRayleighScatteringCoeff;
uniform float uMieScatteringCoeff;
uniform float uRayleighScaleHeight;
uniform float uMieScaleHeight;
uniform float uMiePolarity;

uniform vec3 camera;
uniform vec3 earth_center;
uniform vec3 sun_direction;
uniform vec2 sun_size;

in vec3 view_ray;

#define PI 3.141592
#define iSteps 16
#define jSteps 8


vec2 rsi(vec3 r0, vec3 rd, float sr) {
    // ray-sphere intersection that assumes
    // the sphere is centered at the origin.
    // No intersection when result.x > result.y
    float a = dot(rd, rd);
    float b = 2.0 * dot(rd, r0);
    float c = dot(r0, r0) - (sr * sr);
    float d = (b*b) - 4.0*a*c;
    if (d < 0.0) return vec2(1e5,-1e5);
    return vec2(
        (-b - sqrt(d))/(2.0*a),
        (-b + sqrt(d))/(2.0*a)
    );
}


vec3 atmosphere(vec3 pVrt, vec3 pEye,
                vec3 pSun, float iSun,
                float rPlanet, float rAtmos,
                vec3 kRlh, float shRlh,
                float kMie, float shMie, float polarity) {
    // Normalize the sun and view directions.
    pVrt = normalize(pVrt);
    pSun = normalize(pSun);

    // Calculate the step size of the primary ray.
    vec2 p = rsi(pEye, pVrt, rAtmos);
    if (p.x > p.y) return vec3(0,0,0);
    p.y = min(p.y, rsi(pEye, pVrt, rPlanet).x);
    float iStepSize = (p.y - p.x) / float(iSteps);

    // Initialize the primary ray time.
    float iTime = 0.0;

    // Initialize accumulators for Rayleigh and Mie scattering.
    vec3 totalRlh = vec3(0,0,0);
    vec3 totalMie = vec3(0,0,0);

    // Initialize optical depth accumulators for the primary ray.
    float iOdRlh = 0.0;
    float iOdMie = 0.0;

    // Calculate the Rayleigh and Mie phases.
    // These look like some variant on:
    //   16.2.2 The Phase Function
    //   https://developer.nvidia.com/gpugems/gpugems2/part-ii-shading-lighting-and-shadows/chapter-16-accurate-atmospheric-scattering
    float mu = dot(pVrt, pSun);
    float mumu = mu * mu;
    float pol2 = polarity * polarity;
    // https://www.scratchapixel.com/lessons/procedural-generation-virtual-worlds/simulating-sky/simulating-colors-of-the-sky
    // Solid angle 0.1:
    float pRlh = 3.0 / (16.0 * PI) * (1.0 + mumu);
    // TODO: add sr term to (8.0 * PI * sr), maybe steradian (solid angle) of sun?
    // https://github.com/ebruneton/precomputed_atmospheric_scattering/blob/master/atmosphere/definitions.glsl#L209
    // TODO: test addition of abs inside base of pow (seen in Unity port)
    // TODO: Terrell and scratchpixel put (2.0 + pol2) in demoninator, Bruneton in numerator.
    // https://github.com/ebruneton/precomputed_atmospheric_scattering/blob/master/atmosphere/functions.glsl#L746
    float InverseSolidAngle = 3.0 / (8.0 * PI) * ((1.0 - pol2) * (1.0 + mumu));
    float pMie = InverseSolidAngle * (2.0 + pol2)
      / pow(1.0 + pol2 - 2.0 * polarity * mu, 1.5);

    // Sample the primary ray.
    for (int i = 0; i < iSteps; i++) {

        // Calculate the primary ray sample position.
        vec3 iPos = pEye + pVrt * (iTime + iStepSize * 0.5);

        // Calculate the height of the sample.
        float iHeight = length(iPos) - rPlanet;

        // Calculate the optical depth of the Rayleigh and Mie scattering for this step.
        float odStepRlh = exp(-iHeight / shRlh) * iStepSize;
        float odStepMie = exp(-iHeight / shMie) * iStepSize;

        // Accumulate optical depth.
        iOdRlh += odStepRlh;
        iOdMie += odStepMie;

        // Calculate the step size of the secondary ray.
        float jStepSize = rsi(iPos, pSun, rAtmos).y / float(jSteps);

        // Initialize the secondary ray time.
        float jTime = 0.0;

        // Initialize optical depth accumulators for the secondary ray.
        float jOdRlh = 0.0;
        float jOdMie = 0.0;

        // Sample the secondary ray.
        for (int j = 0; j < jSteps; j++) {

            // Calculate the secondary ray sample position.
            vec3 jPos = iPos + pSun * (jTime + jStepSize * 0.5);

            // Calculate the height of the sample.
            float jHeight = length(jPos) - rPlanet;

            // Accumulate the optical depth.
            jOdRlh += exp(-jHeight / shRlh) * jStepSize;
            jOdMie += exp(-jHeight / shMie) * jStepSize;

            // Increment the secondary ray time.
            jTime += jStepSize;
        }

        // Calculate attenuation.
        vec3 attn = exp(-(kMie * (iOdMie + jOdMie) + kRlh * (iOdRlh + jOdRlh)));

        // Accumulate scattering.
        totalRlh += odStepRlh * attn;
        totalMie += odStepMie * attn;

        // Increment the primary ray time.
        iTime += iStepSize;

    }

    // Calculate and return the final color.
    return iSun * (pRlh * kRlh * totalRlh + pMie * kMie * totalMie);
}

const float kLengthUnitInMeters = 1.;
const vec3 kSphereCenter = vec3(0.0, 0.0, 0) / kLengthUnitInMeters;

void main() {
  vec3 color = atmosphere(
      vPosition, uEyePos,
      uSunPos, uSunIntensity,
      uGroundElevation, uGroundElevation + uAtmosphereHeight,
      uRayleighScatteringCoeff, uRayleighScaleHeight,
      uMieScatteringCoeff, uMieScaleHeight, uMiePolarity);
  // Apply exposure.
  color = 1.0 - exp(-1.0 * color);
  gl_FragColor = vec4(color, 1);
}
`
