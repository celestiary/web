import {AlwaysDepth, LOD, Matrix4, Object3D, PerspectiveCamera, Vector3} from 'three'
import * as netgl from '@pablo-mayrgundter/portal-netgl/core'
import {ASTRO_UNIT_METER} from '../../shared.js'
import {exposureAt, METER_EVERY_FRAMES, nightLightRadiance} from '../exposure.js'
import {MeterCadence} from '../meterReadback.js'
import {clearSharedImages, sharedObjectUrl} from '../sharedImage.js'
import CesiumLayers, {bodyGain, meshRange, preloadNames, tilesReady} from './CesiumLayers.js'
import GuestPages from './guestPages.js'
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
    expect(bodyGain('moon') / bodyGain('earth')).toBeCloseTo(CESIUM_BODIES.moon.textureGain / CESIUM_BODIES.moon.imageryScale, 10)
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
  // Cesium, as far as monthlyBaseLayer, monthlyTileLayer and
  // _updateMonthlyImagery use it.
  const Cesium = {
    ImageryLayer: class {
      constructor(provider, options) {
        this.url = provider.url
        this.options = options
        this.provider = provider
      }

      // The provider comes as a promise, as Cesium's SingleTileImageryProvider.fromUrl
      // gives it: the layer has its url once that has resolved.
      static fromProviderAsync(provider) {
        const layer = new Cesium.ImageryLayer({})
        layer.ready = true
        layer.loaded = Promise.resolve(provider).then((p) => {
          layer.url = p.url
          layer.provider = p
        })
        return layer
      }
    },
    SingleTileImageryProvider: {fromUrl: (url) => ({url, single: true})},
    UrlTemplateImageryProvider: class {
      constructor({url, minimumLevel}) {
        this.url = url
        this.minimumLevel = minimumLevel
      }
    },
    GeographicTilingScheme: class {},
  }
  let savedDocument
  let savedFetch
  let fetched
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
  const julianDayOf = (iso) => (Date.parse(iso) / 864e5) + 2440587.5
  const config = {monthlyImagery: {
    url: 't/2004-{MM}/{z}/{x}/{y}.jpg', singleUrl: 't/2004-{MM}.jpg', fromLevel: 3,
  }}
  // The month's map is given to Cesium as a blob: URL of the one download
  // (sharedImage.js), the same URL the surface and the clouds' use.
  const mapUrl = (mm) => sharedObjectUrl(`t/2004-${mm}.jpg`)
  const loaded = (list) => Promise.all(list.map((l) => l.loaded))
  const tilesUrl = (mm) => `https://example.org/t/2004-${mm}/{z}/{x}/{y}.jpg`
  const setup = (iso) => {
    const L = new CesiumLayers({})
    L.time = {simTimeJulianDay: () => julianDayOf(iso)}
    const list = [{url: 'map'}, {url: 'tiles'}, {url: 'bing'}]
    const globe = {tilesLoaded: false}
    const layers = {
      get: (i) => list[i],
      add: (layer, i) => list.splice(i, 0, layer),
      remove: (layer) => list.splice(list.indexOf(layer), 1),
    }
    const body = {Cesium, month: 3, widget: {imageryLayers: layers, scene: {globe}}}
    return {L, list, globe, body}
  }

  it('adds the new month under the detail layer, and drops the old once the tiles are in', async () => {
    const {L, list, globe, body} = setup('2026-07-15T00:00:00Z')
    L._updateMonthlyImagery(body, config)
    await loaded(list)
    expect(list.map((l) => l.url)).toEqual(['map', 'tiles', await mapUrl('07'), tilesUrl('07'), 'bing'])
    L._updateMonthlyImagery(body, config)
    expect(list.length).toBe(5)
    globe.tilesLoaded = true
    L._updateMonthlyImagery(body, config)
    expect(list.map((l) => l.url)).toEqual([await mapUrl('07'), tilesUrl('07'), 'bing'])
    expect(body.month).toBe(7)
  })

  it('keeps the old month until the new map has loaded', async () => {
    const {L, list, globe, body} = setup('2026-07-15T00:00:00Z')
    L._updateMonthlyImagery(body, config)
    body.newBase.ready = false
    globe.tilesLoaded = true
    L._updateMonthlyImagery(body, config)
    expect(list.length).toBe(5)
    body.newBase.ready = true
    L._updateMonthlyImagery(body, config)
    await loaded(list)
    expect(list.map((l) => l.url)).toEqual([await mapUrl('07'), tilesUrl('07'), 'bing'])
  })

  it('leaves the base alone within a month', () => {
    const {L, list, body} = setup('2026-03-31T12:00:00Z')
    L._updateMonthlyImagery(body, config)
    expect(list.map((l) => l.url)).toEqual(['map', 'tiles', 'bing'])
  })

  it('serves the tiles only from the globe level the map stops at', async () => {
    const {L, list, body} = setup('2026-07-15T00:00:00Z')
    L._updateMonthlyImagery(body, config)
    await loaded(list)
    const [map, tiles] = [list[2], list[3]]
    expect(map.provider.single).toBe(true)
    expect(map.options).toBeUndefined()
    expect(tiles.options).toEqual({minimumTerrainLevel: 3})
    expect(tiles.provider.minimumLevel).toBe(3)
  })

  it('takes the map from the one download, which the surface and the clouds share: no request of its own', async () => {
    const {L, list, body} = setup('2026-07-15T00:00:00Z')
    // The surface's ask (Planet.monthlyMap), a moment before.
    const surface = await sharedObjectUrl('t/2004-07.jpg')
    L._updateMonthlyImagery(body, config)
    await loaded(list)
    expect(list[2].url).toBe(surface)
    expect(fetched).toEqual(['t/2004-07.jpg'])
  })

  it('gives Cesium the image\'s own URL to try if the shared download failed', async () => {
    globalThis.fetch = () => Promise.resolve(new Response('', {status: 500}))
    const {L, list, body} = setup('2026-07-15T00:00:00Z')
    L._updateMonthlyImagery(body, config)
    await loaded(list)
    expect(list[2].url).toBe('https://example.org/t/2004-07.jpg')
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
  // A stand-in ThreeUi, `frame` frames in, asking the meter's cadence as it does.
  const layers = (exposure, frame) => {
    const cadence = new MeterCadence()
    cadence.frame = frame
    return new CesiumLayers({renderer: {toneMappingExposure: exposure}, isMeterFrame: () => cadence.isSampleFrame()})
  }
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

  it('draw on exactly the frames the meter samples', () => {
    // As ThreeUi: the composite asks isMeterFrame (the cadence's
    // isSampleFrame), then _meter ends the frame with advance, metering when
    // it returns true.
    const cadence = new MeterCadence()
    const L = new CesiumLayers({renderer: {toneMappingExposure: step * 0.4}, isMeterFrame: () => cadence.isSampleFrame()})
    const drawn = []
    const metered = []
    for (let f = 0; f < 4 * METER_EVERY_FRAMES; f++) {
      if (L._lightsShow(body)) {
        drawn.push(f)
      }
      if (cadence.advance()) {
        metered.push(f)
      }
    }
    expect(metered).toEqual([0, 1, 2, 3].map((k) => k * METER_EVERY_FRAMES))
    expect(drawn).toEqual(metered)
  })

  it('draw when the meter frames are unknown', () => {
    expect(new CesiumLayers({renderer: {toneMappingExposure: step * 0.4}})._lightsShow(body)).toBe(true)
  })

  it('draw New York black, not hidden, so its buildings hide the lights under them', () => {
    // Hidden, the globe's night imagery drew in the city's pixels (the day
    // frame's stencil): Black Marble's texels as blocky blue bands on its
    // facades at night's gain (CESIUM.md, "New York", the night's bands)
    const renderer = {
      toneMappingExposure: step * 1e3,
      setRenderTarget() {},
      getClearColor() {},
      getClearAlpha: () => 1,
      setClearColor() {},
      clear() {},
      resetState() {},
      render() {},
    }
    const L = new CesiumLayers({renderer, camera: new PerspectiveCamera(), isMeterFrame: () => true})
    const seen = []
    const city = {
      renderer: {show: true},
      occluding: false,
      setShown() {
        throw new Error('the city must stay drawn in the lights\' frame')
      },
      setOccluding(on) {
        this.occluding = on
      },
    }
    L._newYork = {status: 'ready', city}
    const globe = {baseColor: null, enableLighting: true}
    const night = {alpha: 1}
    const widget = {
      scene: {globe},
      imageryLayers: {length: 1, get: () => night},
      render: () => seen.push({shown: city.renderer.show, occluding: city.occluding}),
    }
    const lightsBody = {night, nightInView: true, widget, Cesium: {Color: {BLACK: 'black'}, Ellipsoid: {}},
      link: {frame: (fn) => fn()}}
    const node = new Object3D()
    node.props = {radius: {scalar: 1}}
    L.bodies.earth = lightsBody
    L._drawNightLights({}, {}, 'earth', node)
    expect(seen).toEqual([{shown: true, occluding: true}])
    expect(city.occluding).toBe(false)
    expect(city.renderer.show).toBe(true)
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


describe('ion requests', () => {
  const rad = (deg) => deg * Math.PI / 180
  // Cesium, as far as _requestIon and addIonImagery use it: counts what
  // would ask ion for the imagery (a billed session).
  const setup = () => {
    const calls = {imagery: 0}
    const night = {night: true}
    const layers = [{base: true}, night]
    const listeners = {error: [], ready: []}
    const imagery = {
      errorEvent: {addEventListener: (f) => listeners.error.push(f)},
      readyEvent: {addEventListener: (f) => listeners.ready.push(f)},
    }
    const imageryLayers = {
      indexOf: (l) => layers.indexOf(l),
      add: (l, i) => layers.splice(i ?? layers.length, 0, l),
      remove: (l) => {
        const i = layers.indexOf(l)
        if (i >= 0) {
          layers.splice(i, 1)
        }
        return i >= 0
      },
    }
    const Cesium = {
      ImageryLayer: {
        fromWorldImagery: () => {
          calls.imagery++
          return imagery
        },
      },
    }
    const widget = {imageryLayers, isDestroyed: () => false, scene: {globe: {}}}
    const L = new CesiumLayers({})
    const body = {Cesium, widget, night, heightM: Infinity, ion: {imagery: false}}
    const at = (heightM, fov = rad(45), canvasHeight = 800) => {
      body.heightM = heightM
      L._requestIon('earth', body, fov, canvasHeight)
    }
    return {L, body, calls, layers, listeners, imagery, night, at}
  }

  it('asks for nothing from orbit: the landing view, 20,000 km, a telescope from the Moon', () => {
    const {calls, at} = setup()
    at(2e7)
    at(5 * 6371e3)
    at(3.78e8, rad(45))
    at(3.78e8, rad(0.01))
    at(3.78e8, rad(0.0001), 2160)
    expect(calls).toEqual({imagery: 0})
  })

  it('asks for imagery once, when low', () => {
    const {calls, at} = setup()
    at(1e7)
    expect(calls).toEqual({imagery: 0})
    at(1e4)
    expect(calls).toEqual({imagery: 1})
  })

  it('does not ask again on the way up and down', () => {
    const {calls, at} = setup()
    for (const h of [1e4, 1e7, 1e3, 3e8, 5e5, 1e4]) {
      at(h)
    }
    expect(calls).toEqual({imagery: 1})
  })

  it('puts the imagery under the night lights', () => {
    const {layers, night, imagery, at} = setup()
    at(1e4)
    expect(layers).toEqual([{base: true}, imagery, night])
  })

  it('asks for nothing of a body without ion (no token, or a tileset)', () => {
    const {L, body, calls} = setup()
    body.ion = null
    body.heightM = 10
    L._requestIon('earth', body, rad(45), 800)
    expect(calls).toEqual({imagery: 0})
  })

  it('drops the imagery quietly when ion refuses it, keeping the base', () => {
    const {layers, listeners, imagery, at} = setup()
    const warnings = []
    const warn = console.warn
    console.warn = (...args) => warnings.push(args.join(' '))
    try {
      at(1e4)
      expect(layers).toContain(imagery)
      // A 403 whose body echoes the token: said by status only.
      const refused = {statusCode: 403, response: {responseText: 'access_token=SECRET'}}
      listeners.error[0](refused)
      listeners.error[0](refused)
    } finally {
      console.warn = warn
    }
    expect(layers).not.toContain(imagery)
    expect(layers[0]).toEqual({base: true})
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('HTTP 403')
    expect(warnings[0]).not.toContain('SECRET')
  })
})


/**
 * @param {object} L A CesiumLayers
 * @returns {object} L, with its guest pages' (as _load gives it the first)
 */
function withGuests(L) {
  L.guests = new GuestPages(L)
  return L
}


describe('a body on a guest page (?cesium=iframe)', () => {
  const setup = () => {
    const L = withGuests(new CesiumLayers({}))
    L._viewOf = () => ({size: [480, 300], heightM: 2e7, distanceScale: 1e7, position: [2.7e7, 0, 0]})
    const posted = []
    const body = {
      status: 'ready', remote: true, iframe: {style: {}}, waiting: null, holdUntil: 0,
      receiver: {post: (msg) => posted.push(msg)},
    }
    L.bodies.earth = body
    return {L, body, posted, earth: {name: 'earth'}}
  }

  it('is sent this frame\'s view, one in flight', () => {
    const {L, body, posted, earth} = setup()
    L._postGuestViews([{name: 'earth', node: earth}])
    expect(posted).toHaveLength(1)
    expect(posted[0].type).toBe('cesium:view')
    expect(body.waiting).toBe(posted[0].viewId)
    expect(body.iframe.style.width).toBe('480px')
    // The next frame, the view still out: none sent.
    L._postGuestViews([{name: 'earth', node: earth}])
    expect(posted).toHaveLength(1)
    // Its frame in: the next frame's goes.
    body.waiting = null
    L._postGuestViews([{name: 'earth', node: earth}])
    expect(posted).toHaveLength(2)
    expect(posted[1].viewId).toBeGreaterThan(posted[0].viewId)
  })

  it('holds the frame for the guest\'s, until the wait runs out', () => {
    const {L, body, earth} = setup()
    expect(L.awaitingGuests()).toBe(false)
    L._postGuestViews([{name: 'earth', node: earth}])
    expect(L.awaitingGuests()).toBe(true)
    // Out of time: drawn with the last frame in, the view still out.
    body.holdUntil = performance.now() - 1
    expect(L.awaitingGuests()).toBe(false)
    expect(body.waiting).not.toBe(null)
  })

  it('loads every body from a guest page of its own, Cesium not on this page', async () => {
    const L = new CesiumLayers({})
    L.guestPage = 'https://guest.example/cesium-guest.html'
    const guests = []
    L._loadGuest = (name) => {
      guests.push(name)
      return Promise.resolve()
    }
    for (const name of ['earth', 'moon', 'mars']) {
      await L._load(name)
    }
    expect(guests).toEqual(['earth', 'moon', 'mars'])
    // The guest pages' code, loaded with the first (none in the first load).
    expect(L.guests).toBeInstanceOf(GuestPages)
    expect(L.bodies.moon).toEqual({status: 'loading'})
  })

  it('sends nothing to a guest not yet ready, nor to a body on this page', () => {
    const {L, body, posted, earth} = setup()
    body.status = 'loading'
    L._postGuestViews([{name: 'earth', node: earth}])
    L.bodies.moon = {status: 'ready'}
    L._postGuestViews([{name: 'moon', node: {}}])
    expect(posted).toHaveLength(0)
  })
})


describe('a guest page\'s night lights', () => {
  const setup = () => {
    const L = withGuests(new CesiumLayers({}))
    L._viewOf = () => ({size: [480, 300], heightM: 2e7, distanceScale: 1e7, position: [2.7e7, 0, 0]})
    L._nightInView = () => true
    // As _lightsShow, but at any exposure.
    L._lightsShow = (b) => Boolean(b.night && b.nightInView)
    const posted = []
    const body = {
      status: 'ready', remote: true, iframe: {style: {}}, waiting: null, holdUntil: 0, night: true, parts: false,
      frames: 0, steps: {drawn: 0, inStep: 0, trips: 0, tripMs: 0},
      receiver: {post: (msg) => posted.push(msg)},
    }
    L.bodies.earth = body
    const post = () => {
      body.waiting = null
      L._postGuestViews([{name: 'earth', node: {}}])
      return posted.at(-1)
    }
    return {L, body, post}
  }

  it('are asked for once the receiver routes parts, where the guest has them', () => {
    const {L, body, post} = setup()
    // portal-netgl before 0.6.8: no beforeFrame, so never asked for.
    expect(post().lights).toBe(false)
    L.guests._onPart(body, {type: 'netgl:frame-end', viewId: 1})
    expect(body.parts).toBe(true)
    expect(post().lights).toBe(true)
    expect(body.postedLights).toBe(true)
    // A guest without them (an older page, or their frame failed).
    body.night = false
    expect(post().lights).toBe(false)
  })

  it('land the view with their part, the day frame alone not', () => {
    const {L, body, post} = setup()
    L.guests._onPart(body, {type: 'netgl:frame-end'})
    const {viewId} = post()
    L.guests._onFrame(body, {type: 'netgl:frame-end', viewId})
    expect(body.waiting).toBe(viewId)
    expect(body.frames).toBe(0)
    L.guests._onFrame(body, {type: 'netgl:frame-end', viewId, part: 'lights'})
    expect(body.waiting).toBe(null)
    expect(body.frames).toBe(1)
  })

  it('replay into their own target, the day frame into Cesium\'s', () => {
    const fbs = new Map()
    const L = withGuests(new CesiumLayers({renderer: {properties: {get: (rt) => ({__webglFramebuffer: fbs.get(rt)})}}}))
    const day = {}
    const lights = {}
    fbs.set(day, 'day').set(lights, 'lights')
    L._cesiumTarget = () => day
    L.guests.lightsTarget = () => lights
    const body = {}
    const config = L._replayConfig(() => [480, 300], body)
    L.guests._onPart(body, {type: 'netgl:frame-end', viewId: 2})
    expect(config.screenFramebuffer()).toBe('day')
    expect(body.drainedLights).toBeUndefined()
    L.guests._onPart(body, {type: 'netgl:frame-end', viewId: 2, part: 'lights'})
    expect(config.screenFramebuffer()).toBe('lights')
    expect(body.drainedLights).toBe(true)
    // The page's own link: no body, always Cesium's.
    expect(L._replayConfig(() => null).screenFramebuffer()).toBe('day')
  })
})


describe('a guest page\'s late frames, corrected (portal-netgl 0.6.10)', () => {
  const R = 6371000
  const setup = () => {
    const camera = new PerspectiveCamera(45, 1.6, 1, 1e9)
    camera.position.set(0, 0, 3 * R)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld()
    const L = withGuests(new CesiumLayers({camera, width: 480, height: 300}))
    const node = {matrixWorld: new Matrix4(), props: {radius: {scalar: R}}}
    return {L, camera, node}
  }
  const apply = (m, v) => [0, 1, 2, 3].map((r) => (m[r] * v[0]) + (m[4 + r] * v[1]) + (m[8 + r] * v[2]) + (m[12 + r] * v[3]))

  it('Cesium\'s view for this frame\'s camera puts the camera at the origin, looking down -z', () => {
    const {L, node} = setup()
    const V = L._ecefViewMatrix('earth', node)
    const {position} = L._viewOf('earth', node)
    const eye = apply(V, [...position, 1])
    for (const c of eye.slice(0, 3)) {
      expect(Math.abs(c)).toBeLessThan(1e-6)
    }
    // Towards the body's centre is straight ahead.
    const ahead = apply(V, [-position[0], -position[1], -position[2], 0])
    const n = Math.hypot(...ahead.slice(0, 3))
    expect(ahead[2] / n).toBeCloseTo(-1, 9)
  })

  it('no correction for the frame of the view posted this frame; the camera\'s move for an older one', () => {
    const {L, camera, node} = setup()
    const body = {name: 'earth', node, posted: 7, postedTick: 0}
    L.guests._tick = 0
    const V = L._ecefViewMatrix('earth', node)
    const P = [1, 0, 0, 0, 0, 1.6, 0, 0, 0, 0, -1, -1, 0, 0, -2, 0]
    const end = {type: 'netgl:frame-end', viewId: 7, viewMatrix: V, projectionMatrix: P}
    expect(L.guests._correction(netgl, body, 7, end)).toBe(null)
    // No view and projection (several frusta, an older page): none.
    expect(L.guests._correction(netgl, body, 6, {type: 'netgl:frame-end', viewId: 6})).toBe(null)
    // The camera turns and moves a little, and the frame is the last one again.
    camera.position.set(300, 0, 3 * R)
    camera.rotateY(0.02)
    camera.updateMatrixWorld()
    L.guests._tick = 1
    const C = L.guests._correction(netgl, body, 7, end)
    const now = {viewMatrix: L._ecefViewMatrix('earth', node), projectionMatrix: L._ecefProjection(P)}
    expect(C).toEqual(netgl.reprojection(end, now))
    expect(body.corrected).toBe(1)
  })

  it('refuses a correction too large for the shader\'s float32 (a long move), drawing the frame as it came', () => {
    const {L, camera, node} = setup()
    const body = {name: 'earth', node, posted: 7, postedTick: 0}
    L.guests._tick = 1
    // Cesium's projection low down: near 0.1 m, far all but infinite.
    const P = [1.5, 0, 0, 0, 0, 2.4, 0, 0, 0, 0, -1, -1, 0, 0, -0.2, 0]
    const end = {type: 'netgl:frame-end', viewId: 7, viewMatrix: L._ecefViewMatrix('earth', node), projectionMatrix: P}
    camera.position.set(0.02 * R, 0, 3 * R)
    camera.updateMatrixWorld()
    expect(L.guests._correction(netgl, body, 7, end)).toBe(null)
    expect(body.refused).toBe(1)
  })

  it('corrects to the camera\'s projection now: a resize changes the scales, not the near and far', () => {
    const {L, camera} = setup()
    const P = [1, 0, 0, 0, 0, 1.6, 0, 0, 0, 0, -1.0000002, -1, 0, 0, -0.2, 0]
    const Q = L._ecefProjection(P)
    const y = 1 / Math.tan(camera.fov * Math.PI / 360)
    expect(Q[5]).toBeCloseTo(y, 12)
    expect(Q[0]).toBeCloseTo(y * 300 / 480, 12)
    expect([Q[10], Q[11], Q[14], Q[15]]).toEqual([P[10], P[11], P[14], P[15]])
    L.ui.height = 200
    expect(L._ecefProjection(P)[0]).toBeCloseTo(y * 200 / 480, 12)
  })

  it('waits the short wait when its last frame could be corrected to the camera, the long one when not', () => {
    const {L, node} = setup()
    L._viewOf = () => ({size: [480, 300], heightM: 2e7, distanceScale: 1e7, position: [0, 0, 3 * R]})
    L.guests._netgl = netgl
    const body = {
      name: 'earth', status: 'ready', remote: true, iframe: {style: {}}, waiting: null, holdUntil: 0,
      receiver: {post: () => {}},
    }
    L.bodies.earth = body
    const post = () => {
      body.waiting = null
      L.guests.postViews([{name: 'earth', node}])
      return body.holdUntil - body.postedAt
    }
    // No frame in yet, or one without its view and projection: the long wait.
    expect(post()).toBe(L.guestWaitUncorrectedMs)
    // A frame that can be corrected: the short one.
    L.guests._onPart(body, {type: 'netgl:frame-end', viewId: 1,
      viewMatrix: L._ecefViewMatrix('earth', node), projectionMatrix: [1, 0, 0, 0, 0, 1.6, 0, 0, 0, 0, -1, -1, 0, 0, -2, 0]})
    expect(post()).toBe(L.guestWaitMs)
    expect(L.guestWaitMs).toBeLessThan(L.guestWaitUncorrectedMs)
    // Off: the long one again.
    L.guestReproject = false
    expect(post()).toBe(L.guestWaitUncorrectedMs)
  })

  it('the lights part is \'emission\' (GUEST_VERSION 3) or \'lights\' (before)', () => {
    const fbs = new Map()
    const L = withGuests(new CesiumLayers({renderer: {properties: {get: (rt) => ({__webglFramebuffer: fbs.get(rt)})}}}))
    const day = {}
    const lights = {}
    fbs.set(day, 'day').set(lights, 'lights')
    L._cesiumTarget = () => day
    L.guests.lightsTarget = () => lights
    const body = {postedLights: true, waiting: 3, frames: 0, steps: {trips: 0, tripMs: 0}, postedAt: 0}
    const config = L._replayConfig(() => [480, 300], body)
    L.guests._onPart(body, {type: 'netgl:frame-end', viewId: 3, part: 'emission'})
    expect(config.screenFramebuffer()).toBe('lights')
    L.guests._onPart(body, {type: 'netgl:frame-end', viewId: 3})
    expect(config.screenFramebuffer()).toBe('day')
    L.guests._onFrame(body, {type: 'netgl:frame-end', viewId: 3, part: 'emission'})
    expect(body.waiting).toBe(null)
  })
})


describe('New York on Earth\'s guest page', () => {
  // Over Manhattan, 3 km up (newYork.test.js's above()).
  const OVER = [1333000, -4655000, 4138000]
  const setup = () => {
    const L = withGuests(new CesiumLayers({}))
    L._viewOf = () => ({size: [480, 300], heightM: 3000, distanceScale: 1e7, position: OVER})
    const posted = []
    const body = {
      status: 'ready', remote: true, iframe: {style: {}}, waiting: null, holdUntil: 0, steps: {},
      receiver: {post: (msg) => posted.push(msg)},
    }
    L.bodies.earth = body
    return {L, body, posted}
  }

  it('is sent the switch with each view, and its range kept for the control', () => {
    const {L, posted} = setup()
    L.newYork.enabled = true
    L._postGuestViews([{name: 'earth', node: {}}])
    expect(posted[0].nyc).toBe(true)
    expect(['show', 'keep', 'free']).toContain(L._newYorkRange)
  })

  it('mirrors the guest\'s city in the status, and frees it there', () => {
    const {L, body, posted} = setup()
    L.newYork.enabled = true
    L.guests._onMessage('earth', body, {type: 'cesium:status', newYork: 'loading'})
    expect(L._newYork).toEqual({status: 'loading', remote: true, step: null})
    L.guests._onMessage('earth', body, {type: 'cesium:status', newYork: 'loading', newYorkStep: 'compile'})
    expect(L._newYork.step).toBe('compile')
    L.guests._onMessage('earth', body, {type: 'cesium:status', newYork: 'ready'})
    L.setNewYork(false)
    expect(L._newYork).toBe(null)
    expect(posted).toContainEqual({type: 'cesium:newYork', on: false})
    // The guest's next status, before it freed the city: still none here.
    L.guests._onMessage('earth', body, {type: 'cesium:status', newYork: 'ready'})
    expect(L._newYork).toBe(null)
  })
})


describe('a guest page\'s frame that can\'t run again', () => {
  it('is kept, and drawn in a frame that drains nothing', () => {
    const L = new CesiumLayers({})
    L.guests = new GuestPages(L)
    const targets = {}
    L._cesiumTarget = (key = '_cesiumRT') => (targets[key] ??= {key})
    const copies = []
    L.guests._copy = (from, to) => copies.push(`${from.key}>${to.key}`)
    const receiver = {canRerun: true, drainedViews: []}
    const body = {name: 'mars', receiver, steps: {drawn: 0, inStep: 0}}
    // A frame that can run again: nothing kept.
    L.guests.afterDrain(body, true, false)
    expect(copies).toEqual([])
    // One that deleted objects: kept; then a frame with nothing drawn shows it.
    receiver.canRerun = false
    L.guests.afterDrain(body, true, false)
    L.guests.afterDrain(body, false, false)
    expect(copies).toEqual(['_cesiumRT>_keptRT_mars', '_keptRT_mars>_cesiumRT'])
    expect(body.steps.kept).toBe(1)
    // Unseen, nothing is copied either way.
    L.guests.afterDrain(body, false, true)
    expect(copies).toHaveLength(2)
  })
  it('with night lights, the day frame is kept, and drawn in a drain that had only the lights', () => {
    const L = new CesiumLayers({})
    L.guests = new GuestPages(L)
    const targets = {}
    L._cesiumTarget = (key = '_cesiumRT') => (targets[key] ??= {key})
    L._prepareLights = () => {}
    L.guests._prepareLights = () => {}
    const copies = []
    L.guests._copy = (from, to) => copies.push(`${from.key}>${to.key}`)
    const receiver = {canRerun: true, drainedViews: []}
    const body = {name: 'earth', receiver, steps: {drawn: 0, inStep: 0}, postedLights: true}
    // A drain with both parts: the day frame kept.
    L.guests.beforeDrain(body, false)
    L.guests._onPart(body, {type: 'netgl:frame-end', viewId: 4})
    L.guests._onPart(body, {type: 'netgl:frame-end', viewId: 4, part: 'emission'})
    L.guests.afterDrain(body, true, false)
    expect(copies).toEqual(['_cesiumRT>_keptRT_earth'])
    // The next drain has only the lights (the day part landed a drain
    // earlier, or the lights re-run alone): the kept day frame is drawn.
    L.guests.beforeDrain(body, false)
    L.guests._onPart(body, {type: 'netgl:frame-end', viewId: 5, part: 'emission'})
    L.guests.afterDrain(body, true, false)
    expect(copies).toEqual(['_cesiumRT>_keptRT_earth', '_keptRT_earth>_cesiumRT'])
    // Without lights, a frame that can run again keeps nothing.
    body.postedLights = false
    L.guests.beforeDrain(body, false)
    L.guests._onPart(body, {type: 'netgl:frame-end', viewId: 6})
    L.guests.afterDrain(body, true, false)
    expect(copies).toHaveLength(2)
  })
})


describe('a guest page older than this page', () => {
  it('is said once, by its protocol, and works as it can', () => {
    const L = new CesiumLayers({})
    L.guests = new GuestPages(L, 2)
    const body = {iframe: {src: 'https://guest.example/cesium-guest.html'}, trips: []}
    const warnings = []
    const warn = console.warn
    console.warn = (...args) => warnings.push(args.join(' '))
    try {
      // #310's guest page sends no `guest`: protocol 1.
      L.guests._onMessage('earth', body, {type: 'cesium:status', tilesLoaded: true})
      L.guests._onMessage('earth', body, {type: 'cesium:status', tilesLoaded: true})
      L.guests._onMessage('moon', {iframe: {}, trips: []}, {type: 'cesium:status', guest: 2})
    } finally {
      console.warn = warn
    }
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('guest.example')
    expect(warnings[0]).toContain('protocol 1')
    expect(body.tilesLoaded).toBe(true)
  })
})


describe('a guest page\'s ground height at a landing place', () => {
  const setup = () => {
    const L = withGuests(new CesiumLayers({}))
    const posted = []
    const node = {props: {radius: {scalar: 6371000}}}
    const body = {status: 'ready', remote: true, receiver: {post: (msg) => posted.push(msg)}}
    L.bodies.earth = body
    L.active = [{name: 'earth', node}]
    return {L, body, node, posted}
  }

  it('is asked for by message, with the place on celestiary\'s sphere, and answered', async () => {
    const {L, body, node, posted} = setup()
    // Not synchronously: the guest's tiles are in its own page.
    expect(L.groundHeightAt(node, 36, -112)).toBe(null)
    const asked = L.requestGroundHeight(node, 36, -112)
    expect(posted).toHaveLength(1)
    const [msg] = posted
    expect(msg).toMatchObject({type: 'cesium:height', lat: 36, lng: -112, radius: 6371000})
    L.guests._onMessage('earth', body, {type: 'cesium:height', id: msg.id, height: 2134})
    expect(await asked).toBe(2134)
    expect(body.heights.size).toBe(0)
  })

  it('is null where no active body is on a guest page', async () => {
    const {L, node, posted} = setup()
    L.active = []
    expect(await L.requestGroundHeight(node, 0, 0)).toBe(null)
    expect(posted).toHaveLength(0)
  })
})


describe('a guest page\'s round trips, split', () => {
  it('into the view\'s way in, the guest\'s frame and the way back, on the shared clock', () => {
    const L = withGuests(new CesiumLayers({}))
    const origin = performance.timeOrigin
    const body = {remote: true, origin: 'https://guest.example', frames: 3, steps: {drawn: 4, inStep: 3}, trips: [],
      trip: {viewId: 7, postedAt: 1000, landed: 1012}}
    L.bodies.earth = body
    // In 2 ms after the post, a 7 ms frame, so 3 ms back.
    L.guests._splitTrip(body, {viewId: 7, timing: {receivedAt: origin + 1002, renderMs: 7}})
    expect(body.trips).toHaveLength(1)
    const [t] = body.trips
    expect(t.tripMs).toBe(12)
    expect(t.toGuestMs).toBeCloseTo(2, 6)
    expect(t.guestMs).toBe(7)
    expect(t.backMs).toBeCloseTo(3, 6)
    expect(body.trip).toBe(null)
    L.noteWait(5)
    L.noteWait(9)
    const [stats] = L.guestStats()
    expect(stats).toMatchObject({name: 'earth', origin: 'https://guest.example', frames: 3, inStep: 0.75, n: 1})
    expect(stats.guestMs).toEqual({mean: 7, p95: 7})
    expect(stats.waitMs).toEqual({mean: 7, p95: 9})
  })

  it('takes a status only for the frame it follows', () => {
    const L = withGuests(new CesiumLayers({}))
    const body = {remote: true, steps: {drawn: 0, inStep: 0}, trips: [], trip: {viewId: 7, postedAt: 0, landed: 5}}
    L.guests._splitTrip(body, {viewId: 6, timing: {receivedAt: 1, renderMs: 1}})
    L.guests._splitTrip(body, {viewId: 7})
    expect(body.trips).toHaveLength(0)
    expect(new CesiumLayers({}).guestStats()).toEqual([])
  })
})
