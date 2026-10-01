import {
  BufferAttribute,
  BufferGeometry,
  LineSegments,
  Object3D,
  ShaderMaterial,
  Vector3,
} from 'three'
import {LIGHTYEAR_METER} from '../shared.js'
import {sceneReferred} from './hdr.js'
import {rteCameraLocal} from './rte.js'


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


// RTE, as Asterisms: positions are split into float32 high and low parts
// about the camera, and turned by mat3(modelViewMatrix) (the StellarFrame's
// precession and the view), never translated in float32.  A segment's child
// end grows from its parent while the ship is in transit: it sits at aFrom
// until departure (aTimes.x) and reaches its star at arrival (aTimes.y).
const vertexShader = `
  uniform vec3 uCamPosWorldHigh;
  uniform vec3 uCamPosWorldLow;
  uniform float uTime;
  attribute vec3 positionLow;
  attribute vec3 fromHigh;
  attribute vec3 fromLow;
  attribute vec2 aTimes;
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vShow;
  void main() {
    vec3 to = (position - uCamPosWorldHigh) + (positionLow - uCamPosWorldLow);
    vec3 from = (fromHigh - uCamPosWorldHigh) + (fromLow - uCamPosWorldLow);
    float span = max(aTimes.y - aTimes.x, 1e-6);
    float frac = clamp((uTime - aTimes.x) / span, 0.0, 1.0);
    vColor = aColor;
    vShow = uTime >= aTimes.x ? 1.0 : 0.0;
    gl_Position = projectionMatrix * vec4(mat3(modelViewMatrix) * mix(from, to, frac), 1.0);
  }
`

const fragmentShader = `
  varying vec3 vColor;
  varying float vShow;
  void main() {
    if (vShow < 0.5) {
      discard;
    }
    gl_FragColor = vec4(vColor, 1.0);
  }
`


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


/**
 * Line segments for each hop of a spread (Colonization.js), from parent star
 * to child star, colored by hop.  A child of Stars, in the catalogue's frame.
 */
export default class ColonizationLines extends Object3D {
  /** */
  constructor() {
    super()
    this.name = 'Colonization'
    this.material = sceneReferred(new ShaderMaterial({
      uniforms: {
        uCamPosWorldHigh: {value: new Vector3()},
        uCamPosWorldLow: {value: new Vector3()},
        uTime: {value: 0},
      },
      vertexShader,
      fragmentShader,
      toneMapped: false,
    }))
    this.segments = null
  }


  /**
   * @param {import('./Colonization.js').Spread} spread
   * @param {Float64Array} pos Star positions in light-years, packed xyz
   */
  setSpread(spread, pos) {
    if (this.segments) {
      this.remove(this.segments)
      this.segments.geometry.dispose()
    }
    const numVerts = 2 * (spread.numReached - 1)
    const high = new Float32Array(numVerts * 3)
    const low = new Float32Array(numVerts * 3)
    const fromHigh = new Float32Array(numVerts * 3)
    const fromLow = new Float32Array(numVerts * 3)
    const color = new Float32Array(numVerts * 3)
    const times = new Float32Array(numVerts * 2)
    let vi = 0
    // order[0] is the origin, which has no parent.
    for (let o = 1; o < spread.numReached; o++) {
      const i = spread.order[o]
      const p = spread.parent[i]
      const rgb = hopColor(spread.hop[i], spread.maxHop)
      for (const end of [p, i]) {
        for (let c = 0; c < 3; c++) {
          const k = (3 * vi) + c
          const v = pos[(3 * end) + c] * LIGHTYEAR_METER
          const f = pos[(3 * p) + c] * LIGHTYEAR_METER
          high[k] = v
          low[k] = v - high[k]
          fromHigh[k] = f
          fromLow[k] = f - fromHigh[k]
          color[k] = rgb[c]
        }
        times[2 * vi] = spread.departYears[i]
        times[(2 * vi) + 1] = spread.arriveYears[i]
        vi++
      }
    }
    const geom = new BufferGeometry()
    geom.setAttribute('position', new BufferAttribute(high, 3))
    geom.setAttribute('positionLow', new BufferAttribute(low, 3))
    geom.setAttribute('fromHigh', new BufferAttribute(fromHigh, 3))
    geom.setAttribute('fromLow', new BufferAttribute(fromLow, 3))
    geom.setAttribute('aColor', new BufferAttribute(color, 3))
    geom.setAttribute('aTimes', new BufferAttribute(times, 2))
    const segments = new LineSegments(geom, this.material)
    segments.name = 'ColonizationSegments'
    // Positions are eye-relative in the shader, so three's bounds don't apply.
    segments.frustumCulled = false
    const u = this.material.uniforms
    segments.onBeforeRender = (renderer, scene, camera) => {
      rteCameraLocal(segments, camera, u.uCamPosWorldHigh.value, u.uCamPosWorldLow.value)
    }
    this.segments = segments
    this.add(segments)
  }


  /** @param {number} years Years since departure from the origin */
  setTime(years) {
    this.material.uniforms.uTime.value = years
  }
}
