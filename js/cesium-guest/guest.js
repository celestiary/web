import {latLngAltToBodyFixed} from '../coords.js'
import {setDataBaseUrl} from '../dataUrl.js'
import {hostOrigin} from '../layer/origins.js'
import {CESIUM_BODIES, ionToken} from '../scene/cesium/bodies.js'
import {applyView, createWidget, renderNightLights, sampleGround, terrainHeight, tilesReady} from '../scene/cesium/cesiumBody.js'
import {bodyToEcef} from '../scene/cesium/frames.js'
import {newYorkOptions, newYorkRange, newYorkStatus} from '../scene/cesium/newYork.js'
import {creditsOf} from './credits.js'
import {CESIUM_GUEST_HOSTS, GUEST_VERSION, dataBase} from './origins.js'


// The Cesium guest page (public/cesium-guest.html; design/CesiumGuest.md):
// one of celestiary's Cesium bodies, rendered by Cesium on a page of its
// own, which celestiary embeds as a cross-origin iframe and composites in
// place of its own body, as it does Cesium on its own page (CESIUM.md).
//
//   cesium-guest.html?body=earth[&month=1-12][&data=<celestiary's data base>]
//                    [&host=<origin>][&shadowDraws=1]
//
// Celestiary drives it: each `cesium:view` (cesiumBody.applyView's view, and
// its id) renders one frame, which goes to the host as portal-netgl's
// stream (wire 2 and a port, when the host offers them), its frame-end
// carrying the view's id.  After each frame a `cesium:status` says its
// protocol (origins.js GUEST_VERSION), whether
// the tiles for that view are in, the terrain's height under the camera,
// the credits, when they change, whether it has night lights, and the
// frame's timing: when the view came in (wall clock) and how long the frame
// took.  A view with `lights` renders the night lights' frame too, after the
// day frame, its frame-end tagged `part: 'lights'` (portal-netgl 0.6.8), which
// the host replays into a target of its own (CesiumLayers._drawNightLights).
// A `cesium:height {id, lat, lng, radius}` is answered with the terrain's height there
// (CesiumLayers.requestGroundHeight, for a landing).
//
// New York (Earth only; CESIUM.md "New York"): a view's `nyc` says whether
// the host's switch is on, and this page loads, draws and frees the city in
// its Cesium by the view's range, as the host's own page does
// (CesiumLayers._updateNewYork); its state goes back in the status.
// `nycGuest`, `nycShadows` and `nycLean` are the host's options
// (newYork.js newYorkOptions); `cesium:newYork {on: false}` frees it.
//
// The host's origin comes from location.ancestorOrigins, else the referrer,
// else `host`, and must be on the allow-list (origins.js); nothing is sent
// or taken otherwise.  `data` must be on it too.
//
// Cesium never reads its pixels back here (its inputs are off, the heights
// are CPU picks on loaded tiles), so its shadow context runs none of its
// draws: portal-netgl's `shadowDraws: false`.  `shadowDraws=1` puts them
// back, to compare.


const params = new URLSearchParams(location.search)
const name = params.get('body') ?? 'earth'
const origin = hostOrigin({search: location.search, referrer: document.referrer, ancestors: location.ancestorOrigins},
    CESIUM_GUEST_HOSTS)
if (!origin || window.parent === window || !Object.hasOwn(CESIUM_BODIES, name)) {
  document.body.textContent = 'celestiary\'s Cesium guest: embed this page in celestiary (design/CesiumGuest.md).'
} else {
  start().catch((err) => console.error('[cesium guest] failed to start', err))
}


/** Load Cesium and the link, and serve the host's views. */
async function start() {
  const data = dataBase(params.get('data'))
  if (data) {
    setDataBaseUrl(data)
  }
  window.CESIUM_BASE_URL ??= new URL('cesium/', document.baseURI).href
  const [Cesium, netgl] = await Promise.all([
    import('cesium'),
    import('@pablo-mayrgundter/portal-netgl/core'),
  ])
  // Pinned to the host's one origin both ways.  The host's views come on
  // the window; the stream, and this page's own messages through
  // `core.transport`, go on the port once the host hands one over.
  const base = netgl.parentTransport({hostOrigins: [origin]})
  const guest = netgl.makeNetGLCesiumGuest({
    transport: base,
    webgl: {alpha: true},
    shadowDraws: params.get('shadowDraws') === '1',
  })
  const container = document.createElement('div')
  Object.assign(container.style, {position: 'fixed', left: '0', top: '0', width: '1px', height: '1px'})
  document.body.appendChild(container)
  const creditContainer = document.createElement('div')
  creditContainer.style.display = 'none'
  document.body.appendChild(creditContainer)

  const month = Number(params.get('month'))
  let viewId = null
  let failed = false
  let credits = ''
  const fail = (err) => {
    if (!failed) {
      failed = true
      console.error(`[cesium guest] ${name} failed`, err)
      guest.core?.transport.post({type: 'cesium:error', message: String(err?.message ?? err).slice(0, 300)})
    }
  }
  const body = createWidget(Cesium, name, {
    container,
    contextOptions: guest.contextOptions,
    creditContainer,
    month: month >= 1 && month <= 12 ? month : new Date().getUTCMonth() + 1,
    token: ionToken(),
    onError: fail,
  })
  body.container = container
  const {core} = guest
  // The frame-end carries the view the frame was drawn for, and posts the
  // frame's batch: when, for the status's timing.
  let endedAt = null
  // The part being rendered: null for the day frame, 'lights' for the
  // night lights' frame.
  let part = null
  const endFrame = () => {
    const end = Number.isFinite(viewId) ? {viewId} : {}
    if (part) {
      end.part = part
    }
    core.endFrame(end)
    endedAt = performance.now()
  }
  body.widget.scene.postRender.addEventListener(endFrame)

  // New York, in this page's Cesium (Earth's): {status, city}, or null.
  const nycOptions = newYorkOptions(location.search)
  let nyc = null
  const freeNewYork = () => {
    const was = nyc
    nyc = null
    was?.city?.dispose()
  }
  const loadNewYork = async () => {
    const mine = {status: 'loading', city: null}
    nyc = mine
    try {
      const {createNewYork} = await import('../scene/cesium/newYorkGuest.js')
      const city = await createNewYork({
        Cesium, netgl, widget: body.widget,
        guestBase: nycOptions.guestBase, shadows: nycOptions.shadows, lean: nycOptions.lean,
        cesiumShadow: guest.core?.shadow,
      })
      if (nyc !== mine) {
        // Freed while it loaded.
        city.dispose()
        return
      }
      mine.city = city
      mine.status = 'ready'
    } catch (err) {
      console.warn('[cesium guest] New York failed to load; Earth carries on without it', err)
      if (nyc === mine) {
        mine.status = 'error'
      }
    }
  }
  const updateNewYork = (on, view) => {
    if (name !== 'earth') {
      return
    }
    const range = on ? newYorkRange(view.position, view.heightM) : 'free'
    if (!nyc) {
      if (range === 'show') {
        loadNewYork()
      }
    } else if (range === 'free') {
      freeNewYork()
    } else if (nyc.status === 'ready') {
      nyc.city.setShown(range === 'show')
      nyc.city.update()
    }
  }

  /**
   * One frame, for the host's view.
   *
   * @param {object} msg {viewId, view}
   */
  const render = (msg) => {
    if (failed) {
      return
    }
    // When the view came in, on the wall clock the host shares (its
    // timeOrigin and ours are the same clock), and how long the frame took
    // from there to its batch posted (the frame-end posts it, in render).
    const t0 = performance.now()
    const receivedAt = performance.timeOrigin + t0
    endedAt = null
    viewId = msg.viewId
    applyView(body, msg.view)
    updateNewYork(msg.nyc === true, msg.view)
    try {
      body.widget.resize()
      body.widget.render()
    } catch (err) {
      fail(err)
      return
    }
    body.frames++
    if (msg.lights === true && body.night) {
      // The night lights' frame.  Its frame-end goes even if it fails, as
      // the host waits for it; then the status says there are none.
      part = 'lights'
      endedAt = null
      // The city black, not hidden: its buildings hide the lights on the
      // ground under them (CesiumLayers._drawNightLights).
      const city = nyc?.city
      city?.setOccluding?.(true)
      try {
        renderNightLights(body, () => body.widget.render())
      } catch (err) {
        console.warn(`[cesium guest] ${name} night lights failed; drawing no lights`, err)
        body.night = null
      } finally {
        city?.setOccluding?.(false)
      }
      if (endedAt === null) {
        endFrame()
      }
      part = null
    }
    sampleGround(body, name, performance.now())
    const status = {
      type: 'cesium:status',
      viewId,
      tilesLoaded: tilesReady(body),
      groundHeight: body.groundHeight ?? null,
      guest: GUEST_VERSION,
      night: Boolean(body.night),
      newYork: newYorkStatus(nyc),
      timing: {receivedAt, renderMs: (endedAt ?? performance.now()) - t0},
    }
    const now = JSON.stringify(creditsOf(creditContainer))
    if (now !== credits) {
      credits = now
      status.credits = JSON.parse(now)
    }
    core.transport.post(status)
  }

  base.onMessage((msg) => {
    if (msg?.type === 'cesium:view' && msg.view) {
      render(msg)
    } else if (msg?.type === 'cesium:newYork' && msg.on === false) {
      freeNewYork()
    } else if (msg?.type === 'cesium:height' && [msg.id, msg.lat, msg.lng, msg.radius].every(Number.isFinite)) {
      // The terrain's height at a landing place (CesiumLayers.requestGroundHeight),
      // from the tiles loaded so far, as groundHeightAt on the host's page:
      // the place on celestiary's sphere, on the ellipsoid.
      const [x, y, z] = bodyToEcef(latLngAltToBodyFixed(msg.lat, msg.lng, 0, msg.radius))
      const carto = body.ellipsoid.cartesianToCartographic(new body.Cesium.Cartesian3(x, y, z))
      const height = carto ? terrainHeight(body, name, carto) : null
      core.transport.post({type: 'cesium:height', id: msg.id, height: Number.isFinite(height) ? height : null})
    }
  })
  // NetGL's handshake, which the host's receiver waits on and where the
  // wire is agreed; in place, so the door's anchor is nominal.
  core.announce({position: [0, 0, 0], normal: [0, 0, -1], up: [0, 1, 0], halfWidth: 1, halfHeight: 1})
  window.cesiumGuest = {name, origin, guest, body}
}

