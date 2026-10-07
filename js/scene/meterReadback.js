/**
 * The meter's readback, asynchronous (HDR.md, "The meter's readback"): the
 * 32×32 metering target is read into a pixel-pack buffer (`readPixels` with
 * an offset, which queues a copy on the GPU and returns), a fence goes in
 * after it, and on a later frame, once the fence has signalled, the pixels
 * are copied out of the buffer (`getBufferSubData`), which then waits for
 * nothing.  A synchronous `readPixels` into client memory waits for the
 * whole frame queued ahead of it: about 40 ms every fourth frame on the
 * user's M2 (#189), 0.5 ms with the GPU already drained.
 *
 * A small ring of buffers, so a reading can be a few frames late without a
 * metering waiting for the one before it.  The GPU finishes its work in
 * order, so when a reading is ready every older one is too, and only the
 * newest is copied out; the older are dropped unread.  With every slot in
 * flight (a GPU several meterings behind) a metering is skipped, never
 * waited for.
 *
 * Pure bookkeeping over a WebGL2 context's calls, so the tests drive it with
 * a stand-in.
 */


/** Buffers in the ring: a reading can be up to this many meterings late. */
export const METER_RING_SIZE = 3

// The WebGL2 enums used, for a stand-in context without them.
const GL = {
  PIXEL_PACK_BUFFER: 0x88EB,
  STREAM_READ: 0x88E1,
  SYNC_GPU_COMMANDS_COMPLETE: 0x9117,
  SYNC_STATUS: 0x9114,
  SIGNALED: 0x9119,
  RGBA: 0x1908,
  FLOAT: 0x1406,
}


/**
 * @param {object} gl A rendering context
 * @returns {boolean} Whether it can read back through a pixel-pack buffer and
 *   a fence: a WebGL2 context, with sync objects
 */
export function asyncReadbackSupported(gl) {
  return Boolean(gl) && typeof gl.fenceSync === 'function' && typeof gl.getSyncParameter === 'function' &&
    typeof gl.getBufferSubData === 'function' && typeof gl.deleteSync === 'function' &&
    typeof gl.createBuffer === 'function'
}


/**
 * Reads a framebuffer's pixels back a few frames late, never waiting.
 *
 * - `issue(meta, frame)` queues a read of the bound read framebuffer into a
 *   free buffer, with a fence after it, and keeps `meta` (what the frame was
 *   rendered with) beside it.  False when every buffer is in flight.
 * - `poll(frame)` returns the newest finished read, `{pixels, meta,
 *   latency}`, `latency` in frames since its issue, or null when none has
 *   finished.  `pixels` is one array, reused: read it before the next poll.
 */
export class AsyncReadback {
  /**
   * @param {object} gl A WebGL2 context
   * @param {object} options
   * @param {number} options.width
   * @param {number} options.height
   * @param {number} [options.slots] Buffers in the ring
   */
  constructor(gl, {width, height, slots = METER_RING_SIZE}) {
    this.gl = gl
    this.width = width
    this.height = height
    this.pixels = new Float32Array(width * height * 4)
    this._enum = (name) => gl[name] ?? GL[name]
    // Every buffer, and the ones free; in flight, oldest first.
    this._slots = []
    this._free = []
    for (let i = 0; i < slots; i++) {
      const buffer = gl.createBuffer()
      gl.bindBuffer(this._enum('PIXEL_PACK_BUFFER'), buffer)
      gl.bufferData(this._enum('PIXEL_PACK_BUFFER'), this.pixels.byteLength, this._enum('STREAM_READ'))
      const slot = {buffer, sync: null, meta: null, frame: 0}
      this._slots.push(slot)
      this._free.push(slot)
    }
    gl.bindBuffer(this._enum('PIXEL_PACK_BUFFER'), null)
    this._inFlight = []
    // Meterings skipped with every buffer in flight, for the probes.
    this.skipped = 0
  }


  /** @returns {number} Reads issued and not yet taken */
  get inFlight() {
    return this._inFlight.length
  }


  /** @returns {boolean} Whether a buffer is free for the next read */
  canIssue() {
    return this._free.length > 0
  }


  /**
   * Queue a read of the bound read framebuffer's RGBA floats into a free
   * buffer, and a fence after it.
   *
   * @param {*} meta What to hand back with the pixels
   * @param {number} frame The frame it's read in
   * @returns {boolean} False, and nothing queued, when every buffer is in flight
   */
  issue(meta, frame) {
    const slot = this._free.shift()
    if (!slot) {
      this.skipped++
      return false
    }
    const gl = this.gl
    const pack = this._enum('PIXEL_PACK_BUFFER')
    gl.bindBuffer(pack, slot.buffer)
    gl.readPixels(0, 0, this.width, this.height, this._enum('RGBA'), this._enum('FLOAT'), 0)
    gl.bindBuffer(pack, null)
    slot.sync = gl.fenceSync(this._enum('SYNC_GPU_COMMANDS_COMPLETE'), 0)
    slot.meta = meta
    slot.frame = frame
    this._inFlight.push(slot)
    return true
  }


  /**
   * @param {number} frame The frame it's polled in
   * @returns {{pixels: Float32Array, meta: *, latency: number}|null} The
   *   newest read whose fence has signalled, or null; older finished reads
   *   are dropped, and their buffers freed.
   */
  poll(frame) {
    const gl = this.gl
    let newest = null
    // In order: the GPU finishes them in order, so stop at the first that hasn't.
    while (this._inFlight.length > 0 && this._signalled(this._inFlight[0])) {
      const slot = this._inFlight.shift()
      gl.deleteSync(slot.sync)
      slot.sync = null
      if (newest) {
        this._release(newest)
      }
      newest = slot
    }
    if (!newest) {
      return null
    }
    const pack = this._enum('PIXEL_PACK_BUFFER')
    gl.bindBuffer(pack, newest.buffer)
    gl.getBufferSubData(pack, 0, this.pixels)
    gl.bindBuffer(pack, null)
    const out = {pixels: this.pixels, meta: newest.meta, latency: frame - newest.frame}
    this._release(newest)
    return out
  }


  /** Delete the buffers and fences. */
  dispose() {
    for (const slot of this._slots) {
      if (slot.sync) {
        this.gl.deleteSync(slot.sync)
      }
      this.gl.deleteBuffer(slot.buffer)
    }
    this._slots = []
    this._free = []
    this._inFlight = []
  }


  /**
   * @param {object} slot
   * @returns {boolean} Whether its fence has signalled.  Polled with
   *   getSyncParameter, which doesn't wait (WebGL updates a sync's status
   *   between tasks, so at the soonest the frame after its issue).
   */
  _signalled(slot) {
    return this.gl.getSyncParameter(slot.sync, this._enum('SYNC_STATUS')) === this._enum('SIGNALED')
  }


  /** @param {object} slot Back to the free list */
  _release(slot) {
    slot.meta = null
    this._free.push(slot)
  }
}
