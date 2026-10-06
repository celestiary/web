import {Vector2} from 'three'
import {targets} from '../shared.js'
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
const HIDDEN_OBJECTS = {galaxy: 'MilkyWay'}
const NO_TIMER_NOTE = 'GPU timer unavailable (EXT_disjoint_timer_query_webgl2 missing or hidden): CPU times, ' +
  'which are the time to issue the work, not to run it.  Bisect with the toggles and the FPS.'


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
    this.gpu = GpuTimer.create(this.gl)
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
      for (const frame of this.gpu.poll()) {
        if (frame.id >= this._validFrom) {
          this.stats.addGpu(frame)
        }
      }
    }
    for (const [name, s] of this.shadows) {
      this.stats.addContextCounts(name, s.sink.take().total)
      for (const frame of s.timer?.poll() ?? []) {
        if (frame.id >= this._validFrom) {
          this.stats.addContextGpu(name, frame.total)
        }
      }
    }
    const now = this._now()
    if (this.overlay && now - this._lastOverlayAt >= OVERLAY_EVERY_MS) {
      this._lastOverlayAt = now
      this.overlay.update({summary: this.stats.summary(), gpuTimed: this.gpu !== null, note: this.note()})
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
    const timer = GpuTimer.create(shadow)
    const remove = installGlCounters(shadow, sink)
    const context = `cesium.shadow.${name}`
    this.shadows.set(context, {timer, sink, remove})
    const frame = link.frame
    link.frame = (render) => {
      timer?.start(context)
      try {
        return frame.call(link, render)
      } finally {
        timer?.stop()
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
    if (!this.gpu) {
      return NO_TIMER_NOTE
    }
    return this.gpu.disjoints > 0 ? `${this.gpu.disjoints} disjoint GPU timer events: the frames in flight were dropped` : ''
  }


  /** @returns {object} What the Copy button copies (snapshot.js) */
  snapshot() {
    const {renderer, gl, ui} = this
    const size = renderer.getDrawingBufferSize(new Vector2)
    const dbg = gl.getExtension('WEBGL_debug_renderer_info')
    const shadowTimers = Array.from(this.shadows.values()).map((s) => s.timer !== null)
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
        host: this.gpu !== null,
        shadow: shadowTimers.length === 0 ? null : shadowTimers.every(Boolean),
        disjoints: this.gpu?.disjoints ?? 0,
        dropped: this.gpu?.dropped ?? 0,
      },
      summary: this.stats.summary(),
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


/** The page's instrumentation: off unless ThreeUi.install finds `?perf=1`. */
export const perf = new Perf
