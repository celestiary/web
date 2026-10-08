// Unit tests for atmosphere parameter validation and planet atmosphere data.
import {readdirSync, readFileSync} from 'fs'
import {ASTRO_UNIT_METER, DISPLAY_GAIN} from '../../shared.js'
import {PHYSICAL_SKY_GAIN, exposureAt, skyExposure, skyGain} from '../exposure.js'
import {mieParams} from './AtmospherePrecompute.js'


/**
 * @returns {object}
 */
function loadPlanet(name) {
  return JSON.parse(readFileSync(`./public/data/${name}.json`, 'utf8'))
}

// Fields stored as Measure strings ("8e3 m") need scalar extraction in tests,
// since the test reads raw JSON without reification.
const scalar = (v) => typeof v === 'string' ? parseFloat(v) : v


/**
 * Cornette-Shanks, as MIE_PHASE_GLSL's csPhase.
 *
 * @param {number} mu cos(scattering angle)
 * @param {number} g asymmetry
 * @returns {number} per steradian
 */
function csPhase(mu, g) {
  const g2 = g * g
  return 3 / (8 * Math.PI) * ((1 - g2) * (1 + (mu * mu))) / ((2 + g2) * Math.pow(1 + g2 - (2 * g * mu), 1.5))
}


/**
 * A body's three-lobe Mie phase function in one channel (mieParams): the
 * narrow lobe's share f, and the broad lobes the rest.
 *
 * @param {object} atm raw atmosphere JSON
 * @param {number} c channel
 * @param {number} mu
 * @returns {number}
 */
function mars3Lobe(atm, c, mu) {
  const f = atm.miePeakWeight[c]
  const w = atm.mieForwardWeight
  return (f * csPhase(mu, atm.miePeakPolarity[c])) +
    ((1 - f) * ((w * csPhase(mu, atm.miePolarity[c])) + ((1 - w) * csPhase(mu, atm.mieBackPolarity))))
}


/**
 * @param {Function} phase of mu
 * @returns {{norm: number, meanCos: number}} its integral over the sphere,
 *   and its mean cosine; finely in angle near 0, where a narrow lobe is
 */
function integratePhase(phase) {
  let norm = 0
  let meanCos = 0
  const n = 200000
  for (let i = 0; i < n; i++) {
    // theta = pi u², fine at the forward peak
    const u0 = i / n
    const u1 = (i + 1) / n
    const t0 = Math.PI * u0 * u0
    const t1 = Math.PI * u1 * u1
    const t = 0.5 * (t0 + t1)
    const w = 2 * Math.PI * Math.sin(t) * (t1 - t0) * phase(Math.cos(t))
    norm += w
    meanCos += w * Math.cos(t)
  }
  return {norm, meanCos: meanCos / norm}
}

const REQUIRED_FIELDS = [
  'height',
  'rayleigh', 'rayleighScaleHeight',
  'mieCoeff', 'mieScaleHeight', 'miePolarity',
]


describe('atmosphere JSON data', () => {
  describe('earth', () => {
    const {atmosphere: atm} = loadPlanet('earth')

    it('has all required fields', () => {
      for (const f of REQUIRED_FIELDS) {
        expect(atm[f]).toBeDefined()
      }
    })

    it('rayleigh is an array of 3 positive numbers', () => {
      expect(atm.rayleigh).toHaveLength(3)
      for (const v of atm.rayleigh) {
        expect(v).toBeGreaterThan(0)
      }
    })

    it('scatters blue more than red (blue sky)', () => {
      // Rayleigh: [R, G, B] — Earth atmosphere scatters short wavelengths most
      expect(atm.rayleigh[2]).toBeGreaterThan(atm.rayleigh[0])
    })

    it('has plausible scale heights', () => {
      expect(scalar(atm.rayleighScaleHeight)).toBeGreaterThan(1000)
      expect(scalar(atm.rayleighScaleHeight)).toBeLessThan(20000)
      expect(scalar(atm.mieScaleHeight)).toBeGreaterThan(100)
      expect(scalar(atm.mieScaleHeight)).toBeLessThan(scalar(atm.rayleighScaleHeight))
    })

    it('atmosphere height is above scale height', () => {
      expect(scalar(atm.height)).toBeGreaterThan(scalar(atm.rayleighScaleHeight))
    })

    it('miePolarity is in valid Henyey-Greenstein range (-1, 1)', () => {
      expect(atm.miePolarity).toBeGreaterThan(-1)
      expect(atm.miePolarity).toBeLessThan(1)
    })
  })

  describe('mars', () => {
    const {atmosphere: atm} = loadPlanet('mars')

    it('has all required fields', () => {
      for (const f of REQUIRED_FIELDS) {
        expect(atm[f]).toBeDefined()
      }
    })

    it('rayleigh is an array of 3 positive numbers', () => {
      expect(atm.rayleigh).toHaveLength(3)
      for (const v of atm.rayleigh) {
        expect(v).toBeGreaterThan(0)
      }
    })

    it('scatters blue more than red, with a hundredth of Earth\'s air', () => {
      // Rayleigh: CO2 at 6 mbar, physical.  Mars's colour is its dust's
      // (mieAlbedo), not its gas's: the first data had a red-heavy
      // Rayleigh standing in for the butterscotch.
      const earth = loadPlanet('earth').atmosphere
      expect(atm.rayleigh[2]).toBeGreaterThan(atm.rayleigh[0])
      expect(atm.rayleigh[2]).toBeLessThan(earth.rayleigh[2] / 50)
    })

    it('has dust of optical depth about 0.5, mixed through the gas scale height', () => {
      // MSL and MER records: 0.3-1 outside storms (Lemmon et al. 2004, 2015).
      const tau = atm.mieCoeff * scalar(atm.mieScaleHeight)
      expect(tau).toBeGreaterThan(0.3)
      expect(tau).toBeLessThan(1)
      expect(scalar(atm.mieScaleHeight)).toBe(scalar(atm.rayleighScaleHeight))
    })

    it('has dust that absorbs blue more than red, and scatters it more sharply forward', () => {
      // Single-scattering albedo 0.83-0.90 in the blue, 0.92-0.96 in the red
      // (Tomasko et al. 1999; Wolff et al. 2009); the forward lobes sharper
      // in the blue, the bluish aureole round the Sun.
      expect(atm.mieAlbedo[0]).toBeGreaterThan(atm.mieAlbedo[2])
      for (const w of atm.mieAlbedo) {
        expect(w).toBeGreaterThan(0.8)
        expect(w).toBeLessThan(1)
      }
      expect(atm.miePeakPolarity[2]).toBeGreaterThan(atm.miePeakPolarity[0])
      expect(atm.miePolarity[2]).toBeGreaterThan(atm.miePolarity[0])
      // A back lobe, kept: the broad lobes are a forward and a backward one.
      expect(atm.mieBackPolarity).toBeLessThan(0)
      expect(atm.mieForwardWeight).toBeGreaterThan(0.5)
      expect(atm.mieForwardWeight).toBeLessThan(1)
    })

    it('has a narrow forward lobe, the diffraction peak of micron grains (#188)', () => {
      // Fitted to Mie scattering for r_eff 1.5 µm (composition.md, "The
      // dust's forward peak"): a lobe a few degrees wide, and about half the
      // extinction, as diffraction is for grains much larger than the
      // wavelength (its share of the scattering times the albedo, 0.5).
      for (let c = 0; c < 3; c++) {
        expect(atm.miePeakPolarity[c]).toBeGreaterThan(0.9)
        expect(atm.miePeakPolarity[c]).toBeLessThan(0.97)
        expect(atm.miePeakPolarity[c]).toBeGreaterThan(atm.miePolarity[c])
        expect(atm.miePeakWeight[c] * atm.mieAlbedo[c]).toBeGreaterThan(0.45)
        expect(atm.miePeakWeight[c] * atm.mieAlbedo[c]).toBeLessThan(0.55)
      }
    })

    it('has the measured mean cosine, 0.6-0.7, per channel, rising to the blue', () => {
      // Tomasko et al. 1999; Pollack et al. 1995.  Spheres of the fitted
      // size give 0.73-0.78; the grains' irregular shapes scatter more to
      // the side.  The phase function integrates to 1.
      const means = [0, 1, 2].map((c) => {
        const {norm, meanCos} = integratePhase((mu) => mars3Lobe(atm, c, mu))
        expect(norm).toBeCloseTo(1, 3)
        expect(meanCos).toBeGreaterThan(0.6)
        expect(meanCos).toBeLessThan(0.7005)
        return meanCos
      })
      expect(means[2]).toBeGreaterThan(means[1])
      expect(means[1]).toBeGreaterThan(means[0])
    })

    it('has higher Mie coefficient than Earth (more dust)', () => {
      const earth = loadPlanet('earth').atmosphere
      expect(atm.mieCoeff).toBeGreaterThan(earth.mieCoeff)
    })

    it('miePolarity is in valid Henyey-Greenstein range (-1, 1), per channel', () => {
      for (const g of atm.miePolarity) {
        expect(g).toBeGreaterThan(-1)
        expect(g).toBeLessThan(1)
      }
    })

    it('takes the physical single-scattering gain', () => {
      // π·DISPLAY_GAIN (HDR.md): the sky's brightness is the dust's, not a
      // gain's.
      expect(skyGain(atm)).toBe(PHYSICAL_SKY_GAIN)
    })
  })
})


describe('the sky gain', () => {
  // Every body descriptor with an atmosphere (some data files aren't
  // plain JSON).
  const bodies = readdirSync('./public/data')
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try {
          return JSON.parse(readFileSync(`./public/data/${f}`, 'utf8'))
        } catch {
          return null
        }
      })
      .filter((b) => b?.atmosphere)

  it('is the physical single-scattering gain, π·DISPLAY_GAIN', () => {
    expect(PHYSICAL_SKY_GAIN).toBe(Math.PI * DISPLAY_GAIN)
    expect(PHYSICAL_SKY_GAIN).toBeCloseTo(4.71, 2)
  })

  it('is relative to the body\'s own sunlight, so the same at any distance from the Sun', () => {
    // The sky in exposure units is gain × in-scatter × skyExposure, and
    // skyExposure is 1 at a body's keyed exposure from Mercury to Pluto:
    // the distance falloff is the irradiance's, counted once.
    for (const au of [0.39, 1, 1.52, 5.2, 9.5, 19.2, 30.1, 39.5]) {
      const d = au * ASTRO_UNIT_METER
      expect(skyExposure(d, exposureAt(d))).toBeCloseTo(1, 12)
    }
  })

  it('is the physical gain for every body but Earth, whose data stands in for its aerosols', () => {
    // #55's gains fell with distance (Jupiter 6, Saturn 4, Uranus 2.8,
    // Neptune 2.2, Titan 1.0, Pluto 0.7, Triton 0.6), from when the gain was
    // the Sun's light at the body; since the sky took the body's irradiance
    // (#86's PR A) they counted the falloff twice.  Only a documented
    // reason may set a body's gain (composition.md, "Per-body data").
    expect(bodies.length).toBeGreaterThan(8)
    for (const body of bodies) {
      if (body.name === 'earth') {
        continue
      }
      expect({name: body.name, gain: skyGain(body.atmosphere)})
          .toEqual({name: body.name, gain: PHYSICAL_SKY_GAIN})
    }
    // Earth's: 4.5 times physical, matched to Cesium's Earth over the same
    // imagery and re-fitted when multiple scattering went in (Planet.md).
    const earth = bodies.find((b) => b.name === 'earth')
    expect(earth.atmosphere.sunIntensity).toBe(21)
  })

  it('leaves Titan\'s haze to absorb, most in the blue, where its gain of 1 stood in for it', () => {
    // Titan's τ ≈ 8 of conservative haze at the physical gain was a white
    // disc at I/F 0.59; Huygens DISR's haze absorbs (Tomasko et al. 2008),
    // and with it the disc is 0.24 and orange (composition.md, "Per-body
    // data").
    const {atmosphere: atm} = loadPlanet('titan')
    expect(atm.mieAlbedo).toHaveLength(3)
    expect(atm.mieAlbedo[0]).toBeGreaterThan(atm.mieAlbedo[1])
    expect(atm.mieAlbedo[1]).toBeGreaterThan(atm.mieAlbedo[2])
    for (const w of atm.mieAlbedo) {
      expect(w).toBeGreaterThan(0.7)
      expect(w).toBeLessThan(1)
    }
  })
})


describe('mieParams', () => {
  it('gives a body with no narrow lobe none, so its delta-M scaling is 1 (Earth unchanged)', () => {
    const mie = mieParams(loadPlanet('earth').atmosphere)
    expect(mie.peakWeight.toArray()).toEqual([0, 0, 0])
    expect(mie.peakPolarity.toArray()).toEqual([0, 0, 0])
    expect(mie.forwardWeight).toBe(1)
  })

  it('reads Mars\'s narrow lobe per channel', () => {
    const atm = loadPlanet('mars').atmosphere
    const mie = mieParams(atm)
    expect(mie.peakWeight.toArray()).toEqual(atm.miePeakWeight)
    expect(mie.peakPolarity.toArray()).toEqual(atm.miePeakPolarity)
  })
})


describe('the blocked Sun', () => {
  // The "Sun behind the planet" sentinel is a density-weighted path in
  // metres; it must drive exp(-k·path) to nothing for the smallest
  // coefficient, Earth's Rayleigh red (5.8e-6 /m).  At 1e6 m, 0.3% of the
  // Sun came through every blocked step and the metered exposure showed a
  // red sky with the Sun 35° under the horizon (HDR.md).
  for (const file of ['AtmospherePrecompute.js', 'Atmosphere.js']) {
    it(`${file} blocks the Sun for any coefficient over 1e-8 /m`, () => {
      const source = readFileSync(`./js/scene/atmos/${file}`, 'utf8')
      const sentinels = [...source.matchAll(/jOd = vec2\(([0-9.e]+)/g)].map((m) => Number(m[1]))
      expect(sentinels.length).toBeGreaterThan(0)
      for (const path of sentinels) {
        expect(Math.exp(-1e-8 * path)).toBeLessThan(1e-40)
      }
    })
  }
})
