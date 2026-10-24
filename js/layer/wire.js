// What layer mode sends its host, per frame (design/LayerMode.md, "Cost"):
// a meter round the guest's transport, and the trim of each GL call's
// arrays to the bytes the call reads.
//
// portal-netgl 0.3.0's recorder encodes a typed array as its whole
// ArrayBuffer (`{buffer, offset, length}`), so a ranged upload, three's
// `bufferSubData(target, dstByteOffset, array, srcOffset, count)` for an
// attribute's `updateRanges`, crossed postMessage as the attribute's whole
// array: Starlink's 1/20 slice a frame went as its three ~130 KB arrays.
// compactCall copies out just what the call reads, so the wire carries the
// range.  Pure, DOM-free.
//
// compactCall is an interim fix: the recorder itself slices from
// portal-netgl 0.6.0 on, and compactCall goes when the guest moves to it
// (the follow-up to this, with `parentTransport`).  Its calls are valid
// wire for any receiver meanwhile.  The meter stays.


/**
 * @param {string} name a typed array's constructor's
 * @returns {number} its BYTES_PER_ELEMENT, or 1 if unknown
 */
function bytesPer(name) {
  return globalThis[name]?.BYTES_PER_ELEMENT ?? 1
}


/**
 * @param {*} arg an encoded argument
 * @returns {boolean} whether it's a recorder's typed-array envelope
 */
function isTypedEnvelope(arg) {
  return Boolean(arg) && typeof arg === 'object' && typeof arg.__netgl_typedarray === 'string' &&
    arg.buffer instanceof ArrayBuffer
}


/**
 * A typed-array envelope of `length` elements from `first`, in a buffer of
 * its own.
 *
 * @param {object} env
 * @param {number} first element index in env's view
 * @param {number} length elements
 * @returns {object}
 */
function sliceEnvelope(env, first, length) {
  const bpe = bytesPer(env.__netgl_typedarray)
  const from = env.offset + (first * bpe)
  return {__netgl_typedarray: env.__netgl_typedarray, buffer: env.buffer.slice(from, from + (length * bpe)), offset: 0, length}
}


/**
 * A GL call with its arrays cut to what it reads: `bufferSubData`'s source
 * to its `srcOffset` and `length`, and any other typed array to its own
 * view of its buffer.  The same call when there's nothing to cut.
 *
 * @param {object} call the recorder's `{name, args, returnId}`
 * @returns {object}
 */
export function compactCall(call) {
  const args = call?.args
  if (!Array.isArray(args)) {
    return call
  }
  let out = null
  const set = (i, v) => {
    out ??= args.slice()
    out[i] = v
  }
  if (call.name === 'bufferSubData' && isTypedEnvelope(args[2])) {
    // (target, dstByteOffset, srcData, srcOffset = 0, length = 0: to the end)
    const env = args[2]
    const first = Number.isInteger(args[3]) ? args[3] : 0
    const length = Number.isInteger(args[4]) && args[4] > 0 ? args[4] : env.length - first
    if (first >= 0 && length >= 0 && first + length <= env.length &&
        length * bytesPer(env.__netgl_typedarray) < env.buffer.byteLength) {
      set(2, sliceEnvelope(env, first, length))
      if (args.length > 3) {
        set(3, 0)
      }
      if (args.length > 4) {
        set(4, length)
      }
    }
  }
  for (let i = 0; i < args.length; i++) {
    const env = (out ?? args)[i]
    if (isTypedEnvelope(env) && env.length * bytesPer(env.__netgl_typedarray) < env.buffer.byteLength) {
      set(i, sliceEnvelope(env, 0, env.length))
    }
  }
  return out ? {...call, args: out} : call
}


/**
 * @param {*} v a message, or part of one
 * @returns {number} roughly what structured clone copies of it, bytes:
 *   buffers whole, strings at a byte a character, numbers at 8
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
  let n = 0
  for (const value of Array.isArray(v) ? v : Object.values(v)) {
    n += payloadBytes(value)
  }
  return n
}


/**
 * A transport that meters what it posts, and trims GL calls (compactCall)
 * unless told not to.
 *
 * @param {object} transport `post(msg, transfer)` and `onMessage(fn)`
 * @param {object} [opts]
 * @param {boolean} [opts.compact]
 * @param {Function} [opts.clock] ms, for the time spent posting
 * @returns {{transport: object, take: Function, totals: object}} `take()`
 *   returns and zeroes the counts since the last: GL `calls`, all
 *   `messages`, their `bytes`, and `postMs`, the time in post
 */
export function meteredTransport(transport, {compact = true, clock = () => globalThis.performance?.now() ?? Date.now()} = {}) {
  const zero = () => ({calls: 0, messages: 0, bytes: 0, postMs: 0})
  let since = zero()
  const totals = zero()
  return {
    transport: {
      post(msg, transfer) {
        const t0 = clock()
        const sent = compact && typeof msg?.name === 'string' ? compactCall(msg) : msg
        const bytes = payloadBytes(sent)
        transport.post(sent, transfer)
        const ms = clock() - t0
        for (const c of [since, totals]) {
          c.messages++
          c.calls += typeof sent?.name === 'string' ? 1 : 0
          c.bytes += bytes
          c.postMs += ms
        }
      },
      onMessage: (fn) => transport.onMessage(fn),
    },
    take() {
      const out = since
      since = zero()
      return out
    },
    totals,
  }
}
