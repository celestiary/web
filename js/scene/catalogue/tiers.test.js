import {afterAll, beforeAll, describe, expect, it} from 'bun:test'
import {readFileSync} from 'node:fs'
import createTree from '@pablo-mayrgundter/yaot2'
import {PerspectiveCamera, Vector3} from 'three'
import {buildFromSource} from '../../../tools/stars/build.mjs'
import Stars from '../Stars.js'
import {readCelestiaStars} from '../StarsCatalog.js'
import {toArrayBuffer} from '../../utils.js'
import {queryPoints} from '../Picker.js'
import StarsProvider from '../../search/providers/StarsProvider.js'
import {INDEX_FILE, packPath} from '../points/tileFormat.js'
import {ROOTS_PACK} from './tiers.js'


// The bundled catalogue loaded as brightness tiers (Stars.md, "Brightness
// tiers"), through Stars as the app makes it: the tiers built in memory from
// stars.dat and starnames.dat (tools/stars/build.mjs), served by a fetch
// that holds the faint packs back until a test lets them go.  So the
// bright tier alone is a state a test can look at: what the names, the
// search, the labels, picking and a link to a star see before the rest.


// SpriteSheet (the label sheet) draws on a canvas: the calls it makes.
global.document = global.document ?? {
  createElement: () => ({
    setAttribute: () => {},
    getContext: () => ({
      fillStyle: '', font: '', textBaseline: '', fillRect: () => {}, fill: () => {}, fillText: () => {},
      save: () => {}, restore: () => {}, translate: () => {},
      measureText: (text) => ({width: 6 * text.length, actualBoundingBoxAscent: 10, actualBoundingBoxDescent: 2}),
    }),
    width: 0, height: 0,
  }),
  body: {appendChild: () => {}},
}

const {files} = buildFromSource()
const NAMES = readFileSync('./public/data/starnames.dat', 'utf8')
const STARS_DAT = readFileSync('./public/data/stars.dat')
// HIP 46635 (V 8.4, no name): the issue's own faint star, in a faint tier.
const FAINT = 46635
const SIRIUS = 32349
const PROXIMA = 70890

const savedFetch = global.fetch
// The shaders' sources, held back where a test wants the bright tier in
// before them (as on a page, where the shaders can come second).
let shadersHeld = Promise.resolve()
beforeAll(() => {
  // The names, the shaders and, for the fallback, stars.dat.
  global.fetch = (url) => {
    const u = String(url)
    if (u.endsWith('starnames.dat')) {
      return Promise.resolve({ok: true, text: () => Promise.resolve(NAMES)})
    }
    if (u.endsWith('stars.dat')) {
      const buf = STARS_DAT.buffer.slice(STARS_DAT.byteOffset, STARS_DAT.byteOffset + STARS_DAT.byteLength)
      return Promise.resolve({ok: true, arrayBuffer: () => Promise.resolve(buf)})
    }
    if (u.includes('shaders/')) {
      return shadersHeld.then(() => ({ok: true, text: () => Promise.resolve('void main() {}')}))
    }
    return Promise.resolve({ok: false, status: 404})
  }
})
afterAll(() => {
  global.fetch = savedFetch
})


/**
 * The tiers, served from memory: the faint packs wait for `release()`.
 *
 * @param {object} [opts]
 * @param {Set<string>} [opts.fail] Packs that answer 503
 * @param {boolean} [opts.noManifest]
 * @returns {object}
 */
function serve({fail = new Set(), noManifest = false} = {}) {
  const requested = []
  let release
  const released = new Promise((resolve) => {
    release = resolve
  })
  const fetchFn = async (url) => {
    const path = url.replace(/^tiers\//, '')
    requested.push(path)
    if (path === INDEX_FILE && noManifest) {
      return {ok: false, status: 404}
    }
    if (path !== INDEX_FILE && path !== packPath(ROOTS_PACK)) {
      await released
    }
    if (fail.has(path)) {
      return {ok: false, status: 503}
    }
    const buf = files.get(path)
    return buf ? {
      ok: true,
      json: () => Promise.resolve(JSON.parse(new TextDecoder().decode(buf))),
      arrayBuffer: () => Promise.resolve(buf.slice(0)),
    } : {ok: false, status: 404}
  }
  return {fetchFn, requested, release}
}


/**
 * @param {object} served serve()
 * @param {object} [ui] Overrides
 * @returns {{stars: Stars, ui: object}}
 */
function newStars(served, ui = {}) {
  const state = {}
  const camera = new PerspectiveCamera(60, 1.5, 1, 1e30)
  camera.updateMatrixWorld()
  const theUi = {
    useStore: {getState: () => state, setState: (s) => Object.assign(state, s), subscribe: () => () => {}},
    camera, height: 600, limitingMagnitude: () => 6.5,
    renderer: {domElement: {clientWidth: 900, clientHeight: 600}},
    ...ui,
  }
  const stars = new Stars({name: 'stars'}, theUi, undefined, undefined, false,
      {tiers: true, fetchFn: served.fetchFn, baseUrl: 'tiers'})
  stars.updateMatrixWorld(true)
  return {stars, ui: theUi}
}


/**
 * Let promises and timers run.
 *
 * @param {Function} until
 * @param {Function} [frame] Run between turns (the animation callback's)
 * @returns {Promise<boolean>} Whether it came true
 */
async function settle(until, frame = () => {}) {
  for (let i = 0; i < 200; i++) {
    frame()
    if (until()) {
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  return until()
}


describe('the catalogue as brightness tiers', () => {
  it('fetches the manifest, then the bright tier, and is ready with it: names, labels, the asterisms\' stars', async () => {
    let releaseShaders
    shadersHeld = new Promise((resolve) => {
      releaseShaders = resolve
    })
    const served = serve()
    const {stars} = newStars(served)
    let ready = false
    stars.onCatalogReady(() => (ready = true))
    expect(await settle(() => ready)).toBe(true)
    expect(served.requested.slice(0, 2)).toEqual([INDEX_FILE, packPath(ROOTS_PACK)])
    // The bright tier only: the faint packs are held back.
    expect(stars.catalogComplete()).toBe(false)
    expect(stars.catalog.numStars).toBe(8880)
    // Every name resolves to its star, faint named ones too.
    for (const name of ['Sirius', 'Proxima Centauri', 'Polaris', 'Gliese 1']) {
      const hip = stars.catalog.hipByName.get(name)
      expect(stars.catalog.starByHip.has(hip), name).toBe(true)
    }
    // Every name of a star stars.dat has (a few name stars it hasn't).
    const inDat = new Set([0, ...readCelestiaStars(toArrayBuffer(STARS_DAT)).map((r) => r.hipId)])
    let named = 0
    for (const hip of stars.catalog.namesByHip.keys()) {
      if (inDat.has(hip)) {
        expect(stars.catalog.starByHip.has(hip)).toBe(true)
        named++
      }
    }
    expect(named).toBe(3328)
    // The label sheet, from the bright tier: the favourites and Proxima.
    expect(stars.labelledHips.has(SIRIUS)).toBe(true)
    expect(stars.labelledHips.has(PROXIMA)).toBe(true)
    // The Sun ('Sol', a favourite) before the shader: its record is there
    // from the start (the label sheet threw without it, PR #259's first cut).
    expect(stars.labelledHips.has(0)).toBe(true)
    releaseShaders()
    shadersHeld = Promise.resolve()
    served.release()
  })

  it('holds the faint tiers until the reveal (streamRest), but for what the view wants', async () => {
    const served = serve()
    served.release()
    const {stars} = newStars(served)
    const frame = () => stars.population?.preAnimCb()
    expect(await settle(() => stars.drawn(), frame)).toBe(true)
    for (let i = 0; i < 20; i++) {
      frame()
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    // The naked-eye limit plus the margin: the field's faint tiles, not all.
    const before = served.requested.length
    expect(served.requested.slice(0, 2)).toEqual([INDEX_FILE, packPath(ROOTS_PACK)])
    expect(before).toBeLessThan(14)
    expect(stars.catalogComplete()).toBe(false)
    stars.streamRest()
    expect(await settle(() => stars.catalogComplete(), frame)).toBe(true)
    expect(served.requested.length).toBe(14)
  })

  it('a link to a faint unnamed star waits for its tier; a missing one is missing once all are in', async () => {
    const served = serve()
    const {stars} = newStars(served)
    let faint = null
    let missing = false
    let named = null
    stars.whenStar(FAINT, (s) => (faint = s))
    stars.whenStar(999999999, () => {}, () => (missing = true))
    stars.whenStar(PROXIMA, (s) => (named = s))
    expect(await settle(() => named !== null)).toBe(true)
    expect(faint).toBeNull()
    expect(missing).toBe(false)
    served.release()
    expect(await settle(() => stars.catalogComplete())).toBe(true)
    expect(faint?.hipId).toBe(FAINT)
    expect(missing).toBe(true)
    expect(stars.catalog.numStars).toBe(106747)
    // Every pack once: the manifest, the bright tier and the 12 others.
    expect(served.requested.length).toBe(14)
    expect(new Set(served.requested).size).toBe(14)
  })

  it('the search: every named star from the bright tier, a number once its tier is in', async () => {
    const served = serve()
    const {stars} = newStars(served)
    await settle(() => stars._catalogReady)
    const provider = new StarsProvider(stars.catalog)
    const atReady = provider.collectAll()
    expect(atReady.some((e) => e.displayName === 'Proxima Centauri' || e.aliases.includes('Proxima Centauri')))
        .toBe(true)
    expect(provider.resolveHip(SIRIUS)?.id).toBe(`hip:${SIRIUS}`)
    expect(provider.resolveHip(FAINT)).toBeNull()
    served.release()
    // The search's first query asks for the rest (SearchIndex.loadOnSearch).
    const complete = stars.whenComplete()
    await settle(() => stars.catalogComplete())
    // Nothing named came with the rest: the index built at the bright tier
    // was already whole.
    expect(provider.collectAll().length).toBe(atReady.length)
    expect(provider.resolveHip(FAINT)?.displayName).toBe(`HIP ${FAINT}`)
    let completed = false
    await complete.then(() => (completed = true))
    expect(completed).toBe(true)
  })

  it('picking: a faint star once its tier is in, through an index rebuilt as the tiers come', async () => {
    const served = serve()
    const {stars, ui} = newStars(served)
    await settle(() => stars._catalogReady)
    const before = stars.pickIndex()
    expect(before.coords.length).toBe(3 * (8880 + 1))
    // Aim at the faint star.
    const pick = () => {
      const index = stars.pickIndex()
      const tree = createTree()
      tree.init(index.coords)
      let got = null
      queryPoints(ui, {clientX: 450, clientY: 300}, tree, stars, (p) => (got = p), index)
      return got
    }
    served.release()
    stars.streamRest()
    await settle(() => stars.catalogComplete())
    const star = stars.catalog.starByHip.get(FAINT)
    ui.camera.lookAt(new Vector3(star.x, star.y, star.z))
    ui.camera.updateMatrixWorld()
    const after = stars.pickIndex()
    expect(after.version).not.toBe(before.version)
    expect(after.coords.length).toBe(3 * (106747 + 1))
    expect(pick()?.star?.hipId).toBe(FAINT)
  })

  it('is drawn when the bright tier and the view\'s tiles are in: the Sun\'s view at once, a deep one with its own', async () => {
    const served = serve()
    let limit = 3
    const {stars} = newStars(served, {limitingMagnitude: () => limit})
    const frame = () => stars.population?.preAnimCb()
    // A limit of 3 (by the Sun, its glare in the frame) plus the margin: the
    // bright tier is all the view wants.
    expect(await settle(() => stars.drawn(), frame)).toBe(true)
    expect(stars.catalogComplete()).toBe(false)
    expect(stars.sunPoint).toBeTruthy()

    // The naked eye's limit, 6.5, plus the margin reaches into the faint
    // packs over the field: it waits for them.
    const deepServed = serve()
    const deep = newStars(deepServed, {limitingMagnitude: () => 6.5}).stars
    const deepFrame = () => deep.population?.preAnimCb()
    await settle(() => deep._catalogReady && deep._shaderReady, deepFrame)
    for (let i = 0; i < 10; i++) {
      deepFrame()
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    expect(deep.drawn()).toBe(false)
    expect(deep.population.stats().missing).toBeGreaterThan(0)
    deepServed.release()
    expect(await settle(() => deep.drawn(), deepFrame)).toBe(true)
    // Once drawn, drawn: a view wanting a tile still to come isn't loading.
    limit = 12
    frame()
    expect(stars.drawn()).toBe(true)
    served.release()
  })

  it('draws every point of each loaded tile in the field, as the one geometry did', async () => {
    const served = serve()
    const {stars, ui} = newStars(served)
    served.release()
    stars.streamRest()
    const frame = () => stars.population?.preAnimCb()
    await settle(() => stars.catalogComplete(), frame)
    ui.camera.fov = 170
    ui.camera.updateProjectionMatrix()
    frame()
    let drawn = 0
    for (const t of stars.population.loaded.values()) {
      if (t.points.visible) {
        expect(t.points.geometry.drawRange.count).toBe(t.count)
        drawn += t.count
      }
    }
    expect(drawn).toBeGreaterThan(50000)
  })

  it('falls back to stars.dat whole: with no manifest, or a tile that fails', async () => {
    for (const served of [serve({noManifest: true}), serve({fail: new Set([packPath('3')])})]) {
      const {stars} = newStars(served)
      served.release()
      await settle(() => stars._catalogReady || !stars.population)
      stars.streamRest()
      expect(await settle(() => stars.catalogComplete())).toBe(true)
      expect(stars.population).toBeNull()
      expect(stars.catalog.numStars).toBe(106747)
      expect(stars.catalog.starByHip.size).toBe(106748)
      expect(stars.catalog.hipByName.get('Sirius')).toBe(SIRIUS)
      await settle(() => stars.drawn())
      expect(stars.drawn()).toBe(true)
      expect(stars.geom.idsByNdx.length).toBe(106748)
    }
  })
})
