import {DataTexture, WebGLRenderer} from 'three'
import {makeNetGLGuestContext, parentTransport} from '@pablo-mayrgundter/portal-netgl/core'
import Celestiary from '../Celestiary.js'
import useStore from '../store/useStore.js'
import {gmstRad} from '../scene/celestialFrame.js'
import {hostOrigin} from '../layer/origins.js'
import {meteredTransport} from '../layer/wire.js'
import {serveLayer} from '../layer/protocol.js'
import {targets} from '../shared.js'
import {fieldOf, landedQuaternion, shadowDrawsFor, skyGain, sunAltitude} from './view.js'


// The sky guest (public/sky.html; design/SkyGuest.md): celestiary itself,
// the whole app less its chrome, landed on Earth where a host says and
// drawing the sky there into the host's WebGL context through NetGL.  The
// host sends its camera each frame, as a rotation in Earth's equator of date
// with its projection, its clock and its observer; celestiary renders that
// view, its stars, Milky Way, planets, Moon, Sun, clouds and air, and ends
// the frame.  The first host is exo.cafe's abode.
//
//   sky.html[?host=<origin>][&meter=0][&perf=1|sync]
//
// The host's origin is found and checked as layer mode's (layer/origins.js),
// and the control plane is layer mode's (layer/protocol.js) with the sky's
// hello.
//
// The exposure is celestiary's own: its meter reads the frame back and the
// eye adapts, as in the app.  For that the guest's shadow context draws
// (portal-netgl's `shadowDraws`): the scene buffer only on the frames the
// meter samples, one in four, where portal-netgl lets it switch (0.6.11),
// and every frame's otherwise, its GPU work twice over (meterOnly, below).
// `meter=0` keeps the shadow from drawing, and takes the gain the meter
// settles on for the Sun's altitude instead (view.js skyGain), for a
// cheaper sky that's right on average and wrong where the frame's content
// matters (the Moon in view, a bright planet).


/** The sky guest's `layer:hello`: an opaque view of the sky, any projection, in the equator of date. */
export const SKY_HELLO = Object.freeze({
  adapter: 'celestiary-sky',
  capabilities: {kinds: ['sky'], depth: ['none'], projections: ['matrix'], frames: ['equator-of-date'],
    warp: false, anchors: false, time: true, labels: false, observer: true},
  contracts: {alpha: 'opaque', color: 'display'},
  extent: {frame: 'equator-of-date', beyond: 'infinite'},
})
/**
 * Earth's ground, plain: a host draws its own ground under the sky, so the
 * guest needn't load or upload the surface's maps (colour, terrain, water,
 * normals, night lights: about 80 MB, and 34 MB again each month at a
 * host's fast clock), all of which crossed to the host as uploads that
 * stalled its frame.  One 1×1 texture in their place, and none for the
 * rest; the atmosphere is the LUTs', not the ground's.  Cheap when held.
 *
 * @param {object} c Celestiary
 */
function plainGround(c) {
  const earth = c.scene.objects.earth
  if (!earth) {
    return
  }
  // Held at the draw itself: the planet hands its stand-in map over to the
  // real one once that loads (standInMaps.js), and the month's after that,
  // in the frame's own animation, after the view is applied.
  earth.traverse((o) => {
    if (o.name !== 'planet surface' || !o.material || o.userData.plainGround) {
      return
    }
    o.userData.plainGround = true
    const before = o.onBeforeRender
    o.onBeforeRender = function(...args) {
      plainMaterial(this.material)
      return before.apply(this, args)
    }
    plainMaterial(o.material)
  })
}


/**
 * @param {object} m the surface's material
 */
function plainMaterial(m) {
  let changed = m.map !== GROUND
  m.map = GROUND
  for (const k of ['bumpMap', 'normalMap', 'roughnessMap', 'metalnessMap']) {
    changed ||= m[k] !== null
    m[k] = null
  }
  if (m.userData.uNightMap && m.userData.uNightMap.value !== NO_LIGHTS) {
    m.userData.uNightMap.value = NO_LIGHTS
  }
  if (changed) {
    m.needsUpdate = true
  }
}
const GROUND = new DataTexture(new Uint8Array([46, 52, 40, 255]), 1, 1)
GROUND.needsUpdate = true
const NO_LIGHTS = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1)
NO_LIGHTS.needsUpdate = true
/**
 * The shadow draws what the meter reads, and no more (portal-netgl 0.6.11's
 * settable `shadowDraws`; before it, nothing changes and the shadow draws
 * everything).  Decided by the target each draw goes to:
 *
 * - the scene buffer, only on the frames the meter samples
 *   (ThreeUi.isMeterFrame): the meter reads it back at their end;
 * - the screen, never: nothing reads the shadow's (it's 1×1);
 * - any other target, always: the caches drawn there are read again on
 *   later frames (the Milky Way's march, the zodiacal light, the clouds'
 *   history, the atmosphere's tables, the galaxies), and the metering
 *   target itself.
 *
 * Three binds every target through `setRenderTarget`, its shadow maps and
 * transmission pass too, so the switch sits there.
 *
 * @param {object} guest portal-netgl's guest context
 * @param {object} renderer three's, on the guest's context
 * @param {object} ui ThreeUi
 */
function meterOnly(guest, renderer, ui) {
  const settable = Boolean(Object.getOwnPropertyDescriptor(guest, 'shadowDraws')?.set)
  if (!settable) {
    return
  }
  const bind = renderer.setRenderTarget.bind(renderer)
  renderer.setRenderTarget = (target, ...rest) => {
    guest.shadowDraws = shadowDrawsFor(target, ui._sceneRT, ui.isMeterFrame())
    return bind(target, ...rest)
  }
  guest.shadowDraws = false
}


/** How high the camera stands, m. */
const EYE_HEIGHT_M = 2
/**
 * What the app's callbacks for its chrome get here: nothing to show them in.
 *
 * @returns {undefined}
 */
const ignore = () => undefined


const found = hostOrigin({search: location.search, referrer: document.referrer, ancestors: location.ancestorOrigins})
if (!found || window.parent === window) {
  document.body.textContent = 'celestiary sky: embed this page in an allowed host (design/SkyGuest.md).'
} else {
  start(found)
}


/**
 * Boot celestiary on the guest's context and serve the host's views.
 *
 * @param {string} origin the host's
 */
function start(origin) {
  const metering = new URLSearchParams(location.search).get('meter') !== '0'
  const meter = meteredTransport(parentTransport({hostOrigins: [origin]}))
  const guest = makeNetGLGuestContext({transport: meter.transport, messageChannel: 'stream', wire: 2,
    shadowDraws: metering})
  const renderer = new WebGLRenderer({context: guest.gl, canvas: guest.shadow.canvas, antialias: false})
  // Not the homepage, and no Cesium: the sky is celestiary's own.  And
  // the meter reads its frame back synchronously (ThreeUi's `meter=sync`):
  // into client memory, which portal-netgl keeps on this page's shadow.
  // The pixel-pack buffer it reads through otherwise is replayed on the
  // host, where nothing reads it (Chrome warns, 'READ-usage buffer was
  // written, then fenced, but written again', and copies it for nothing),
  // and the wait for the pixels stays in this page's process.
  const search = new URLSearchParams(location.search)
  if (metering && !search.has('meter')) {
    search.set('meter', 'sync')
  }
  history.replaceState(null, '', `${location.pathname}?${search}#sun`)
  for (const body of ['earth', 'moon', 'mars']) {
    useStore.getState().setBodyLayer(body, 'default')
  }
  const container = document.body.appendChild(document.createElement('div'))
  const c = new Celestiary(useStore, container, document.createElement('div'), ignore, ignore,
      {renderer, viewSize: {width: 640, height: 400}})
  // Frames are the host's to ask for: no loop of our own, and no permalink
  // in our address bar.
  renderer.setAnimationLoop(null)
  c._schedulePermalinkUpdate = ignore
  if (!metering) {
    c.ui._meter = ignore
  } else {
    meterOnly(guest, renderer, c.ui)
  }
  const shrinkShadow = () => {
    // three keeps the size it was given; the shadow's own buffer goes back
    // to 1×1 (layer/layer.js).  The meter reads the scene's render target,
    // not this, so it's the same with the meter on.
    guest.shadow.canvas.width = 1
    guest.shadow.canvas.height = 1
  }
  shrinkShadow()

  let site = null
  const sky = {
    viewId: null,
    subscribed: false,
    onInvalidate: null,
    subscribe: ignore,
    anchors: () => [],
    dispose: ignore,
    /**
     * @param {object} view {viewMatrix, projectionMatrix, timeMs, observer}
     * @param {?number} viewId
     */
    applyView(view, viewId) {
      this.viewId = viewId
      const o = view.observer ?? {lat: 0, lon: 0, alt: 0}
      c.time.setTime(view.timeMs)
      c.time.isPaused = true
      // On the ground where the host says: again if the site moves, or if
      // the app's own arrival (at #sun, as it loads) took the camera away.
      const key = `${o.lat},${o.lon},${o.alt ?? 0}`
      const earth = c.scene.objects.earth
      if (key !== site || !targets.landed || c.ui.camera.platform.parent !== earth) {
        site = key
        c.scene.land('earth', o.lat, o.lon, (o.alt ?? 0) + EYE_HEIGHT_M, {instant: true})
      }
      plainGround(c)
      targets.track = false
      targets.tween = null
      const cam = c.ui.camera
      const {fov} = fieldOf(view.projectionMatrix)
      cam.fov = fov
      cam.updateProjectionMatrix()
      landedQuaternion(view.viewMatrix, gmstRad(c.time.simTimeJulianDay()), cam.quaternion)
      c.ui._approach = null
      if (!metering) {
        // What the meter would settle on for the Sun's height, at once.
        const gain = skyGain(sunAltitude(view.timeMs, o.lat, o.lon))
        c.ui._meterGain = c.ui._meterGainGoal = gain
        c.ui._liveExposure = null
        c.ui._lastExposureMs = null
      }
    },
    render() {
      c.ui.renderLoop(performance.now())
    },
  }

  const served = serveLayer({
    transport: guest.transport, layer: sky, meter, hello: SKY_HELLO,
    loaded: whenReady(c),
    render: () => sky.render(),
    endFrame: () => guest.endFrame(Number.isFinite(sky.viewId) ? {viewId: sky.viewId} : {}),
    announce: () => guest.announce({position: [0, 0, 0], normal: [0, 0, 1], up: [0, 1, 0]}),
    resize: ([, , w, h], pixelRatio) => {
      if (renderer.getPixelRatio() !== pixelRatio) {
        renderer.setPixelRatio(pixelRatio)
      }
      c.setViewSize(w / pixelRatio, h / pixelRatio)
      shrinkShadow()
    },
  })
  // The host can ask for this page's perf snapshot (its passes, by
  // js/perf; on with `perf=1` in this page's URL, which exo's `?sky_perf=1`
  // passes on): the guest's own side of the cost, recording and its shadow's
  // draws; the host times its replay itself.
  guest.transport.onMessage((msg) => {
    if (msg?.type !== 'sky:perf-request') {
      return
    }
    const perf = window.perf
    const snapshot = perf?.enabled ? JSON.parse(JSON.stringify(perf.snapshot())) :
      {enabled: false, note: 'add perf=1 to sky.html (exo: ?sky_perf=1)'}
    guest.transport.post({type: 'sky:perf', id: msg.id, snapshot: {...snapshot, lastFrame: served.state.last, metering}})
  })
  window.celestiarySky = {c, renderer, guest, origin, meter, served, metering}
}


/**
 * When Earth is in the scene, to land on.
 *
 * @param {Celestiary} c
 * @returns {Promise<Array<string>>} what failed (nothing)
 */
function whenReady(c) {
  return new Promise((resolve) => {
    const poll = setInterval(() => {
      if (c.scene?.objects?.earth?.props?.radius) {
        clearInterval(poll)
        // The overlays off: labels, orbits, grids and the rest.
        c.scene.applySettings({a: false, l: false, p: false, o: false, x: false, G: false, e: false, c: false,
          g: false})
        c.scene.overlays?.finish?.()
        resolve([])
      }
    }, 100)
  })
}
