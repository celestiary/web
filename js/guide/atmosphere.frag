// Adapted From https://github.com/wwwtyro/glsl-atmosphere
// Thanks Rye!
// License:
//   The Unlicense
//   A license with no conditions whatsoever which dedicates works to
//   the public domain. Unlicensed works, modifications, and larger
//   works may be distributed under different terms and without source
//   code.
//   https://github.com/wwwtyro/glsl-atmosphere/blob/master/LICENSE
precision highp float;

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
