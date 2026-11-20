import {describe, expect, it} from 'bun:test'
import {readFileSync} from 'node:fs'
import {Group, PerspectiveCamera, Vector3} from 'three'
import RubinImage, {BASE_LEVEL, GRID, MAX_LOADING, selectLevel, tileBox, tileGeometry, tilePath,
  visibleTiles} from './RubinImage.js'
import {equatorialToScene, pixToWorld, sceneToEquatorial} from './wcs.js'
import {newImageSwitch} from './install.js'


const manifest = JSON.parse(readFileSync(new URL('../../../public/data/rubin/noirlab2626d.json', import.meta.url)))
const CENTRE = equatorialToScene(manifest.wcs.crval[0], manifest.wcs.crval[1])


describe('the image\'s levels and tiles', () => {
  it('chooses the coarsest level whose pixel fits a screen pixel', () => {
    // The camera's widest field, 3.5° over 1000 px (12.6″ a pixel): level 2
    // is 6.4″ a pixel, level 1 12.8″.
    expect(selectLevel(manifest, 3.5, 1000)).toBe(2)
    // 0.5° (1.8″ a pixel): level 4 (1.6″).
    expect(selectLevel(manifest, 0.5, 1000)).toBe(4)
    // The pixel limit (0.2″ a pixel): the deepest committed level.
    const deepest = manifest.tiles.levels.at(-1).level
    expect(selectLevel(manifest, 0.2 / 3600 * 1000, 1000)).toBe(deepest)
    // A field wider than the image: the one tile.
    expect(selectLevel(manifest, 60, 500)).toBe(0)
  })

  it('cuts each level into whole tiles and short edge tiles', () => {
    const l = manifest.tiles.levels.find((e) => e.level === 5)
    const last = tileBox(manifest, l, l.cols - 1, l.rows - 1)
    expect(last.x1).toBeCloseTo(manifest.wcs.width, 6)
    expect(last.y1).toBeCloseTo(manifest.wcs.height, 6)
    expect(last.fx).toBeLessThan(1)
    expect(tileBox(manifest, l, 0, 0).fx).toBe(1)
    expect(tilePath(manifest.tiles.url, 5, 3, 7)).toBe('large/rubin/noirlab2626d/5/3_7.jpg')
  })

  it('finds the tiles in a view', () => {
    // At the centre, 0.5° across: a few of level 4's 54.
    const some = visibleTiles(manifest, 4, CENTRE, 0.35)
    expect(some.length).toBeGreaterThan(0)
    expect(some.length).toBeLessThan(20)
    // Wide: all of level 2.
    expect(visibleTiles(manifest, 2, CENTRE, 3).length).toBe(6)
    // Away from the field: none.
    expect(visibleTiles(manifest, 4, equatorialToScene(100, 20), 2).length).toBe(0)
  })

  it('puts a tile\'s corners where the WCS puts its pixels', () => {
    const l = manifest.tiles.levels.find((e) => e.level === 3)
    const g = tileGeometry(manifest, l, 1, 1, 1)
    const pos = g.getAttribute('position')
    expect(pos.count).toBe((GRID + 1) ** 2)
    const b = tileBox(manifest, l, 1, 1)
    const w = pixToWorld(manifest.wcs, b.x0, b.y0)
    const back = sceneToEquatorial([pos.getX(0), pos.getY(0), pos.getZ(0)])
    expect(Math.abs(back.ra - w.ra) * 3600).toBeLessThan(0.05)
    expect(Math.abs(back.dec - w.dec) * 3600).toBeLessThan(0.05)
    g.dispose()
  })
})


/**
 * @returns {object} A layer looking at the field's centre, with textures that resolve when asked
 */
function newLayer() {
  const camera = new PerspectiveCamera(0.5, 1.5, 1, 1e20)
  camera.lookAt(new Vector3(...CENTRE))
  camera.updateMatrixWorld()
  const pending = []
  const disposed = []
  const layer = new RubinImage({
    manifest,
    resolve: (p) => `/${p}`,
    view: () => ({camera, fovDeg: camera.fov, aspect: camera.aspect, heightPx: 1000}),
    loadTexture: (url) => new Promise((resolve) => {
      pending.push(() => resolve({url, dispose: () => disposed.push(url)}))
    }),
  })
  new Group().add(layer)
  return {layer, pending, disposed}
}


describe('the image layer', () => {
  it('fetches only the tiles in view, a few at a time, from the frame\'s callback', async () => {
    const {layer, pending} = newLayer()
    expect(pending.length).toBe(0)
    layer.preAnimCb()
    expect(layer.level).toBe(4)
    expect(pending.length).toBe(MAX_LOADING)
    for (const p of pending.splice(0)) {
      p()
    }
    await Promise.resolve()
    await Promise.resolve()
    expect(layer.children.length).toBe(MAX_LOADING)
    // The base level first, whole under the detail.
    expect([...layer.tiles.values()].filter((t) => t.level === BASE_LEVEL).length).toBeGreaterThan(0)
    layer.preAnimCb()
    expect(pending.length).toBeGreaterThan(0)
    layer.dispose()
  })

  it('does nothing while hidden, and frees its tiles when disposed', async () => {
    const {layer, pending, disposed} = newLayer()
    layer.visible = false
    layer.preAnimCb()
    expect(pending.length).toBe(0)
    layer.visible = true
    layer.preAnimCb()
    const n = pending.length
    for (const p of pending.splice(0)) {
      p()
    }
    await Promise.resolve()
    await Promise.resolve()
    const parent = layer.parent
    layer.dispose()
    expect(disposed.length).toBe(n)
    expect(layer.tiles.size).toBe(0)
    expect(parent.children.length).toBe(0)
  })
})


describe('the image\'s switch', () => {
  it('fetches the manifest when first on, and shows the credit while on', async () => {
    const credits = new Map()
    const stellarFrame = new Group()
    const asked = []
    const sw = newImageSwitch({stellarFrame, ui: {camera: new PerspectiveCamera(), height: 500}}, {
      fetchJson: (url) => {
        asked.push(url)
        return Promise.resolve(manifest)
      },
      addCredit: (id, c) => credits.set(id, c),
      removeCredit: (id) => credits.delete(id),
    })
    expect(sw.enabled).toBe(false)
    expect(asked.length).toBe(0)
    sw.enabled = true
    await sw.ready
    expect(asked).toEqual(['data/rubin/noirlab2626d.json'])
    expect(stellarFrame.children).toEqual([sw.layer])
    expect(credits.get('rubin-image').text).toContain('CC BY 4.0')
    expect(credits.get('rubin-image').text).toContain('Rubin Observatory/NOIRLab/SLAC/AURA')
    sw.enabled = false
    expect(sw.layer.visible).toBe(false)
    expect(credits.size).toBe(0)
    sw.enabled = true
    expect(asked.length).toBe(1)
    sw.dispose()
    expect(stellarFrame.children.length).toBe(0)
    expect(credits.size).toBe(0)
  })
})
