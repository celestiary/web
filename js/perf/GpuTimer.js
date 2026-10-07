/**
 * GPU time per section of a frame, with `EXT_disjoint_timer_query_webgl2`.
 *
 * - **Non-blocking.**  A frame's queries are read a few frames later, when
 *   `QUERY_RESULT_AVAILABLE` says they're in; nothing waits for the GPU.
 * - **Nesting-safe.**  One `TIME_ELAPSED` query runs at a time, so a section
 *   is a series of segments, one query each (sections.js decides when one
 *   stops and another starts).  A name's time in a frame is its segments' sum.
 * - **Disjoint.**  When `GPU_DISJOINT_EXT` says the clock was disturbed (a
 *   power state change, a context switch), every frame in flight is dropped,
 *   not read.
 *
 * The extension gives the `TIME_ELAPSED_EXT` and `GPU_DISJOINT_EXT` enums; the
 * result queries (`QUERY_RESULT`, `QUERY_RESULT_AVAILABLE`) are WebGL 2's own.
 * Each GL context has its own timer: Cesium's shadow context (CESIUM.md) is a
 * context of its own, with its own extension object and queries.
 */


/** Frames in flight, at most: a GPU further behind than this has its oldest frames dropped. */
export const MAX_PENDING_FRAMES = 12
const NS_PER_MS = 1e6


export default class GpuTimer {
  /**
   * @param {WebGL2RenderingContext} gl
   * @param {object} ext Its `EXT_disjoint_timer_query_webgl2`
   */
  constructor(gl, ext) {
    this.gl = gl
    this.ext = ext
    this.free = []
    // Frames issued and not yet read: [{id, segments: [{name, query}]}]
    this.pending = []
    this.frame = null
    this.active = null
    this.disjoints = 0
    this.dropped = 0
  }


  /**
   * @param {WebGL2RenderingContext} gl
   * @returns {GpuTimer|null} A timer, or null where the extension is missing
   *   (Safari, or a browser that hides it, as Brave may)
   */
  static create(gl) {
    let ext = null
    try {
      ext = gl?.getExtension?.('EXT_disjoint_timer_query_webgl2') ?? null
    } catch {
      ext = null
    }
    return ext ? new GpuTimer(gl, ext) : null
  }


  /** @param {number} id The frame's number */
  startFrame(id) {
    this.stop()
    this.frame = {id, segments: [], tainted: false}
  }


  /** @param {string} name Begin a segment for it, ending the one running */
  start(name) {
    if (!this.frame) {
      return
    }
    this.stop()
    const query = this.free.pop() ?? this.gl.createQuery()
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query)
    this.active = {name, query}
  }


  /** End the segment running */
  stop() {
    if (!this.active) {
      return
    }
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT)
    this.frame?.segments.push(this.active)
    this.active = null
  }


  /** End the frame, and queue it to be read. */
  endFrame() {
    this.stop()
    const frame = this.frame
    this.frame = null
    if (!frame) {
      return
    }
    if (frame.tainted) {
      this._recycle(frame)
      return
    }
    this.pending.push(frame)
    while (this.pending.length > MAX_PENDING_FRAMES) {
      this.dropped++
      this._recycle(this.pending.shift())
    }
  }


  /**
   * Read the frames whose queries are in, oldest first.
   *
   * @returns {Array<{id: number, ms: {[key: string]: number}, total: number}>}
   *   Each frame's GPU milliseconds by section name, and their sum
   */
  poll() {
    const {gl, ext} = this
    // Reading the flag clears it.  It covers every query issued so far, the
    // frame being built included.
    if (gl.getParameter(ext.GPU_DISJOINT_EXT)) {
      this.disjoints++
      this.dropped += this.pending.length
      for (const frame of this.pending) {
        this._recycle(frame)
      }
      this.pending = []
      if (this.frame) {
        this.frame.tainted = true
      }
      return []
    }
    const done = []
    while (this.pending.length > 0) {
      const frame = this.pending[0]
      const last = frame.segments[frame.segments.length - 1]
      if (last && !gl.getQueryParameter(last.query, gl.QUERY_RESULT_AVAILABLE)) {
        break
      }
      this.pending.shift()
      const ms = {}
      let total = 0
      for (const {name, query} of frame.segments) {
        const v = gl.getQueryParameter(query, gl.QUERY_RESULT) / NS_PER_MS
        ms[name] = (ms[name] ?? 0) + v
        total += v
      }
      this._recycle(frame)
      done.push({id: frame.id, ms, total})
    }
    return done
  }


  /** @param {{segments: Array<{query: object}>}} frame */
  _recycle(frame) {
    for (const {query} of frame.segments) {
      this.free.push(query)
    }
  }


  /** Release the queries. */
  dispose() {
    this.stop()
    for (const frame of [this.frame, ...this.pending]) {
      if (frame) {
        this._recycle(frame)
      }
    }
    this.pending = []
    this.frame = null
    for (const query of this.free) {
      this.gl.deleteQuery(query)
    }
    this.free = []
  }
}
