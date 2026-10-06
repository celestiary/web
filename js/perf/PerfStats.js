import {COUNT_KEYS} from './counts.js'
import {orderedPasses} from './passes.js'
import {RollingStat, StatFamily, WINDOW} from './stats.js'


/**
 * What the `?perf=1` overlay has measured: rolling GPU and CPU time per pass,
 * counts per pass, the frame interval, and what's left after the
 * passes.  Pure: fed numbers, it gives the summary the overlay draws and the
 * snapshot copies.
 */
export default class PerfStats {
  /** @param {number} [capacity] Samples per window */
  constructor(capacity = WINDOW) {
    this.capacity = capacity
    this.reset()
  }


  /** Forget everything. */
  reset() {
    const c = this.capacity
    this.gpu = new StatFamily(c)
    this.gpuTotal = new RollingStat(c)
    this.cpu = new StatFamily(c)
    this.cpuTotal = new RollingStat(c)
    this.interval = new RollingStat(c)
    // Other GL contexts (Cesium's shadow context), by name: their GPU time on
    // clocks of their own, not part of the total, and their counts.
    this.contextGpu = new Map()
    this.contextCounts = new Map()
    this.countsTotal = new StatFamily(c)
    this.countsByPass = Object.fromEntries(COUNT_KEYS.map((k) => [k, new StatFamily(c)]))
    this.three = new StatFamily(c)
  }


  /** @param {number} ms Time since the frame before */
  addInterval(ms) {
    this.interval.add(ms)
  }


  /**
   * @param {{ms: {[key: string]: number}, total: number}} frame One frame's GPU time by pass
   */
  addGpu(frame) {
    this.gpu.add(frame.ms)
    this.gpuTotal.add(frame.total)
  }


  /**
   * @param {{[key: string]: number}} ms One frame's CPU time by pass
   * @param {number} total
   */
  addCpu(ms, total) {
    this.cpu.add(ms)
    this.cpuTotal.add(total)
  }


  /**
   * @param {string} name A context
   * @param {number} ms One frame's GPU time on it
   */
  addContextGpu(name, ms) {
    if (!this.contextGpu.has(name)) {
      this.contextGpu.set(name, new RollingStat(this.capacity))
    }
    this.contextGpu.get(name).add(ms)
  }


  /**
   * @param {string} name A context
   * @param {{[key: string]: number}} counts One frame's counts on it
   */
  addContextCounts(name, counts) {
    if (!this.contextCounts.has(name)) {
      this.contextCounts.set(name, new StatFamily(this.capacity))
    }
    this.contextCounts.get(name).add(counts)
  }


  /**
   * @param {{total: {[key: string]: number}, perPass: {[key: string]: {[key: string]: number}}}} counts One frame's
   * @param {{[key: string]: number}} [three] `renderer.info.render`'s calls, triangles, points, lines
   */
  addCounts(counts, three = {}) {
    this.countsTotal.add(counts.total)
    for (const key of COUNT_KEYS) {
      const byPass = {}
      for (const [pass, c] of Object.entries(counts.perPass)) {
        byPass[pass] = c[key]
      }
      this.countsByPass[key].add(byPass)
    }
    this.three.add(three)
  }


  /**
   * @param {number} [digits]
   * @returns {object} Everything, rounded: `frame` (interval and FPS),
   *   `total` (GPU, CPU, counts), `passes` (each with `gpu`, `cpu`, `counts`
   *   as means over the window), `contexts`, `three`
   */
  summary(digits = 3) {
    const round = (v) => Number(v.toFixed(digits))
    const names = orderedPasses([...this.gpu.names(), ...this.cpu.names(), ...this.countsByPass.draws.names()])
    const passes = names.map((name) => {
      const counts = {}
      for (const key of COUNT_KEYS) {
        counts[key] = round(this.countsByPass[key].get(name)?.mean() ?? 0)
      }
      return {
        name,
        gpu: this.gpu.get(name)?.summary(digits) ?? null,
        cpu: this.cpu.get(name)?.summary(digits) ?? null,
        counts,
      }
    })
    const countsTotal = {}
    for (const key of COUNT_KEYS) {
      countsTotal[key] = round(this.countsTotal.get(key)?.mean() ?? 0)
    }
    const intervalMean = this.interval.mean()
    const contexts = {}
    for (const name of new Set([...this.contextGpu.keys(), ...this.contextCounts.keys()])) {
      const counts = {}
      for (const key of COUNT_KEYS) {
        counts[key] = round(this.contextCounts.get(name)?.get(key)?.mean() ?? 0)
      }
      contexts[name] = {gpu: this.contextGpu.get(name)?.summary(digits) ?? null, counts}
    }
    const three = {}
    for (const name of this.three.names()) {
      three[name] = round(this.three.get(name).mean())
    }
    return {
      frame: {
        intervalMs: this.interval.summary(digits),
        fps: intervalMean > 0 ? round(1000 / intervalMean) : 0,
        fpsP5: this.interval.p95() > 0 ? round(1000 / this.interval.p95()) : 0,
      },
      total: {
        gpu: this.gpuTotal.n > 0 ? this.gpuTotal.summary(digits) : null,
        cpu: this.cpuTotal.summary(digits),
        counts: countsTotal,
      },
      passes,
      contexts,
      three,
    }
  }
}
