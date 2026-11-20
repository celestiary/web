import {describe, expect, it} from 'bun:test'
import {SUN_DISC_RADIANCE} from '../exposure.js'
import {VISIBLE_FLOOR, offDiscBrightest, viewFieldWeight, visibleRadius} from './SunLayers.js'
import {CORONA_RADII} from './sun-shaders.js'
import {newSolarWind, parkerLag} from './SolarWind.js'


describe('the Sun\'s off-disc layers, by exposure', () => {
  it('are skipped next to the bare disc stopped down, and reach far in the dark', () => {
    // The disc shown as a sunlit surface (0.6): the gain the meter takes.
    const bare = 0.6
    expect(bare * offDiscBrightest(1.0001)).toBeLessThan(VISIBLE_FLOOR)
    expect(visibleRadius(bare)).toBe(1)
    // At the gain of totality (~200 over Earth's keyed), several radii.
    const totality = SUN_DISC_RADIANCE * 200
    expect(visibleRadius(totality)).toBeGreaterThan(3)
    expect(visibleRadius(totality)).toBeLessThan(CORONA_RADII)
    // At a coronagraph's long exposure, all of the shell.
    expect(visibleRadius(SUN_DISC_RADIANCE * 1e5)).toBe(CORONA_RADII)
  })
})


describe('the activity view\'s field', () => {
  it('comes in as the disc resolves, over the pixels the meter takes the disc\'s exposure', () => {
    // The Sun from 1 AU at 45° on a 1080 px screen is 13 px: mostly out.
    expect(viewFieldWeight(4)).toBe(0)
    expect(viewFieldWeight(8)).toBe(0)
    expect(viewFieldWeight(13)).toBeLessThan(0.15)
    expect(viewFieldWeight(20)).toBeCloseTo(0.5, 6)
    expect(viewFieldWeight(32)).toBe(1)
    expect(viewFieldWeight(500)).toBe(1)
  })
})


describe('the solar wind', () => {
  it('Parker\'s spiral: ~45° from radial at 1 AU for the slow wind', () => {
    // tan ψ = Ω r / v: 2.87e-6 × 1.496e8 km / 400 km/s ≈ 1.07, so 47°.
    const lag = parkerLag(1, 400)
    const dLag = parkerLag(1.001, 400) - lag
    const angle = Math.atan(dLag / 0.001) * 180 / Math.PI
    expect(angle).toBeGreaterThan(40)
    expect(angle).toBeLessThan(52)
    expect(parkerLag(1, 750)).toBeLessThan(lag)
  })


  it('is an overlay of streamlines', () => {
    const wind = newSolarWind(0.5)
    expect(wind.name).toBe('solar wind')
    expect(wind.geometry.attributes.position.count).toBeGreaterThan(1000)
    expect(wind.layers.mask).toBe(2)
  })
})
