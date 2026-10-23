import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Points,
  ShaderMaterial,
  Vector3,
} from 'three'
import {sceneReferred} from '../hdr.js'
import {SATELLITES_LOAD_DIST} from '../satellites/names.js'
import {temeState} from '../satellites/sgp4.js'


// A constellation's satellites as points (Networks.md, "Propagation"):
// Starlink's ~11,000, Iridium's 80.  SGP4 for all of them every frame is
// ~7 ms on a laptop's CPU, too much, so each frame propagates only a slice
// (all of them every `refreshFrames` frames), and between its refreshes a
// satellite is carried along the circle its last state (r, v) lies on, in
// the vertex shader: p(t) = r cos(ω dt) + (v / ω) sin(ω dt), ω = |v| / |r|.
// For these near-circular orbits that's metres off over the seconds between
// refreshes at real time, and bounded at any rate (a circle, not a
// tangent line).  Hung from Earth's planetTilt, as the satellites are; the
// state is SGP4's TEME taken to that frame (sgp4.js temeToEquator), in
// metres and seconds.


const KM = 1e3
const SEC_PER_DAY = 86400
// The times on the GPU are seconds after a reference, re-based when the
// clock has moved this far from it, so float32 holds them to under a
// millisecond.
const REBASE_SEC = 600
// A date this far from the last frame's, in either direction, is a jump
// (the date picker, a link), not the clock running: everything is
// propagated at once, rather than drawn extrapolated a long way.
const JUMP_DAYS = 0.5
// Past this far from Earth's centre the points are a smudge round its own
// point: neither drawn nor propagated.  The same as Earth's satellites'.
const MAX_SHOW_DIST = SATELLITES_LOAD_DIST
const noRaycast = () => undefined
const tmpCam = new Vector3
const tmpEarth = new Vector3


/**
 * The position a refreshed state is carried to (the shader's mirror).
 *
 * @param {Array<number>|Float64Array} r0 position at the refresh, xyz from `j`
 * @param {Array<number>|Float64Array} vw velocity / ω there, xyz from `j`
 * @param {number} j offset of the satellite's xyz
 * @param {number} w ω, rad/s
 * @param {number} dt seconds since the refresh
 * @param {{set: Function}} out
 * @returns {object} out
 */
export function carry(r0, vw, j, w, dt, out) {
  const a = w * dt
  const c = Math.cos(a)
  const s = Math.sin(a)
  return out.set((r0[j] * c) + (vw[j] * s), (r0[j + 1] * c) + (vw[j + 1] * s), (r0[j + 2] * c) + (vw[j + 2] * s))
}


/** */
export default class Constellation extends Group {
  /**
   * @param {Array<import('../satellites/sgp4.js').SatRecord>} records
   * @param {object} opts
   * @param {string} opts.name
   * @param {Float32Array} opts.colors rgb a satellite, display values
   * @param {number} [opts.pointSize] px
   * @param {number} [opts.refreshFrames] frames to propagate them all over
   * @param {?number} [opts.layer] the overlay layer
   * @param {?object} [opts.camera] the view's, for showing by distance
   */
  constructor(records, {name, colors, pointSize = 2, refreshFrames = 8, layer = null, camera = null}) {
    super()
    this.name = name
    this.records = records
    this.count = records.length
    this.refreshFrames = Math.max(1, refreshFrames)
    this.camera = camera
    const n = this.count
    // The last refresh of each, in the frame and units the points use, and
    // ω; times are seconds after `jdRef`.
    this.jdRef = records.length ? records[0].epochJd : 0
    this.r0 = new Float64Array(n * 3)
    this.vw = new Float64Array(n * 3)
    this.w = new Float64Array(n)
    this.t0 = new Float64Array(n)
    this.shown = new Uint8Array(n)
    this.tRef = 0
    this.tNow = 0
    this.jd = NaN
    this._cursor = 0
    this._primed = false
    // The attributes going up whole this frame (a re-base), not by range.
    this._wholeUpload = new Set
    // How many were propagated in the last update, for the probes.
    this.lastRefreshed = 0
    this.points = this._newPoints(colors, pointSize, layer)
    this.add(this.points)
    this.preAnimCb = (time, jd) => this.update(jd)
  }


  /**
   * Propagate this frame's slice, or all of them on the first frame shown
   * and after a jump in the date, and set the shader's clock.  Nothing
   * while hidden: not shown (the overlay off, `visible`), or too far.
   *
   * @param {number} jd Julian Day (UTC)
   * @param {boolean} [shown] whether its overlay is drawn (an owner's, when
   *   the overlay's node is the owner)
   */
  update(jd, shown = this.visible) {
    if (this.camera) {
      const d = this.camera.getWorldPosition(tmpCam).distanceTo(this.getWorldPosition(tmpEarth))
      this.points.visible = d < MAX_SHOW_DIST
    }
    if (!shown || !this.points.visible) {
      this._primed = false
      this.lastRefreshed = 0
      return
    }
    const t = (jd - this.jdRef) * SEC_PER_DAY
    const jump = !this._primed || !(Math.abs(jd - this.jd) < JUMP_DAYS)
    this.jd = jd
    this.tNow = t
    const attrs = this.points.geometry.attributes
    if (jump || Math.abs(t - this.tRef) > REBASE_SEC) {
      this._rebase(t)
    }
    const n = this.count
    const k = jump ? n : Math.min(n, Math.ceil(n / this.refreshFrames))
    const start = jump ? 0 : this._cursor
    for (let m = 0; m < k; m++) {
      this._refresh((start + m) % n, jd, t)
    }
    this._cursor = (start + k) % n
    this.lastRefreshed = k
    this._primed = true
    // Upload what changed: the slice, in one or two runs (it wraps).
    const first = Math.min(k, n - start)
    for (const name of ['position', 'aVw', 'aState']) {
      const attr = attrs[name]
      if (this._wholeUpload.has(name)) {
        continue
      }
      const size = attr.itemSize
      attr.addUpdateRange(start * size, first * size)
      if (k > first) {
        attr.addUpdateRange(0, (k - first) * size)
      }
      attr.needsUpdate = true
    }
    this._wholeUpload.clear()
    this.points.material.uniforms.uNow.value = t - this.tRef
  }


  /**
   * Where satellite i is drawn now, metres in this frame: its last refresh
   * carried to the frame's time, as the shader does.
   *
   * @param {number} i
   * @param {{set: Function}} out
   * @returns {?object} out, or null if it isn't drawn
   */
  positionOf(i, out) {
    if (!this.shown[i]) {
      return null
    }
    return carry(this.r0, this.vw, 3 * i, this.w[i], this.tNow - this.t0[i], out)
  }


  /**
   * @param {number} i
   * @param {number} jd
   * @param {number} t seconds after jdRef
   */
  _refresh(i, jd, t) {
    const pv = temeState(this.records[i], jd)
    const attrs = this.points.geometry.attributes
    const j = 3 * i
    if (pv) {
      // TEME (x, y, z) → (x, z, −y), km → m (sgp4.js temeToEquator).
      const {position: p, velocity: v} = pv
      const rx = p.x * KM
      const ry = p.z * KM
      const rz = -p.y * KM
      const r = Math.hypot(rx, ry, rz)
      const vx = v.x * KM
      const vy = v.z * KM
      const vz = -v.y * KM
      const w = Math.hypot(vx, vy, vz) / r
      this.r0[j] = rx
      this.r0[j + 1] = ry
      this.r0[j + 2] = rz
      this.vw[j] = vx / w
      this.vw[j + 1] = vy / w
      this.vw[j + 2] = vz / w
      this.w[i] = w
      this.t0[i] = t
      this.shown[i] = 1
      attrs.position.setXYZ(i, rx, ry, rz)
      attrs.aVw.setXYZ(i, this.vw[j], this.vw[j + 1], this.vw[j + 2])
    } else {
      this.shown[i] = 0
    }
    attrs.aState.setXYZ(i, this.w[i], this.t0[i] - this.tRef, this.shown[i])
  }


  /**
   * Move the GPU's time reference to t, and every satellite's refresh time
   * with it: the whole attribute goes up.
   *
   * @param {number} t
   */
  _rebase(t) {
    this.tRef = t
    const state = this.points.geometry.attributes.aState
    for (let i = 0; i < this.count; i++) {
      state.setY(i, this.t0[i] - t)
    }
    state.clearUpdateRanges()
    state.needsUpdate = true
    this._wholeUpload.add('aState')
  }


  /**
   * @param {Float32Array} colors
   * @param {number} pointSize
   * @param {?number} layer
   * @returns {Points}
   */
  _newPoints(colors, pointSize, layer) {
    const n = this.count
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(n * 3), 3))
    geometry.setAttribute('aVw', new Float32BufferAttribute(new Float32Array(n * 3), 3))
    // ω, the refresh's time after tRef, and whether it's drawn.
    geometry.setAttribute('aState', new Float32BufferAttribute(new Float32Array(n * 3), 3))
    geometry.setAttribute('aColor', new Float32BufferAttribute(colors, 3))
    const material = sceneReferred(new ShaderMaterial({
      uniforms: {uSize: {value: pointSize}, uPixelRatio: {value: 1}, uNow: {value: 0}},
      vertexShader: `
        uniform float uSize;
        uniform float uPixelRatio;
        uniform float uNow;
        attribute vec3 aVw;
        attribute vec3 aState;
        attribute vec3 aColor;
        varying vec3 vColor;
        void main() {
          vColor = aColor;
          // Along the circle of its last state (Constellation.js carry).
          float a = aState.x * (uNow - aState.y);
          vec3 p = (position * cos(a)) + (aVw * sin(a));
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
          if (aState.z < 0.5) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          }
          gl_PointSize = uSize * uPixelRatio;
        }`,
      // A round dot, soft at its edge: symmetric, so SwiftShader's flipped
      // gl_PointCoord (AGENTS.md) doesn't show.
      fragmentShader: `
        varying vec3 vColor;
        void main() {
          float r = length(gl_PointCoord - 0.5) * 2.0;
          float a = 1.0 - smoothstep(0.6, 1.0, r);
          if (a <= 0.0) discard;
          gl_FragColor = vec4(vColor, a);
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, toneMapped: false,
    }))
    const points = new Points(geometry, material)
    points.name = `${this.name} points`
    points.frustumCulled = false
    points.raycast = noRaycast
    if (layer !== null) {
      points.layers.set(layer)
    }
    points.onBeforeRender = (renderer) => {
      material.uniforms.uPixelRatio.value = renderer.getPixelRatio()
    }
    return points
  }


  /** Free the GPU buffers. */
  dispose() {
    this.removeFromParent()
    this.points.geometry.dispose()
    this.points.material.dispose()
  }
}
