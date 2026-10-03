// Unit tests for atmosphere parameter validation and planet atmosphere data.
import {readFileSync} from 'fs'


/**
 * @returns {object}
 */
function loadPlanet(name) {
  return JSON.parse(readFileSync(`./public/data/${name}.json`, 'utf8'))
}

// Fields stored as Measure strings ("8e3 m") need scalar extraction in tests,
// since the test reads raw JSON without reification.
const scalar = (v) => typeof v === 'string' ? parseFloat(v) : v

const REQUIRED_FIELDS = [
  'height', 'sunIntensity',
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
      // (Tomasko et al. 1999; Wolff et al. 2009); the forward lobe sharper
      // in the blue, the bluish aureole round the Sun.
      expect(atm.mieAlbedo[0]).toBeGreaterThan(atm.mieAlbedo[2])
      for (const w of atm.mieAlbedo) {
        expect(w).toBeGreaterThan(0.8)
        expect(w).toBeLessThan(1)
      }
      expect(atm.miePolarity[2]).toBeGreaterThan(atm.miePolarity[0])
      expect(atm.mieBackPolarity).toBeLessThan(0)
      expect(atm.mieForwardWeight).toBeGreaterThan(0.8)
      expect(atm.mieForwardWeight).toBeLessThan(1)
    })

    it('has higher Mie coefficient than Earth (more dust)', () => {
      const earth = loadPlanet('earth').atmosphere
      expect(atm.mieCoeff).toBeGreaterThan(earth.mieCoeff)
    })

    it('sun is dimmer than Earth (greater orbital distance)', () => {
      const earth = loadPlanet('earth').atmosphere
      expect(atm.sunIntensity).toBeLessThan(earth.sunIntensity)
    })

    it('miePolarity is in valid Henyey-Greenstein range (-1, 1), per channel', () => {
      for (const g of atm.miePolarity) {
        expect(g).toBeGreaterThan(-1)
        expect(g).toBeLessThan(1)
      }
    })

    it('sun intensity is the physical single-scattering gain', () => {
      // π·DISPLAY_GAIN (HDR.md): the sky's brightness is the dust's, not a
      // gain's.
      expect(atm.sunIntensity).toBeCloseTo(Math.PI * 1.5, 1)
    })
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
