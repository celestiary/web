import {Object3D} from 'three'
import {LIGHTYEAR_METER, overlay} from '../shared.js'
import {pulseCycle} from './Colonization.js'
import {ALWAYS, disposeWideLines, newWideLines} from './wideLines.js'


// Bright-to-dark along blue.  The first hop (e.g. Alpha Centauri) is near
// white, the last near black.  Display values: sceneReferred puts them
// through the tone map's inverse, so they reach the screen as written.
const RAMP = [
  [0.95, 0.97, 1.00],
  [0.62, 0.77, 1.00],
  [0.25, 0.50, 0.92],
  [0.09, 0.22, 0.52],
  [0.02, 0.03, 0.07],
]

export const DEFAULT_STYLE = {
  widthFirst: 5, // px at hop 1
  widthLast: 0.5, // px at the last hop
  sizeAttenuation: true,
  attenuationLy: 32, // distance at which an attenuated line is its full width
  opacity: 0.25,
}

export const DEFAULT_PULSE = {
  on: false,
  stepSec: 0.05, // T, seconds the pulse sits on each hop
  trail: 10, // N, hops a trail takes to fade back
}

// The route to a selected star: amber, over the spread's blues.
const PATH_COLOR = [1.0, 0.7, 0.15]
const PATH_WIDTH = 4
const MS_PER_SEC = 1000
// Draw the route after (over) the spread.
const PATH_RENDER_ORDER = 10


/**
 * @param {number} hop 1-based hop number
 * @param {number} maxHop Longest path in hops
 * @returns {Array<number>} rgb display values, one step per hop
 */
export function hopColor(hop, maxHop) {
  const t = maxHop > 1 ? (hop - 1) / (maxHop - 1) : 0
  const x = t * (RAMP.length - 1)
  const i = Math.min(Math.floor(x), RAMP.length - 2)
  const f = x - i
  const [a, b] = [RAMP[i], RAMP[i + 1]]
  return [0, 1, 2].map((c) => a[c] + ((b[c] - a[c]) * f))
}


/** @returns {string} CSS color for hop */
export function hopColorCss(hop, maxHop) {
  const [r, g, b] = hopColor(hop, maxHop).map((c) => Math.round(c * 255))
  return `rgb(${r}, ${g}, ${b})`
}


/** @returns {string} CSS color of a selected star's route */
export function pathColorCss() {
  const [r, g, b] = PATH_COLOR.map((c) => Math.round(c * 255))
  return `rgb(${r}, ${g}, ${b})`
}


/**
 * The spread's hops (Colonization.js) as lines from parent star to child
 * star, colored and sized by hop, and the route to a selected star over
 * them (wideLines.js).  A child of Stars, in the catalogue's frame.
 */
export default class ColonizationLines extends Object3D {
  /** */
  constructor() {
    super()
    this.name = 'Colonization'
    this.tree = null
    this.path = null
    this.style = {...DEFAULT_STYLE}
    this.pulse = {...DEFAULT_PULSE}
    this._pulseStartMs = 0
    this._maxHop = 1
    this._years = 0
  }


  /**
   * @param {import('./Colonization.js').Spread} spread
   * @param {Float64Array} pos Star positions in light-years, packed xyz
   */
  setSpread(spread, pos) {
    this._dispose(this.tree)
    this.setPath(null)
    this._maxHop = spread.maxHop
    // order[0] is the origin, which has no parent.
    const n = spread.numReached - 1
    const from = new Int32Array(n)
    const to = new Int32Array(n)
    const color = new Float32Array(n * 3)
    const hop = new Float32Array(n)
    const times = new Float32Array(n * 2)
    for (let k = 0; k < n; k++) {
      const i = spread.order[k + 1]
      from[k] = spread.parent[i]
      to[k] = i
      hop[k] = spread.hop[i]
      color.set(hopColor(spread.hop[i], spread.maxHop), 3 * k)
      times[2 * k] = spread.departYears[i]
      times[(2 * k) + 1] = spread.arriveYears[i]
    }
    this.tree = newWideLines({...endpoints(from, to, pos), color, hop, times}, {
      name: 'ColonizationSegments',
      sort: true,
      onFrame: (u) => {
        if (this.pulse.on) {
          const steps = (performance.now() - this._pulseStartMs) / MS_PER_SEC / this.pulse.stepSec
          u.uPulseHop.value = 1 + (steps % pulseCycle(this._maxHop, this.pulse.trail))
        }
      },
    })
    this.tree.material.uniforms.uTime.value = this._years
    this._applyStyle()
    overlay(this.tree)
    this.add(this.tree)
  }


  /**
   * Draw the route to a star over the spread, whole whatever the time.
   *
   * @param {Array<number>|null} path Star indices, origin first; null clears
   * @param {Float64Array} [pos] Star positions in light-years, packed xyz
   */
  setPath(path, pos) {
    this._dispose(this.path)
    this.path = null
    if (!path || path.length < 2) {
      return
    }
    const n = path.length - 1
    const color = new Float32Array(n * 3)
    for (let k = 0; k < n; k++) {
      color.set(PATH_COLOR, 3 * k)
    }
    const mesh = newWideLines({
      ...endpoints(Int32Array.from(path.slice(0, -1)), Int32Array.from(path.slice(1)), pos),
      color,
    }, {name: 'ColonizationPath'})
    const u = mesh.material.uniforms
    u.uTime.value = ALWAYS
    u.uWidthFirst.value = u.uWidthLast.value = PATH_WIDTH
    // On top of the spread and everything else: it's what was asked about.
    mesh.material.depthTest = false
    mesh.renderOrder = PATH_RENDER_ORDER
    this.path = mesh
    overlay(mesh)
    this.add(mesh)
  }


  /** @param {number} years Years since departure from the origin */
  setTime(years) {
    this._years = years
    if (this.tree) {
      this.tree.material.uniforms.uTime.value = years
    }
  }


  /** @param {object} style Any of DEFAULT_STYLE's fields */
  setStyle(style) {
    Object.assign(this.style, style)
    this._applyStyle()
  }


  /** @param {object} pulse Any of DEFAULT_PULSE's fields; restarts it from hop 1 */
  setPulse(pulse) {
    Object.assign(this.pulse, pulse)
    this._pulseStartMs = performance.now()
    this._applyStyle()
  }


  /** Push style and pulse settings into the spread's uniforms. */
  _applyStyle() {
    if (!this.tree) {
      return
    }
    const u = this.tree.material.uniforms
    const {widthFirst, widthLast, sizeAttenuation, attenuationLy, opacity} = this.style
    u.uWidthFirst.value = widthFirst
    u.uWidthLast.value = widthLast
    u.uAttenuation.value = sizeAttenuation ? attenuationLy * LIGHTYEAR_METER : 0
    u.uOpacity.value = opacity
    u.uMaxHop.value = this._maxHop
    u.uPulseOn.value = this.pulse.on ? 1 : 0
    u.uTrail.value = this.pulse.trail
  }


  /** Free the GPU buffers and materials of the spread and the route. */
  dispose() {
    this._dispose(this.tree)
    this._dispose(this.path)
    this.tree = null
    this.path = null
  }


  /** @param {object|null} mesh */
  _dispose(mesh) {
    if (mesh) {
      disposeWideLines(mesh)
    }
  }
}


/**
 * @param {Int32Array} from Star index per segment
 * @param {Int32Array} to
 * @param {Float64Array} pos Star positions in light-years, packed xyz
 * @returns {{start: Float64Array, end: Float64Array}} In metres
 */
function endpoints(from, to, pos) {
  const start = new Float64Array(from.length * 3)
  const end = new Float64Array(from.length * 3)
  for (let k = 0; k < from.length; k++) {
    for (let c = 0; c < 3; c++) {
      start[(3 * k) + c] = pos[(3 * from[k]) + c] * LIGHTYEAR_METER
      end[(3 * k) + c] = pos[(3 * to[k]) + c] * LIGHTYEAR_METER
    }
  }
  return {start, end}
}
