import {EXTENT_M} from './OrbitsLayer.js'


// Layer mode's control plane, guest side (design/LayerMode.md, "The
// contract"), wire-compatible with portal-netgl 0.4.0's deck.gl host
// (`attachNetGLDeckLayer`, portal #36) and shaped as portal RFC 0001 has it
// (§6 the view, §7 time, §8 anchors, §10 the handshake):
//
//   - NetGL's own handshake, `netgl:ready` until `netgl:ready-ack`
//     (`announce`): 0.4.0's host sends no view before it.
//   - `layer:hello` beside it, until `layer:hello-ack` (or a first view,
//     from a host that doesn't ack it: 0.4.0 as published).
//   - `layer:invalidate {reason}` when what's drawn changes with no new
//     view (the data loaded, the DSN's feed, a subscription), so a host
//     that sends views only when its camera or clock moves (0.4.0's
//     `sameView`) sends one.
//   - `layer:view {viewId, view: {frame, viewMatrix, projectionMatrix,
//     viewport, pixelRatio, timeMs, earth}}`: one frame each, ending with
//     `netgl:frame-end`, which is the receipt 0.4.0's host waits on
//     (`receiver.onFrame`) before its next view.
//   - `layer:anchors` after a frame only while something is subscribed.
//
// Transport-agnostic and DOM-free, so the test drives it with fakes.


/** The protocol's version, in `layer:hello`. */
export const LAYER_PROTOCOL_VERSION = 1
/** `layer:hello` is repeated this often until the host is heard from, ms. */
export const HELLO_RESEND_MS = 500


/**
 * @param {object} opts
 * @param {object} opts.transport `post(msg)` and `onMessage(fn)`
 * @param {object} opts.layer an OrbitsLayer (applyView, anchors, subscribe, subscribed, dispose)
 * @param {Function} opts.render draw the layer's frame into the guest context
 * @param {Function} opts.endFrame end the NetGL frame (guest.endFrame: `netgl:frame-end`)
 * @param {Function} [opts.announce] post NetGL's `netgl:ready` until acked (guest.announce)
 * @param {Function} [opts.resize] (viewport, pixelRatio) before a frame
 * @param {Promise<Array<string>>} opts.loaded the layer's load (its failures)
 * @param {Function} [opts.nowMs]
 * @param {object} [opts.timers] {setInterval, clearInterval}
 * @returns {{stop: Function, state: object}}
 */
export function serveLayer({transport, layer, render, endFrame, announce = null, resize = null, loaded,
  nowMs = () => Date.now(), timers = globalThis}) {
  const state = {heard: false, ready: false, hidden: false, clock: null, pending: null, frames: 0, stopped: false,
    invalidations: 0}
  const post = (msg) => transport.post(msg)
  const hello = () => post({
    type: 'layer:hello', version: LAYER_PROTOCOL_VERSION, adapter: 'celestiary-orbits',
    capabilities: {kinds: ['overlay'], depth: ['shared'], projections: ['matrix'], frames: ['ecef'],
      warp: false, anchors: true, time: true, labels: false},
    contracts: {alpha: 'coverage', color: 'display'},
    extent: {frame: 'ecef', sphere: {center: [0, 0, 0], radius: EXTENT_M.orbits}, beyond: 'clamp-to-far',
      farthest: EXTENT_M.beams},
    ext: {'portal.anchors/1': {publish: ['norad', 'dsn', 'dsn-sc', 'naif']}},
  })
  announce?.()
  hello()
  const resend = timers.setInterval(() => {
    if (state.heard || state.stopped) {
      timers.clearInterval(resend)
      return
    }
    hello()
  }, HELLO_RESEND_MS)

  /**
   * @param {object} view
   * @returns {number} the time it's drawn at, Unix ms: its own, else the
   *   host's clock (`layer:time`), else the wall clock
   */
  const timeOf = (view) => {
    if (Number.isFinite(view.timeMs)) {
      return view.timeMs
    }
    const c = state.clock
    return c ? c.timeMs + (c.paused ? 0 : (nowMs() - c.at) * c.rate) : nowMs()
  }
  const draw = ({viewId = null, view}) => {
    if (state.hidden || state.stopped) {
      return
    }
    resize?.(view.viewport ?? [0, 0, 1, 1], view.pixelRatio ?? 1)
    const timeMs = timeOf(view)
    layer.applyView({...view, timeMs}, viewId)
    render()
    endFrame()
    state.frames++
    if (layer.subscribed) {
      post({type: 'layer:anchors', viewId, timeMs, anchors: layer.anchors()})
    }
  }

  const unsubscribe = transport.onMessage((msg) => {
    switch (msg?.type) {
      case 'layer:hello-ack':
        state.heard = true
        break
      case 'layer:view':
        state.heard = true
        if (!msg.view || typeof msg.view !== 'object') {
          break
        }
        if (state.ready) {
          draw(msg)
        } else {
          state.pending = msg
        }
        break
      case 'layer:time': {
        const timeMs = Number(msg.timeMs ?? msg.utcMs)
        state.clock = {timeMs, rate: Number.isFinite(msg.rate) ? msg.rate : 1, paused: msg.paused === true, at: nowMs()}
        break
      }
      case 'layer:anchors-subscribe':
        layer.subscribe(Array.isArray(msg.patterns) ? msg.patterns : [])
        invalidate('anchors subscribed')
        break
      case 'layer:visibility':
        state.hidden = msg.state === 'hidden'
        break
      case 'layer:dispose':
        stop()
        layer.dispose()
        break
      default:
        break
    }
  })

  loaded.then((failed) => {
    state.ready = true
    post(failed.length ? {type: 'layer:status', status: 'ready', partial: failed} : {type: 'layer:status', status: 'ready'})
    if (state.pending) {
      const msg = state.pending
      state.pending = null
      draw(msg)
    } else {
      invalidate('loaded')
    }
  }).catch((err) => post({type: 'layer:status', status: 'error', message: String(err?.message ?? err)}))
  post({type: 'layer:status', status: 'loading'})

  /**
   * Ask the host for a frame: what's drawn changed with no new view.
   *
   * @param {string} reason
   */
  function invalidate(reason) {
    if (!state.stopped) {
      state.invalidations++
      post({type: 'layer:invalidate', reason})
    }
  }
  layer.onInvalidate = (reason) => {
    if (state.ready) {
      invalidate(reason)
    }
  }

  /** Stop listening and resending. */
  function stop() {
    state.stopped = true
    timers.clearInterval(resend)
    unsubscribe()
  }
  return {stop, state, invalidate}
}
