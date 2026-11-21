/**
 * The perf overlay's graphs and render info (DESIGN.md, "Perf overlay"):
 * frame rate, frame time and memory drawn side by side, and three's
 * `renderer.info` beside them.  A chunk of its own, loaded when the overlay
 * first shows (perf.js), so the first load carries none of it; it imports
 * no module of the app's, so it splits nothing out of the first load either.
 *
 * Fed by perf.js: `frame(ms)` with each frame's interval, `draw(summary)`
 * with PerfStats' summary at each of the overlay's redraws.  Each redraw
 * adds one point to each graph: the frames since the last as a rate, their
 * mean interval, the JS heap.
 */


/** A graph's size in CSS pixels. */
export const GRAPH_W = 80
export const GRAPH_H = 48
/** The text line at a graph's top, CSS pixels. */
const TEXT_H = 11
const FONT = '9px ui-monospace, Menlo, monospace'
const BG = '#0a0a18'
const MB = 1024 * 1024


/**
 * The graphs' three series, and what each draws in.
 *
 * @type {Array<{key: string, label: string, fg: string, title: string}>}
 */
export const GRAPHS = [
  {key: 'fps', label: 'FPS', fg: '#0ff', title: 'Frames per second, over each half second'},
  {key: 'ms', label: 'MS', fg: '#0f0', title: 'Frame time: the mean interval between frames over each half second, ms'},
  {key: 'mb', label: 'MB', fg: '#f08', title: 'JS heap in use, MB (performance.memory: Chromium only)'},
]


/**
 * A rolling series and its range over the points kept, for one graph.  Pure.
 */
export class Series {
  /** @param {number} capacity Points kept */
  constructor(capacity) {
    this.capacity = capacity
    this.values = []
    this.min = Infinity
    this.max = 0
  }


  /** @param {number} v */
  add(v) {
    this.values.push(v)
    if (this.values.length > this.capacity) {
      this.values.shift()
    }
    this.min = Math.min(...this.values)
    this.max = Math.max(0, ...this.values)
  }


  /** @returns {number|null} The last value, or null for none */
  last() {
    return this.values.length === 0 ? null : this.values[this.values.length - 1]
  }
}


/**
 * One redraw's point for each graph, from the frames since the last.  Pure.
 *
 * @param {{n: number, sumMs: number}} bucket The frames' count and summed intervals
 * @param {{usedJSHeapSize: number}|undefined} memory `performance.memory`, where the browser has it
 * @returns {{fps: number|null, ms: number|null, mb: number|null}} null where there is nothing to say
 */
export function graphPoint(bucket, memory) {
  const ok = bucket.n > 0 && bucket.sumMs > 0
  return {
    fps: ok ? (1000 * bucket.n) / bucket.sumMs : null,
    ms: ok ? bucket.sumMs / bucket.n : null,
    mb: memory && Number.isFinite(memory.usedJSHeapSize) ? memory.usedJSHeapSize / MB : null,
  }
}


/**
 * The render info's sections (moved here from the render panel), from the
 * overlay's summary and the renderer.  Pure, for tests.
 *
 * @param {object} summary PerfStats.summary(): `frame`, `total.cpu`, `three`
 * @param {object} renderer A three WebGLRenderer, or its shape
 * @param {{usedJSHeapSize: number, jsHeapSizeLimit: number}} [memory] performance.memory
 * @returns {Array<{title: string, rows: Array<Array<string>>}>}
 */
export function infoSections(summary, renderer, memory) {
  const mem = renderer?.info?.memory ?? {}
  const three = summary.three ?? {}
  const n = (v) => String(Math.round(v ?? 0))
  const heap = memory && Number.isFinite(memory.usedJSHeapSize) ?
    `${(memory.usedJSHeapSize / MB).toFixed(0)} / ${(memory.jsHeapSizeLimit / MB).toFixed(0)} MB` : 'n/a'
  return [
    {title: 'Frame', rows: [
      ['FPS', summary.frame.fps.toFixed(1)],
      ['frame time', `${summary.frame.intervalMs.mean.toFixed(2)} ms`],
      ['CPU to issue', `${(summary.total.cpu?.mean ?? 0).toFixed(2)} ms`],
    ]},
    {title: 'Memory', rows: [
      ['geometries', n(mem.geometries)],
      ['textures', n(mem.textures)],
      ['JS heap', heap],
    ]},
    {title: 'Render (three\'s draws)', rows: [
      ['calls', n(three.calls)],
      ['triangles', n(three.triangles)],
      ['points', n(three.points)],
      ['lines', n(three.lines)],
    ]},
  ]
}


/** The graphs and the info, in an element perf.js puts in the overlay. */
export default class PerfInfo {
  /**
   * @param {object} p
   * @param {Document} p.doc
   * @param {object} p.renderer
   * @param {function(): object|undefined} [p.memory] performance.memory, or undefined
   */
  constructor({doc, renderer, memory = () => globalThis.performance?.memory}) {
    this.doc = doc
    this.renderer = renderer
    this.memory = memory
    this.bucket = {n: 0, sumMs: 0}
    const el = (tag, props = {}, style = {}) => {
      const e = doc.createElement(tag)
      Object.assign(e, props)
      Object.assign(e.style, style)
      return e
    }
    this.el = el
    this.root = el('div', {}, {margin: '4px 0'})
    this.root.setAttribute('data-testid', 'perf-info')
    const row = el('div', {}, {display: 'flex', gap: '4px'})
    const dpr = globalThis.devicePixelRatio ?? 1
    this.graphs = GRAPHS.map((g) => {
      const canvas = el('canvas', {width: Math.round(GRAPH_W * dpr), height: Math.round(GRAPH_H * dpr), title: g.title},
          {width: `${GRAPH_W}px`, height: `${GRAPH_H}px`, display: 'block'})
      canvas.setAttribute('data-testid', `perf-graph-${g.key}`)
      row.append(canvas)
      return {...g, canvas, dpr, series: new Series(GRAPH_W - 2)}
    })
    this.info = el('div', {}, {display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '3px'})
    this.root.append(row, this.info)
  }


  /** @param {number} ms One frame's interval */
  frame(ms) {
    this.bucket.n++
    this.bucket.sumMs += ms
  }


  /** @param {object} summary PerfStats.summary(), at the overlay's redraw */
  draw(summary) {
    const memory = this.memory()
    const point = graphPoint(this.bucket, memory)
    this.bucket = {n: 0, sumMs: 0}
    for (const g of this.graphs) {
      if (point[g.key] !== null) {
        g.series.add(point[g.key])
      }
      drawGraph(g)
    }
    const parts = infoSections(summary, this.renderer, memory).map((s) => {
      const box = this.el('div')
      box.append(this.el('div', {textContent: s.title}, {color: '#8ac'}))
      for (const [name, value] of s.rows) {
        const line = this.el('div', {}, {display: 'flex', justifyContent: 'space-between', gap: '8px'})
        line.append(this.el('span', {textContent: name}, {color: '#aaa'}), this.el('span', {textContent: value}))
        box.append(line)
      }
      return box
    })
    this.info.replaceChildren(...parts)
  }


  /** Take it off the page. */
  dispose() {
    this.root.remove()
  }
}


/**
 * Draw one graph as three's Stats panel does: a text line of the last value
 * and the series' maximum (^), the series as bars scaled to that maximum.
 *
 * @param {{canvas: HTMLCanvasElement, dpr: number, label: string, fg: string, series: Series}} g
 */
function drawGraph(g) {
  const ctx = g.canvas.getContext?.('2d')
  if (!ctx) {
    return
  }
  const {series, dpr} = g
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = BG
  ctx.fillRect(0, 0, GRAPH_W, GRAPH_H)
  ctx.font = FONT
  ctx.textBaseline = 'top'
  ctx.fillStyle = g.fg
  const last = series.last()
  // The last value, and the top of the bars' scale: the series' maximum.
  const fmt = (v) => v.toFixed(g.key === 'ms' && v < 100 ? 1 : 0)
  ctx.fillText(last === null ? `${g.label} n/a` : `${fmt(last)} ${g.label}`, 2, 1)
  if (last !== null) {
    ctx.textAlign = 'right'
    ctx.fillText(`^${fmt(series.max)}`, GRAPH_W - 2, 1)
    ctx.textAlign = 'left'
  }
  const top = TEXT_H + 1
  const h = GRAPH_H - top - 1
  const max = series.max > 0 ? series.max : 1
  ctx.globalAlpha = 0.85
  series.values.forEach((v, i) => {
    const bh = Math.max(1, Math.round((v / max) * h))
    ctx.fillRect(GRAPH_W - 1 - series.values.length + i, top + h - bh, 1, bh)
  })
  ctx.globalAlpha = 1
}
