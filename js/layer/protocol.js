import {EXTENT_M} from './OrbitsLayer.js'


// Layer mode's control plane, guest side (design/LayerMode.md, "The
// contract"): the messages beside NetGL's call stream, named as portal's
// docs/portal-layers.md has them.  Transport-agnostic and DOM-free, so the
// test drives it with a fake transport and layer.


/** The protocol's version, in `layer:hello`. */
export const LAYER_PROTOCOL_VERSION = 1
/** `layer:hello` is repeated this often until the host acks it, ms. */
export const HELLO_RESEND_MS = 500


/**
 * @param {object} opts
 * @param {object} opts.transport `post(msg)` and `onMessage(fn)`
 * @param {object} opts.layer an OrbitsLayer (applyView, setTime, anchors, subscribe, dispose)
 * @param {Function} opts.render draw the layer's frame into the guest context
 * @param {Function} opts.endFrame end the NetGL frame (guest.endFrame)
 * @param {Function} [opts.resize] (viewport, pixelRatio) before a frame
 * @param {Promise<Array<string>>} opts.loaded the layer's load (its failures)
 * @param {Function} [opts.nowMs]
 * @param {object} [opts.timers] {setInterval, clearInterval}
 * @returns {{stop: Function, state: object}}
 */
export function serveLayer({transport, layer, render, endFrame, resize = null, loaded, nowMs = () => Date.now(),
  timers = globalThis}) {
  const state = {acked: false, ready: false, hidden: false, clock: null, pending: null, frames: 0, stopped: false}
  const post = (msg) => transport.post(msg)
  const hello = () => post({
    type: 'layer:hello', version: LAYER_PROTOCOL_VERSION, kind: 'celestiary-orbits',
    capabilities: {anchors: true, time: true, labels: false},
    contracts: {depth: 'shared', alpha: 'coverage', color: 'display-srgb'},
    extent: {radiusM: EXTENT_M.orbits, beamsM: EXTENT_M.beams},
  })
  hello()
  const resend = timers.setInterval(() => {
    if (state.acked || state.stopped) {
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
    return c ? c.utcMs + ((nowMs() - c.at) * c.rate) : nowMs()
  }
  const draw = (view) => {
    if (state.hidden || state.stopped) {
      return
    }
    resize?.(view.viewport ?? [0, 0, 1, 1], view.pixelRatio ?? 1)
    const timeMs = timeOf(view)
    layer.applyView({...view, timeMs})
    render()
    endFrame()
    state.frames++
    // The frame's receipt and its anchors, after its frame-end: the host
    // sends its next view on this (one view in flight).
    post({type: 'layer:anchors', viewId: view.viewId ?? null, timeMs, anchors: layer.anchors()})
  }

  const unsubscribe = transport.onMessage((msg) => {
    switch (msg?.type) {
      case 'layer:hello-ack':
        state.acked = true
        break
      case 'layer:view':
        if (state.ready) {
          draw(msg)
        } else {
          state.pending = msg
        }
        break
      case 'layer:time':
        state.clock = {utcMs: Number(msg.utcMs), rate: Number.isFinite(msg.rate) ? msg.rate : 1, at: nowMs()}
        break
      case 'layer:anchors-subscribe':
        layer.subscribe(Array.isArray(msg.patterns) ? msg.patterns : [])
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
      const view = state.pending
      state.pending = null
      draw(view)
    }
  }).catch((err) => post({type: 'layer:status', status: 'error', message: String(err?.message ?? err)}))
  post({type: 'layer:status', status: 'loading'})

  /** Stop listening and resending. */
  function stop() {
    state.stopped = true
    timers.clearInterval(resend)
    unsubscribe()
  }
  return {stop, state}
}
