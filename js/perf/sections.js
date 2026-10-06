/**
 * Exclusive-time sections, for a clock that can't nest.
 *
 * `EXT_disjoint_timer_query_webgl2` runs one `TIME_ELAPSED` query at a time,
 * so a pass inside another (the Milky Way's march inside the scene render, a
 * Cesium replay inside the composite) can't have its own query running
 * inside the outer one's.  A section stack makes it work anyway: opening a
 * section stops the one under it, and closing it starts that one again, as
 * another segment.  Each name's time is the sum of its segments, with
 * whatever ran inside it taken out: an outer section's time is its own, the
 * inner ones' not counted twice, and the sections add up to the frame.
 *
 * The clock is a pair of callbacks, so the CPU clock and the GPU one share
 * this logic, and the tests drive it with a fake.
 */
export default class Sections {
  /**
   * @param {{start: function(string): void, stop: function(string): void}} clock
   *   `start(name)` begins a segment for name, `stop(name)` ends it
   */
  constructor(clock) {
    this.clock = clock
    this.stack = []
  }


  /** @returns {string|null} The section running now */
  get top() {
    return this.stack.length === 0 ? null : this.stack[this.stack.length - 1]
  }


  /** @returns {number} How many sections are open */
  get depth() {
    return this.stack.length
  }


  /** @param {string} name Open a section, suspending the one under it */
  open(name) {
    const under = this.top
    if (under !== null) {
      this.clock.stop(under)
    }
    this.stack.push(name)
    this.clock.start(name)
  }


  /**
   * Close a section, and any left open inside it (a `begin` whose `end`
   * an exception skipped), then resume the one under it.  A name that isn't
   * open is ignored.
   *
   * @param {string} name
   * @returns {boolean} Whether it was open
   */
  close(name) {
    if (!this.stack.includes(name)) {
      return false
    }
    // Only the top one is running: the ones under it are suspended.
    this.clock.stop(this.stack[this.stack.length - 1])
    while (this.stack.pop() !== name) {
      // Left open inside it.
    }
    const under = this.top
    if (under !== null) {
      this.clock.start(under)
    }
    return true
  }


  /** Close everything. */
  closeAll() {
    if (this.stack.length > 0) {
      this.clock.stop(this.stack[this.stack.length - 1])
      this.stack = []
    }
  }
}


/** A `Sections` clock over a time source: accumulates milliseconds per name. */
export class CpuClock {
  /** @param {function(): number} now Milliseconds */
  constructor(now) {
    this.now = now
    this.startedAt = new Map()
    this.ms = {}
  }


  /** @param {string} name */
  start(name) {
    this.startedAt.set(name, this.now())
  }


  /** @param {string} name */
  stop(name) {
    const t0 = this.startedAt.get(name)
    if (t0 === undefined) {
      return
    }
    this.startedAt.delete(name)
    this.ms[name] = (this.ms[name] ?? 0) + (this.now() - t0)
  }


  /** @returns {{[key: string]: number}} What accumulated; the clock starts afresh */
  take() {
    const ms = this.ms
    this.ms = {}
    this.startedAt.clear()
    return ms
  }
}
