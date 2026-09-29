import moonProps from '../../../public/data/moon.json'
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
})
