// The channels' coefficients from the spectra (bandAverage.mjs), and the
// check that they, not one wavelength a channel, reproduce the spectrum's
// light through the limb.
import {describe, expect, it} from 'bun:test'
import {
  CIE,
  OZONE_SIGMA,
  SOLAR,
  channelCoefficients,
  channelWeights,
  limbColour,
  limbError,
  spectralColour,
} from './bandAverage.mjs'


describe('the tables', () => {
  it('have Bruneton\'s lengths: 48 bins of 10 nm and the CMFs at 5 nm, 360 to 830 nm', () => {
    expect(SOLAR).toHaveLength(48)
    expect(OZONE_SIGMA).toHaveLength(48)
    expect(CIE).toHaveLength(95)
    // Chappuis's peak is in the 600 nm bin, inside red's response.
    expect((OZONE_SIGMA.indexOf(Math.max(...OZONE_SIGMA)) * 10) + 360).toBe(600)
  })

  it('make the Sun white: no path, no colour', () => {
    for (const v of spectralColour(() => 1)) {
      expect(v).toBeCloseTo(1, 12)
    }
  })

  it('give every channel a positive response under sunlight, with its negative lobes', () => {
    const {weight} = channelWeights()
    for (const w of weight) {
      expect(w.reduce((a, b) => a + b, 0)).toBeGreaterThan(0)
      expect(Math.min(...w)).toBeLessThan(0)
    }
  })
})


describe('the channels\' coefficients', () => {
  const {point, band, matched} = channelCoefficients()

  it('keep 680, 550 and 440 nm as the point model', () => {
    expect(point.rayleigh[1]).toBeCloseTo(1.216e-5, 10)
    expect(point.ozone[0]).toBeCloseTo(6.497e-7, 9)
  })

  it('take red\'s ozone near 4 times the 680 nm value: the Chappuis band in red\'s response', () => {
    expect(band.ozone[0] / point.ozone[0]).toBeGreaterThan(3.5)
    expect(band.ozone[0]).toBeGreaterThan(band.ozone[1])
    expect(band.ozone[2]).toBe(0)
  })

  it('reproduce the spectrum\'s limb, 10 to 35 km, eight times better than one wavelength a channel', () => {
    const e = {point: limbError(point), band: limbError(band), matched: limbError(matched)}
    expect(e.band.rgb).toBeLessThan(0.08)
    expect(e.band.chroma).toBeLessThan(0.11)
    expect(e.point.rgb).toBeGreaterThan(0.5)
    expect(e.band.rgb).toBeLessThan(e.matched.rgb)
  })

  it('make the limb at 20 km blue over red, as the spectrum does, where one wavelength made it red', () => {
    const truth = limbColour(20e3)
    const b = limbColour(20e3, band)
    const p = limbColour(20e3, point)
    expect(truth[0]).toBeLessThan(truth[2])
    expect(b[0]).toBeLessThan(b[2])
    expect(p[0]).toBeGreaterThan(p[2])
  })
})
