import {clearSharedImages, sharedObjectUrl} from '../sharedImage.js'
import {MONTH_FADE_PER_S, monthBlendOfJulianDay, overAlphas} from '../monthly.js'
import {TILES_WAIT_MS, addDetail, createSeason, monthlyBaseLayer, updateSeason} from './season.js'
import {CESIUM_BODIES} from './bodies.js'


// Cesium, as far as season.js uses it.
const makeCesium = () => {
  const calls = {worldImagery: 0}
  const events = () => {
    const list = []
    return {list, addEventListener: (f) => list.push(f), raiseEvent: (...a) => list.forEach((f) => f(...a))}
  }
  const ion = {settle: null}
  class ImageryLayer {
    constructor(provider, options) {
      this.url = provider.url
      this.options = options
      this.provider = provider
      this.alpha = 1
      this.ready = true
      this.errorEvent = events()
    }

    // The provider comes as a promise, as Cesium's fromUrl gives it: the
    // layer is ready, with its url, once that has resolved.
    static fromProviderAsync(provider, options) {
      const layer = new ImageryLayer({}, options)
      layer.ready = false
      layer.loaded = Promise.resolve(provider).then((p) => {
        layer.url = p.url
        layer.provider = p
        layer.ready = true
      }, (err) => layer.errorEvent.raiseEvent(err))
      return layer
    }
  }
  const Cesium = {
    calls,
    ion,
    ImageryLayer,
    SingleTileImageryProvider: {fromUrl: (url) => ({url, single: true})},
    UrlTemplateImageryProvider: class {
      constructor({url, minimumLevel}) {
        this.url = url
        this.minimumLevel = minimumLevel
      }
    },
    GeographicTilingScheme: class {},
    WebMercatorTilingScheme: class {
      getNumberOfXTilesAtLevel(level) {
        return 2 * (2 ** level)
      }
    },
    createWorldImageryAsync: () => {
      calls.worldImagery++
      return new Promise((resolve, reject) => {
        ion.settle = {resolve, reject}
      })
    },
  }
  return Cesium
}


const makeBody = (Cesium, month) => {
  const list = []
  const layers = {
    get length() {
      return list.length
    },
    get: (i) => list[i],
    indexOf: (l) => list.indexOf(l),
    add: (layer, i) => list.splice(i ?? list.length, 0, layer),
    remove: (layer) => {
      const i = list.indexOf(layer)
      if (i >= 0) {
        list.splice(i, 1)
      }
      return i >= 0
    },
  }
  const globe = {tilesLoaded: false}
  const widget = {imageryLayers: layers, scene: {globe}, isDestroyed: () => false}
  const config = CESIUM_BODIES.earth
  const base = monthlyBaseLayer(Cesium, config.monthlyImagery, month)
  list.push(base)
  const season = createSeason(Cesium, widget, base, config.monthlyImagery, month)
  const night = {night: true, alpha: 0}
  list.push(night)
  return {body: {Cesium, widget, season}, list, globe, config, night}
}


const julianDayOf = (iso) => (Date.parse(iso) / 864e5) + 2440587.5
const blendOn = (iso) => monthBlendOfJulianDay(julianDayOf(iso))
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))


let fetched
let savedDocument
let savedFetch
beforeEach(() => {
  savedDocument = globalThis.document
  savedFetch = globalThis.fetch
  globalThis.document = {baseURI: 'https://example.org/'}
  clearSharedImages()
  fetched = []
  globalThis.fetch = (url) => {
    fetched.push(url)
    return Promise.resolve(new Response(`bytes of ${url}`))
  }
})
afterEach(() => {
  globalThis.document = savedDocument
  globalThis.fetch = savedFetch
  clearSharedImages()
})


describe('the globe through the year (season.js)', () => {
  it('shows the month alone at its middle, as before', () => {
    const Cesium = makeCesium()
    const {body, list, config, night} = makeBody(Cesium, 7)
    updateSeason(body, config, blendOn('2026-07-16T12:00:00Z'), 0)
    expect(list).toHaveLength(3)
    expect(list[2]).toBe(night)
    expect(list[0].alpha).toBe(1)
  })

  it('adds the next month over it at alpha 0, and fades it in once its map is in', async () => {
    const Cesium = makeCesium()
    const {body, list, globe, config, night} = makeBody(Cesium, 7)
    // The 1st of August: July and August about half and half.
    const blend = blendOn('2026-08-01T00:00:00Z')
    expect(blend.a).toBe(7)
    expect(blend.w).toBeCloseTo(0.5, 1)
    updateSeason(body, config, blend, 0)
    expect(list).toHaveLength(5)
    expect(list[4]).toBe(night)
    const [, , map8, tiles8] = list
    await settle()
    expect(map8.url).toBe(await sharedObjectUrl('textures/earth/blue-marble/2004-08.jpg'))
    expect(tiles8.url).toContain('2004-08/{z}/{x}/{y}.jpg')
    expect(map8.alpha).toBe(0)
    // Its map in, the tiles not yet: still 0.
    updateSeason(body, config, blend, 16)
    expect(map8.alpha).toBe(0)
    globe.tilesLoaded = true
    let shown = 0
    for (let t = 32; t < 1000; t += 16) {
      updateSeason(body, config, blend, t)
      // No step bigger than the fade's.
      const now = body.season.entries[1].shown
      expect(now - shown).toBeLessThanOrEqual((MONTH_FADE_PER_S * 0.016) + 1e-9)
      shown = now
      expect(tiles8.alpha).toBe(map8.alpha)
    }
    expect(list[0].alpha).toBe(1)
    expect(map8.alpha).toBeCloseTo(overAlphas([1 - blend.w, blend.w])[1], 9)
  })

  it('takes a month\'s map whose tiles never settle after a while', async () => {
    const Cesium = makeCesium()
    const {body, list, config} = makeBody(Cesium, 7)
    const blend = blendOn('2026-08-01T00:00:00Z')
    updateSeason(body, config, blend, 0)
    await settle()
    updateSeason(body, config, blend, 100)
    updateSeason(body, config, blend, 100 + TILES_WAIT_MS + 1)
    updateSeason(body, config, blend, 100 + TILES_WAIT_MS + 500)
    expect(list[2].alpha).toBeGreaterThan(0)
  })

  it('follows a timelapse through the month, and drops the month it has left', async () => {
    const Cesium = makeCesium()
    const {body, list, globe, config, night} = makeBody(Cesium, 7)
    globe.tilesLoaded = true
    const day = 864e5
    let t = 0
    for (let ms = Date.parse('2026-07-16T12:00:00Z'); ms < Date.parse('2026-08-25T00:00:00Z'); ms += day / 4) {
      updateSeason(body, config, monthBlendOfJulianDay((ms / day) + 2440587.5), t)
      await settle()
      t += 50
    }
    // August and September, July gone.
    expect(body.season.entries.map((e) => e.month)).toEqual([8, 9])
    expect(list).toHaveLength(5)
    expect(list[4]).toBe(night)
    const blend = blendOn('2026-08-24T18:00:00Z')
    expect(list[2].alpha).toBeCloseTo(blend.w, 6)
  })

  it('keeps what it shows after a jump in date until the new month is in', async () => {
    const Cesium = makeCesium()
    const {body, list, globe, config} = makeBody(Cesium, 7)
    globe.tilesLoaded = true
    await settle()
    // December's map never comes.
    Cesium.SingleTileImageryProvider.fromUrl = () => new Promise(() => undefined)
    const july = list[0]
    const blend = blendOn('2026-12-15T12:00:00Z')
    for (let t = 0; t < 2000; t += 16) {
      updateSeason(body, config, blend, t)
    }
    expect(list).toContain(july)
    expect(july.alpha).toBe(1)
    expect(list[2].alpha).toBe(0)
  })

  it('takes the map from the one download, which the surface and the clouds share', async () => {
    const Cesium = makeCesium()
    const surface = await sharedObjectUrl('textures/earth/blue-marble/2004-07.jpg')
    const {list} = makeBody(Cesium, 7)
    await settle()
    expect(list[0].url).toBe(surface)
    expect(fetched).toEqual(['textures/earth/blue-marble/2004-07.jpg'])
  })

  it('gives Cesium the image\'s own URL to try if the shared download failed', async () => {
    globalThis.fetch = () => Promise.resolve(new Response('', {status: 500}))
    const Cesium = makeCesium()
    const {list} = makeBody(Cesium, 7)
    await settle()
    await settle()
    expect(list[0].url).toBe('https://example.org/textures/earth/blue-marble/2004-07.jpg')
  })

  it('serves the tiles only from the globe level the map stops at', () => {
    const Cesium = makeCesium()
    const {list} = makeBody(Cesium, 7)
    expect(list[1].options).toEqual({minimumTerrainLevel: 3})
    expect(list[1].provider.minimumLevel).toBe(3)
  })
})


describe('ion\'s detail over the months (season.js addDetail)', () => {
  const ionFailure = (err) => `HTTP ${err.statusCode}`
  const inner = () => ({
    tilingScheme: new (makeCesium().WebMercatorTilingScheme)(),
    tileWidth: 256,
    errorEvent: {list: [], addEventListener(f) {
      this.list.push(f)
    }},
  })

  it('puts a detail layer for each month over the months\' maps, under the night lights, faded in', async () => {
    const Cesium = makeCesium()
    const {body, list, globe, config, night} = makeBody(Cesium, 7)
    globe.tilesLoaded = true
    const blend = blendOn('2026-08-01T00:00:00Z')
    updateSeason(body, config, blend, 0)
    addDetail(body, config, ionFailure)
    expect(Cesium.calls.worldImagery).toBe(1)
    const [, , , , d7, d8] = list
    expect(list).toHaveLength(7)
    expect(list[6]).toBe(night)
    expect(d7.options).toEqual({minimumTerrainLevel: config.detailFromLevel})
    Cesium.ion.settle.resolve(inner())
    await settle()
    await settle()
    expect(d7.provider.lowLevel).toBe(4)
    for (let t = 16; t < 4000; t += 16) {
      updateSeason(body, config, blend, t)
      if (t === 16 + (16 * 5)) {
        // On the way in.
        expect(body.season.detail).toBeLessThan(0.2)
      }
    }
    expect(body.season.detail).toBe(1)
    // The details mixed as the maps are: the month's share, over the bases entirely.
    expect(d7.alpha).toBe(1)
    expect(d8.alpha).toBeCloseTo(blend.w, 6)
  })

  it('gives a month added later its detail too', () => {
    const Cesium = makeCesium()
    const {body, list, config, night} = makeBody(Cesium, 7)
    addDetail(body, config, ionFailure)
    updateSeason(body, config, blendOn('2026-08-01T00:00:00Z'), 0)
    // Map 7, tiles 7, map 8, tiles 8, detail 7, detail 8, the lights.
    expect(list).toHaveLength(7)
    expect(list[4]).toBe(body.season.entries[0].detail)
    expect(list[5]).toBe(body.season.entries[1].detail)
    expect(list[6]).toBe(night)
  })

  it('drops the detail quietly when ion refuses it, keeping the Blue Marble', async () => {
    const Cesium = makeCesium()
    const {body, list, config} = makeBody(Cesium, 7)
    const warnings = []
    const warn = console.warn
    console.warn = (...args) => warnings.push(args.join(' '))
    try {
      addDetail(body, config, ionFailure)
      expect(list).toHaveLength(4)
      // A 403 whose body echoes the token: said by status only.
      Cesium.ion.settle.reject({statusCode: 403, response: {responseText: 'access_token=SECRET'}})
      await settle()
      await settle()
    } finally {
      console.warn = warn
    }
    expect(list).toHaveLength(3)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('HTTP 403')
    expect(warnings[0]).not.toContain('SECRET')
  })
})
