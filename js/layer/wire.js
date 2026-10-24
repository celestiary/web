// What layer mode sends its host, per frame (design/LayerMode.md, "Cost"):
// a meter round the guest's transport, which `layer:stats` reports.
//
// From portal-netgl 0.6.0 on the recorder ships only what each call reads
// (bufferSubData's range, a view's own bytes), and wire 2 sends a frame as
// one `netgl:batch`, over the MessageChannel port the host hands the guest
// in its `netgl:ready-ack`.  Once that port is open the guest context posts
// its batches, and the app's own messages, on the port and not on the
// transport it was given, so the meter wraps the port too: it sees the ack
// come in, before the guest context does.  Pure, DOM-free.


/**
 * @param {*} v a message, or part of one
 * @returns {number} roughly what structured clone copies of it, bytes:
 *   buffers whole, strings at a byte a character, numbers at 8.  A
 *   transferred buffer moves rather than copies, but it's counted all the
 *   same: it's what crosses.
 */
export function payloadBytes(v) {
  if (v === null || v === undefined) {
    return 0
  }
  if (typeof v === 'number') {
    return 8
  }
  if (typeof v === 'string') {
    return v.length
  }
  if (typeof v !== 'object') {
    return 1
  }
  if (v instanceof ArrayBuffer) {
    return v.byteLength
  }
  if (ArrayBuffer.isView(v)) {
    return v.buffer.byteLength
  }
  if (typeof ImageBitmap !== 'undefined' && v instanceof ImageBitmap) {
    return v.width * v.height * 4
  }
  if (typeof MessagePort !== 'undefined' && v instanceof MessagePort) {
    return 0
  }
  let n = 0
  for (const value of Array.isArray(v) ? v : Object.values(v)) {
    n += payloadBytes(value)
  }
  return n
}


/**
 * @param {*} msg a posted message
 * @returns {number} the GL calls in it: 1 for a call (wire 1), a batch's
 *   calls (wire 2), else 0
 */
export function callsIn(msg) {
  if (typeof msg?.name === 'string') {
    return 1
  }
  if (msg?.type === 'netgl:batch' && Array.isArray(msg.batch)) {
    let n = 0
    for (const item of msg.batch) {
      n += typeof item?.name === 'string' ? 1 : 0
    }
    return n
  }
  return 0
}


/**
 * A transport that meters what it posts, and what's posted on the port a
 * host's `netgl:ready-ack` hands over (wire 2).
 *
 * @param {object} transport `post(msg, transfer)` and `onMessage(fn)`
 * @param {object} [opts]
 * @param {Function} [opts.clock] ms, for the time spent posting
 * @returns {{transport: object, take: Function, totals: object}} `take()`
 *   returns and zeroes the counts since the last: GL `calls`, all
 *   `messages` (window and port), their `bytes`, and `postMs`, the time in
 *   post
 */
export function meteredTransport(transport, {clock = () => globalThis.performance?.now() ?? Date.now()} = {}) {
  const zero = () => ({calls: 0, messages: 0, bytes: 0, postMs: 0})
  let since = zero()
  const totals = zero()
  const metered = (post) => (msg, transfer) => {
    const t0 = clock()
    const bytes = payloadBytes(msg)
    const calls = callsIn(msg)
    post(msg, transfer)
    const ms = clock() - t0
    for (const c of [since, totals]) {
      c.messages++
      c.calls += calls
      c.bytes += bytes
      c.postMs += ms
    }
  }
  const tapped = new WeakSet()
  /** @param {object} msg inbound; a ready-ack's port gets a metered post */
  const tap = (msg) => {
    const port = msg?.type === 'netgl:ready-ack' ? msg.port : null
    if (port && typeof port.postMessage === 'function' && !tapped.has(port)) {
      tapped.add(port)
      const post = port.postMessage.bind(port)
      port.postMessage = metered((m, transfer) => post(m, transfer ?? []))
    }
  }
  return {
    transport: {
      post: metered((msg, transfer) => transport.post(msg, transfer)),
      onMessage: (fn) => transport.onMessage((msg) => {
        tap(msg)
        fn(msg)
      }),
    },
    take() {
      const out = since
      since = zero()
      return out
    },
    totals,
  }
}
