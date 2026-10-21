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
import SpriteSheet from './SpriteSheet.js'
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
const CENTRE_ARC_RADIUS = 0.82
const BARYCENTRE_MARKER_PER_RATIO = 0.25
const BARYCENTRE_MIN_RATIO = 1e-4
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
  barycentre: 0xffe08a,
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
  // From the mean place to the true one: the equation of centre, ν - M.
  centreArc: {color: COLORS.body, n: ARC_STRIP_POINTS, keys: [M, L]},
  // From the place the elements give to the body, where they aren't one
  // (Earth's are the Earth-Moon barycentre's): setBodyOffset.
  bodyOffset: {color: COLORS.body, n: 2, keys: [M, L], needs: 'offset', xray: true},
  // The two bodies' barycentre, on the line to the body at m/(M + m) of the
  // way, and the primary's own orbit about it: the body's, scaled by that
  // and turned half round, through the primary's centre (setMassRatio).
  barycentre: {color: COLORS.barycentre, n: MARKER_POINTS, keys: [A, M, L], needs: 'barycentre', xray: true},
  primaryOrbit: {color: COLORS.barycentre, n: RIM_POINTS, keys: [A, M, L], needs: 'barycentre', xray: true},
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
    // tip - head·tangent + wing·head/2·radial: the tangent the way the arc
    // runs, ±(-sin, cos); the radial (cos, sin).
    const sign = sweep < 0 ? -1 : 1
    const cr = (r * cos) + (sign * head * sin) + (wing * head * 0.5 * cos)
    const cp = (r * sin) - (sign * head * cos) + (wing * head * 0.5 * sin)
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
   * @param {?object} [opts.labels] Name the points in the scene (the app):
   *     {direction, body}, the reference direction's and the body's place's
   *     names (the body's only where its place isn't the body's own, e.g.
   *     'Earth-Moon barycentre'); needs a DOM, for the labels' canvas
   */
  constructor({layer = null, body = false, screen = false, labels = null} = {}) {
    super()
    this.name = 'orbitDiagram'
    this.parts = {}
    this.keys = null
    for (const [name, p] of Object.entries(PARTS)) {
      if (p.optional && !body) {
        continue
      }
      // The barycentre's parts are inside the bodies (the Earth-Moon one is
      // 4,700 km from the Earth's centre): drawn through them.
      const strip = newWideLineStrip(new Float32Array(p.n * 3), {
        name: `orbitDiagram.${name}`, color: p.color, width: WIDTH.all, opacity: OPACITY.all,
        material: p.xray ? {depthTest: false} : {},
      })
      if (screen) {
        strip.material.uniforms.uOverride.value.set(...new Color().setHex(p.color, LinearSRGBColorSpace).toArray(), 1)
      }
      this.parts[name] = strip
      this.add(strip)
    }
    /** Where to hang labels, in the diagram's units: set by setElements. */
    this.anchors = {
      direction: new Vector3, ascendingNode: new Vector3, pericentre: new Vector3, body: new Vector3,
      centre: new Vector3, emptyFocus: new Vector3,
    }
    this._bodyOffset = null
    this._massRatio = 0
    this.anchors.barycentre = new Vector3
    this._labels = labels ? this._newLabels(labels) : null
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
    // To the orbit, at the mean anomaly's angle from pericentre.
    const rMean = p / (1 + (e * Math.cos(m)))
    set('meanLine', segment([0, 0, 0], [rMean * Math.cos(m), 0, -rMean * Math.sin(m)]), q.peri)
    const centre = ((((nu - m) % TWO_PI) + (3 * Math.PI)) % TWO_PI) - Math.PI
    set('centreArc', arcWithHead(ORIGIN, [Math.cos(m), 0, -Math.sin(m)], [-Math.sin(m), 0, -Math.cos(m)],
        CENTRE_ARC_RADIUS, centre), q.peri)
    set('radius', segment([0, 0, 0], [rBody * Math.cos(nu), 0, -rBody * Math.sin(nu)]), q.peri)
    set('body', arc(MARKER_RADIUS * 1.5, 0, TWO_PI, rBody * Math.cos(nu), -rBody * Math.sin(nu)), q.peri)
    const an = this.anchors
    an.direction.set(rim * 0.8, 0, 0)
    an.ascendingNode.set(rNode, 0, 0).applyQuaternion(q.node)
    an.pericentre.set(1 - e, 0, 0).applyQuaternion(q.peri)
    an.body.set(rBody * Math.cos(nu), 0, -rBody * Math.sin(nu)).applyQuaternion(q.peri)
    an.centre.set(-e, 0, 0).applyQuaternion(q.peri)
    an.emptyFocus.set(-2 * e, 0, 0).applyQuaternion(q.peri)
    // The barycentre, and the primary's orbit about it, passing through the
    // primary's centre (the focus) as it must: B - k r(E), with B = k r(ν).
    // In the orbit's perifocal axes.
    const k = this._massRatio
    const bx = k * rBody * Math.cos(nu)
    const bz = -k * rBody * Math.sin(nu)
    an.barycentre.copy(an.body).multiplyScalar(k)
    set('primaryOrbit', (u, v) => {
      const ecc = TWO_PI * u
      return v.set(bx - (k * (Math.cos(ecc) - e)), 0, bz + (k * b * Math.sin(ecc)))
    }, q.peri)
    set('barycentre', arc(Math.min(MARKER_RADIUS, BARYCENTRE_MARKER_PER_RATIO * k), 0, TWO_PI, bx, bz), q.peri)
    this.setBodyOffset(this._bodyOffset)
    this._placeLabels()
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
      strip.visible = state !== 'hidden' && this._has(PARTS[name].needs)
      u.uOpacity.value = OPACITY[state] ?? 0
      u.uWidthFirst.value = u.uWidthLast.value = WIDTH[state] ?? 0
    }
    this._showLabels()
    const planesLit = Boolean(this.keys?.has(I))
    this.fills.reference.material.opacity = planesLit ? FILL_LIT_OPACITY : FILL_OPACITY
    this.fills.orbitPlane.material.opacity = planesLit ? FILL_LIT_OPACITY : FILL_OPACITY
  }


  /**
   * Mark how far the body is from the place its elements give it, where
   * that isn't the body (Earth's are the Earth-Moon barycentre's): a line
   * from that place to the body.  Null takes it away.
   *
   * @param {?Vector3} body the body, in the diagram's frame and units
   */
  setBodyOffset(body) {
    this._bodyOffset = body ? (this._bodyOffset ?? new Vector3).copy(body) : null
    const strip = this.parts.bodyOffset
    const pos = strip.geometry.attributes.position
    const from = this.anchors.body
    const to = this._bodyOffset ?? from
    pos.array.set([from.x, from.y, from.z, to.x, to.y, to.z])
    pos.needsUpdate = true
    strip.visible = this._has('offset') && partState('bodyOffset', this.keys) !== 'hidden'
    this._showLabels()
  }


  /**
   * The secondary's share of the two bodies' mass, m / (M + m), for their
   * barycentre and the primary's orbit about it: the Moon's 1/82.3, Pluto
   * and Charon's 0.11, Jupiter's 1/1048 (the Sun's centre circles a point
   * just outside its surface).  Under BARYCENTRE_MIN_RATIO (the Sun and
   * Earth's 3e-6: 450 km at 1 AU) they aren't drawn.
   *
   * @param {number} k
   */
  setMassRatio(k) {
    this._massRatio = Number.isFinite(k) && k > 0 ? k : 0
  }


  /**
   * @param {string} [needs] a part's `needs`
   * @returns {boolean} whether the diagram has what the part shows
   */
  _has(needs) {
    if (needs === 'offset') {
      return this._bodyOffset !== null
    }
    if (needs === 'barycentre') {
      return this._massRatio >= BARYCENTRE_MIN_RATIO
    }
    return true
  }


  /**
   * @param {object} names {direction, body}
   * @returns {object} {sheet, sprites, entries}
   */
  _newLabels(names) {
    const entries = [
      {anchor: 'direction', text: names.direction ?? 'reference direction', part: 'direction',
        color: COLORS.direction},
      {anchor: 'ascendingNode', text: '☊ ascending node', part: 'ascendingNode', color: C[NODE].color},
      {anchor: 'pericentre', text: 'pericentre', part: 'periLine', color: C[OMEGA].color},
      {anchor: 'centre', text: 'centre', part: 'centre', color: C[A].color},
      {anchor: 'emptyFocus', text: 'empty focus', part: 'emptyFocus', color: C[E].color},
    ]
    if (names.body) {
      entries.push({anchor: 'body', text: names.body, part: 'radius', color: COLORS.body, needs: 'offset'})
    }
    if (names.barycentre) {
      entries.push({anchor: 'barycentre', text: names.barycentre, part: 'barycentre', color: COLORS.barycentre,
        needs: 'barycentre'})
    }
    const sheet = new SpriteSheet(entries.length, entries.map((l) => l.text))
    for (const l of entries) {
      sheet.add(0, 0, 0, l.text, `#${l.color.toString(16).padStart(6, '0')}`)
    }
    const sprites = sheet.compile()
    sprites.name = 'orbitDiagram.labels'
    // Some name points inside the bodies (the barycentres): drawn over them.
    if (sprites.material) {
      sprites.material.depthTest = false
    }
    this.add(sprites)
    return {sheet, sprites, entries}
  }


  /** Move the labels to their points. */
  _placeLabels() {
    const attr = this._labels?.sheet.positionAttribute
    if (!attr) {
      return
    }
    this._labels.entries.forEach((l, i) => attr.setXYZ(i, ...this.anchors[l.anchor].toArray()))
    attr.needsUpdate = true
  }


  /** Name only the points whose parts are lit. */
  _showLabels() {
    const labels = this._labels
    if (!labels?.sheet.setShown) {
      return
    }
    labels.entries.forEach((l, i) => {
      const lit = partState(l.part, this.keys) === 'lit' && this._has(l.needs)
      labels.sheet.setShown(i, lit)
    })
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
