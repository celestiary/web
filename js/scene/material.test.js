import {describe, expect, it} from 'bun:test'

// material.js -> Three.js TextureLoader -> ImageLoader -> document.createElementNS('img').
// Provide a minimal stub so material construction doesn't throw under bun:test
// (no real DOM).  We don't dispatch the synthetic load event, so texture.image
// stays unset — the tests below assert observable contract (cache identity,
// material props) without inspecting the eventually-loaded URL.
const fakeImg = () => ({
  style: {},
  setAttribute: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
})
// Bun shares global state across test files.  We need *only*
// createElementNS for Three.js's ImageLoader (cacheMaterial → TextureLoader
// → ImageLoader).  Don't touch createElement: another test file may have
// installed a fuller stub for canvas-using code (e.g., SpriteSheet) and we
// don't want to clobber it with our image-only fake and break that file
// when bun runs them together.
if (!global.document) {
  global.document = {body: {appendChild: () => {}}}
}
if (!global.document.createElementNS) {
  global.document.createElementNS = () => fakeImg()
}

const {cacheMaterial, pathTexture} = await import('./material.js')


describe('pathTexture', () => {
  it('returns a Three.js Texture (no throw on missing DOM/network)', () => {
    const tex = pathTexture('mars')
    expect(tex).toBeDefined()
    expect(tex.isTexture).toBe(true)
  })

  it('accepts a path-shaped basename (subdirs work, no thrown error)', () => {
    expect(() => pathTexture('earth/earth_terrain')).not.toThrow()
    expect(() => pathTexture('star_glow', '.png')).not.toThrow()
  })
})


describe('cacheMaterial', () => {
  it('returns a MeshPhysicalMaterial with depth test enabled', () => {
    const m = cacheMaterial('cache_test_basic_a')
    expect(m).toBeDefined()
    expect(m.isMeshPhysicalMaterial).toBe(true)
    expect(m.depthTest).toBe(true)
    expect(m.depthWrite).toBe(true)
    expect(m.map).toBeDefined()
  })

  it('caches by name — second call returns the same instance', () => {
    const m1 = cacheMaterial('cache_test_identity')
    const m2 = cacheMaterial('cache_test_identity')
    expect(m1).toBe(m2)
  })

  it('cache key is name only — pathPrefix on subsequent calls is ignored (first wins)', () => {
    // Documents the contract: the prefix only takes effect on first call,
    // when the material is built.  Useful for understanding why a single
    // body's textures must always be loaded with the same prefix.
    const first = cacheMaterial('cache_test_prefix_lock', undefined, 'first/')
    const second = cacheMaterial('cache_test_prefix_lock', undefined, 'second/')
    expect(first).toBe(second)
  })

  it('different names build distinct materials', () => {
    const a = cacheMaterial('cache_test_distinct_a')
    const b = cacheMaterial('cache_test_distinct_b')
    expect(a).not.toBe(b)
  })

  it('accepts a pathPrefix without throwing (subdir loading)', () => {
    expect(() => cacheMaterial('cache_test_subdir', undefined, 'mybody/')).not.toThrow()
  })
})
