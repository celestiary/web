import {Vector2} from 'three'
import {targets} from '../shared.js'
import {makeBarrier} from './barrier.js'
import {CountSink} from './counts.js'
import GpuTimer from './GpuTimer.js'
import {installGlCounters} from './glCounters.js'
import Overlay from './Overlay.js'
import PerfStats from './PerfStats.js'
import Sections, {CpuClock} from './sections.js'
import {buildSnapshot, snapshotJson} from './snapshot.js'
import {parsePerfParams, passesOff} from './toggles.js'


/** How often the overlay redraws, ms. */
const OVERLAY_EVERY_MS = 500
/** How often to look again for a hidden toggle's object that wasn't in the scene yet, in frames. */
const LOOKUP_EVERY_FRAMES = 60
// The scene objects a `hide` toggle (toggles.js) hides, by toggle key.
const HIDDEN_OBJECTS = {galaxy: 'MilkyWay', galaxies: 'Galaxies'}
const NO_TIMER_NOTE = 'GPU timer unavailable (EXT_disjoint_timer_query_webgl2 missing or hidden): CPU times, ' +
  'which are the time to issue the work, not to run it.  Tick sync timing, or bisect with the toggles and the FPS.'
const ENCODER_NOTE = 'GPU timer queries here read per encoder, not per pass (passes in one read alike, and the sum is ' +
  'more than the frame): do not trust or add the GPU column.  Tick sync timing for per-pass cost.'
// Timer queries are per encoder where the sum of the passes' means is this many times the frame interval.
const ENCODER_SUM_RATIO = 1.5
// Frames before that sum means anything.
const ENCODER_MIN_FRAMES = 30


/**
 * The `?perf=1` instrumentation (DESIGN.md, "Perf overlay"): the hooks the
 * frame loop calls, and what they feed.  Without `?perf=1` `enabled` is false
 * and every hook returns at its first line: no timer queries, no wrapped GL
 * calls, no DOM.
 *
 * The hooks, in the frame:
 * - `begin(name)` / `end(name)` bracket a pass.  `begin` returns false when
 *   the pass's toggle is off, so a pass that can be switched off is
 *   `if (perf.begin('x')) {...}` then `perf.end('x')`.
 * - `gate(name, uniform)` zeroes a uniform that switches the pass's work off.
 * - `frameBegin()` / `frameEnd()` bracket the frame.
 * - `attachCesium(name, link, guest)` times and counts Cesium's shadow
 *   context.
 *
 * Sections nest (sections.js); each pass's time is its own.
 */
export class Perf {
  constructor() {
    this.enabled = false
    // Toggle keys switched off, and the pass names that comes to, by kind.
    this.off = new Set()
    this.offSkip = new Set()
    this.offGate = new Set()
  }


  /**
   * Turn instrumentation on if the URL asks (`?perf=1`).
   *
   * @param {object} ui ThreeUi: `renderer`, `scene`, `camera`, `layers`, `width`, `height`, `hdr`
   * @param {object} [options]
   * @param {string} [options.search] The query string; default the page's
   * @param {Document} [options.doc] Where the overlay goes; default the page's
   * @param {function(): number} [options.now] Milliseconds; default performance.now
   * @param {boolean} [options.overlay] Show the overlay (the tests don't)
   * @returns {boolean} Whether it is on
   */
  install(ui, {search, doc, now, overlay = true} = {}) {
    if (this.enabled) {
      return true
    }
    const query = search ?? (typeof location === 'undefined' ? '' : location.search)
    const params = parsePerfParams(query)
    if (!params.enabled) {
      return false
    }
    this.ui = ui
    this.renderer = ui.renderer
    this._now = now ?? (() => performance.now())
    this.off = params.off
    this._syncToggles()
    this.stats = new PerfStats()
    this.sink = new CountSink()
    this.cpuClock = new CpuClock(this._now)
    this.gl = this.renderer.getContext()
    // What the context says it is, before the counters, so the lookups don't count.
    this._unmasked = unmaskedRenderer(this.gl)
    const probe = GpuTimer.create(this.gl)
    this._timerAvailable = probe !== null
    this.sync = params.sync
    this.barrierKind = params.barrier
    this.barrier = makeBarrier(this.gl, this.barrierKind)
    // Sync timing waits for the GPU at each pass's end and times by the wall clock; no queries then.
    this.gpu = this.sync ? null : probe
    this._granularity = null
    this.removeCounters = installGlCounters(this.gl, this.sink)
    // Three resets the counts at each render() call by default, and a frame
    // has a dozen; the frame resets them (frameBegin).
    this.renderer.info.autoReset = false
    this.sections = new Sections({
      start: (name) => {
        this.sink.setPass(name)
        this.cpuClock.start(name)
        this.gpu?.start(name)
      },
      stop: (name) => {
        if (this.sync) {
          this._wait(this.sink, this.barrier)
        }
        this.cpuClock.stop(name)
        this.gpu?.stop()
      },
    })
    // Cesium's shadow contexts, by body: {timer, sink, remove}.
    this.shadows = new Map()
    this.frameId = 0
    // GPU results for frames before this one are from before the last reset: dropped.
    this._validFrom = 0
    this._frameOpen = false
    this._lastFrameAt = null
    this._lastOverlayAt = -Infinity
    this._hidden = new Map()
    this._lookups = 0
    this.enabled = true
    if (typeof window !== 'undefined') {
      // For the console, as `window.c` is: `perf.snapshot()`.
      window.perf = this
    }
    if (overlay && (doc ?? (typeof document === 'undefined' ? null : document))) {
      this.overlay = new Overlay({
        doc: doc ?? document,
        off: this.off,
        sync: this.sync,
        onSync: (on) => this.setSync(on),
        onToggle: (key, runs) => this.setToggle(key, runs),
        onCopy: () => snapshotJson(this.snapshot()),
        onReset: () => this.resetStats(),
      })
    }
    return true
  }


  /**
   * Begin a pass.
   *
   * @param {string} name
   * @returns {boolean} Whether the pass should run: false when it is switched off
   */
  begin(name) {
    if (!this.enabled) {
      return true
    }
    if (this.offSkip.has(name)) {
      return false
    }
    if (this._frameOpen) {
      this.sections.open(name)
    }
    return true
  }


  /** @param {string} name End a pass begun */
  end(name) {
    if (this.enabled && this._frameOpen) {
      this.sections.close(name)
    }
  }


  /**
   * @param {string} name A pass
   * @returns {boolean} Whether the pass should run, for one decided away from its `begin`
   */
  runs(name) {
    return !this.enabled || !this.offSkip.has(name)
  }


  /**
   * @param {string} name A pass
   * @param {{value: number}} uniform Zeroed when the pass's `gate` toggle is off
   */
  gate(name, uniform) {
    if (this.enabled && this.offGate.has(name)) {
      uniform.value = 0
    }
  }


  /** Start the frame's clocks. */
  frameBegin() {
    if (!this.enabled) {
      return
    }
    if (this._frameOpen) {
      // An exception skipped the last frame's end: drop it.
      this._closeFrame()
    }
    const now = this._now()
    if (this._lastFrameAt !== null) {
      this.stats.addInterval(now - this._lastFrameAt)
    }
    this._lastFrameAt = now
    this._frameOpen = true
    this.frameId++
    this.renderer.info.reset()
    this.gpu?.startFrame(this.frameId)
    for (const s of this.shadows.values()) {
      s.timer?.startFrame(this.frameId)
    }
    // Whatever runs outside a named pass counts here.
    this.sections.open('other')
    this._applyHides()
  }


  /** End the frame: bank this frame's CPU time and counts, and read the frames whose GPU time is in. */
  frameEnd() {
    if (!this.enabled || !this._frameOpen) {
      return
    }
    const {cpu, counts} = this._closeFrame()
    let total = 0
    for (const ms of Object.values(cpu)) {
      total += ms
    }
    this.stats.addCpu(cpu, total)
    const r = this.renderer.info.render
    this.stats.addCounts(counts, {calls: r.calls, triangles: r.triangles, points: r.points, lines: r.lines})
    if (this.gpu) {
      // The poll's own getParameter and getQueryParameter calls aren't the page's.
      this.sink.muted = true
      for (const frame of this.gpu.poll()) {
        if (frame.id >= this._validFrom) {
          this.stats.addGpu(frame)
        }
      }
      this.sink.muted = false
    }
    for (const [name, s] of this.shadows) {
      const taken = s.sink.take()
      this.stats.addContextCounts(name, taken.total, taken.sync.total)
      if (this.sync) {
        // The wait for the context to finish what it was given (sync timing).
        this.stats.addContextGpu(name, s.waitMs)
        s.waitMs = 0
        continue
      }
      s.sink.muted = true
      for (const frame of s.timer?.poll() ?? []) {
        if (frame.id >= this._validFrom) {
          this.stats.addContextGpu(name, frame.total)
        }
      }
      s.sink.muted = false
    }
    const now = this._now()
    if (this.overlay && now - this._lastOverlayAt >= OVERLAY_EVERY_MS) {
      this._lastOverlayAt = now
      this.overlay.update({summary: this.stats.summary(), gpuMode: this.gpuMode(), sync: this.sync, note: this.note()})
    }
  }


  /**
   * Close the frame's sections and queries.
   *
   * @returns {{cpu: {[key: string]: number}, counts: object}}
   */
  _closeFrame() {
    this._frameOpen = false
    this.sections.closeAll()
    this.gpu?.endFrame()
    for (const s of this.shadows.values()) {
      s.timer?.endFrame()
    }
    return {cpu: this.cpuClock.take(), counts: this.sink.take()}
  }


  /**
   * Time and count Cesium's shadow context, the second GL context every
   * Cesium draw runs on as well as the replay (CESIUM.md).  Its time is its
   * own clock's, on its own context, not part of the frame's total.
   *
   * @param {string} name The body
   * @param {{frame: function(function(): void): *}} link portal-netgl's link; its `frame` is wrapped
   * @param {{core: {shadow: object}}} guest portal-netgl's Cesium guest
   */
  attachCesium(name, link, guest) {
    const shadow = guest?.core?.shadow
    if (!this.enabled || !shadow) {
      return
    }
    const sink = new CountSink()
    const timer = this.sync ? null : GpuTimer.create(shadow)
    const remove = installGlCounters(shadow, sink)
    const context = `cesium.shadow.${name}`
    const entry = {shadow, timer, sink, remove, barrier: makeBarrier(shadow, this.barrierKind), waitMs: 0}
    this.shadows.set(context, entry)
    const frame = link.frame
    link.frame = (render) => {
      entry.timer?.start(context)
      try {
        return frame.call(link, render)
      } finally {
        entry.timer?.stop()
        if (this.sync && this._frameOpen) {
          // Sync timing: wait for the shadow context's GPU work here, and
          // take the wait out of the pass it happened in (it is the shadow's).
          const waited = this._wait(entry.sink, entry.barrier)
          entry.waitMs += waited
          this.cpuClock.credit(this.sections.top, -waited)
        }
      }
    }
  }


  /**
   * @param {string} key A toggle's key
   * @param {boolean} runs Whether the pass runs
   */
  setToggle(key, runs) {
    if (runs) {
      this.off.delete(key)
    } else {
      this.off.add(key)
    }
    this._syncToggles()
    // The old numbers were another configuration's.
    this.resetStats()
  }


  /** Forget the rolling windows, and the GPU frames still in flight, which are from before. */
  resetStats() {
    this.stats?.reset()
    this._validFrom = this.frameId + 1
  }


  /**
   * Run a barrier (barrier.js) without counting its own GL calls.
   *
   * @param {object} sink The context's CountSink
   * @param {function(): void} barrier
   * @returns {number} How long it waited, ms
   */
  _wait(sink, barrier) {
    const t0 = this._now()
    sink.muted = true
    try {
      barrier()
    } finally {
      sink.muted = false
    }
    return this._now() - t0
  }


  /**
   * Sync timing on or off (`?perf=sync`, or the checkbox): off the timer
   * queries, on a wait for the GPU at the end of every pass.
   *
   * @param {boolean} on
   */
  setSync(on) {
    if (on === this.sync) {
      return
    }
    this.sync = on
    this.gpu?.dispose()
    this.gpu = on || !this._timerAvailable ? null : GpuTimer.create(this.gl)
    for (const s of this.shadows.values()) {
      s.timer?.dispose()
      s.timer = on ? null : GpuTimer.create(s.shadow)
      s.waitMs = 0
    }
    this.resetStats()
  }


  /**
   * @returns {{granularity: string|null, reason: string|null}} What the GPU
   *   timer reads: `pass` as it should; `encoder` where it reads per
   *   Metal encoder (ANGLE Metal says so in its renderer string; or the
   *   passes' means add up to more than the frame), once seen so for good;
   *   null with no timer or in sync mode
   */
  timerGranularity() {
    if (!this.gpu) {
      return {granularity: null, reason: null}
    }
    if (!this._granularity) {
      const s = this.stats
      if (/metal/i.test(this._unmasked ?? '')) {
        this._granularity = {granularity: 'encoder', reason: 'ANGLE Metal (the renderer string says Metal)'}
      } else if (s.gpuTotal.n >= ENCODER_MIN_FRAMES && s.interval.n >= ENCODER_MIN_FRAMES &&
          s.gpuTotal.mean() > ENCODER_SUM_RATIO * s.interval.mean()) {
        this._granularity = {granularity: 'encoder', reason: 'the passes add up to more than the frame interval'}
      } else if (s.gpuTotal.n >= ENCODER_MIN_FRAMES) {
        return {granularity: 'pass', reason: null}
      } else {
        return {granularity: null, reason: null}
      }
    }
    return this._granularity
  }


  /** @returns {string} 'ok' (GPU times per pass), 'encoder' (per encoder: not to be added up) or 'none' */
  gpuMode() {
    if (!this.gpu) {
      return 'none'
    }
    return this.timerGranularity().granularity === 'encoder' ? 'encoder' : 'ok'
  }


  _syncToggles() {
    this.offSkip = passesOff(this.off, 'skip')
    this.offGate = passesOff(this.off, 'gate')
  }


  /** Hide the scene objects whose toggles are off, and show those whose are back on. */
  _applyHides() {
    for (const [key, objectName] of Object.entries(HIDDEN_OBJECTS)) {
      let entry = this._hidden.get(key)
      if (!entry) {
        entry = {object: null, saved: null}
        this._hidden.set(key, entry)
      }
      if (!entry.object && this._lookups++ % LOOKUP_EVERY_FRAMES === 0) {
        entry.object = this.ui.scene?.getObjectByName(objectName) ?? null
      }
      const object = entry.object
      if (!object) {
        continue
      }
      if (this.off.has(key)) {
        if (entry.saved === null) {
          entry.saved = {visible: object.visible}
        }
        object.visible = false
      } else if (entry.saved !== null) {
        object.visible = entry.saved.visible
        entry.saved = null
      }
    }
  }


  /** @returns {string} What GPU timing does on this machine, for the overlay's top line */
  note() {
    if (this.sync) {
      return `SYNC TIMING (${this.barrierKind}): the GPU is waited for at the end of every pass, so each row is the ` +
        'wall-clock ms of that pass, GPU work included, and the frame rate is lower than real.'
    }
    if (!this.gpu) {
      return NO_TIMER_NOTE
    }
    if (this.timerGranularity().granularity === 'encoder') {
      return ENCODER_NOTE
    }
    return this.gpu.disjoints > 0 ? `${this.gpu.disjoints} disjoint GPU timer events: the frames in flight were dropped` : ''
  }


  /** @returns {object} What the Copy button copies (snapshot.js) */
  snapshot() {
    this.sink.muted = true
    try {
      return this._snapshot()
    } finally {
      this.sink.muted = false
    }
  }


  _snapshot() {
    const {renderer, gl, ui} = this
    const size = renderer.getDrawingBufferSize(new Vector2)
    const dbg = gl.getExtension('WEBGL_debug_renderer_info')
    const shadowTimers = Array.from(this.shadows.values()).map((s) => s.timer !== null)
    const {granularity, reason} = this.timerGranularity()
    const summary = this.stats.summary()
    // GPU times that are per encoder don't add up to a frame: no total.
    if (granularity === 'encoder' || this.sync) {
      summary.total.gpu = null
    }
    summary.clock = this.sync ? 'wall-synced' : 'cpu-issue'
    return buildSnapshot({
      takenAt: new Date(),
      link: typeof location === 'undefined' ? '' : location.href,
      viewport: {
        width: ui.width, height: ui.height, drawingBufferWidth: size.x, drawingBufferHeight: size.y,
      },
      devicePixelRatio: typeof window === 'undefined' ? 1 : window.devicePixelRatio,
      gpu: {
        renderer: gl.getParameter(gl.RENDERER),
        vendor: gl.getParameter(gl.VENDOR),
        unmaskedRenderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null,
        unmaskedVendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : null,
      },
      userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
      timer: {
        // Whether the extension is there, and what the numbers are.
        host: this._timerAvailable,
        shadow: shadowTimers.length === 0 ? null : shadowTimers.every(Boolean),
        disjoints: this.gpu?.disjoints ?? 0,
        dropped: this.gpu?.dropped ?? 0,
        // 'query': GPU timer queries; 'sync': the GPU waited for after every pass, wall clock.
        mode: this.sync ? 'sync' : 'query',
        barrier: this.sync ? this.barrierKind : null,
        // 'pass' as it should be; 'encoder' where it reads per Metal encoder (no total); null: unknown or off.
        granularity,
        granularityReason: reason,
      },
      summary,
      off: this.off,
      scene: {
        target: targets.obj?.props?.name ?? null,
        hdr: ui.hdr === true,
        fov: ui.camera?.fov ?? null,
        cesiumActive: ui.layers?.active?.map((a) => a.name) ?? [],
      },
    })
  }


  /** Take it all off again (the tests). */
  uninstall() {
    if (!this.enabled) {
      return
    }
    this.enabled = false
    this.removeCounters()
    this.gpu?.dispose()
    this.gpu = null
    for (const s of this.shadows.values()) {
      s.remove()
      s.timer?.dispose()
    }
    this.shadows.clear()
    this.overlay?.dispose()
    this.overlay = null
    this.renderer.info.autoReset = true
    for (const entry of this._hidden.values()) {
      if (entry.saved !== null && entry.object) {
        entry.object.visible = entry.saved.visible
      }
    }
    this._hidden.clear()
    this.off = new Set()
    this._syncToggles()
  }
}


/**
 * @param {object} gl
 * @returns {string|null} The context's unmasked renderer string, if the browser shows it
 */
function unmaskedRenderer(gl) {
  try {
    const dbg = gl.getExtension('WEBGL_debug_renderer_info')
    return dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null
  } catch {
    return null
  }
}


/** The page's instrumentation: off unless ThreeUi.install finds `?perf=1`. */
export const perf = new Perf
