import {clearSharedImages, sharedBlob, sharedObjectUrl} from '../sharedImage.js'
import CloudMap from './CloudMap.js'
import {CLOUD_TILE_LEVEL, tileGrid} from './cloudSource.js'


// CloudMap with a stand-in for the browser: what it requests, and when.
// Each blob holds a word saying what its picture is; createImageBitmap and
// the canvas turn that into pixels.
const {width: W, height: H} = tileGrid(CLOUD_TILE_LEVEL)
const GROUND_URL = 'textures/earth/blue-marble/2004-10.jpg'
const BUNDLED_URL = 'textures/earth/earth_atmos.jpg'
const FILL_URL = 'textures/earth/earth_atmos_fill.jpg'
const GROUND_PATTERN = 'earth/blue-marble/2004-{MM}'
const BUNDLED_PATH = 'earth/earth_atmos.jpg'
const FILL_PATH = 'earth/earth_atmos_fill.jpg'
const SETTLE_MS = 1000
const OCEAN = [10, 20, 60]
const CLOUD = [235, 235, 235]
const BUNDLED_GREY = 128
const BEFORE_THE_SATELLITES = Date.UTC(1999, 0, 1)

const NOW = Date.UTC(2026, 9, 14, 12)
const THE_11TH = Date.UTC(2026, 9, 11, 12)

const saved = {}
let requests
let clock
// What the tile at a URL shows: 'cloud', 'black' (no data), 'polar' (none
// north of 72° N: the tile's top quarter), or null (404).
let serveTile


/**
 * @param {string} word What the picture is
 * @param {number} w
 * @param {number} h
 * @returns {Uint8ClampedArray} Its RGBA
 */
function pixels(word, w, h) {
  const px = new Uint8ClampedArray(w * h * 4)
  const colour = {
    ground: OCEAN, cloud: CLOUD, polar: CLOUD, black: [0, 0, 0], bundled: [BUNDLED_GREY, BUNDLED_GREY, BUNDLED_GREY],
  }[word]
  const blackRows = word === 'polar' ? h / 4 : 0
  for (let i = 0; i < w * h; i++) {
    px.set(i < blackRows * w ? [0, 0, 0, 255] : [...colour, 255], 4 * i)
  }
  return px
}


beforeEach(() => {
  for (const key of ['fetch', 'document', 'createImageBitmap', 'OffscreenCanvas']) {
    saved[key] = globalThis[key]
  }
  saved.now = performance.now
  clearSharedImages()
  requests = []
  clock = 0
  serveTile = () => 'cloud'
  performance.now = () => clock
  globalThis.document = {}
  globalThis.fetch = (url) => {
    requests.push(url)
    let word
    if (url.endsWith(GROUND_URL)) {
      word = 'ground'
    } else if (url.endsWith(BUNDLED_URL) || url.endsWith(FILL_URL)) {
      word = 'bundled'
    } else {
      word = serveTile(url)
      if (!word) {
        return Promise.resolve(new Response('', {status: 404}))
      }
    }
    return Promise.resolve(new Response(word))
  }
  globalThis.createImageBitmap = async (blob) => ({word: await blob.text(), close() {}})
  globalThis.OffscreenCanvas = class {
    constructor(w, h) {
      this.w = w
      this.h = h
    }

    getContext() {
      return {
        drawImage: (bitmap) => {
          this.word = bitmap.word
        },
        getImageData: () => ({data: pixels(this.word, this.w, this.h)}),
      }
    }
  }
})


afterEach(() => {
  for (const key of ['fetch', 'document', 'createImageBitmap', 'OffscreenCanvas']) {
    if (saved[key] === undefined) {
      delete globalThis[key]
    } else {
      globalThis[key] = saved[key]
    }
  }
  performance.now = saved.now
  clearSharedImages()
})


/**
 * Let a date settle, start the load, and wait for it to finish.
 *
 * @param {CloudMap} map
 * @param {number} simMs
 */
async function load(map, simMs) {
  map.update(simMs, NOW)
  clock += SETTLE_MS + 1
  map.update(simMs, NOW)
  const done = () => map.status.seam?.state !== 'building' && (map.status.ready || map.status.loaded)
  for (let i = 0; i < 400 && !(map.status.kind !== 'none' && done()); i++) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}


const count = (suffix) => requests.filter((url) => url.endsWith(suffix)).length
const tiles = () => requests.filter((url) => url.includes('gibs.earthdata.nasa.gov'))

const newMap = () => new CloudMap({groundPattern: GROUND_PATTERN, bundledPath: BUNDLED_PATH, fillPath: FILL_PATH})


describe('CloudMap loading', () => {
  it('fetches a day\'s month of Blue Marble once, and not the bundled clouds, if no pixel is unseen', async () => {
    const map = newMap()
    await load(map, THE_11TH)
    expect(map.status).toMatchObject({kind: 'daily', ready: true, filled: 0})
    expect(count(GROUND_URL)).toBe(1)
    expect(count(BUNDLED_URL)).toBe(0)
    expect(count(FILL_URL)).toBe(0)
    // The map is the mosaic's clouds: full coverage everywhere.
    expect(map.coverage.every((v) => v === 255)).toBe(true)
    expect(map.coverage.length).toBe(W * H)
  })

  it('takes the Blue Marble the surface has already fetched: one fetch for both', async () => {
    // Planet.monthlyMap's ask, a moment before the clouds'.
    const surface = sharedBlob(GROUND_URL)
    const map = newMap()
    await load(map, THE_11TH)
    await surface
    expect(count(GROUND_URL)).toBe(1)
    // And Cesium's, later.
    await sharedObjectUrl(GROUND_URL)
    expect(count(GROUND_URL)).toBe(1)
  })

  it('fetches the small copy, after the tiles, to fill the polar night, and not the 1.4 MB texture', async () => {
    // Polar night: no data north of 72° N.
    serveTile = (url) => (/\/2\/0\/\d+\.jpeg$/.test(url) ? 'polar' : 'cloud')
    const map = newMap()
    let tilesBefore = -1
    const fetchFill = globalThis.fetch
    globalThis.fetch = (url) => {
      if (url.endsWith(FILL_URL)) {
        tilesBefore = tiles().length
      }
      return fetchFill(url)
    }
    await load(map, THE_11TH)
    expect(map.status.ready).toBe(true)
    expect(count(FILL_URL)).toBe(1)
    expect(count(BUNDLED_URL)).toBe(0)
    expect(count(GROUND_URL)).toBe(1)
    // Not before the day's tiles: the 15 are in (the seam's three are
    // fetched after the day).
    expect(tilesBefore).toBeGreaterThanOrEqual(15)
    expect(map.status.filled).toBeGreaterThan(0)
    // The pixels no layer saw have the bundled texture's coverage, the rest the mosaic's.
    expect(map.coverage[0]).not.toBe(255)
    expect(map.coverage[(H - 1) * W / 2]).toBe(255)
  })

  it('fetches the full bundled texture for a tile no layer serves: a gap in daylight', async () => {
    serveTile = (url) => (/\/2\/1\/2\.jpeg$/.test(url) ? null : 'cloud')
    const warn = console.warn
    console.warn = () => null
    const map = newMap()
    await load(map, THE_11TH)
    console.warn = warn
    expect(map.status.tilesFailed).toBe(1)
    expect(count(BUNDLED_URL)).toBe(1)
    expect(count(FILL_URL)).toBe(0)
    expect(count(GROUND_URL)).toBe(1)
  })

  it('fetches the bundled clouds, and no Blue Marble, for a date before the satellites', async () => {
    const map = newMap()
    await load(map, BEFORE_THE_SATELLITES)
    expect(map.status).toMatchObject({kind: 'bundled', loaded: true})
    expect(count(BUNDLED_URL)).toBe(1)
    expect(count(FILL_URL)).toBe(0)
    expect(count(GROUND_URL)).toBe(0)
    expect(tiles().length).toBe(0)
  })

  it('uses the full texture for a polar gap if it is in already: the exact one', async () => {
    // A date with no mosaic first (the full texture), then a day with polar night.
    const map = newMap()
    await load(map, BEFORE_THE_SATELLITES)
    serveTile = (url) => (/\/2\/0\/\d+\.jpeg$/.test(url) ? 'polar' : 'cloud')
    await load(map, THE_11TH)
    expect(map.status.ready).toBe(true)
    expect(count(BUNDLED_URL)).toBe(1)
    expect(count(FILL_URL)).toBe(0)
  })

  it('fetches nothing at all until the date has settled', () => {
    const map = newMap()
    map.update(THE_11TH, NOW)
    clock += SETTLE_MS - 1
    map.update(THE_11TH, NOW)
    expect(requests).toEqual([])
  })
})
