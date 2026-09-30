import {LOD, Object3D} from 'three'
import CesiumLayers, {DECODE, decodeOf, meshRange, preloadNames, tilesReady} from './CesiumLayers.js'
import {CESIUM_BODIES} from './bodies.js'


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
    const drawsItsOwn = CESIUM_BODIES.earth.atmosphere
    try {
      // No body draws Cesium's atmosphere now (HDR.md); as if Earth did.
      CESIUM_BODIES.earth.atmosphere = true
      expect(L.atmosphereShare(earth)).toBe(0)
      L.active = [{name: 'earth', node: earth}, {name: 'mars', node: mars}]
      expect(L.atmosphereShare(earth)).toBe(0.5)
      expect(L.atmosphereShare(mars)).toBe(0)
      expect(L.atmosphereShare(null)).toBe(0)
    } finally {
      CESIUM_BODIES.earth.atmosphere = drawsItsOwn
    }
    expect(L.atmosphereShare(earth)).toBe(0)
  })
})


describe('decodeOf', () => {
  it('inverts the tone map for display values, scales albedo, into the HDR buffer', () => {
    expect(decodeOf('moon', true)).toBe(DECODE.NEUTRAL_INVERSE)
    expect(decodeOf('mars', true)).toBe(DECODE.NEUTRAL_INVERSE)
    expect(decodeOf('earth', true)).toBe(DECODE.LINEAR)
  })

  it('hands the LDR buffer display values', () => {
    expect(decodeOf('moon', false)).toBe(DECODE.NONE)
    expect(decodeOf('earth', false)).toBe(DECODE.LINEAR_TO_DISPLAY)
  })
})


describe('monthly imagery', () => {
  // Cesium, as far as monthlyImageryLayer and _updateMonthlyImagery use it.
  const Cesium = {
    ImageryLayer: class {
      constructor(provider) {
        this.url = provider.url
      }
    },
    UrlTemplateImageryProvider: class {
      constructor({url}) {
        this.url = url
      }
    },
    GeographicTilingScheme: class {},
  }
  let savedDocument
  beforeEach(() => {
    savedDocument = globalThis.document
    globalThis.document = {baseURI: 'https://example.org/'}
  })
  afterEach(() => {
    globalThis.document = savedDocument
  })
  const julianDayOf = (iso) => (Date.parse(iso) / 864e5) + 2440587.5
  const setup = (iso) => {
    const L = new CesiumLayers({})
    L.time = {simTimeJulianDay: () => julianDayOf(iso)}
    const list = [{url: 'base'}, {url: 'bing'}]
    const globe = {tilesLoaded: false}
    const layers = {
      get: (i) => list[i],
      add: (layer, i) => list.splice(i, 0, layer),
      remove: (layer) => list.splice(list.indexOf(layer), 1),
    }
    const body = {Cesium, month: 3, widget: {imageryLayers: layers, scene: {globe}}}
    return {L, list, globe, body, config: {monthlyImagery: {url: 't/2004-{MM}/{z}/{x}/{y}.jpg'}}}
  }

  it('adds the new month under the detail layer, and drops the old once the tiles are in', () => {
    const {L, list, globe, body, config} = setup('2026-07-15T00:00:00Z')
    L._updateMonthlyImagery(body, config)
    expect(list.map((l) => l.url)).toEqual(['base', 'https://example.org/t/2004-07/{z}/{x}/{y}.jpg', 'bing'])
    L._updateMonthlyImagery(body, config)
    expect(list.length).toBe(3)
    globe.tilesLoaded = true
    L._updateMonthlyImagery(body, config)
    expect(list.map((l) => l.url)).toEqual(['https://example.org/t/2004-07/{z}/{x}/{y}.jpg', 'bing'])
    expect(body.month).toBe(7)
  })

  it('leaves the base alone within a month', () => {
    const {L, list, body, config} = setup('2026-03-31T12:00:00Z')
    L._updateMonthlyImagery(body, config)
    expect(list.map((l) => l.url)).toEqual(['base', 'bing'])
  })
})


describe('ground height', () => {
  const setup = () => {
    const L = new CesiumLayers({})
    const moon = {}
    const earth = {}
    L.bodies.moon = {groundHeight: 4200}
    L.active = [{name: 'moon', node: moon}]
    return {L, moon, earth}
  }

  it('is the active layer\'s last sample for its body', () => {
    const {L, moon, earth} = setup()
    expect(L.groundHeight(moon)).toBe(4200)
    expect(L.groundHeight(earth)).toBe(null)
    L.active = []
    expect(L.groundHeight(moon)).toBe(null)
  })

  it('is sampled no more often than every GROUND_SAMPLE_MS, and only near the surface', () => {
    const L = new CesiumLayers({})
    let height = 0
    let calls = 0
    const body = {
      Cesium: {Cartographic: class {}, Ellipsoid: {}},
      ellipsoid: {cartesianToCartographic: () => ({height})},
      widget: {scene: {camera: {position: {}}, globe: {getHeight: () => ++calls * 10}}},
    }
    L._now = 1000
    L._sampleGround(body, 'earth')
    expect(body.groundHeight).toBe(10)
    L._now = 1100
    L._sampleGround(body, 'earth')
    expect(calls).toBe(1)
    L._now = 1300
    height = 2e5
    L._sampleGround(body, 'earth')
    expect(body.groundHeight).toBe(null)
  })
})
