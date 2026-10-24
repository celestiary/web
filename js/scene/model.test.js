import {afterEach, describe, expect, it} from 'bun:test'
import {BoxGeometry, DoubleSide, FrontSide, Group, Mesh, MeshStandardMaterial} from 'three'
import {clearModelCache, loadModel, modelRadius, prepareModel, setGltfLoader} from './model.js'


/**
 * @returns {Group} A glTF's scene as GLTFLoader gives it: a 2 m cube, glowing.
 */
function cube() {
  const root = new Group
  const material = new MeshStandardMaterial({color: 0x808080, emissive: 0x202020})
  root.add(new Mesh(new BoxGeometry(2, 2, 2), material))
  return root
}


describe('model', () => {
  afterEach(() => {
    setGltfLoader(null)
    clearModelCache()
  })

  it('drops emissive light, so only the Sun lights it', () => {
    const root = prepareModel(cube())
    const m = root.children[0].material
    expect(m.emissive.getHex()).toBe(0)
    expect(m.emissiveMap).toBeNull()
    expect(root.name).toBe('model')
  })

  it('keeps emissive light when asked', () => {
    const m = prepareModel(cube(), {emissive: true}).children[0].material
    expect(m.emissive.getHex()).not.toBe(0)
  })

  it('draws both sides when asked: a one-sided sunshield', () => {
    expect(prepareModel(cube()).children[0].material.side).toBe(FrontSide)
    expect(prepareModel(cube(), {doubleSided: true}).children[0].material.side).toBe(DoubleSide)
  })

  it('fetches a path once, through dataUrl, and clones it for each ask', async () => {
    const urls = []
    setGltfLoader((url) => {
      urls.push(url)
      return Promise.resolve(cube())
    })
    const [a, b] = await Promise.all([loadModel('large/models/x.glb'), loadModel('large/models/x.glb')])
    expect(urls).toEqual(['large/models/x.glb'])
    expect(a).not.toBe(b)
    // Clones share geometry and materials.
    expect(a.children[0].geometry).toBe(b.children[0].geometry)
    expect(a.children[0].material).toBe(b.children[0].material)
  })

  it('scales a model to metres', async () => {
    setGltfLoader(() => Promise.resolve(cube()))
    const km = await loadModel('large/models/km.glb', {scale: 1000})
    // The cube's corner, √3 from its centre, in kilometres.
    expect(modelRadius(km)).toBeCloseTo(Math.sqrt(3) * 1000, 6)
    expect(modelRadius(await loadModel('large/models/km.glb'))).toBeCloseTo(Math.sqrt(3), 6)
  })

  it('forgets a failure, so the next ask tries again', async () => {
    let calls = 0
    setGltfLoader(() => {
      calls++
      return calls === 1 ? Promise.reject(new Error('offline')) : Promise.resolve(cube())
    })
    await expect(loadModel('large/models/y.glb')).rejects.toThrow('offline')
    expect(await loadModel('large/models/y.glb')).toBeDefined()
    expect(calls).toBe(2)
  })

  it('measures its bounding sphere about its origin', () => {
    const root = cube()
    root.children[0].position.set(3, 0, 0)
    // The cube's far corner: (4, 1, 1) at most, the box's sphere about its
    // centre (3, 0, 0) of radius √3, so 3 + √3.
    expect(modelRadius(root)).toBeCloseTo(3 + Math.sqrt(3), 6)
    expect(modelRadius(new Group)).toBe(0)
  })
})
