import {describe, expect, it} from 'bun:test'
import {
  LUNAR_PHOTOMETRY_GLSL,
  MOON_GEOMETRIC_ALBEDO,
  MOON_HIGHLAND_STORED,
  MOON_TEXTURE_GAIN,
  PHASE_HOLD,
  discIntegral,
  earthshineFraction,
  lambertIntegral,
  limbParameter,
  lommelSeeligerIntegral,
  lunarHighlight,
  lunarPeakReflectance,
  lunarReflectance,
  moonMagnitude,
  moonPhaseMagnitude,
  phaseFunction,
  surfaceBrightness,
} from './lunarPhotometry.js'
import {CESIUM_BODIES} from './cesium/bodies.js'
import horizons from './lunarPhotometry.horizons.json'
import moonProps from '../../public/data/moon.json'


const toRad = Math.PI / 180
const mag = (x) => -2.5 * Math.log10(x)


describe('the disc integrals f(α) is fitted with', () => {
  it('Lommel-Seeliger\'s and Lambert\'s closed forms are the summed disc\'s, to 0.5%', () => {
    for (const deg of [10, 45, 90, 127.5, 150]) {
      const a = deg * toRad
      const s = [Math.sin(a), Math.cos(a)]
      let ls = 0
      let lam = 0
      const n = 600
      for (let j = 0; j < n; j++) {
        const y = -1 + ((2 * (j + 0.5)) / n)
        for (let i = 0; i < n; i++) {
          const x = -1 + ((2 * (i + 0.5)) / n)
          const r2 = (x * x) + (y * y)
          if (r2 < 1) {
            const z = Math.sqrt(1 - r2)
            const mu0 = (x * s[0]) + (z * s[1])
            if (mu0 > 0) {
              ls += 2 * mu0 / (mu0 + z)
              lam += mu0
            }
          }
        }
      }
      const area = ((2 / n) ** 2) / Math.PI
      expect(ls * area / lommelSeeligerIntegral(a)).toBeCloseTo(1, 2)
      expect(lam * area / ((2 / 3) * lambertIntegral(a))).toBeCloseTo(1, 2)
    }
  })
})


describe('the Moon\'s phase curve', () => {
  it('its geometric albedo is Horizons\' V(1, 0) = 0.23: 0.121', () => {
    expect(MOON_GEOMETRIC_ALBEDO).toBeCloseTo(0.121, 3)
    expect(discIntegral(0, MOON_GEOMETRIC_ALBEDO)).toBeCloseTo(MOON_GEOMETRIC_ALBEDO, 3)
  })

  it('the disc summed by the photometric function is Horizons\' law to 0.02 mag, 0-160°', () => {
    for (let deg = 0; deg <= 160; deg += 10) {
      const a = deg * toRad
      expect(Math.abs(mag(discIntegral(a)) - moonPhaseMagnitude(a))).toBeLessThan(0.02)
    }
  })

  it('and Horizons\' APmag over a lunation, reduced to 1 AU, to 0.1 mag at every phase it lists to 160°', () => {
    let worst = 0
    for (const {apmag, r, delta, phase} of horizons.phaseCurve.rows) {
      if (phase > 160) {
        continue
      }
      const v1 = apmag - (5 * Math.log10(r * delta))
      const model = 0.23 + mag(discIntegral(phase * toRad, 1, 200))
      worst = Math.max(worst, Math.abs(model - v1))
    }
    expect(worst).toBeLessThan(0.1)
  })

  it('is Lambert\'s phase law ×4.2 bright at #192\'s crescent, and the model fixes that', () => {
    const a = 127.5 * toRad
    const real = Math.pow(10, -0.4 * moonPhaseMagnitude(a))
    expect(real).toBeCloseTo(0.0178, 3)
    expect(lambertIntegral(a) / real).toBeGreaterThan(4)
    expect(discIntegral(a) / real).toBeCloseTo(1, 1)
  })

  it('is held past 160°, where the law is an extrapolation', () => {
    expect(phaseFunction(170 * toRad)).toBe(phaseFunction(PHASE_HOLD))
    expect(Number.isFinite(phaseFunction(Math.PI))).toBe(true)
  })
})


describe('the disc, resolved', () => {
  it('is flat at full: no limb darkening (Lambert would go to 0 at the limb)', () => {
    const centre = lunarReflectance(1, 1, 0)
    for (const mu of [0.8, 0.5, 0.2, 0.05]) {
      expect(lunarReflectance(mu, mu, 0)).toBeCloseTo(centre, 9)
    }
  })

  it('brightens toward the bright limb at partial phase', () => {
    const a = 45 * toRad
    // In the phase plane, from the sub-observer point toward the Sun (θ).
    const at = (deg) => lunarReflectance(Math.cos(a - (deg * toRad)), Math.cos(deg * toRad), a)
    expect(at(85)).toBeGreaterThan(at(0))
    expect(limbParameter(a)).toBeGreaterThan(0.4)
  })

  it('falls off to nothing at the terminator, monotonically', () => {
    for (const deg of [30, 90, 127.5]) {
      const a = deg * toRad
      let last = Infinity
      for (let mu0 = 0.5; mu0 >= 0; mu0 -= 0.05) {
        const v = lunarReflectance(mu0, 0.7, a)
        expect(v).toBeLessThanOrEqual(last + 1e-12)
        last = v
      }
      expect(lunarReflectance(0, 0.7, a)).toBe(0)
      expect(lunarReflectance(-0.1, 0.7, a)).toBe(0)
    }
  })

  it('L(α) is McEwen\'s: 1 at full, ~0.6 at 30°, 0 from 104°', () => {
    expect(limbParameter(0)).toBe(1)
    expect(limbParameter(30 * toRad)).toBeCloseTo(0.608, 3)
    expect(limbParameter(110 * toRad)).toBe(0)
  })

  it('its brightest point, the limb\'s last 3% left out: 1 at full, 0.40 at quarter, 0.22 at #192\'s crescent', () => {
    expect(lunarPeakReflectance(0)).toBeCloseTo(1, 6)
    expect(lunarPeakReflectance(90 * toRad)).toBeCloseTo(0.405, 2)
    expect(lunarPeakReflectance(127.5 * toRad)).toBeCloseTo(0.217, 2)
  })

  it('the meter\'s highlight: the highlands\' I/F there, 0.16 at full and 0.035 at the crescent', () => {
    expect(MOON_HIGHLAND_STORED * MOON_TEXTURE_GAIN).toBeCloseTo(0.163, 3)
    expect(lunarHighlight(0)).toBeCloseTo(0.163, 3)
    expect(lunarHighlight(127.5 * toRad)).toBeCloseTo(0.035, 3)
  })
})


describe('#192\'s view against Horizons (Bay Village, 2026-10-06 09:23 UT)', () => {
  const ev = horizons.event
  const a = ev.phase * toRad

  it('the Moon\'s magnitude, −8.42', () => {
    expect(moonMagnitude(a, ev.r, ev.delta)).toBeCloseTo(ev.apmag, 1)
  })

  it('the lit part\'s mean surface brightness, 5.97 mag/arcsec²: the disc\'s light over its lit share', () => {
    const lit = ev.illuminated / 100
    const iOverF = discIntegral(a, MOON_GEOMETRIC_ALBEDO) / lit
    expect(Math.abs(surfaceBrightness(iOverF, ev.r) - ev.sbrt)).toBeLessThan(0.05)
  })

  it('earthshine on the night side, 13.8-14.4 mag/arcsec² (HDR.md): Earth\'s light at its phase, seen at ~0°', () => {
    // Earth from the Moon at 180° − 127.5° = 52.5° (the Moon's phase is the
    // supplement of Earth's, the two nearly in line with the Sun).
    const shine = earthshineFraction(52.5 * toRad, ev.delta * 1.495978707e11)
    expect(shine).toBeCloseTo(6.9e-5, 5)
    // An earthlit point seen from Earth: incidence ~ emission, α ~ 1°.
    const iOverF = MOON_GEOMETRIC_ALBEDO * shine * lunarReflectance(0.6, 0.6, 1 * toRad)
    const s = surfaceBrightness(iOverF, ev.r)
    expect(s).toBeGreaterThan(13.6)
    expect(s).toBeLessThan(14.4)
  })

  it('a V 8.4 star\'s peak in celestiary\'s kernel (σ 1.35″, 1.8″ pixels) is ~1/100 of the lit mean', () => {
    const lit = discIntegral(a, MOON_GEOMETRIC_ALBEDO) / (ev.illuminated / 100)
    const litS = surfaceBrightness(lit, ev.r)
    const sigma = 1.35
    const pixel = 1.8
    const peakS = 8.4 - (2.5 * Math.log10(1 / (2 * Math.PI * sigma * sigma)))
    const ratio = Math.pow(10, -0.4 * (peakS - litS))
    expect(1 / ratio).toBeGreaterThan(80)
    expect(1 / ratio).toBeLessThan(130)
    expect(pixel).toBeGreaterThan(sigma)
  })
})


describe('the colour map\'s scale', () => {
  it('moon.json\'s texture_gain and Cesium\'s textureGain are the albedo scale', () => {
    expect(MOON_TEXTURE_GAIN).toBeCloseTo(0.445, 3)
    expect(moonProps.texture_gain).toBeCloseTo(MOON_TEXTURE_GAIN, 3)
    expect(CESIUM_BODIES.moon.textureGain).toBe(moonProps.texture_gain)
    expect(moonProps.photometry).toBe('lunar')
  })
})


describe('the GLSL', () => {
  // Replays the shader's arithmetic in JS (float64; its constants and
  // order), against the JS function.
  const glslReflectance = (mu0, mu, cosAlpha) => {
    if (mu0 <= 0) {
      return 0
    }
    const alpha = Math.acos(Math.min(Math.max(cosAlpha, -1), 1))
    const al = Math.min(Math.max(alpha, 1e-4), PHASE_HOLD)
    const lp = (x) => Math.min(Math.max(1 + (x * (-0.019 + (x * (2.42e-4 - (1.46e-6 * x))))), 0), 1)
    const a = al * 180 / Math.PI
    const l = lp(a)
    const h = 0.5 * al
    const ls = 1 - (Math.sin(h) * Math.tan(h) * Math.log(1 / Math.tan(0.5 * h)))
    const lam = (Math.sin(al) + ((Math.PI - al) * Math.cos(al))) / Math.PI
    const dv = (0.026 * a) + (4e-9 * a * a * a * a)
    const f = Math.pow(2, -0.4 * 3.321928095 * dv) / ((l * ls) + ((1 - l) * (2 / 3) * lam))
    const l2 = lp(alpha * 180 / Math.PI)
    return f * ((2 * l2 * mu0 / Math.max(mu0 + Math.max(mu, 0), 1e-6)) + ((1 - l2) * mu0))
  }

  it('is the JS function', () => {
    for (const deg of [0.5, 10, 60, 127.5, 150]) {
      const a = deg * toRad
      for (const [mu0, mu] of [[0.9, 0.9], [0.3, 0.8], [0.7, 0.05]]) {
        expect(glslReflectance(mu0, mu, Math.cos(a))).toBeCloseTo(lunarReflectance(mu0, mu, a), 5)
      }
    }
  })

  it('carries the same constants, and no GLSL reserved word or host-specific name', () => {
    expect(LUNAR_PHOTOMETRY_GLSL).toContain('-0.019 + a * (2.42e-4 - 1.46e-6 * a)')
    expect(LUNAR_PHOTOMETRY_GLSL).toContain('0.026 * a + 4e-9 * a2 * a2')
    expect(LUNAR_PHOTOMETRY_GLSL).not.toMatch(/\b(half|fixed|double|long|short|input|output|sizeof)\b/)
    expect(LUNAR_PHOTOMETRY_GLSL).not.toMatch(/\bPI\b|czm_/)
  })
})
