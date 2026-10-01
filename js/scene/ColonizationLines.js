import {
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Float32BufferAttribute,
  Mesh,
  NormalBlending,
  Object3D,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
} from 'three'
import {LIGHTYEAR_METER} from '../shared.js'
import {pulseCycle} from './Colonization.js'
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

export const DEFAULT_STYLE = {
  widthFirst: 6, // px at hop 1
  widthLast: 1, // px at the last hop
  sizeAttenuation: false,
  attenuationLy: 300, // distance at which an attenuated line is its full width
  opacity: 1,
}

export const DEFAULT_PULSE = {
  on: false,
  stepSec: 0.25, // T, seconds the pulse sits on each hop
  trail: 0, // N, hops a trail takes to fade back
}

// The route to a selected star: amber, over the spread's blues.
const PATH_COLOR = [1.0, 0.7, 0.15]
const PATH_WIDTH = 4
// A pulse lights a segment this much of the way to white.
const PULSE_WHITEN = 0.85
// Size attenuation never widens a line past this multiple of its width.
const MAX_ATTENUATION_GAIN = 4
const MS_PER_SEC = 1000
// Draw the route after (over) the spread.
const PATH_RENDER_ORDER = 10
// A time after every arrival (a uniform can't hold Infinity reliably).
const ALWAYS = 1e30


// Each segment is an instance of one quad, extruded in screen space so it
// can be wider than WebGL's 1 px lines.  position.x is the side (-1, 1),
// position.y the end (0 start, 1 end).
//
// RTE, as Asterisms: endpoints are float32 high + low parts about the
// camera, turned by mat3(modelViewMatrix) (the StellarFrame's precession and
// the view) and never translated in float32.  The end grows from the start
// while the ship is in transit: at the start at departure (aTimes.x), at its
// star at arrival (aTimes.y).  The segment is trimmed to the near plane in
// view space before projecting, as a line that passes behind the camera
// would otherwise project through infinity.
const vertexShader = `
  uniform vec3 uCamPosWorldHigh;
  uniform vec3 uCamPosWorldLow;
  uniform float uTime;
  uniform vec2 uResolution;
  uniform float uPixelRatio;
  uniform float uNear;
  uniform float uMaxHop;
  uniform float uWidthFirst;
  uniform float uWidthLast;
  uniform float uAttenuation;
  uniform float uOpacity;
  uniform float uPulseOn;
  uniform float uPulseHop;
  uniform float uTrail;
  uniform vec4 uOverride;
  attribute vec3 startHigh;
  attribute vec3 startLow;
  attribute vec3 endHigh;
  attribute vec3 endLow;
  attribute vec2 aTimes;
  attribute vec3 aColor;
  attribute float aHop;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vSide;
  varying float vHalf;

  const vec4 CULLED = vec4(0.0, 0.0, 2.0, 1.0);

  void main() {
    if (uTime < aTimes.x) {
      gl_Position = CULLED;
      return;
    }
    vec3 s = (startHigh - uCamPosWorldHigh) + (startLow - uCamPosWorldLow);
    vec3 e = (endHigh - uCamPosWorldHigh) + (endLow - uCamPosWorldLow);
    float span = max(aTimes.y - aTimes.x, 1e-6);
    e = mix(s, e, clamp((uTime - aTimes.x) / span, 0.0, 1.0));
    vec3 vs = mat3(modelViewMatrix) * s;
    vec3 ve = mat3(modelViewMatrix) * e;
    float zNear = -uNear;
    if (vs.z > zNear && ve.z > zNear) {
      gl_Position = CULLED;
      return;
    }
    if (vs.z > zNear) {
      vs = mix(vs, ve, (zNear - vs.z) / (ve.z - vs.z));
    } else if (ve.z > zNear) {
      ve = mix(ve, vs, (zNear - ve.z) / (vs.z - ve.z));
    }
    vec4 cs = projectionMatrix * vec4(vs, 1.0);
    vec4 ce = projectionMatrix * vec4(ve, 1.0);
    vec2 halfRes = 0.5 * uResolution;
    vec2 d = (ce.xy / ce.w - cs.xy / cs.w) * halfRes;
    float len = length(d);
    vec2 dir = len > 1e-6 ? d / len : vec2(1.0, 0.0);
    vec2 perp = vec2(-dir.y, dir.x);
    bool atEnd = position.y > 0.5;

    float t = uMaxHop > 1.0 ? (aHop - 1.0) / (uMaxHop - 1.0) : 0.0;
    float w = mix(uWidthFirst, uWidthLast, t);
    float boost = 0.0;
    if (uPulseOn > 0.5) {
      float behind = floor(uPulseHop) - aHop;
      if (behind >= 0.0 && behind <= uTrail) {
        boost = 1.0 - (behind / (uTrail + 1.0));
      }
    }
    w *= 1.0 + boost;
    if (uAttenuation > 0.0) {
      w *= min(uAttenuation / length(atEnd ? ve : vs), ${MAX_ATTENUATION_GAIN.toFixed(1)});
    }
    w *= uPixelRatio;
    // Half the quad's width: half the line's, and a pixel for its edge.
    float halfW = (0.5 * w) + 1.0;
    vec4 clip = atEnd ? ce : cs;
    // Square caps: out along the segment by halfW, so hops meet without gaps.
    vec2 offset = (perp * position.x + dir * (atEnd ? 1.0 : -1.0)) * halfW;
    clip.xy += offset / halfRes * clip.w;
    // Divided through to w = 1: the same point and depth, with w out of the
    // way.  w is the distance in metres, ~1e18 at light-years, and the
    // rasterizer's perspective-corrected varyings work in 1/w products that
    // underflow float32 there (the coverage across the width came out 0).
    // With w = 1 they interpolate linearly on screen, as wanted across a
    // line's width.  Safe because both ends are in front of the near plane.
    gl_Position = vec4(clip.xyz / clip.w, 1.0);

    vColor = mix(mix(aColor, vec3(1.0), ${PULSE_WHITEN} * boost), uOverride.rgb, uOverride.a);
    vAlpha = max(uOpacity, boost);
    vSide = position.x;
    vHalf = halfW;
  }
`

// Coverage across the width: 1 to half a pixel inside the line's edge, 0
// by half a pixel outside it (vHalf is the line's half width plus 1).  A
// 1 px line is 1 at its centre, as a GL line; a thinner one never reaches
// 1, so attenuated lines fade as they thin.
const fragmentShader = `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vSide;
  varying float vHalf;
  void main() {
    float cover = clamp(vHalf - 0.5 - (abs(vSide) * vHalf), 0.0, 1.0);
    gl_FragColor = vec4(vColor, vAlpha * cover);
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


/** @returns {string} CSS color of a selected star's route */
export function pathColorCss() {
  const [r, g, b] = PATH_COLOR.map((c) => Math.round(c * 255))
  return `rgb(${r}, ${g}, ${b})`
}


/**
 * The spread's hops (Colonization.js) as lines from parent star to child
 * star, colored and sized by hop, and the route to a selected star over
 * them.  A child of Stars, in the catalogue's frame.
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
    const segments = []
    for (let o = 1; o < spread.numReached; o++) {
      const i = spread.order[o]
      segments.push({
        from: spread.parent[i],
        to: i,
        hop: spread.hop[i],
        times: [spread.departYears[i], spread.arriveYears[i]],
        color: hopColor(spread.hop[i], spread.maxHop),
      })
    }
    this.tree = this._newMesh('ColonizationSegments', segments, pos)
    this._applyStyle()
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
    const segments = []
    for (let h = 1; h < path.length; h++) {
      segments.push({from: path[h - 1], to: path[h], hop: h, times: [0, 0], color: PATH_COLOR})
    }
    const mesh = this._newMesh('ColonizationPath', segments, pos)
    const u = mesh.material.uniforms
    u.uTime.value = ALWAYS
    u.uWidthFirst.value = u.uWidthLast.value = PATH_WIDTH
    u.uOverride.value.set(...PATH_COLOR, 1)
    // On top of the spread and everything else: it's what was asked about.
    mesh.material.depthTest = false
    mesh.renderOrder = PATH_RENDER_ORDER
    this.path = mesh
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


  /**
   * @param {string} name
   * @param {Array<object>} segments {from, to, hop, times, color}
   * @param {Float64Array} pos
   * @returns {Mesh}
   */
  _newMesh(name, segments, pos) {
    const n = segments.length
    const startHigh = new Float32Array(n * 3)
    const startLow = new Float32Array(n * 3)
    const endHigh = new Float32Array(n * 3)
    const endLow = new Float32Array(n * 3)
    const color = new Float32Array(n * 3)
    const times = new Float32Array(n * 2)
    const hop = new Float32Array(n)
    segments.forEach((seg, k) => {
      for (let c = 0; c < 3; c++) {
        const j = (3 * k) + c
        const s = pos[(3 * seg.from) + c] * LIGHTYEAR_METER
        const e = pos[(3 * seg.to) + c] * LIGHTYEAR_METER
        startHigh[j] = s
        startLow[j] = s - startHigh[j]
        endHigh[j] = e
        endLow[j] = e - endHigh[j]
        color[j] = seg.color[c]
      }
      times[2 * k] = seg.times[0]
      times[(2 * k) + 1] = seg.times[1]
      hop[k] = seg.hop
    })
    const geom = new InstancedBufferGeometry()
    geom.setAttribute('position', new Float32BufferAttribute([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0], 3))
    // Counter-clockwise on screen (front faces): perp is dir turned left, so
    // side -1 is the right edge.
    geom.setIndex([1, 0, 2, 1, 2, 3])
    geom.setAttribute('startHigh', new InstancedBufferAttribute(startHigh, 3))
    geom.setAttribute('startLow', new InstancedBufferAttribute(startLow, 3))
    geom.setAttribute('endHigh', new InstancedBufferAttribute(endHigh, 3))
    geom.setAttribute('endLow', new InstancedBufferAttribute(endLow, 3))
    geom.setAttribute('aColor', new InstancedBufferAttribute(color, 3))
    geom.setAttribute('aTimes', new InstancedBufferAttribute(times, 2))
    geom.setAttribute('aHop', new InstancedBufferAttribute(hop, 1))
    geom.instanceCount = n
    const mesh = new Mesh(geom, newLineMaterial(this._years))
    mesh.name = name
    // Vertices are placed in the shader, so three's bounds don't apply, and
    // the quad in `position` isn't where anything is: never cull or pick it.
    mesh.frustumCulled = false
    mesh.raycast = noRaycast
    const u = mesh.material.uniforms
    const res = new Vector2()
    mesh.onBeforeRender = (renderer, scene, camera) => {
      rteCameraLocal(mesh, camera, u.uCamPosWorldHigh.value, u.uCamPosWorldLow.value)
      const target = renderer.getRenderTarget()
      if (target) {
        res.set(target.width, target.height)
      } else {
        renderer.getDrawingBufferSize(res)
      }
      u.uResolution.value.copy(res)
      u.uPixelRatio.value = renderer.getPixelRatio()
      u.uNear.value = camera.near
      if (this.pulse.on) {
        const steps = (performance.now() - this._pulseStartMs) / MS_PER_SEC / this.pulse.stepSec
        u.uPulseHop.value = 1 + (steps % pulseCycle(this._maxHop, this.pulse.trail))
      }
    }
    return mesh
  }


  /** @param {Mesh|null} mesh */
  _dispose(mesh) {
    if (mesh) {
      this.remove(mesh)
      mesh.geometry.dispose()
      mesh.material.dispose()
    }
  }
}


/**
 * @param {number} years
 * @returns {ShaderMaterial}
 */
function newLineMaterial(years) {
  return sceneReferred(new ShaderMaterial({
    uniforms: {
      uCamPosWorldHigh: {value: new Vector3()},
      uCamPosWorldLow: {value: new Vector3()},
      uTime: {value: years},
      uResolution: {value: new Vector2(1, 1)},
      uPixelRatio: {value: 1},
      uNear: {value: 1},
      uMaxHop: {value: 1},
      uWidthFirst: {value: DEFAULT_STYLE.widthFirst},
      uWidthLast: {value: DEFAULT_STYLE.widthLast},
      uAttenuation: {value: 0},
      uOpacity: {value: 1},
      uPulseOn: {value: 0},
      uPulseHop: {value: 0},
      uTrail: {value: 0},
      uOverride: {value: new Vector4(0, 0, 0, 0)},
    },
    vertexShader,
    fragmentShader,
    toneMapped: false,
    transparent: true,
    blending: NormalBlending,
    depthWrite: false,
  }))
}


/** Raycasting skips the lines: their quad isn't where they're drawn. */
function noRaycast() {
  // Nothing to intersect.
}
