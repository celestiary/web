/**
 * Cheaper NetGL plumbing for a nested in-place guest (New York inside
 * Cesium inside celestiary; CESIUM.md, "New York", what it costs).  Two
 * host-side stand-ins for portal-netgl features it doesn't have yet:
 *
 * - leanShadow: a shadow context that keeps its objects, its state and its
 *   programs (it still answers the recorder's queries and mints its
 *   handles) but holds no geometry and draws nothing.  The recorder ships
 *   every call as it was made; only the shadow's own copy of it is cut.
 * - stageLink: a guest's calls made while its immediate link is closed (its
 *   whole build and compile, before its first frame) queued without copying
 *   their upload data, cut into chunks, and replayed a chunk a frame.
 *
 * Pure: no DOM, no Cesium; the GL contexts and the link are passed in.
 */


/** Calls that draw or clear: none on a lean shadow. */
const NO_DRAW = [
  'drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements',
  'clear', 'clearBufferfv', 'clearBufferiv', 'clearBufferuiv', 'clearBufferfi',
  'blitFramebuffer', 'invalidateFramebuffer', 'invalidateSubFramebuffer',
]
/** Calls that only write contents: none on a lean shadow (its contents are never read). */
const NO_CONTENTS = [
  'bufferSubData', 'copyBufferSubData',
  'texSubImage2D', 'texSubImage3D', 'compressedTexSubImage2D', 'compressedTexSubImage3D',
  'copyTexSubImage2D', 'copyTexSubImage3D',
]
const UNIFORM_BUFFER = 0x8A11


/**
 * Make a shadow context lean while `active()` says so: no draws, clears or
 * blits, no contents written, and its buffers' storage not allocated (a
 * uniform buffer's is, at its size, unfilled, for bindBufferRange's checks).
 * Textures keep their storage at its size, unfilled, so framebuffers stay
 * complete.  Everything else, the objects, programs and state, runs as
 * before, so the shadow still answers the recorder's queries (locations,
 * parameters, statuses) and mints its handles.  Its pixels and buffer
 * contents are then garbage: only for a shadow nothing reads back from (the
 * city's: three never reads it; Cesium's, during the city's calls only:
 * Cesium's picking doesn't call external renderers).
 *
 * Done with own properties on the context, which a NetGL recorder (a Proxy
 * over the shadow) reaches before the prototype's.
 *
 * @param {object} gl The shadow WebGL2 context (not its recorder)
 * @param {function(): boolean} [active] Whether the next call is lean
 * @returns {function(): void} Undo it
 */
export function leanShadow(gl, active = () => true) {
  const saved = new Map()
  const override = (name, lean) => {
    const own = Object.prototype.hasOwnProperty.call(gl, name)
    const prev = gl[name]
    if (typeof prev !== 'function') {
      return
    }
    saved.set(name, own ? prev : undefined)
    gl[name] = function(...args) {
      return active() ? lean(this, prev, args) : prev.apply(this, args)
    }
  }
  for (const name of [...NO_DRAW, ...NO_CONTENTS]) {
    override(name, () => undefined)
  }
  override('bufferData', (self, prev, args) => {
    const [target, data, usage] = args
    const bytes = typeof data === 'number' ? data : byteLengthOf(data, args[3], args[4])
    return prev.call(self, target, target === UNIFORM_BUFFER ? bytes : 0, usage)
  })
  override('texImage2D', (self, prev, args) => {
    if (args.length >= 9) {
      // (target, level, internalformat, width, height, border, format, type, pixels | offset)
      return typeof args[8] === 'number' ? prev.apply(self, args) : prev.call(self, ...args.slice(0, 8), null)
    }
    // (target, level, internalformat, format, type, source)
    const [target, level, internalformat, format, type, source] = args
    const {width, height} = sourceSize(source)
    return prev.call(self, target, level, internalformat, width, height, 0, format, type, null)
  })
  override('texImage3D', (self, prev, args) => {
    // (target, level, internalformat, width, height, depth, border, format, type, source | offset)
    return typeof args[9] === 'number' ? prev.apply(self, args) : prev.call(self, ...args.slice(0, 9), null)
  })
  return () => {
    for (const [name, prev] of saved) {
      if (prev === undefined) {
        delete gl[name]
      } else {
        gl[name] = prev
      }
    }
    saved.clear()
  }
}


/**
 * @param {object} data A typed array, DataView or ArrayBuffer
 * @param {number} [srcOffset] Elements
 * @param {number} [length] Elements
 * @returns {number} The bytes bufferData would take from it
 */
function byteLengthOf(data, srcOffset = 0, length = 0) {
  if (!data) {
    return 0
  }
  if (ArrayBuffer.isView(data)) {
    const size = data.BYTES_PER_ELEMENT || 1
    return length ? length * size : data.byteLength - (srcOffset * size)
  }
  return data.byteLength ?? 0
}


/**
 * @param {object} source An image, canvas, video, bitmap or ImageData
 * @returns {{width: number, height: number}}
 */
function sourceSize(source) {
  return {
    width: source?.naturalWidth || source?.videoWidth || source?.width || 1,
    height: source?.naturalHeight || source?.videoHeight || source?.height || 1,
  }
}


/** Calls whose data may be queued by reference (stageLink): allocations with their first contents. */
const BY_REFERENCE = new Set(['bufferData', 'texImage2D', 'texImage3D', 'compressedTexImage2D', 'compressedTexImage3D'])
/** Under this, bytes, a call's data is copied anyway: scratch arrays are small. */
const BY_REFERENCE_MIN_BYTES = 16384
/** A chunk ends after this much upload data, bytes ... */
export const CHUNK_BYTES = 8 * 1024 * 1024
/** ... or this many programs linked ... */
export const CHUNK_PROGRAMS = 4
/** ... or this many calls. */
export const CHUNK_CALLS = 4000


/**
 * Stage a guest's calls on its immediate link (portal-netgl
 * makeNetGLImmediateLink).  The link copies each call made while it's closed
 * (structuredClone, buffer data and all) into a queue it replays whole at the
 * start of the next `link.frame()`: for New York, its build and compile,
 * ~20,000 calls and ~130 MB, copied and held until its first frame, then
 * replayed in that one frame into both host contexts (Cesium's recorder and
 * celestiary's), every program linked there.  Staged instead:
 *
 * - The calls are queued here, not on the link: uploads' data (bufferData,
 *   texImage*) by reference, since what three hands those is the
 *   attribute's or the texture's own array, which nothing rewrites before
 *   the replay; everything else copied, as the link does (uniforms come from
 *   scratch arrays).
 * - The queue is cut into chunks, CHUNK_BYTES of upload, CHUNK_PROGRAMS
 *   programs linked or CHUNK_CALLS calls each, by asking the guest for a
 *   frame end (`guestCtx.endFrame()`): its checkpoint then starts the next
 *   chunk with the guest's state as it was, so a chunk replays in any host
 *   frame whatever the host did in between.
 * - `step()` replays one chunk (inside `link.frame`, so straight into the
 *   host); `frame(render)` replays what's left and runs one guest frame.
 *
 * The guest is made with `stage.transport` and handed to `stage.attach`.
 *
 * @param {object} link The guest's immediate link
 * @param {object} [budget] {bytes, programs, calls}: a chunk's most
 * @returns {object} {transport, attach(guestCtx), get chunks, get queued,
 *   step(), frame(render, {all}), stats}
 */
export function stageLink(link, {bytes = CHUNK_BYTES, programs = CHUNK_PROGRAMS, calls = CHUNK_CALLS} = {}) {
  const post = (msg) => link.transport.post(msg)
  let open = false
  let queue = []
  let chunks = 0
  let ctx = null
  let cutting = false
  let since = {bytes: 0, programs: 0, calls: 0}
  const stats = {queuedCalls: 0, byReferenceBytes: 0, copiedBytes: 0, chunks: 0}

  const isFrameEnd = (msg) => msg?.type === 'netgl:frame-end'
  const isCall = (msg) => typeof msg?.name === 'string' && Array.isArray(msg.args)

  const queueCall = (msg) => {
    let upload = 0
    for (const arg of msg.args) {
      upload += encodedBytes(arg)
    }
    if (BY_REFERENCE.has(msg.name) && upload >= BY_REFERENCE_MIN_BYTES) {
      // The encoded call is fresh (the recorder made it for this post); its
      // buffer is the guest's own, kept until the replay
      queue.push(msg)
      stats.byReferenceBytes += upload
    } else {
      queue.push(structuredClone(msg))
      stats.copiedBytes += upload
    }
    stats.queuedCalls++
    since.bytes += upload
    since.calls++
    if (msg.name === 'linkProgram') {
      since.programs++
    }
    if (ctx && !cutting && (since.bytes >= bytes || since.programs >= programs || since.calls >= calls)) {
      cutting = true
      try {
        ctx.endFrame()
      } finally {
        cutting = false
      }
    }
  }

  const transport = {
    post(msg) {
      if (open) {
        if (isFrameEnd(msg)) {
          open = false
        }
        post(msg)
        return
      }
      if (isCall(msg)) {
        queueCall(msg)
      } else if (isFrameEnd(msg)) {
        queue.push(msg)
        chunks++
        stats.chunks++
        since = {bytes: 0, programs: 0, calls: 0}
      } else {
        post(msg)
      }
    },
    onMessage: (listener) => link.transport.onMessage(listener),
  }

  // Replay queued messages into the open link: up to and including the first
  // frame end (one chunk), or all of them, frame ends dropped (their
  // checkpoints still restore the guest's state)
  const replay = (all) => {
    let i = 0
    for (; i < queue.length; i++) {
      const msg = queue[i]
      if (isFrameEnd(msg)) {
        chunks--
        if (!all) {
          i++
          post(msg)
          break
        }
        continue
      }
      post(msg)
    }
    queue = queue.slice(i)
  }

  return {
    transport,
    stats,
    /** @param {object} guestCtx The guest context made on `transport` */
    attach(guestCtx) {
      ctx = guestCtx
    },
    /** @returns {number} Chunks waiting (frame ends in the queue) */
    get chunks() {
      return chunks
    },
    /** @returns {number} Messages waiting */
    get queued() {
      return queue.length
    },
    /** @returns {boolean} Replayed one chunk (false: none was left) */
    step() {
      if (chunks === 0) {
        return false
      }
      link.frame(() => {
        open = true
        try {
          replay(false)
        } finally {
          open = false
        }
      })
      return true
    },
    /**
     * One guest frame: everything queued (every chunk left, at once: step()
     * them first to spread them over frames), then `render`'s calls.
     *
     * @param {function(): void} render
     */
    frame(render) {
      link.frame(() => {
        open = true
        try {
          replay(true)
          render()
        } finally {
          open = false
        }
      })
    },
  }
}


/**
 * @param {*} arg An encoded NetGL argument
 * @returns {number} The bytes of data it carries
 */
function encodedBytes(arg) {
  if (!arg || typeof arg !== 'object') {
    return 0
  }
  if (arg.__netgl_typedarray) {
    const size = globalThis[arg.__netgl_typedarray]?.BYTES_PER_ELEMENT ?? 1
    return arg.length * size
  }
  if (arg.__netgl_arraybuffer) {
    return arg.__netgl_arraybuffer.byteLength
  }
  if (arg.__netgl_imagedata) {
    return arg.buffer?.byteLength ?? 0
  }
  if (Array.isArray(arg)) {
    return arg.reduce((sum, a) => sum + encodedBytes(a), 0)
  }
  return 0
}
