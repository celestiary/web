import {AlwaysDepth, LOD, Object3D, PerspectiveCamera, Vector3} from 'three'
import {ASTRO_UNIT_METER} from '../../shared.js'
import {exposureAt, METER_EVERY_FRAMES, nightLightRadiance} from '../exposure.js'
import CesiumLayers, {bodyGain, meshRange, preloadNames, tilesReady} from './CesiumLayers.js'
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


describe('decode', () => {
  it('scales every body by DISPLAY_GAIN and its imagery against celestiary\'s texture', () => {
    expect(bodyGain('earth')).toBeCloseTo(bodyGain('mars'), 10)
    expect(bodyGain('moon') / bodyGain('earth')).toBeCloseTo(1.3 / 0.82, 10)
  })

  it('draws the globe over whatever its stencil admitted, depth or not', () => {
    // A depth test here failed where a line or point behind the body had
    // written a nearer depth than the decoded one, and drew it over the
    // globe (#141's review).  The stencil shell does the occlusion.
    const {material} = new CesiumLayers({}).decode
    expect(material.depthTest).toBe(true)
    expect(material.depthFunc).toBe(AlwaysDepth)
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

  it('is pending while a wanted layer has no height yet, not once it has one or has failed', () => {
    const L = new CesiumLayers({useStore: {getState: () => ({bodyLayers: {}})}})
    const earth = {props: {name: 'earth'}}
    // Not loaded yet, loading, and loaded but not active: pending.
    expect(L.groundPending(earth)).toBe(true)
    L.bodies.earth = {status: 'loading'}
    expect(L.groundPending(earth)).toBe(true)
    L.bodies.earth = {status: 'ready'}
    expect(L.groundPending(earth)).toBe(true)
    // Active with a height: known.
    L.bodies.earth.groundHeight = -400
    L.active = [{name: 'earth', node: earth}]
    expect(L.groundPending(earth)).toBe(false)
    expect(L.groundHeight(earth)).toBe(-400)
    // Failed: the sphere is the ground.
    L.active = []
    L.bodies.earth = {status: 'error'}
    expect(L.groundPending(earth)).toBe(false)
    // Not wanted: celestiary's own body is chosen, or the body has no layer.
    const chosen = new CesiumLayers({useStore: {getState: () => ({bodyLayers: {earth: 'celestiary'}})}})
    expect(chosen.groundPending(earth)).toBe(false)
    expect(L.groundPending({props: {name: 'venus'}})).toBe(false)
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


describe('hiding the celestiary surface', () => {
  const body = () => {
    const node = new Object3D()
    const surface = new Object3D()
    surface.name = 'planet surface and guides'
    const places = new Object3D()
    node.add(surface)
    node.add(places)
    node.places = places
    return {node, surface, places}
  }

  it('hides the surface group but leaves the place labels, which draw over Cesium (#172)', () => {
    const L = new CesiumLayers({})
    const {node, surface, places} = body()
    L._hideSurface(node)
    expect(surface.visible).toBe(false)
    expect(places.visible).toBe(true)
    expect(L.hidden.has(places)).toBe(false)
  })

  it('puts the surface back, and tolerates a body without one', () => {
    const L = new CesiumLayers({})
    const {node, surface} = body()
    L._hideSurface(node)
    L._hideSurface(node)
    L._restore()
    expect(surface.visible).toBe(true)
    expect(() => L._hideSurface(new Object3D())).not.toThrow()
  })
})


describe('night lights', () => {
  const layers = (exposure, frame) => new CesiumLayers({renderer: {toneMappingExposure: exposure}, _frame: frame})
  const body = {night: {}, nightInView: true}
  // The renderer's exposure at which the brightest light is a display step.
  const step = (1 / 255) / nightLightRadiance()

  it('are skipped with no night side in the frame, or no night layer', () => {
    expect(layers(step * 1e3, 1)._lightsShow({...body, nightInView: false})).toBe(false)
    expect(layers(step * 1e3, 1)._lightsShow({nightInView: true})).toBe(false)
  })

  it('draw where the brightest could reach half a display step', () => {
    expect(layers(step, 1)._lightsShow(body)).toBe(true)
    expect(layers(step * 0.6, 1)._lightsShow(body)).toBe(true)
  })

  it('under it, are skipped but on the frames the meter reads', () => {
    expect(layers(step * 0.4, 1)._lightsShow(body)).toBe(false)
    expect(layers(step * 0.4, METER_EVERY_FRAMES * 3)._lightsShow(body)).toBe(true)
    // By day the lights are far under it: Earth's keyed exposure, gain 1.
    expect(layers(exposureAt(ASTRO_UNIT_METER), 2)._lightsShow(body)).toBe(false)
  })
})


describe('activation', () => {
  const planet = (name, radius, position) => {
    const lod = new LOD()
    lod.name = 'planet LOD'
    const node = new Object3D()
    node.props = {name, radius: {scalar: radius}}
    lod.addLevel(node, 1)
    lod.addLevel(new Object3D(), 1e12)
    lod.position.copy(position)
    lod.updateMatrixWorld(true)
    return node
  }
  const setup = (cameraAt, lookAt) => {
    const earth = planet('earth', 6371e3, new Vector3(0, 0, 0))
    const moon = planet('moon', 1737.4e3, new Vector3(3.844e8, 0, 0))
    const camera = new PerspectiveCamera(45, 16 / 9, 1, 1e13)
    camera.position.copy(cameraAt)
    camera.lookAt(lookAt)
    camera.updateMatrixWorld(true)
    const L = new CesiumLayers({camera, height: 837, sceneManager: {objects: {earth, moon}}})
    return {L, earth, moon}
  }

  it('drops the Moon under the horizon from Earth\'s ground, looking down', () => {
    // 7.5 km over the point facing away from the Moon, looking down at the
    // ground, which hides the Moon behind it.
    const {L, earth, moon} = setup(new Vector3(-(6371e3 + 7500), 0, 0), new Vector3(0, 0, 0))
    expect(L._visibleAt('earth', earth)).not.toBe(null)
    expect(L._visibleAt('moon', moon)).toBe(null)
  })

  it('keeps the Moon over the horizon, looking at it', () => {
    const {L, moon} = setup(new Vector3(6371e3 + 7500, 0, 0), new Vector3(3.844e8, 0, 0))
    expect(L._visibleAt('moon', moon)).not.toBe(null)
  })

  it('drops a body under MIN_PIXEL_RADIUS', () => {
    // The Moon from 1,200,000 km past it, 1.5 px in radius at 837 px; at
    // 600,000 km, 3 px.
    const far = setup(new Vector3(3.844e8 + 1.2e9, 0, 0), new Vector3(3.844e8, 0, 0))
    expect(far.L._visibleAt('moon', far.moon)).toBe(null)
    const near = setup(new Vector3(3.844e8 + 6e8, 0, 0), new Vector3(3.844e8, 0, 0))
    expect(near.L._visibleAt('moon', near.moon)).not.toBe(null)
  })
})
