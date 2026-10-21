import {
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  LinearSRGBColorSpace,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from 'three'
import {sceneReferred} from './hdr.js'
import {ORBIT_ELEMENTS} from './orbitElements.js'
import {newWideLineStrip} from './wideLines.js'


// A diagram of an orbit's six elements (DESIGN.md "Orbital elements"), after
// the usual figure (en.wikipedia.org/wiki/Orbital_elements): the reference
// plane and direction, the orbit's plane, the line of nodes, the angles Ω,
// i, ω and M as arcs, the major and minor axes and the focal distance.
// Each part is lit by the elements it shows; highlight(keys) draws those
// of the given elements bright and the rest faint or not at all.  The guide's orbit page drives it
// with sliders; the app lays it on a body's orbit, from the info panel's
// list of elements (Scene.showOrbitElement, Animation.layOrbitDiagram).
//
// Drawn in units of the semi-major axis, in the reference plane's axes as
// meanElements.js has them: the plane XZ, its pole +Y, the reference
// direction +X, prograde motion from +X toward -Z.  The focus (the
// primary) is at the origin; the owner scales the group by a and turns it
// into its frame.


const ARC_POINTS = 97
// An arc's arrowhead, at its end: back to one wing, the tip, the other.
const ARROWHEAD_POINTS = 3
const ARROWHEAD_PER_RADIUS = 0.18
const ARC_STRIP_POINTS = ARC_POINTS + ARROWHEAD_POINTS
const RIM_POINTS = 193
const MARKER_POINTS = 25
const MARKER_RADIUS = 0.025
const NODE_ARC_RADIUS = 0.35
const PERI_ARC_RADIUS = 0.5
const ANOMALY_ARC_RADIUS = 0.65
const INCLINATION_ARC_RADIUS = 0.3
const RIM_PER_APOAPSIS = 1.2
const ARROW_LENGTH = 0.06
const ARROW_HALF_WIDTH = 0.03
const FILL_OPACITY = 0.06
const FILL_LIT_OPACITY = 0.12
const WIDTH = {lit: 2.5, all: 1.5, context: 1}
const OPACITY = {lit: 1, all: 0.85, context: 0.4}

const C = ORBIT_ELEMENTS
const COLORS = {
  orbit: 0x6fa8ff,
  reference: 0xb0b0b0,
  orbitPlane: 0xe0d070,
  direction: 0xd0d0d0,
  body: 0xffffff,
}

const A = 'semiMajorAxis'
const E = 'eccentricity'
const I = 'inclination'
const NODE = 'longitudeOfAscendingNode'
const VARPI = 'longitudeOfPericenter'
const OMEGA = 'argumentOfPericenter'
const L = 'meanLongitude'
const M = 'meanAnomaly'

/**
 * The parts: their colour, point count, and the elements that light them.
 * `base` parts are drawn faint as context whatever is lit.
 */
const PARTS = {
  orbit: {color: COLORS.orbit, n: RIM_POINTS, keys: [A, E], base: true},
  referenceRim: {color: COLORS.reference, n: RIM_POINTS, keys: [I, NODE], base: true},
  orbitRim: {color: COLORS.orbitPlane, n: RIM_POINTS, keys: [I, OMEGA], base: true},
  direction: {color: COLORS.direction, n: 2, keys: [NODE, VARPI, L], base: true},
  arrowhead: {color: COLORS.direction, n: 3, keys: [NODE, VARPI, L], base: true},
  nodeLine: {color: C[NODE].color, n: 2, keys: [NODE, VARPI, OMEGA, I]},
  ascendingNode: {color: C[NODE].color, n: MARKER_POINTS, keys: [NODE, VARPI, OMEGA, I]},
  nodeArc: {color: C[NODE].color, n: ARC_STRIP_POINTS, keys: [NODE, VARPI, L]},
  inclinationArc: {color: C[I].color, n: ARC_STRIP_POINTS, keys: [I]},
  periArc: {color: C[OMEGA].color, n: ARC_STRIP_POINTS, keys: [OMEGA, VARPI, L]},
  periLine: {color: C[OMEGA].color, n: 2, keys: [OMEGA, VARPI, M]},
  majorAxis: {color: C[A].color, n: 2, keys: [A]},
  centre: {color: C[A].color, n: MARKER_POINTS, keys: [A, E]},
  focalLine: {color: C[E].color, n: 2, keys: [E]},
  minorAxis: {color: C[E].color, n: 2, keys: [E]},
  emptyFocus: {color: C[E].color, n: MARKER_POINTS, keys: [E]},
  anomalyArc: {color: C[M].color, n: ARC_STRIP_POINTS, keys: [M, L]},
  meanLine: {color: C[M].color, n: 2, keys: [M, L]},
  radius: {color: COLORS.body, n: 2, keys: [M, L]},
  body: {color: COLORS.body, n: MARKER_POINTS, keys: [M, L], base: true, optional: true},
}

const TO_RAD = Math.PI / 180
const ORIGIN = [0, 0, 0]
const X_DIR = [1, 0, 0]
// 90° on from +X the way the angles run: prograde, toward -Z.
const PROGRADE = [0, 0, -1]
const noRaycast = () => undefined
const Y_AXIS = new Vector3(0, 1, 0)
const X_AXIS = new Vector3(1, 0, 0)
const tmpQ = new Quaternion
const tmpV = new Vector3


/**
 * How a part is drawn when some elements are lit: bright if any of them
 * shows it, faint if it is the base, else not at all.
 *
 * @param {string} part
 * @param {?Set<string>} keys ORBIT_ELEMENTS keys, or null for all at once
 * @returns {'lit'|'all'|'context'|'hidden'}
 */
export function partState(part, keys) {
  const p = PARTS[part]
  if (!keys) {
    return 'all'
  }
  if (p.keys.some((k) => keys.has(k))) {
    return 'lit'
  }
  return p.base ? 'context' : 'hidden'
}


/**
 * @param {?string|Array<string>|Set<string>} keys
 * @returns {?Set<string>} null for none given: all at once
 */
function keySet(keys) {
  if (keys === null || keys === undefined) {
    return null
  }
  return new Set(typeof keys === 'string' ? [keys] : keys)
}


/**
 * Points of a curve into a strip's packed array, each turned by quat.
 *
 * @param {Float32Array} out
 * @param {number} n points
 * @param {Function} at (u in [0, 1], Vector3) sets the point, unturned
 * @param {Quaternion} quat
 */
function fill(out, n, at, quat) {
  for (let k = 0; k < n; k++) {
    at(n > 1 ? k / (n - 1) : 0, tmpV)
    tmpV.applyQuaternion(quat)
    out[3 * k] = tmpV.x
    out[(3 * k) + 1] = tmpV.y
    out[(3 * k) + 2] = tmpV.z
  }
}


/**
 * @param {number} r
 * @param {number} t0 radians
 * @param {number} t1 radians
 * @param {number} [cx] centre, along x
 * @param {number} [cz] centre, along z
 * @returns {Function} an arc in the XZ plane, prograde (+X toward -Z)
 */
function arc(r, t0, t1, cx = 0, cz = 0) {
  return (u, v) => {
    const t = t0 + ((t1 - t0) * u)
    return v.set(cx + (r * Math.cos(t)), 0, cz - (r * Math.sin(t)))
  }
}


/**
 * An arc of a circle, then an arrowhead at its end showing which way the
 * angle runs: the arc to the tip, back along it to one wing, the tip, the
 * other wing.  The circle is c + r (cos t ref + sin t perp), t from 0 to
 * sweep.
 *
 * @param {Array<number>} c centre
 * @param {Array<number>} ref unit, the direction at t = 0
 * @param {Array<number>} perp unit, 90° on, the way t runs
 * @param {number} r
 * @param {number} sweep radians, the angle
 * @returns {Function} (u, Vector3) for fill, over ARC_STRIP_POINTS
 */
function arcWithHead(c, ref, perp, r, sweep) {
  const at = (t, cr, cp, v) => v.set(
      c[0] + (cr * ref[0]) + (cp * perp[0]),
      c[1] + (cr * ref[1]) + (cp * perp[1]),
      c[2] + (cr * ref[2]) + (cp * perp[2]))
  const head = ARROWHEAD_PER_RADIUS * r * Math.min(1, Math.abs(sweep) * 4)
  return (u, v) => {
    const k = Math.round(u * (ARC_STRIP_POINTS - 1))
    if (k < ARC_POINTS) {
      const t = sweep * k / (ARC_POINTS - 1)
      return at(t, r * Math.cos(t), r * Math.sin(t), v)
    }
    // The wings: back along the tangent from the tip, and out or in along
    // the radius.
    const cos = Math.cos(sweep)
    const sin = Math.sin(sweep)
    const wing = k === ARC_POINTS ? 1 : (k === ARC_POINTS + 1 ? 0 : -1)
    if (wing === 0) {
      return at(sweep, r * cos, r * sin, v)
    }
    // tip - head·tangent + wing·head/2·radial, tangent (-sin, cos), radial (cos, sin)
    const cr = (r * cos) + (head * sin) + (wing * head * 0.5 * cos)
    const cp = (r * sin) - (head * cos) + (wing * head * 0.5 * sin)
    return at(sweep, cr, cp, v)
  }
}


/**
 * @param {Array<number>} a
 * @param {Array<number>} b
 * @returns {Function} the segment from a to b
 */
function segment(a, b) {
  return (u, v) => v.set(a[0] + ((b[0] - a[0]) * u), a[1] + ((b[1] - a[1]) * u), a[2] + ((b[2] - a[2]) * u))
}


/** The diagram: a Group of wide-line strips and two plane fills. */
export default class OrbitDiagram extends Group {
  /**
   * @param {object} [opts]
   * @param {?number} [opts.layer] Put every part on this layer (the app's overlay)
   * @param {boolean} [opts.body] Draw a marker at the body's place (the guide)
   * @param {boolean} [opts.screen] Drawn straight to an sRGB canvas (the
   *     guide), not into the app's linear scene buffer: the lines take their
   *     colours' sRGB values as they are
   */
  constructor({layer = null, body = false, screen = false} = {}) {
    super()
    this.name = 'orbitDiagram'
    this.parts = {}
    this.keys = null
    for (const [name, p] of Object.entries(PARTS)) {
      if (p.optional && !body) {
        continue
      }
      const strip = newWideLineStrip(new Float32Array(p.n * 3), {
        name: `orbitDiagram.${name}`, color: p.color, width: WIDTH.all, opacity: OPACITY.all,
      })
      if (screen) {
        strip.material.uniforms.uOverride.value.set(...new Color().setHex(p.color, LinearSRGBColorSpace).toArray(), 1)
      }
      this.parts[name] = strip
      this.add(strip)
    }
    /** Where to hang labels, in the diagram's units: set by setElements. */
    this.anchors = {direction: new Vector3, ascendingNode: new Vector3, pericentre: new Vector3, body: new Vector3}
    this.fills = {
      reference: this._newFill(COLORS.reference),
      orbitPlane: this._newFill(COLORS.orbitPlane),
    }
    this.add(this.fills.reference)
    this.orbitFrame = new Group
    this.orbitFrame.add(this.fills.orbitPlane)
    this.add(this.orbitFrame)
    if (layer !== null) {
      this.traverse((o) => o.layers.set(layer))
    }
    this._q = {node: new Quaternion, plane: new Quaternion, peri: new Quaternion, id: new Quaternion}
    this.setElements({e: 0, i: 0, node: 0, w: 0, m: 0, nu: 0})
    this.highlight(null)
  }


  /**
   * @param {number} color
   * @returns {Mesh} a unit disc in the XZ plane
   */
  _newFill(color) {
    const material = sceneReferred(new MeshBasicMaterial({
      color: new Color(color), transparent: true, opacity: FILL_OPACITY, side: DoubleSide,
      depthWrite: false, toneMapped: false,
    }))
    const disc = new Mesh(new CircleGeometry(1, RIM_POINTS - 1), material)
    disc.rotation.x = -Math.PI / 2
    disc.name = 'orbitDiagram.fill'
    disc.raycast = noRaycast
    return disc
  }


  /**
   * Lay the diagram on a set of elements.
   *
   * @param {{e: number, i: number, node: number, w: number, m: number, nu: number}} el
   *     degrees; nu the true anomaly
   */
  setElements(el) {
    const e = Math.min(Math.max(el.e, 0), 0.99)
    const q = this._q
    q.node.setFromAxisAngle(Y_AXIS, el.node * TO_RAD)
    q.plane.copy(q.node).multiply(tmpQ.setFromAxisAngle(X_AXIS, el.i * TO_RAD))
    q.peri.copy(q.plane).multiply(tmpQ.setFromAxisAngle(Y_AXIS, el.w * TO_RAD))
    const b = Math.sqrt(1 - (e * e))
    const p = 1 - (e * e)
    const rim = RIM_PER_APOAPSIS * (1 + e)
    // The ascending node: in the orbit's plane, ω before pericentre.
    const rNode = p / (1 + (e * Math.cos(el.w * TO_RAD)))
    const rBody = p / (1 + (e * Math.cos(el.nu * TO_RAD)))
    const nu = el.nu * TO_RAD
    const m = el.m * TO_RAD
    const set = (name, at, quat) => {
      const strip = this.parts[name]
      if (!strip) {
        return
      }
      const pos = strip.geometry.attributes.position
      fill(pos.array, PARTS[name].n, at, quat)
      pos.needsUpdate = true
    }
    const TWO_PI = 2 * Math.PI
    set('orbit', (u, v) => {
      const ecc = TWO_PI * u
      return v.set(Math.cos(ecc) - e, 0, -b * Math.sin(ecc))
    }, q.peri)
    set('referenceRim', arc(rim, 0, TWO_PI), q.id)
    set('orbitRim', arc(rim, 0, TWO_PI), q.plane)
    set('direction', segment([0, 0, 0], [rim, 0, 0]), q.id)
    set('arrowhead', (u, v) => {
      const k = Math.round(u * 2)
      return k === 1 ? v.set(rim, 0, 0) : v.set(rim - ARROW_LENGTH, 0, k === 0 ? ARROW_HALF_WIDTH : -ARROW_HALF_WIDTH)
    }, q.id)
    set('nodeLine', segment([-rim, 0, 0], [rim, 0, 0]), q.node)
    set('ascendingNode', arc(MARKER_RADIUS, 0, TWO_PI, rNode), q.node)
    set('nodeArc', arcWithHead(ORIGIN, X_DIR, PROGRADE, NODE_ARC_RADIUS, el.node * TO_RAD), q.id)
    // At the ascending node, from the reference plane's prograde direction
    // up to the orbit's.
    set('inclinationArc', arcWithHead([rNode, 0, 0], PROGRADE, [0, 1, 0], INCLINATION_ARC_RADIUS, el.i * TO_RAD),
        q.node)
    set('periArc', arcWithHead(ORIGIN, X_DIR, PROGRADE, PERI_ARC_RADIUS, el.w * TO_RAD), q.plane)
    set('periLine', segment([0, 0, 0], [1 - e, 0, 0]), q.peri)
    set('majorAxis', segment([-(1 + e), 0, 0], [1 - e, 0, 0]), q.peri)
    set('centre', arc(MARKER_RADIUS, 0, TWO_PI, -e), q.peri)
    set('focalLine', segment([-e, 0, 0], [0, 0, 0]), q.peri)
    set('minorAxis', segment([-e, 0, b], [-e, 0, -b]), q.peri)
    set('emptyFocus', arc(MARKER_RADIUS, 0, TWO_PI, -2 * e), q.peri)
    set('anomalyArc', arcWithHead(ORIGIN, X_DIR, PROGRADE, ANOMALY_ARC_RADIUS, m), q.peri)
    set('meanLine', segment([0, 0, 0], [Math.cos(m), 0, -Math.sin(m)]), q.peri)
    set('radius', segment([0, 0, 0], [rBody * Math.cos(nu), 0, -rBody * Math.sin(nu)]), q.peri)
    set('body', arc(MARKER_RADIUS * 1.5, 0, TWO_PI, rBody * Math.cos(nu), -rBody * Math.sin(nu)), q.peri)
    const an = this.anchors
    an.direction.set(rim * 0.8, 0, 0)
    an.ascendingNode.set(rNode, 0, 0).applyQuaternion(q.node)
    an.pericentre.set(1 - e, 0, 0).applyQuaternion(q.peri)
    an.body.set(rBody * Math.cos(nu), 0, -rBody * Math.sin(nu)).applyQuaternion(q.peri)
    this.fills.reference.scale.setScalar(rim)
    this.fills.orbitPlane.scale.setScalar(rim)
    this.orbitFrame.quaternion.copy(q.plane)
  }


  /**
   * Light some elements' parts, show the base faintly and hide the rest; or,
   * with null, draw them all alike.
   *
   * @param {?string|Array<string>|Set<string>} keys an ORBIT_ELEMENTS key or several
   */
  highlight(keys) {
    this.keys = keySet(keys)
    for (const [name, strip] of Object.entries(this.parts)) {
      const state = partState(name, this.keys)
      const u = strip.material.uniforms
      strip.visible = state !== 'hidden'
      u.uOpacity.value = OPACITY[state] ?? 0
      u.uWidthFirst.value = u.uWidthLast.value = WIDTH[state] ?? 0
    }
    const planesLit = Boolean(this.keys?.has(I))
    this.fills.reference.material.opacity = planesLit ? FILL_LIT_OPACITY : FILL_OPACITY
    this.fills.orbitPlane.material.opacity = planesLit ? FILL_LIT_OPACITY : FILL_OPACITY
  }


  /** Free the GPU buffers. */
  dispose() {
    this.traverse((o) => {
      o.geometry?.dispose()
      o.material?.dispose()
    })
    this.removeFromParent()
  }
}
