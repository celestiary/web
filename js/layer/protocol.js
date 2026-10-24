import {EXTENT_M} from './OrbitsLayer.js'


// Layer mode's control plane, guest side (design/LayerMode.md, "The
// contract"), wire-compatible with portal-netgl's deck.gl host
// (`attachNetGLDeckLayer`, 0.4.0 on) and shaped as portal RFC 0001 has it
// (§6 the view, §7 time, §8 anchors, §10 the handshake):
//
//   - NetGL's own handshake, `netgl:ready` until `netgl:ready-ack`
//     (`announce`), which agrees the wire (0.6.0's wire 2, else 1): the
//     host sends no view before it.
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
//   - `layer:stats` about once a second, only after `layer:stats-subscribe`:
//     the guest's own cost a frame (design/LayerMode.md, "Cost").
//
// Transport-agnostic and DOM-free, so the test drives it with fakes.


/** The protocol's version, in `layer:hello`. */
export const LAYER_PROTOCOL_VERSION = 1
/** `layer:hello` is repeated this often until the host is heard from, ms. */
export const HELLO_RESEND_MS = 500
/** `layer:stats`' default interval, and its shortest, ms. */
export const STATS_INTERVAL_MS = 1000
export const STATS_MIN_INTERVAL_MS = 250


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
 * @param {?object} [opts.meter] the transport's meter (wire.js
 *   meteredTransport): `take()`, what was posted since it was last asked
 * @param {Function} [opts.clock] ms, for the frame's timings
 * @returns {{stop: Function, state: object}}
 */
export function serveLayer({transport, layer, render, endFrame, announce = null, resize = null, loaded,
  nowMs = () => Date.now(), timers = globalThis, meter = null,
  clock = () => globalThis.performance?.now() ?? Date.now()}) {
  const state = {heard: false, ready: false, hidden: false, clock: null, pending: null, frames: 0, stopped: false,
    invalidations: 0, last: null, stats: null}
  const post = (msg) => transport.post(msg)
  const hello = () => post({
    type: 'layer:hello', version: LAYER_PROTOCOL_VERSION, adapter: 'celestiary-orbits',
    capabilities: {kinds: ['overlay'], depth: ['shared'], projections: ['matrix'], frames: ['ecef'],
      warp: false, anchors: true, time: true, labels: false},
    contracts: {alpha: 'coverage', color: 'display'},
    extent: {frame: 'ecef', sphere: {center: [0, 0, 0], radius: EXTENT_M.orbits}, beyond: 'clamp-to-far',
      farthest: EXTENT_M.beams},
    // `near`: the subscription takes `{near: {p, n}, pattern}`, the n
    // anchors nearest p (anchors.js compileSubscription); a host asks for
    // it only when this says so.
    ext: {'portal.anchors/1': {publish: ['norad', 'dsn', 'dsn-sc', 'naif'], near: true}},
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
    const t0 = clock()
    layer.applyView({...view, timeMs}, viewId)
    const t1 = clock()
    render()
    const t2 = clock()
    endFrame()
    state.frames++
    let anchorsMs = 0
    if (layer.subscribed) {
      const t3 = clock()
      const anchors = layer.anchors()
      anchorsMs = clock() - t3
      post({type: 'layer:anchors', viewId, timeMs, anchors})
    }
    // What this frame cost the guest: the update, the render (with the
    // recording of its calls), the anchors, and what crossed the wire.
    const wire = meter?.take() ?? {calls: 0, messages: 0, bytes: 0, postMs: 0}
    state.last = {updateMs: t1 - t0, renderMs: t2 - t1, recordMs: wire.postMs, anchorsMs, calls: wire.calls,
      messages: wire.messages, bytes: wire.bytes}
    if (state.stats) {
      addStats(state.last)
    }
  }

  /** @param {object} frame state.last, into the interval's sums; posted when it's up */
  const addStats = (frame) => {
    const s = state.stats
    s.frames++
    for (const key of Object.keys(s.sums)) {
      s.sums[key] += frame[key]
    }
    const elapsed = clock() - s.since
    if (elapsed >= s.intervalMs) {
      const mean = Object.fromEntries(Object.entries(s.sums).map(([k, v]) => [k, v / s.frames]))
      post({type: 'layer:stats', frames: s.frames, intervalMs: elapsed, ...mean})
      startStats(s.intervalMs)
    }
  }
  /** @param {number} intervalMs */
  const startStats = (intervalMs) => {
    state.stats = {intervalMs, since: clock(), frames: 0,
      sums: {updateMs: 0, renderMs: 0, recordMs: 0, anchorsMs: 0, calls: 0, messages: 0, bytes: 0}}
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
      case 'layer:stats-subscribe': {
        // {intervalMs}: about this often; 0 or {enabled: false} stops them.
        const ms = Number(msg.intervalMs ?? STATS_INTERVAL_MS)
        if (msg.enabled === false || !(ms > 0)) {
          state.stats = null
        } else {
          startStats(Math.max(STATS_MIN_INTERVAL_MS, ms))
        }
        break
      }
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
