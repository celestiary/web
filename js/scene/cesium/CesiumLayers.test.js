import {LOD, Object3D} from 'three'
import CesiumLayers, {meshRange, preloadNames, tilesReady} from './CesiumLayers.js'


describe('meshRange', () => {
  it('is where the planet LOD swaps the body mesh for its point', () => {
    const lod = new LOD()
    lod.name = 'planet LOD'
    const planet = new Object3D()
    lod.addLevel(planet, 1)
    lod.addLevel(new Object3D(), 1.5e12)
    expect(meshRange(planet)).toBe(1.5e12)
  })

  it('is 0 for a node outside a planet LOD', () => {
    expect(meshRange(new Object3D())).toBe(0)
    const other = new LOD()
    const node = new Object3D()
    other.addLevel(node, 1)
    expect(meshRange(node)).toBe(0)
  })
})


describe('preloadNames', () => {
  const body = (name, parent) => ({props: {name, parent}})

  it('is the targeted Cesium body', () => {
    expect(preloadNames(body('earth', 'sun'))).toEqual(['earth'])
  })

  it('includes the parent planet of a targeted moon', () => {
    expect(preloadNames(body('moon', 'earth'))).toEqual(['moon', 'earth'])
    expect(preloadNames(body('phobos', 'mars'))).toEqual(['mars'])
  })

  it('is empty for bodies without a Cesium layer, or no target', () => {
    expect(preloadNames(body('europa', 'jupiter'))).toEqual([])
    expect(preloadNames(null)).toEqual([])
  })
})


describe('tilesReady', () => {
  const globe = (tilesLoaded) => ({widget: {scene: {globe: {tilesLoaded}}}})
  const tiles = (tileset) => ({widget: {scene: {globe: undefined}}, tileset})

  it('is false before Cesium has rendered a frame', () => {
    expect(tilesReady(globe(true))).toBe(false)
  })

  it('follows the globe tiles (Earth)', () => {
    expect(tilesReady({...globe(false), frames: 3})).toBe(false)
    expect(tilesReady({...globe(true), frames: 3})).toBe(true)
  })

  it('follows the ion tileset tiles, and is false until it is added', () => {
    expect(tilesReady({...tiles(undefined), frames: 3})).toBe(false)
    expect(tilesReady({...tiles({tilesLoaded: false}), frames: 3})).toBe(false)
    expect(tilesReady({...tiles({tilesLoaded: true}), frames: 3})).toBe(true)
  })
})


describe('crossfade', () => {
  const layers = () => {
    const L = new CesiumLayers({})
    L._now = 1000
    return L
  }

  it('runs from 0 to 1 over a second from when the tiles were in', () => {
    const L = layers()
    L.bodies.moon = {fadeStart: 1000}
    expect(L.fadeOf('moon')).toBe(0)
    L._now = 1500
    expect(L.fadeOf('moon')).toBe(0.5)
    L._now = 4000
    expect(L.fadeOf('moon')).toBe(1)
  })

  it('is complete for a body that never faded', () => {
    expect(layers().fadeOf('earth')).toBe(1)
  })

  it('hands the atmosphere to Cesium only for an active body that draws its own', () => {
    const L = layers()
    const earth = {}
    const mars = {}
    L.bodies.earth = {fadeStart: 500}
    L.bodies.mars = {fadeStart: 500}
    expect(L.atmosphereShare(earth)).toBe(0)
    L.active = [{name: 'earth', node: earth}, {name: 'mars', node: mars}]
    expect(L.atmosphereShare(earth)).toBe(0.5)
    expect(L.atmosphereShare(mars)).toBe(0)
    expect(L.atmosphereShare(null)).toBe(0)
  })
})
