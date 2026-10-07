/**
 * Rolling statistics for the `?perf=1` overlay (DESIGN.md, "Perf overlay").
 * Pure: no DOM, no GL, so the tests drive them with plain numbers.
 */


/** Samples a rolling window holds: 4 s at 60 FPS, 8 s at 30. */
export const WINDOW = 240


/**
 * @param {Array<number>} values
 * @param {number} p Fraction, 0 to 1
 * @returns {number} The nearest-rank percentile (0 for no values)
 */
export function percentile(values, p) {
  if (values.length === 0) {
    return 0
  }
  const sorted = Array.from(values).sort((a, b) => a - b)
  const rank = Math.ceil(p * sorted.length)
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]
}


/** The last `capacity` samples of a series, and what is asked of them. */
export class RollingStat {
  /** @param {number} [capacity] */
  constructor(capacity = WINDOW) {
    this.capacity = capacity
    this.values = new Float64Array(capacity)
    this.n = 0
    this.head = 0
  }


  /** @param {number} v A sample; a non-finite one is ignored */
  add(v) {
    if (!Number.isFinite(v)) {
      return
    }
    this.values[this.head] = v
    this.head = (this.head + 1) % this.capacity
    this.n = Math.min(this.n + 1, this.capacity)
  }


  /**
   * Fill with zeros: a series that starts late is zero for the frames before.
   *
   * @param {number} count
   */
  backfill(count) {
    for (let i = 0; i < Math.min(count, this.capacity); i++) {
      this.add(0)
    }
  }


  /** @returns {Array<number>} The samples held, oldest first */
  samples() {
    if (this.n < this.capacity) {
      return Array.from(this.values.subarray(0, this.n))
    }
    return [...this.values.subarray(this.head), ...this.values.subarray(0, this.head)]
  }


  /** @returns {number} The mean (0 for no samples) */
  mean() {
    if (this.n === 0) {
      return 0
    }
    let sum = 0
    for (let i = 0; i < this.n; i++) {
      sum += this.values[i]
    }
    return sum / this.n
  }


  /** @returns {number} The 95th percentile (0 for no samples) */
  p95() {
    return percentile(this.samples(), 0.95)
  }


  /** @returns {number} The largest sample (0 for no samples) */
  max() {
    let m = 0
    for (let i = 0; i < this.n; i++) {
      m = Math.max(m, this.values[i])
    }
    return m
  }


  /** @returns {number} The share of samples above zero, 0 to 1 */
  activeShare() {
    if (this.n === 0) {
      return 0
    }
    let active = 0
    for (let i = 0; i < this.n; i++) {
      active += this.values[i] > 0 ? 1 : 0
    }
    return active / this.n
  }


  /** Forget every sample. */
  clear() {
    this.n = 0
    this.head = 0
  }


  /**
   * @param {number} [digits]
   * @returns {{mean: number, p95: number, max: number, runShare: number, n: number}}
   */
  summary(digits = 3) {
    const round = (v) => Number(v.toFixed(digits))
    return {
      mean: round(this.mean()),
      p95: round(this.p95()),
      max: round(this.max()),
      runShare: Number(this.activeShare().toFixed(2)),
      n: this.n,
    }
  }
}


/** A named family of RollingStats, each zero for the frames it wasn't in. */
export class StatFamily {
  /** @param {number} [capacity] */
  constructor(capacity = WINDOW) {
    this.capacity = capacity
    this.stats = new Map()
    this.frames = 0
  }


  /**
   * One frame's values.  A name seen before and missing from this frame is
   * zero in it; a name new to the family is zero for the frames before.
   *
   * @param {{[key: string]: number}} values
   */
  add(values) {
    for (const name of Object.keys(values)) {
      if (!this.stats.has(name)) {
        const stat = new RollingStat(this.capacity)
        stat.backfill(Math.min(this.frames, this.capacity))
        this.stats.set(name, stat)
      }
    }
    for (const [name, stat] of this.stats) {
      stat.add(values[name] ?? 0)
    }
    this.frames++
  }


  /**
   * @param {string} name
   * @returns {RollingStat|undefined}
   */
  get(name) {
    return this.stats.get(name)
  }


  /** @returns {Array<string>} The names seen */
  names() {
    return Array.from(this.stats.keys())
  }


  /** Forget every sample, and the names. */
  clear() {
    this.stats.clear()
    this.frames = 0
  }
}
