import {describe, expect, it} from 'bun:test'
import {Group, PerspectiveCamera, Vector3} from 'three'
import HipsLayer, {FALLBACK_ORDERS, GRID, MAX_LOADING} from './HipsLayer.js'
import {apply, frameMatrix, lonLatToVec, newCoverage} from './hips.js'
import {JWST_NIRCAM, RUBIN_FIRST_LOOK} from './surveys.js'


const M16 = [274.70, -13.84]


/**
 * A layer looking at a place, with textures that settle when asked.
 *
 * @param {object} survey
 * @param {Array<number>} at [ra, dec]
 * @param {object} [opts]
 * @param {number} [opts.fov]
 * @param {(url: string) => boolean} [opts.fails] Which URLs answer 404
 * @returns {object}
 */
function newLayer(survey, at, {fov = 0.2, fails = () => false} = {}) {
  const camera = new PerspectiveCamera(fov, 1.5, 1, 1e20)
  camera.lookAt(new Vector3(...apply(frameMatrix('equatorial'), lonLatToVec(...at))))
  camera.updateMatrixWorld()
  const pending = []
  const asked = []
  const disposed = []
  const drawn = []
  const layer = new HipsLayer({
    survey,
    view: () => ({camera, fovDeg: camera.fov, aspect: camera.aspect, heightPx: 1000}),
    onDrawn: (d) => drawn.push(d),
    loadTexture: (url) => new Promise((resolve, reject) => {
      asked.push(url)
      pending.push(() => (fails(url) ? reject(new Error('404')) : resolve({url, dispose: () => disposed.push(url)})))
    }),
  })
  new Group().add(layer)
  return {layer, camera, pending, asked, disposed, drawn}
}


/** @param {Array<Function>} pending */
async function settle(pending) {
  for (const p of pending.splice(0)) {
    p()
  }
  for (let i = 0; i < 4; i++) {
    await Promise.resolve()
  }
}


describe('the HiPS layer', () => {
  it('asks for the tiles in view within the coverage, a few at a time, coarse first', async () => {
    const {layer, pending, asked, drawn} = newLayer(JWST_NIRCAM, M16)
    expect(asked.length).toBe(0)
    layer.preAnimCb()
    // 0.2° over 1000 px is 0.72″ a pixel: order 9 (0.81″) is too coarse, order 10 (0.40″) fits.
    expect(layer.order).toBe(10)
    expect(asked.length).toBe(MAX_LOADING)
    expect(asked[0]).toMatch(new RegExp(`^https://skies\\.esac\\.esa\\.int/JWST/NIRCam_Imaging/Norder${10 - FALLBACK_ORDERS}/`))
    expect(asked.every((u) => u.endsWith('.png'))).toBe(true)
    await settle(pending)
    expect(layer.children.length).toBe(MAX_LOADING)
    layer.preAnimCb()
    expect(drawn).toEqual([true])
    expect(layer.drawnCount).toBeGreaterThan(0)
    // Keep going until all are in: every one asked is covered and in view.
    for (let i = 0; i < 20 && pending.length; i++) {
      await settle(pending)
      layer.preAnimCb()
    }
    const cov = newCoverage(JWST_NIRCAM.coverage)
    for (const url of asked) {
      const [, order, pix] = url.match(/Norder(\d+)\/Dir\d+\/Npix(\d+)\.png$/).map(Number)
      expect(cov.intersects(order, pix)).toBe(true)
    }
    expect(new Set(asked).size).toBe(asked.length)
    expect(asked.length).toBeLessThan(40)
    expect(asked).toContain('https://skies.esac.esa.int/JWST/NIRCam_Imaging/Norder10/Dir7540000/Npix7542617.png')
    // Each tile at the camera by the model-view's turn alone.
    for (const mesh of layer.children) {
      expect(mesh.material.vertexShader).toContain('mat3(modelViewMatrix) * position')
      expect(mesh.geometry.getAttribute('position').count).toBe((GRID + 1) ** 2)
      // A tile covers its whole cell: black is no data, and lets the stars under it show.
      expect(mesh.material.uniforms.uKeyBlack.value).toBe(1)
      expect(mesh.material.fragmentShader).toContain('mix(1.0, lit, uKeyBlack)')
    }
    layer.dispose()
  })

  it('asks for nothing outside the coverage', () => {
    const {layer, asked} = newLayer(JWST_NIRCAM, [100, 20])
    layer.preAnimCb()
    expect(asked.length).toBe(0)
  })

  it('does nothing while hidden, and frees its tiles when disposed', async () => {
    const {layer, pending, asked, disposed, drawn} = newLayer(JWST_NIRCAM, M16)
    layer.visible = false
    layer.preAnimCb()
    expect(asked.length).toBe(0)
    layer.visible = true
    layer.preAnimCb()
    await settle(pending)
    layer.preAnimCb()
    const parent = layer.parent
    layer.dispose()
    expect(disposed.length).toBe(MAX_LOADING)
    expect(layer.tiles.size).toBe(0)
    expect(parent.children.length).toBe(0)
    expect(drawn).toEqual([true, false])
    // Disposed, it asks for nothing more.
    const n = asked.length
    layer.preAnimCb()
    expect(asked.length).toBe(n)
  })

  it('asks the mirror once for a tile the first service lacks, and never again for one both lack', async () => {
    // Rubin's First Look at the Trifid: CDS's primary fails, the mirror answers some.
    const missing = /Npix\d*[02468]\.webp$/
    const {layer, pending, asked} = newLayer(RUBIN_FIRST_LOOK, [270.596, -23.03], {
      fails: (u) => u.includes('//alasky.') || missing.test(u),
    })
    layer.preAnimCb()
    expect(asked.length).toBe(MAX_LOADING)
    expect(asked.every((u) => u.startsWith('https://alasky.cds.unistra.fr/Rubin/CDS_P_Rubin_FirstLook/'))).toBe(true)
    expect(asked.every((u) => u.endsWith('.webp'))).toBe(true)
    await settle(pending)
    // Each failed from the primary was asked of the mirror.
    expect(asked.length).toBe(MAX_LOADING * 2)
    expect(asked.slice(MAX_LOADING).every((u) => u.startsWith('https://alaskybis.'))).toBe(true)
    await settle(pending)
    // The mirror answered some, so it is asked first from now on.
    expect(layer.serviceIndex).toBe(1)
    const missed = layer.missing.size
    expect(missed).toBeGreaterThan(0)
    const before = asked.length
    for (let i = 0; i < 30; i++) {
      layer.preAnimCb()
      await settle(pending)
    }
    // No tile asked twice of the same service.
    expect(new Set(asked).size).toBe(asked.length)
    expect(asked.length).toBeGreaterThan(before)
    layer.dispose()
  })
})


describe('the format', () => {
  it('falls back to the next listed format once, when the preferred one fails on every service', async () => {
    // Rubin's First Look lists png and webp; here CDS serves no webp.
    const {layer, pending, asked} = newLayer(RUBIN_FIRST_LOOK, [270.596, -23.03], {fails: (u) => u.endsWith('.webp')})
    layer.preAnimCb()
    expect(layer.ext).toBe('webp')
    await settle(pending)
    // Each webp failed on the primary: the mirror is asked.
    await settle(pending)
    // And on both: png from now on, those tiles asked again in it.
    expect(layer.ext).toBe('png')
    expect(layer.missing.size).toBe(0)
    await settle(pending)
    expect(layer.formatConfirmed).toBe(true)
    expect(layer.children.length).toBe(MAX_LOADING)
    for (let i = 0; i < 10; i++) {
      layer.preAnimCb()
      await settle(pending)
    }
    // No webp asked after the switch.
    const firstPng = asked.findIndex((u) => u.endsWith('.png'))
    expect(asked.slice(firstPng).some((u) => u.endsWith('.webp'))).toBe(false)
    layer.dispose()
  })

  it('keeps a format once a tile has loaded in it, and marks the misses missing', async () => {
    const missing = /Npix\d*[02468]\.webp$/
    const {layer, pending} = newLayer(RUBIN_FIRST_LOOK, [270.596, -23.03], {fails: (u) => missing.test(u)})
    for (let i = 0; i < 6; i++) {
      layer.preAnimCb()
      await settle(pending)
    }
    expect(layer.ext).toBe('webp')
    expect(layer.missing.size).toBeGreaterThan(0)
    layer.dispose()
  })
})


describe('the manifests', () => {
  for (const s of [RUBIN_FIRST_LOOK, JWST_NIRCAM]) {
    it(`describes ${s.id}`, () => {
      for (const k of ['id', 'title', 'credit', 'licence', 'source']) {
        expect(typeof s[k]).toBe('string')
      }
      expect(s.serviceUrls.length).toBeGreaterThan(0)
      expect(s.serviceUrls.every((u) => u.startsWith('https://') && !u.endsWith('/'))).toBe(true)
      expect(s.maxOrder).toBeGreaterThanOrEqual(s.minOrder)
      expect(s.tileWidth).toBe(512)
      expect(['equatorial', 'galactic']).toContain(s.frame)
      // The coverage is near the survey's own sky fraction: a little over, as it's degraded to order 8.
      const cov = newCoverage(s.coverage)
      let cells = 0
      for (const [o, list] of Object.entries(s.coverage)) {
        cells += list.length * (4 ** (8 - Number(o)))
      }
      const fraction = cells / (12 * (4 ** 8))
      expect(cov.maxOrder).toBe(8)
      expect(fraction).toBeGreaterThan(s.skyFraction)
      expect(fraction).toBeLessThan(s.skyFraction * 25)
    })
  }

  it('has Rubin\'s First Look as its MocServer record has it', () => {
    // CDS's record (2026-11-20; Sky.md, "Surveys").
    expect(RUBIN_FIRST_LOOK).toMatchObject({
      id: 'CDS/P/Rubin/FirstLook',
      serviceUrls: ['https://alasky.cds.unistra.fr/Rubin/CDS_P_Rubin_FirstLook',
        'https://alaskybis.cds.unistra.fr/Rubin/CDS_P_Rubin_FirstLook'],
      minOrder: 0, maxOrder: 12, tileWidth: 512, formats: ['png', 'webp'], frame: 'equatorial',
      skyFraction: 7.068e-4, licence: 'ODbL-1.0',
    })
    expect(RUBIN_FIRST_LOOK.credit).toContain('RubinObs/NOIRLab/SLAC/NSF/DOE/AURA')
    expect(RUBIN_FIRST_LOOK.credit).toContain('CNRS/Unistra')
  })
})
