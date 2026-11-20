import {describe, expect, it} from 'bun:test'
import {SUN_DISC_RADIANCE} from '../exposure.js'
import SunLayers, {VISIBLE_FLOOR, offDiscBrightest, viewFieldWeight, visibleRadius} from './SunLayers.js'
import {EUV_VIEW, VIEW_EUV, VIEW_EYE} from './activityView.js'
import {MAX_FILAMENTS} from './limits.js'
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
    // The thresholds scale with the pixel ratio, as luminousDiscGain's do.
    expect(viewFieldWeight(16, 2)).toBe(0)
    expect(viewFieldWeight(40, 2)).toBeCloseTo(0.5, 6)
    expect(viewFieldWeight(64, 2)).toBe(1)
  })
})


describe('the view the layers are drawn in', () => {
  const star = () => ({props: {radius: {scalar: 6.957e8}}, color: [1, 1, 1], teff: 5772})

  it('is the eye\'s unless asked, and switches the disc\'s and the corona\'s shaders together', () => {
    const layers = new SunLayers(star(), {activity: true})
    const disc = layers.photosphereUniforms()
    const corona = layers.corona.material.uniforms
    expect(layers.view).toBe(VIEW_EYE)
    expect(disc.uEuv.value).toBe(0)
    expect(corona.uView.value.x).toBe(0)
    layers.setView(VIEW_EUV)
    expect(layers.view).toBe(VIEW_EUV)
    expect(disc.uEuv.value).toBe(1)
    expect(corona.uView.value.x).toBe(1)
    layers.setView('x-ray')
    expect(layers.view).toBe(VIEW_EYE)
    expect(disc.uEuv.value).toBe(0)
    expect(corona.uView.value.x).toBe(0)
  })

  it('starts in the view it is given, with the view\'s levels in the uniforms', () => {
    const layers = new SunLayers(star(), {activity: true, view: VIEW_EUV})
    const disc = layers.photosphereUniforms()
    expect(disc.uEuv.value).toBe(1)
    expect(disc.uEuvLevels.value.toArray()).toEqual([EUV_VIEW.plage, EUV_VIEW.filament, EUV_VIEW.limb, EUV_VIEW.white])
    expect(disc.uFilamentCentre.value.length).toBe(MAX_FILAMENTS)
    expect(layers.corona.material.uniforms.uRadialRef.value.length).toBe(16)
  })

  it('gives a star without activity the view\'s disc and no corona', () => {
    const layers = new SunLayers(star(), {activity: false, view: VIEW_EUV})
    expect(layers.corona).toBeUndefined()
    expect(layers.photosphereUniforms().uEuv.value).toBe(1)
    expect(layers.photosphereUniforms().uRegionMode.value).toBe(0)
  })
})


describe('the CMEs\' pass', () => {
  const star = () => ({props: {radius: {scalar: 6.957e8}}, color: [1, 1, 1], teff: 5772})
  const camera = {fov: 9, aspect: 16 / 9}
  const item = (front) => ({cme: {front}})
  // The Sun 35 radii ahead, the corona shown out to a radius.
  const layers = (view, maxRho) => {
    const l = new SunLayers(star(), {activity: true, view})
    const u = l.corona.material.uniforms
    u.uSunCentre.value.set(0, 0, -35)
    u.uMaxRho.value = maxRho
    l.cmeItems = [item(3.6), item(20)]
    return l
  }

  it('isn\'t run in white light beside the bare disc, whose glare hides a CME: only in an eclipse or behind an occulter', () => {
    const l = layers(VIEW_EYE, 40)
    expect(l.visibleFraction).toBe(1)
    expect(l.cmesInView(camera)).toEqual([])
    l.visibleFraction = 0.01
    expect(l.cmesInView(camera)).toEqual([])
    l.visibleFraction = 0
    expect(l.cmesInView(camera).length).toBe(2)
  })

  it('leaves out a CME whose core is past where the corona shows at this exposure', () => {
    const l = layers(VIEW_EYE, 5)
    l.visibleFraction = 0
    expect(l.cmesInView(camera).map((i) => i.cme.front)).toEqual([3.6])
    l.corona.material.uniforms.uMaxRho.value = 1
    expect(l.cmesInView(camera)).toEqual([])
  })

  it('is run in the activity view only round a resolved disc', () => {
    const l = layers(VIEW_EUV, 40)
    const u = l.corona.material.uniforms
    expect(l.cmesInView(camera).length).toBe(2)
    u.uView.value.y = 0
    u.uView.value.z = 0
    expect(l.cmesInView(camera)).toEqual([])
  })

  it('leaves out a CME outside the frame', () => {
    const l = layers(VIEW_EUV, 40)
    const u = l.corona.material.uniforms
    // The Sun 90° off the view's axis, 215 radii away: 3.6 radii is 1°, 20 radii 6°.
    u.uSunCentre.value.set(215, 0, 0)
    expect(l.cmesInView(camera)).toEqual([])
    // 9° off it, the frame's half diagonal 9.2°: both reach in.
    u.uSunCentre.value.set(215 * Math.sin(9 * Math.PI / 180), 0, -215 * Math.cos(9 * Math.PI / 180))
    expect(l.cmesInView(camera).length).toBe(2)
    // 12° off it: only the larger does.
    u.uSunCentre.value.set(215 * Math.sin(12 * Math.PI / 180), 0, -215 * Math.cos(12 * Math.PI / 180))
    expect(l.cmesInView(camera).map((i) => i.cme.front)).toEqual([20])
    l.cmeItems = []
    expect(l.cmesInView(camera)).toEqual([])
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
