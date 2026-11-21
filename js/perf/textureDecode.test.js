import {describe, expect, it} from 'bun:test'
import {CESIUM_DECODE_GAMMA, decodedCount, decodedLayerCount, setCesiumDecode, setTextureDecode} from './textureDecode.js'


const tex = (props = {}) => ({isTexture: true, colorSpace: '', type: 1009, image: {width: 4, complete: true},
  needsUpdate: false, ...props})


/** A stand-in scene: traverse visits each object. */
function sceneOf(objects) {
  return {traverse: (fn) => objects.forEach(fn)}
}


describe('setTextureDecode', () => {
  it('decodes the lit materials\' colour maps only, and restores them', () => {
    const map = tex()
    const night = tex()
    const normal = tex()
    const glb = tex({colorSpace: 'srgb'})
    const label = tex()
    const loading = tex({image: {width: 0, complete: false}})
    const data = tex({isDataTexture: true})
    const scene = sceneOf([
      {material: {isMeshStandardMaterial: true, map, normalMap: normal, emissiveMap: loading, userData: {uNightMap: {value: night}}}},
      {material: {isMeshStandardMaterial: true, map: glb, userData: {}}},
      {material: {isSpriteMaterial: true, map: label, userData: {}}},
      {material: [{isMeshPhongMaterial: true, map: data, userData: {}}]},
      {},
    ])
    expect(setTextureDecode(scene, true)).toBe(3)
    expect(decodedCount()).toBe(3)
    expect([map.colorSpace, night.colorSpace, loading.colorSpace]).toEqual(['srgb', 'srgb', 'srgb'])
    expect(map.needsUpdate).toBe(true)
    // A loading image is uploaded when it arrives, with its colour space.
    expect(loading.needsUpdate).toBe(false)
    expect([normal.colorSpace, glb.colorSpace, label.colorSpace, data.colorSpace]).toEqual(['', 'srgb', '', ''])
    // Again: nothing new.
    expect(setTextureDecode(scene, true)).toBe(0)
    expect(setTextureDecode(scene, false)).toBe(3)
    expect([map.colorSpace, night.colorSpace, loading.colorSpace]).toEqual(['', '', ''])
    expect(glb.colorSpace).toBe('srgb')
    expect(decodedCount()).toBe(0)
  })
})


describe('setCesiumDecode', () => {
  it('sets each ready body\'s imagery layers to the decode gamma, and restores them', () => {
    const day = {gamma: 1}
    const night = {gamma: 0.9}
    const imageryLayers = (list) => ({length: list.length, get: (i) => list[i]})
    const layers = {bodies: {
      earth: {widget: {imageryLayers: imageryLayers([day, night]), isDestroyed: () => false}},
      moon: {status: 'loading'},
      mars: {widget: {imageryLayers: imageryLayers([{gamma: 1}]), isDestroyed: () => true}},
    }}
    expect(setCesiumDecode(layers, true)).toBe(2)
    expect([day.gamma, night.gamma]).toEqual([CESIUM_DECODE_GAMMA, CESIUM_DECODE_GAMMA])
    expect(setCesiumDecode(layers, true)).toBe(0)
    expect(decodedLayerCount()).toBe(2)
    expect(setCesiumDecode(layers, false)).toBe(2)
    expect([day.gamma, night.gamma]).toEqual([1, 0.9])
    expect(setCesiumDecode(null, true)).toBe(0)
  })
})
