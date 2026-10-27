import {setDataBaseUrl} from '../dataUrl.js'
import {hostOrigin} from '../layer/origins.js'
import {CESIUM_BODIES, ionToken} from '../scene/cesium/bodies.js'
import {applyView, createWidget, sampleGround, tilesReady} from '../scene/cesium/cesiumBody.js'
import {creditsOf} from './credits.js'
import {CESIUM_GUEST_HOSTS, dataBase} from './origins.js'


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
// carrying the view's id.  After each frame a `cesium:status` says whether
// the tiles for that view are in, the terrain's height under the camera,
// and the credits, when they change.
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
  // The frame-end carries the view the frame was drawn for.
  body.widget.scene.postRender.addEventListener(() => core.endFrame(Number.isFinite(viewId) ? {viewId} : {}))

  /**
   * One frame, for the host's view.
   *
   * @param {object} msg {viewId, view}
   */
  const render = (msg) => {
    if (failed) {
      return
    }
    viewId = msg.viewId
    applyView(body, msg.view)
    try {
      body.widget.resize()
      body.widget.render()
    } catch (err) {
      fail(err)
      return
    }
    body.frames++
    sampleGround(body, name, performance.now())
    const status = {
      type: 'cesium:status',
      viewId,
      tilesLoaded: tilesReady(body),
      groundHeight: body.groundHeight ?? null,
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
    }
  })
  // NetGL's handshake, which the host's receiver waits on and where the
  // wire is agreed; in place, so the door's anchor is nominal.
  core.announce({position: [0, 0, 0], normal: [0, 0, -1], up: [0, 1, 0], halfWidth: 1, halfHeight: 1})
  window.cesiumGuest = {name, origin, guest, body}
}

