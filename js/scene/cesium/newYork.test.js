import {readFileSync} from 'node:fs'
import {createStore} from 'zustand/vanilla'
import createLayersSlice from '../../store/LayersSlice.js'
import CesiumLayers from './CesiumLayers.js'
import {
  DEFAULT_GUEST_BASE,
  FREE_BEYOND_M,
  guestBaseAllowed,
  newYorkOptions,
  newYorkRange,
  newYorkStatus,
  NYC_LAT,
  NYC_LON,
  SHOW_BELOW_M,
  wgs84Ecef,
} from './newYork.js'


/**
 * @param {number} lon
 * @param {number} lat
 * @param {number} h Metres over the ellipsoid, along the radial (near enough here)
 * @returns {Array<number>}
 */
function above(lon, lat, h) {
  const p = wgs84Ecef(lon, lat)
  const r = Math.hypot(...p)
  return p.map((x) => x * (r + h) / r)
}


describe('newYorkOptions', () => {
  it('is off by default, on with ?nyc=1', () => {
    expect(newYorkOptions('').enabled).toBe(false)
    expect(newYorkOptions('?nyc=0').enabled).toBe(false)
    expect(newYorkOptions('?nyc=1')).toEqual({enabled: true, guestBase: DEFAULT_GUEST_BASE, shadows: false, lean: true})
    expect(newYorkOptions('?nyc=1&nycShadows=1').shadows).toBe(true)
  })

  it('is lean unless ?nycLean=0', () => {
    expect(newYorkOptions('?nyc=1&nycLean=0').lean).toBe(false)
    expect(newYorkOptions('?nyc=1&nycLean=1').lean).toBe(true)
  })

  it('takes the guest from slop-newyork\'s PR preview, or a local server', () => {
    const preview = 'https://pablo-mayrgundter.github.io/slop-newyork/pr-preview/pr-1/'
    expect(newYorkOptions(`?nyc=1&nycGuest=${encodeURIComponent(preview)}`).guestBase).toBe(preview)
    expect(newYorkOptions('?nycGuest=http://localhost:8000').guestBase).toBe('http://localhost:8000/')
  })

  it('ignores a guest from anywhere else: its code would run in celestiary\'s page', () => {
    const warn = console.warn
    console.warn = () => {}
    try {
      expect(newYorkOptions('?nycGuest=https://example.com/x/').guestBase).toBe(DEFAULT_GUEST_BASE)
    } finally {
      console.warn = warn
    }
  })
})


describe('guestBaseAllowed', () => {
  it('allows slop-newyork\'s site over https and local servers', () => {
    expect(guestBaseAllowed(DEFAULT_GUEST_BASE)).toBe(true)
    expect(guestBaseAllowed(`${DEFAULT_GUEST_BASE}pr-preview/pr-7/`)).toBe(true)
    expect(guestBaseAllowed('http://127.0.0.1:5400/')).toBe(true)
  })

  it('refuses other sites, look-alike paths, plain http and non-URLs', () => {
    expect(guestBaseAllowed('https://example.com/slop-newyork/')).toBe(false)
    expect(guestBaseAllowed('https://pablo-mayrgundter.github.io/slop-newyork-evil/')).toBe(false)
    expect(guestBaseAllowed('http://pablo-mayrgundter.github.io/slop-newyork/')).toBe(false)
    expect(guestBaseAllowed('javascript:alert(1)/')).toBe(false)
    expect(guestBaseAllowed('not a url')).toBe(false)
  })
})


describe('newYorkRange', () => {
  it('shows the city from a few km over the harbour', () => {
    expect(newYorkRange(above(-74.035, 40.66, 3000), 3000)).toBe('show')
  })

  it('keeps but doesn\'t draw it from too high, or a little too far', () => {
    expect(newYorkRange(above(NYC_LON, NYC_LAT, SHOW_BELOW_M + 1000), SHOW_BELOW_M + 1000)).toBe('keep')
    expect(newYorkRange(above(-75.2, 39.95, 1000), 1000)).toBe('keep')
  })

  it('frees it far away', () => {
    expect(newYorkRange(above(0, 51.5, 1000), 1000)).toBe('free')
    expect(newYorkRange(above(NYC_LON, NYC_LAT, FREE_BEYOND_M + 1), FREE_BEYOND_M + 1)).toBe('free')
  })
})


describe('the page\'s import map', () => {
  it('maps three.js\'s names for the guest to one pinned commit, not @dev', () => {
    const html = readFileSync(new URL('../../../public/index.html', import.meta.url), 'utf8')
    const json = html.match(/<script type="importmap">([\s\S]*?)<\/script>/)?.[1]
    const {imports} = JSON.parse(json)
    expect(Object.keys(imports).sort()).toEqual(['three', 'three/addons/', 'three/tsl', 'three/webgpu'])
    const commits = new Set(Object.values(imports).map((u) => u.match(/three\.js@([0-9a-f]{40})\//)?.[1]))
    expect(commits.size).toBe(1)
    expect([...commits][0]).toMatch(/^[0-9a-f]{40}$/)
    // Before index.js, the first module script.
    expect(html.indexOf('type="importmap"')).toBeLessThan(html.indexOf('<script type="module"'))
  })

  it('is the Cesium guest page\'s too, which draws the city in iframe mode', () => {
    const map = (file) => {
      const html = readFileSync(new URL(`../../../public/${file}`, import.meta.url), 'utf8')
      expect(html.indexOf('type="importmap"')).toBeLessThan(html.indexOf('<script type="module"'))
      return JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)?.[1]).imports
    }
    expect(map('cesium-guest.html')).toEqual(map('index.html'))
  })
})


describe('CesiumLayers and New York', () => {
  const OVER = above(-74.035, 40.66, 3000)
  const FAR = above(0, 51.5, 3000)
  const layers = (enabled = true) => {
    const L = new CesiumLayers({})
    L.newYork = {enabled, guestBase: DEFAULT_GUEST_BASE, shadows: false, lean: true}
    L.loads = 0
    L._loadNewYork = () => {
      L.loads++
      L._newYork = {status: 'loading', city: null}
    }
    return L
  }
  const city = () => ({
    shown: null, updates: 0, disposed: 0,
    renderer: {show: true},
    setShown(on) {
      this.shown = on
    },
    update() {
      this.updates++
    },
    dispose() {
      this.disposed++
    },
  })

  it('loads nothing with the switch off', () => {
    const L = layers(false)
    L._updateNewYork({heightM: 3000}, OVER)
    expect(L.loads).toBe(0)
    expect(L._newYork).toBe(null)
  })

  it('loads once the camera is over the city, and not before', () => {
    const L = layers()
    L._updateNewYork({heightM: 3000}, FAR)
    expect(L.loads).toBe(0)
    L._updateNewYork({heightM: 3000}, OVER)
    L._updateNewYork({heightM: 3000}, OVER)
    expect(L.loads).toBe(1)
  })

  it('draws it only in range, and frees it far away', () => {
    const L = layers()
    const c = city()
    L._newYork = {status: 'ready', city: c}
    L._updateNewYork({heightM: 3000}, OVER)
    expect(c.shown).toBe(true)
    L._updateNewYork({heightM: SHOW_BELOW_M + 1000}, above(NYC_LON, NYC_LAT, SHOW_BELOW_M + 1000))
    expect(c.shown).toBe(false)
    L._updateNewYork({heightM: 3000}, FAR)
    expect(c.disposed).toBe(1)
    expect(L._newYork).toBe(null)
  })

  it('frees it when the switch goes off, or Earth\'s layer fails', () => {
    const L = layers()
    const a = city()
    L._newYork = {status: 'ready', city: a}
    L.setNewYork(false)
    expect(a.disposed).toBe(1)
    expect(L._newYork).toBe(null)

    const b = city()
    L.setNewYork(true)
    L._newYork = {status: 'ready', city: b}
    const error = console.error
    console.error = () => {}
    try {
      L._fail('earth', new Error('test'))
    } finally {
      console.error = error
    }
    expect(b.disposed).toBe(1)
  })

  it('frees it when Earth\'s layer is no longer wanted (the user chose celestiary\'s, or the homepage)', () => {
    const L = layers()
    const c = city()
    L._newYork = {status: 'ready', city: c}
    L.suspended = true
    L.beforeRender(null)
    expect(c.disposed).toBe(1)
  })


  // The store and the layers control (LayersSlice: newYorkOn, newYorkNear,
  // newYorkStatus).  Earth's layer active is `active` holding Earth.
  const withStore = (fromUrl = false) => {
    const store = createStore((set, get) => createLayersSlice(set, get))
    const L = layers(fromUrl)
    L._newYorkFromUrl = fromUrl
    L.ui = {useStore: store}
    return {L, store}
  }
  const earthActive = (L) => {
    L.active = [{name: 'earth', node: {}}]
  }

  it('offers the toggle only with Earth\'s Cesium layer in use and the camera in the city\'s range', () => {
    const {L, store} = withStore()
    // Earth's layer not drawn (celestiary's Earth, or not loaded): no toggle,
    // even over the city.
    L._updateNewYork({heightM: 3000}, OVER)
    L._publishNewYork(store.getState())
    expect(store.getState().newYorkNear).toBe(false)
    // Drawn, over the harbour: offered.
    earthActive(L)
    L._updateNewYork({heightM: 3000}, OVER)
    L._publishNewYork(store.getState())
    expect(store.getState().newYorkNear).toBe(true)
    // Too high over the city, or over London: not offered.
    L._updateNewYork({heightM: SHOW_BELOW_M + 1000}, above(NYC_LON, NYC_LAT, SHOW_BELOW_M + 1000))
    L._publishNewYork(store.getState())
    expect(store.getState().newYorkNear).toBe(false)
    L._updateNewYork({heightM: 3000}, OVER)
    L._publishNewYork(store.getState())
    expect(store.getState().newYorkNear).toBe(true)
    L._updateNewYork({heightM: 3000}, FAR)
    L._publishNewYork(store.getState())
    expect(store.getState().newYorkNear).toBe(false)
    // Earth's layer gone (the user chose celestiary's Earth): the range is
    // forgotten, so it isn't offered on the layer's return before a new one.
    L._updateNewYork({heightM: 3000}, OVER)
    L.active = []
    L._publishNewYork(store.getState())
    expect(store.getState().newYorkNear).toBe(false)
    earthActive(L)
    L._publishNewYork(store.getState())
    expect(store.getState().newYorkNear).toBe(false)
  })

  it('offers it while Earth\'s layer warms too: loaded and wanted, its tiles not in yet', () => {
    const {L, store} = withStore()
    L.active = []
    L.warming = [{name: 'earth', node: {}}]
    L._updateNewYork({heightM: 3000}, OVER)
    L._publishNewYork(store.getState())
    expect(store.getState().newYorkNear).toBe(true)
    // Not the Moon's warming.
    L.warming = [{name: 'moon', node: {}}]
    L._publishNewYork(store.getState())
    expect(store.getState().newYorkNear).toBe(false)
  })

  it('is off by default and loads nothing until toggled on', () => {
    const {L, store} = withStore()
    earthActive(L)
    L._syncNewYork(store.getState())
    L._updateNewYork({heightM: 3000}, OVER)
    expect(store.getState().newYorkOn).toBe(false)
    expect(L.loads).toBe(0)
  })

  it('follows the toggle: on loads it over the city, off frees it', () => {
    const {L, store} = withStore()
    earthActive(L)
    store.getState().setNewYorkOn(true)
    L._syncNewYork(store.getState())
    expect(L.newYork.enabled).toBe(true)
    L._updateNewYork({heightM: 3000}, OVER)
    expect(L.loads).toBe(1)
    L._publishNewYork(store.getState())
    expect(store.getState().newYorkStatus).toBe('loading')
    // Built, its set-up still staged into the frames: still loading.
    const c = city()
    c.stage = {chunks: 3}
    L._newYork = {status: 'ready', city: c}
    L._publishNewYork(store.getState())
    expect(store.getState().newYorkStatus).toBe('loading')
    c.stage.chunks = 0
    L._publishNewYork(store.getState())
    expect(store.getState().newYorkStatus).toBe('ready')
    // Off: freed, and no load state.
    store.getState().setNewYorkOn(false)
    L._syncNewYork(store.getState())
    expect(L.newYork.enabled).toBe(false)
    expect(c.disposed).toBe(1)
    L._publishNewYork(store.getState())
    expect(store.getState().newYorkStatus).toBe(null)
  })

  it('keeps ?nyc=1 working: on in the store from the first frame', () => {
    const {L, store} = withStore(true)
    L._syncNewYork(store.getState())
    expect(store.getState().newYorkOn).toBe(true)
    L._syncNewYork(store.getState())
    expect(L.newYork.enabled).toBe(true)
    // And the toggle can still turn it off.
    store.getState().setNewYorkOn(false)
    L._syncNewYork(store.getState())
    expect(L.newYork.enabled).toBe(false)
  })

  it('writes setNewYork (the console\'s switch) to the store, so the control and the link agree', () => {
    const {L, store} = withStore()
    L.setNewYork(true)
    expect(store.getState().newYorkOn).toBe(true)
    L._syncNewYork(store.getState())
    expect(L.newYork.enabled).toBe(true)
    L.setNewYork(false)
    expect(store.getState().newYorkOn).toBe(false)
  })

  it('runs the whole frame\'s switch through beforeRender', () => {
    const {L, store} = withStore()
    store.getState().setNewYorkOn(true)
    L.beforeRender(null)
    expect(L.newYork.enabled).toBe(true)
    expect(store.getState().newYorkNear).toBe(false)
  })
})


describe('newYorkStatus', () => {
  it('is null before the city is asked for, then its load state', () => {
    expect(newYorkStatus(null)).toBe(null)
    expect(newYorkStatus({status: 'loading', city: null})).toBe('loading')
    expect(newYorkStatus({status: 'ready', city: {stage: {chunks: 2}}})).toBe('loading')
    expect(newYorkStatus({status: 'ready', city: {stage: {chunks: 0}}})).toBe('ready')
    expect(newYorkStatus({status: 'ready', city: {stage: null}})).toBe('ready')
    expect(newYorkStatus({status: 'error', city: null})).toBe('error')
  })
})
