import {LOD, Object3D} from 'three'
import {meshRange, preloadNames, tilesReady} from './CesiumLayers.js'


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
