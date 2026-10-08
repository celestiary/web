import {describe, expect, it} from 'bun:test'
import {
  ASTRO_UNIT_METER, DISPLAY_GAIN, LIGHTYEAR_METER, SUN_ILLUMINANCE_LUX, SUN_LIGHT_DECAY, SUN_LUMINOUS_INTENSITY,
} from '../shared.js'
import {CLOUD_WHITE} from './clouds/cloudSource.js'
import {EXPOSURE_UNIT_CD_M2} from './eye.js'
import {
  FLOAT32_MAX, FLOAT32_SQRT_MAX, NIGHT_LIGHT_RADIANCE, exposureAt, exposureRelative, irradianceAt, nightLightRadiance,
  skyExposure,
} from './exposure.js'
import horizons from './planetPhotometry.horizons.json'


// The Sun's light (shared.js, Star.js): the physical inverse square, in
// photometric units.  What it replaced, for the invariance tests: a falloff
// of 1/d^1.01 at 3.7e28, tuned before the exposure followed the target.
const AU = ASTRO_UNIT_METER
const OLD_INTENSITY = 3.7e28
const OLD_DECAY = 1.01
const oldIrradiance = (d) => OLD_INTENSITY / Math.pow(d, OLD_DECAY)
const oldExposureAt = (d) => DISPLAY_GAIN * Math.PI / oldIrradiance(d)
const f32 = Math.fround


/**
 * three's PointLight in its fragment shader (lights_pars_begin,
 * getDistanceAttenuation, r171), in float32: the light's view-space vector's
 * length, its falloff, and the uniform's colour times it.
 *
 * @param {Array<number>} lVector The light's position less the fragment's, view space, metres
 * @param {number} intensity The light's intensity (its colour, white, times it)
 * @param {number} decay
 * @returns {number} directLight.color's channel, as the shader computes it
 */
function shaderIrradiance(lVector, intensity, decay) {
  const [x, y, z] = lVector.map(f32)
  const lightDistance = f32(Math.sqrt(f32(f32(f32(x * x) + f32(y * y)) + f32(z * z))))
  const falloff = f32(1 / Math.max(f32(Math.pow(lightDistance, decay)), 0.01))
  return f32(f32(intensity) * falloff)
}


describe('the Sun\'s light', () => {
  it('falls off as the inverse square of the distance', () => {
    expect(SUN_LIGHT_DECAY).toBe(2)
    for (const au of [0.31, 0.72, 1, 5.3, 30.1]) {
      const d = au * AU
      expect(irradianceAt(2 * d) / irradianceAt(d)).toBeCloseTo(0.25, 12)
      expect(irradianceAt(d) / irradianceAt(AU)).toBeCloseTo(1 / (au * au), 12)
    }
  })

  it('is in lux: the Sun\'s illuminance at 1 AU, and a sunlit white is the eye\'s cd/m²', () => {
    expect(irradianceAt(AU)).toBeCloseTo(SUN_ILLUMINANCE_LUX, 6)
    expect(SUN_LUMINOUS_INTENSITY).toBeCloseTo(2.84e27, -25)
    // A white Lambertian surface facing the Sun at 1 AU, E/π cd/m², is
    // DISPLAY_GAIN exposure units at Earth's keyed exposure (eye.js).
    expect(irradianceAt(AU) / Math.PI).toBeCloseTo(DISPLAY_GAIN * EXPOSURE_UNIT_CD_M2, 6)
  })

  it('renders everything lit at 1 AU as the old falloff did', () => {
    // A lit surface, at its own keyed exposure and at Earth's.
    for (const albedo of [0.05, 0.37, 1]) {
      const was = oldIrradiance(AU) * albedo / Math.PI * oldExposureAt(AU)
      expect(irradianceAt(AU) * albedo / Math.PI * exposureAt(AU)).toBeCloseTo(was, 12)
    }
    // Earth's night lights (Planet.js, CesiumLayers), in exposure units.
    const nightWas = NIGHT_LIGHT_RADIANCE * oldIrradiance(AU) / Math.PI * oldExposureAt(AU)
    expect(nightLightRadiance() * exposureAt(AU)).toBeCloseTo(nightWas, 15)
    // The clouds (CloudShell), a white cloud facing the Sun.
    const cloudWas = CLOUD_WHITE * oldIrradiance(AU) / Math.PI * oldExposureAt(AU)
    expect(CLOUD_WHITE * irradianceAt(AU) / Math.PI * exposureAt(AU)).toBeCloseTo(cloudWas, 12)
    // The sky's scale and the absolute sources' (stars, the Milky Way, the
    // Sun's disc) at Earth's keyed exposure.
    expect(skyExposure(AU, exposureAt(AU))).toBeCloseTo(1, 12)
    expect(exposureRelative(exposureAt(AU))).toBeCloseTo(1, 12)
  })

  it('moves Earth and the Moon against each other by under 0.3%, and Earth\'s year by under 2%', () => {
    // The Moon is within 0.0026 AU of Earth: one's keyed exposure over the
    // other's, d² against d^1.01.
    for (const moonAu of [1.0026, 0.9974]) {
      const now = exposureAt(moonAu * AU) / exposureAt(AU)
      const was = oldExposureAt(moonAu * AU) / oldExposureAt(AU)
      expect(Math.abs(Math.log(now / was))).toBeLessThan(Math.log(1.003))
    }
    // Earth's keyed exposure over 1 AU's, which the stars and the Milky
    // Way scale by (exposureRelative): 0.967 at perihelion where it was
    // 0.983, 0.02 mag.
    for (const earthAu of [0.9833, 1.0167]) {
      const now = exposureRelative(exposureAt(earthAu * AU))
      const was = oldExposureAt(earthAu * AU) / oldExposureAt(AU)
      expect(now).toBeCloseTo(earthAu * earthAu, 12)
      expect(Math.abs(Math.log(now / was))).toBeLessThan(Math.log(1.02))
    }
  })

  it('puts bodies at other distances where the kludge had them wrong, in stops', () => {
    // Against a body at 1 AU, the old falloff over-lit a body at d by
    // (d/AU)^0.99 (#192): the planets' mean distances, and Jupiter's at the
    // occultation.
    const stops = (au) => Math.log2((oldIrradiance(au * AU) / oldIrradiance(AU)) / (irradianceAt(au * AU) / irradianceAt(AU)))
    const want = {0.387: -1.4, 0.723: -0.5, 1.524: 0.6, 5.3: 2.4, 9.54: 3.2, 19.19: 4.2, 30.07: 4.9}
    for (const [au, error] of Object.entries(want)) {
      expect(stops(Number(au))).toBeCloseTo(error, 1)
    }
    // From the Moon's keyed exposure Jupiter at 5.3 AU is lit at 1/28 of it.
    expect(exposureAt(5.3 * AU) / exposureAt(AU)).toBeCloseTo(28.09, 2)
  })
})


describe('the Sun\'s light at #192\'s date, against Horizons', () => {
  // planetPhotometry.horizons.json: each body's distance from the Sun at
  // 2026-10-06 09:00 UT (tools/photometry/fetchHorizons.mjs; offline).
  const entry = (body) => horizons.entries.find((e) => e.body === body && e.observer === 'geocentre')
  const moon = entry('moon')

  it('lights each planet against the Moon by the inverse square of their distances from the Sun', () => {
    for (const body of ['mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune']) {
      const {rAu} = entry(body)
      const ratio = irradianceAt(rAu * AU) / irradianceAt(moon.rAu * AU)
      expect(ratio).toBeCloseTo((moon.rAu / rAu) ** 2, 12)
      // From the Moon's keyed exposure, a sunlit white on the planet shows
      // at that share of DISPLAY_GAIN.
      expect(irradianceAt(rAu * AU) / Math.PI * exposureAt(moon.rAu * AU)).toBeCloseTo(DISPLAY_GAIN * ratio, 12)
    }
  })

  it('took the kludge\'s error out: Neptune was 4.85 stops bright against the Moon, Jupiter 2.4', () => {
    const stops = (body) => {
      const {rAu} = entry(body)
      const was = oldIrradiance(rAu * AU) / oldIrradiance(moon.rAu * AU)
      return Math.log2(was / (irradianceAt(rAu * AU) / irradianceAt(moon.rAu * AU)))
    }
    expect(stops('mercury')).toBeCloseTo(-1.12, 2)
    expect(stops('jupiter')).toBeCloseTo(2.39, 2)
    expect(stops('neptune')).toBeCloseTo(4.85, 2)
  })
})


describe('the Sun\'s light in float32', () => {
  it('would overflow float32 at the old irradiance at 1 AU, so it is in lux', () => {
    const keepOld = OLD_INTENSITY * Math.pow(AU, SUN_LIGHT_DECAY - OLD_DECAY)
    expect(keepOld).toBeGreaterThan(FLOAT32_MAX)
    expect(f32(keepOld)).toBe(Infinity)
    expect(Number.isFinite(f32(SUN_LUMINOUS_INTENSITY))).toBe(true)
    expect(SUN_LUMINOUS_INTENSITY).toBeLessThan(FLOAT32_MAX / 1e10)
  })

  it('lights a surface from Mercury\'s perihelion to Pluto\'s aphelion as doubles do', () => {
    // The light's vector in view space from a camera by the body: along a
    // diagonal, so every component is large.
    for (const au of [0.3075, 0.387, 1, 5.3, 30.07, 49.3, 1000]) {
      const d = au * AU
      const c = d / Math.sqrt(3)
      const e = shaderIrradiance([c, -c, c], SUN_LUMINOUS_INTENSITY, SUN_LIGHT_DECAY)
      expect(Number.isFinite(e)).toBe(true)
      expect(Math.abs((e / irradianceAt(d)) - 1)).toBeLessThan(1e-6)
      // And times an exposure keyed anywhere from Mercury to Pluto, and the
      // dark-adapted gain, into the buffer's range.
      expect(f32(e * f32(exposureAt(d)))).toBeCloseTo(DISPLAY_GAIN * Math.PI, 4)
    }
  })

  it('falls to zero, not NaN, past 2^64 m, where length() of the light\'s vector overflows first', () => {
    // A camera a light-year out still sees the Sun's light on a nearby
    // surface; past sqrt(FLT_MAX) the vector's length is Inf, and so would
    // be d^decay for any decay over 1.
    expect(shaderIrradiance([LIGHTYEAR_METER, 0, 0], SUN_LUMINOUS_INTENSITY, SUN_LIGHT_DECAY)).toBeGreaterThan(0)
    const past = 1.01 * FLOAT32_SQRT_MAX
    expect(shaderIrradiance([past, 0, 0], SUN_LUMINOUS_INTENSITY, SUN_LIGHT_DECAY)).toBe(0)
    expect(shaderIrradiance([past / Math.sqrt(2), past / Math.sqrt(2), 0], SUN_LUMINOUS_INTENSITY, SUN_LIGHT_DECAY)).toBe(0)
  })
})
