import {LOD, Object3D} from 'three'
import {meshRange} from './CesiumLayers.js'


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
