import {readFileSync} from 'node:fs'
import {describe, expect, it} from 'bun:test'
import {
  BLACKBODY_LUT_SIZE,
  SUN_TEFF,
  blackbodyColor,
  blackbodyFromLut,
  blackbodyLuminance,
  blackbodyLut,
  blackbodyXyz,
  bolometricCorrectionV,
  deJager,
  granulationContrast,
  granulesPerRadius,
  greyIntensity,
  limbDarkening,
  luminanceSlope,
  lutTemperature,
  powerTwo,
  powerTwoMean,
  spectralTypeName,
  starTeff,
  stefanBoltzmannRatio,
  teffFromClass,
  umbraDeltaT,
} from './stellar.js'


/**
 * @param {number} temp
 * @returns {Array<number>} The blackbody's CIE 1931 chromaticity x, y
 */
function chromaticity(temp) {
  const [x, y, z] = blackbodyXyz(temp)
  return [x / (x + y + z), y / (x + y + z)]
}


/**
 * The Planckian locus's cubic-spline approximation, Kim et al. 2002 (IEEE
 * Trans. Consumer Electronics 48, 4), an independent published fit, valid
 * from 1,667 K to 25,000 K.
 *
 * @param {number} t K
 * @returns {Array<number>} x, y
 */
function kimLocus(t) {
  const x = t <= 4000 ?
    (-0.2661239e9 / (t ** 3)) - (0.2343589e6 / (t ** 2)) + (0.8776956e3 / t) + 0.179910 :
    (-3.0258469e9 / (t ** 3)) + (2.1070379e6 / (t ** 2)) + (0.2226347e3 / t) + 0.240390
  let y
  if (t <= 2222) {
    y = (-1.1063814 * (x ** 3)) - (1.34811020 * (x ** 2)) + (2.18555832 * x) - 0.20219683
  } else if (t <= 4000) {
    y = (-0.9549476 * (x ** 3)) - (1.37418593 * (x ** 2)) + (2.09137015 * x) - 0.16748867
  } else {
    y = (3.0817580 * (x ** 3)) - (5.87338670 * (x ** 2)) + (3.75112997 * x) - 0.37001483
  }
  return [x, y]
}


describe('the blackbody colour', () => {
  it('is CIE illuminant A at 2,856 K', () => {
    // Illuminant A is a blackbody of 2,856 K (CIE 15:2004): x 0.44757, y 0.40745.
    const [x, y] = chromaticity(2856)
    expect(Math.abs(x - 0.44757)).toBeLessThan(0.002)
    expect(Math.abs(y - 0.40745)).toBeLessThan(0.002)
  })

  it('follows the Planckian locus (Kim et al. 2002) to 0.004 in x and y', () => {
    for (const t of [1667, 2000, 2500, 3000, 4000, 5000, 5772, 6500, 8000, 10000, 15000, 25000]) {
      const [x, y] = chromaticity(t)
      const [kx, ky] = kimLocus(t)
      expect(Math.abs(x - kx)).toBeLessThan(0.004)
      expect(Math.abs(y - ky)).toBeLessThan(0.004)
    }
  })

  it('is white near 6,500 K (sRGB\'s D65 white), warm for the Sun, red for M stars, blue for B stars', () => {
    const near = blackbodyColor(6504)
    for (const c of near) {
      expect(c).toBeGreaterThan(0.95)
      expect(c).toBeLessThan(1.06)
    }
    const [r, g, b] = blackbodyColor(SUN_TEFF)
    expect(r).toBeGreaterThan(g)
    expect(g).toBeGreaterThan(b)
    const m = blackbodyColor(3000)
    expect(m[0] / m[2]).toBeGreaterThan(5)
    const hot = blackbodyColor(20000)
    expect(hot[2] / hot[0]).toBeGreaterThan(2)
  })

  it('has a luminance of 1, and no negative channel', () => {
    for (const t of [1000, 2000, 3000, 5772, 10000, 50000]) {
      const [r, g, b] = blackbodyColor(t)
      expect(Math.min(r, g, b)).toBeGreaterThanOrEqual(0)
      const y = (0.2126729 * r) + (0.7151522 * g) + (0.0721750 * b)
      // A clipped negative channel (the coolest stars' blue) lifts it a little.
      expect(Math.abs(y - 1)).toBeLessThan(t < 2000 ? 0.02 : 1e-3)
    }
  })

  it('the table, interpolated as the shader does, is within 1% of the function', () => {
    const lut = blackbodyLut()
    expect(lut.length).toBe(BLACKBODY_LUT_SIZE * 4)
    expect(lutTemperature(0)).toBeCloseTo(1000, 6)
    expect(lutTemperature(BLACKBODY_LUT_SIZE - 1)).toBeCloseTo(50000, 3)
    for (let t = 1100; t < 50000; t *= 1.13) {
      const [r, g, b, log2Y] = blackbodyFromLut(lut, t)
      const exact = blackbodyColor(t)
      for (const [k, c] of [r, g, b].entries()) {
        expect(Math.abs(c - exact[k])).toBeLessThan(0.01 * Math.max(exact[k], 0.3))
      }
      expect(Math.abs(((2 ** log2Y) / blackbodyLuminance(t)) - 1)).toBeLessThan(0.01)
    }
  })
})


describe('a disc\'s surface brightness', () => {
  it('is the Sun\'s at the Sun\'s temperature, and its luminance, not σT⁴, elsewhere', () => {
    expect(blackbodyLuminance(SUN_TEFF)).toBeCloseTo(1, 9)
    expect(stefanBoltzmannRatio(SUN_TEFF)).toBeCloseTo(1, 9)
    // A cool star puts most of its light in the infrared, a hot one in the UV.
    expect(blackbodyLuminance(3000)).toBeLessThan(stefanBoltzmannRatio(3000) / 3)
    expect(blackbodyLuminance(20000)).toBeLessThan(stefanBoltzmannRatio(20000) / 3)
    expect(blackbodyLuminance(20000)).toBeGreaterThan(20)
  })

  it('a temperature change is a larger luminance change in a cool star', () => {
    expect(luminanceSlope(SUN_TEFF)).toBeGreaterThan(4)
    expect(luminanceSlope(SUN_TEFF)).toBeLessThan(5)
    expect(luminanceSlope(3000)).toBeGreaterThan(luminanceSlope(SUN_TEFF))
    expect(luminanceSlope(20000)).toBeLessThan(2)
  })
})


describe('the temperature from the spectral class', () => {
  // The catalogue's indices: type O=0 ... M=6; lumClass Ia0=0, Ia=1, Ib=2, II=3, III=4, IV=5, V=6, unknown=8.
  const cls = (spectralType, sub, lumClass) => ({kind: 0, spectralType, sub, lumClass})

  it('reproduces de Jager & Nieuwenhuijzen\'s K0 V (log Teff 3.712)', () => {
    expect(Math.log10(deJager('K', 0, 5).teff)).toBeCloseTo(3.712, 1)
    expect(Math.abs(Math.log10(deJager('K', 0, 5).teff) - 3.712)).toBeLessThan(0.02)
  })

  it('is within 8% of measured stars of known class', () => {
    // [type, sub, lumClass, measured Teff, source]
    const stars = [
      [4, 2, 6, 5772, 'Sun, G2 V (IAU 2015 B3)'],
      [2, 1, 6, 9845, 'Sirius A, A1 V (Davis et al. 2011)'],
      [2, 0, 6, 9600, 'Vega, A0 V (mean; Yoon et al. 2010: 8,152-10,060)'],
      [6, 5, 6, 2980, 'Proxima Cen, M5.5 V (Ribas et al. 2017)'],
      [6, 2, 1, 3600, 'Betelgeuse, M2 Ia (Levesque & Massey 2020)'],
      [5, 1, 4, 4286, 'Arcturus, K1.5 III (Ramirez & Allende Prieto 2011)'],
      [1, 8, 1, 12100, 'Rigel, B8 Ia (Przybilla et al. 2006)'],
    ]
    for (const [type, sub, lum, measured] of stars) {
      const t = teffFromClass(cls(type, sub, lum))
      expect(Math.abs((t / measured) - 1)).toBeLessThan(0.08)
    }
  })

  it('falls from O to M, and a giant is cooler than a dwarf of its type', () => {
    let last = Infinity
    for (let type = 0; type <= 6; type++) {
      for (const sub of [0, 5]) {
        const t = teffFromClass(cls(type, sub, 6))
        expect(t).toBeLessThan(last)
        last = t
      }
    }
    expect(teffFromClass(cls(5, 0, 4))).toBeLessThan(teffFromClass(cls(5, 0, 6)))
  })

  it('takes an unknown subclass as 5 and an unknown luminosity class as V', () => {
    expect(teffFromClass(cls(4, 10, 6))).toBeCloseTo(teffFromClass(cls(4, 5, 6)), 6)
    expect(teffFromClass(cls(2, 0, 8))).toBeCloseTo(teffFromClass(cls(2, 0, 6)), 6)
  })

  it('has a temperature for every class the catalogue holds', () => {
    for (let type = 0; type < 16; type++) {
      for (let sub = 0; sub <= 10; sub++) {
        for (const lum of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
          const t = teffFromClass(cls(type, sub, lum))
          expect(t).toBeGreaterThanOrEqual(500)
          expect(t).toBeLessThanOrEqual(50000)
        }
      }
    }
    // White dwarfs: 50,400 K / subclass.
    expect(teffFromClass({kind: 1, spectralType: 0, sub: 2, lumClass: 8})).toBeCloseTo(25200, 6)
    expect(teffFromClass({kind: 1, spectralType: 0, sub: 10, lumClass: 8})).toBe(10000)
  })

  it('gives the Sun its own, a body file\'s string indices a class, and props a measured one', () => {
    expect(starTeff({name: 'sun', spectralType: '4'})).toBe(SUN_TEFF)
    expect(starTeff({hipId: 0, spectralType: 4, sub: 2, lumClass: 6})).toBe(SUN_TEFF)
    expect(starTeff({spectralType: '6', sub: '5', lumClass: '6'})).toBeLessThan(3200)
    expect(starTeff({teff: 4000, spectralType: 2})).toBe(4000)
  })

  it('names the class', () => {
    expect(spectralTypeName({spectralType: 4, sub: 2, lumClass: 6})).toBe('G2 V')
    expect(spectralTypeName({spectralType: 6, sub: 2, lumClass: 2})).toBe('M2 Ib')
    expect(spectralTypeName({spectralType: 2, sub: 0, lumClass: 8})).toBe('A0')
    expect(spectralTypeName({spectralType: '4'})).toBe('G')
    expect(spectralTypeName({kind: 1, spectralType: 0, sub: 3, lumClass: 8})).toBe('DA3')
    expect(spectralTypeName({})).toBe('?')
  })
})


describe('the bolometric correction (Flower 1996, Torres 2010)', () => {
  it('is the Sun\'s -0.08 at its temperature, near 0 for F stars, large for hot and cool stars', () => {
    expect(bolometricCorrectionV(SUN_TEFF)).toBeCloseTo(-0.08, 1)
    expect(Math.abs(bolometricCorrectionV(7000))).toBeLessThan(0.1)
    expect(bolometricCorrectionV(3600)).toBeLessThan(-1.5)
    expect(bolometricCorrectionV(30000)).toBeLessThan(-2.5)
  })

  it('is finite and held at its cool limit', () => {
    expect(bolometricCorrectionV(2000)).toBeCloseTo(bolometricCorrectionV(3000), 9)
    expect(Number.isFinite(bolometricCorrectionV(NaN))).toBe(true)
  })
})


describe('the limb darkening', () => {
  it('the power-2 law is 1 at the centre and 1 - c at the limb, and its mean is its integral', () => {
    expect(powerTwo(1, 0.6, 0.7)).toBeCloseTo(1, 12)
    expect(powerTwo(0, 0.6, 0.7)).toBeCloseTo(0.4, 12)
    let sum = 0
    const n = 20000
    for (let i = 0; i < n; i++) {
      const mu = (i + 0.5) / n
      sum += powerTwo(mu, 0.6, 0.7) * 2 * mu / n
    }
    expect(powerTwoMean(0.6, 0.7)).toBeCloseTo(sum, 6)
  })

  it('a grey atmosphere\'s bolometric limb is Eddington\'s 0.4 of its centre', () => {
    // Integrated over wavelength the grey atmosphere is (2 + 3μ)/5 (Eddington).
    const bolometric = (mu) => {
      let sum = 0
      for (let nm = 100; nm < 100000; nm *= 1.01) {
        sum += greyIntensity(nm, SUN_TEFF, mu) * nm
      }
      return sum
    }
    expect(bolometric(0) / bolometric(1)).toBeCloseTo(0.4, 2)
    expect(bolometric(0.5) / bolometric(1)).toBeCloseTo(0.7, 2)
  })

  it('the Sun\'s limb is darker in blue than in red, as observed', () => {
    const {c, alpha, mean} = limbDarkening(SUN_TEFF)
    const limb = c.map((ck) => 1 - ck)
    // The Sun's limb in the visible is ~0.3-0.45 of its centre (Neckel & Labs 1994).
    expect(limb[0]).toBeGreaterThan(0.3)
    expect(limb[0]).toBeLessThan(0.5)
    expect(limb[2]).toBeGreaterThan(0.2)
    expect(limb[0]).toBeGreaterThan(limb[1])
    expect(limb[1]).toBeGreaterThan(limb[2])
    for (let k = 0; k < 3; k++) {
      expect(alpha[k]).toBeGreaterThan(0)
      expect(mean[k]).toBeCloseTo(powerTwoMean(c[k], alpha[k]), 12)
      // The fit is exact at μ = 1/2.
      expect(powerTwo(0.5, c[k], alpha[k])).toBeGreaterThan(0.55)
    }
  })

  it('cool stars\' limbs are darker than hot stars\'', () => {
    const limbAt = (t) => 1 - limbDarkening(t).c[1]
    expect(limbAt(3500)).toBeLessThan(limbAt(SUN_TEFF))
    expect(limbAt(SUN_TEFF)).toBeLessThan(limbAt(10000))
  })
})


describe('the surface structure', () => {
  it('granulation peaks in F stars and is gone in A stars', () => {
    expect(granulationContrast(SUN_TEFF)).toBeCloseTo(0.15, 6)
    expect(granulationContrast(6500)).toBeGreaterThan(granulationContrast(SUN_TEFF))
    expect(granulationContrast(3000)).toBeLessThan(0.05)
    expect(granulationContrast(9600)).toBe(0)
    expect(granulationContrast(3600, 0)).toBeGreaterThan(granulationContrast(3600))
  })

  it('a granule is a fixed share of the pressure scale height: the Sun 535 per radius, a supergiant a few', () => {
    expect(granulesPerRadius(SUN_TEFF, 4.438, 1)).toBeCloseTo(535, 6)
    // Betelgeuse: 764 R☉, 18 M☉: log g -0.45.
    const betelgeuse = granulesPerRadius(3600, Math.log10(18 / (764 * 764)) + 4.438, 764)
    expect(betelgeuse).toBeGreaterThan(1.5)
    expect(betelgeuse).toBeLessThan(40)
    // Proxima: 0.154 R☉, 0.122 M☉: smaller cells than the Sun's, more of them.
    expect(granulesPerRadius(2980, Math.log10(0.122 / (0.154 * 0.154)) + 4.438, 0.154)).toBeGreaterThan(535)
    expect(granulesPerRadius(SUN_TEFF, NaN, 1)).toBe(535)
  })

  it('a spot\'s umbra is ~1,700 K under the Sun\'s photosphere and less for cool stars', () => {
    expect(umbraDeltaT(SUN_TEFF)).toBe(1700)
    expect(umbraDeltaT(3000)).toBeLessThan(500)
  })
})


describe('the star shader', () => {
  it('declares no GLSL reserved word', async () => {
    const {FRAGMENT_SHADER, VERTEX_SHADER} = await import('./star-shaders.js')
    for (const source of [FRAGMENT_SHADER, VERTEX_SHADER].map((s) => s.replace(/\/\/.*$/gm, ''))) {
      for (const word of ['half', 'fixed', 'input', 'output', 'filter', 'sample', 'active', 'common', 'partition']) {
        expect(source).not.toMatch(new RegExp(`\\b(float|int|vec[234]|bool)\\s+${word}\\b`))
      }
    }
  })

  it('star.frag and star.vert, the shaders the photosphere replaced, are gone', () => {
    expect(() => readFileSync('./js/shaders/star.frag')).toThrow()
    expect(() => readFileSync('./js/shaders/star.vert')).toThrow()
  })
})
