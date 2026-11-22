import earthProps from '../../../public/data/earth/index.json'
import marsProps from '../../../public/data/mars/index.json'
import moonProps from '../../../public/data/earth/moons/moon/index.json'
import {CESIUM_BODIES, ionToken, isCesiumBody} from './bodies.js'


describe('isCesiumBody', () => {
  it('offers Earth without an ion token', () => {
    expect(ionToken()).toBe('')
    expect(isCesiumBody('earth')).toBe(true)
  })

  it('withholds ion-only bodies (Moon, Mars) without an ion token', () => {
    expect(CESIUM_BODIES.moon.ionTileset).toBeDefined()
    expect(isCesiumBody('moon')).toBe(false)
    expect(isCesiumBody('mars')).toBe(false)
  })

  it('is false for bodies Cesium has no data for', () => {
    expect(isCesiumBody('venus')).toBe(false)
    expect(isCesiumBody('toString')).toBe(false)
  })
})


describe('CESIUM_BODIES', () => {
  it('scales the Moon\'s imagery as celestiary scales the same mosaic', () => {
    expect(CESIUM_BODIES.moon.textureGain).toBe(moonProps.texture_gain)
  })

  it('scales each body\'s imagery as celestiary scales its texture: Mars\'s, and Earth\'s none', () => {
    expect(CESIUM_BODIES.mars.textureGain).toBe(marsProps.texture_gain)
    expect(CESIUM_BODIES.earth.textureGain ?? 1).toBe(earthProps.texture_gain ?? 1)
  })

  it('reads imagery as celestiary reads the same texture: the Moon\'s linear, the others\' sRGB', () => {
    expect(moonProps.texture_encoding).toBe('linear')
    expect(CESIUM_BODIES.moon.imageryEncoding).toBe('linear')
    for (const [name, props] of [['earth', earthProps], ['mars', marsProps]]) {
      expect(props.texture_encoding ?? 'srgb', name).toBe('srgb')
      expect(CESIUM_BODIES[name].imageryEncoding ?? 'srgb', name).toBe('srgb')
    }
  })
})
