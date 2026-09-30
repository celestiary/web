import {BufferAttribute, DynamicDrawUsage, Sphere, Vector3} from 'three'


// An orbit line as drawn close up: its body's centre on the line, to a
// small fraction of the body's radius, at any zoom.  Two things kept it off
// (orbitPath.test.js, "as rendered"):
//
// - Chord sag.  A 1000-segment line over one orbit bows inside the curve by
//   up to a·(2π/1000)²/8 ≈ 4.9e-6·a: 0.3 radii for Mars, 0.8 for Neptune,
//   24 for Pluto.  So a fine arc of the same curve is spliced in around the
//   body, over the body's coarse segment and one each side, at a spacing
//   whose sag is under FINE_TOLERANCE of the body's radius.
// - float32.  The vertices (in the geometry and on the GPU) are good to
//   ~6e-8 of their size, ~0.3 radii for Pluto's, and the GPU adds the
//   camera offset in float32 too.  So the coarse line is kept in float64
//   and written relative to an origin at the body, which the line's
//   position (float64, composed on the CPU) puts back: near the body the
//   numbers are small and float32 is exact where the camera looks.
//
// The splice and the origin stay while the body is in its coarse segment,
// within ORIGIN_RADII of the origin, and within CHECK_TOLERANCE of the arc;
// otherwise they're redone, a few hundred vertices and one upload.


/** Target sag of the fine arc, in the body's radii. */
export const FINE_TOLERANCE = 2.5e-4

/** The body is re-spliced when it's farther than this from the arc, radii. */
export const CHECK_TOLERANCE = 5e-4

/**
 * Or farther than this from the origin, radii: float32 then holds the
 * vertices near it to ~6e-5 of a radius.
 */
export const ORIGIN_RADII = 1000

/** Fine steps per coarse segment, at most (Pluto's line needs ~200). */
export const MAX_FINE_STEPS = 256

// Coarse segments spliced each side of the body's.
const SPAN_SIDE = 1

// float32's relative precision, about (2^-24, and the GPU's sum as much
// again).
const FLOAT32_PRECISION = 1.2e-7


/**
 * One orbit line's vertices: the coarse curve in float64, and what's drawn.
 */
export class BodyLine {
  /**
   * @param {object} line a three Line, whose position attribute this replaces
   * @param {object} opts
   * @param {number} opts.n coarse vertices
   * @param {boolean} [opts.closed] whether the last vertex is the first
   *     (an ellipse), so the fine arc can wrap
   */
  constructor(line, {n, closed = false}) {
    this.line = line
    this.n = n
    this.closed = closed
    /** The coarse vertices, in the line's parent's frame. */
    this.coarse = new Float64Array(3 * n)
    /** The curve through them (see setCoarse), or null. */
    this.curve = null
    /** The fine arc drawn now, or null. */
    this.span = null
    /** Fine steps per coarse segment. */
    this.steps = 1
    /** Where the drawn vertices are relative to (the line's position). */
    this.origin = new Vector3
    const capacity = n + (((2 * SPAN_SIDE) + 1) * MAX_FINE_STEPS)
    const attr = new BufferAttribute(new Float32Array(3 * capacity), 3)
    attr.setUsage(DynamicDrawUsage)
    line.geometry.setAttribute('position', attr)
    line.geometry.setDrawRange(0, n)
    this._fine = new Float64Array(3 * capacity)
    this._v = new Vector3
    this._w = new Vector3
    // The coarse line's bounding sphere and size, in the parent's frame.
    this._sphere = new Sphere
    this._size = 0
  }


  /**
   * Set the coarse vertices and the curve through them, and draw them
   * without a fine arc (the next follow() adds it).
   *
   * @param {Float64Array} xyz n × 3, the line's parent's frame
   * @param {object} curve {at(u, target): Vector3} the point at coarse
   *     index u (fractional), on the curve the coarse vertices were taken
   *     from, and {correct: boolean}: whether the body's own position may
   *     be off the curve (an interpolated path), and the arc bent to it
   * @param {number} steps fine steps per coarse segment
   * @param {Vector3} origin
   */
  setCoarse(xyz, curve, steps, origin) {
    this.coarse.set(xyz)
    this.curve = curve
    this.steps = Math.min(Math.max(1, steps), MAX_FINE_STEPS)
    this.span = null
    // Once per build, not per splice: the arc is within the coarse line's
    // sphere, but for the interpolation's small offset (a margin).
    let size = 0
    const c = this._sphere.center.set(0, 0, 0)
    const n = this.n
    for (let j = 0; j < n; j++) {
      c.x += xyz[3 * j] / n
      c.y += xyz[(3 * j) + 1] / n
      c.z += xyz[(3 * j) + 2] / n
    }
    let r2 = 0
    for (let j = 0; j < n; j++) {
      const v = this._v.fromArray(xyz, 3 * j)
      r2 = Math.max(r2, v.distanceToSquared(c))
      size = Math.max(size, Math.abs(v.x), Math.abs(v.y), Math.abs(v.z))
    }
    this._sphere.radius = Math.sqrt(r2) * (1 + 1e-4)
    this._size = size
    this.write(origin)
  }


  /**
   * Keep the drawn line through the body: re-splice the fine arc if the
   * body has left it, or its origin.  Cheap when nothing's due.
   *
   * @param {Vector3} body in the line's parent's frame
   * @param {number} u the body's coarse index (fractional), or NaN when
   *     it's not on this line (outside a path's window)
   * @param {number} radius the body's, for the tolerances
   */
  follow(body, u, radius) {
    // Neither sag nor float32 would show: leave it as built.
    if (!this.curve || (this.steps === 1 && this._size * FLOAT32_PRECISION < FINE_TOLERANCE * radius)) {
      return
    }
    const n = this.n
    if (!Number.isFinite(u) || (!this.closed && (u < 0 || u > n - 1))) {
      // Not on this line: draw it plainly, until it's rebuilt.
      if (this.span) {
        this.span = null
        this.write(this.origin)
      }
      return
    }
    if (this.span && this._holds(body, u, radius)) {
      return
    }
    this.splice(body, u)
  }


  /**
   * @param {Vector3} body
   * @param {number} u
   * @param {number} radius
   * @returns {boolean} whether the drawn arc still holds the body
   */
  _holds(body, u, radius) {
    const sp = this.span
    const k = this._segment(u)
    if (k !== sp.k || body.distanceTo(this.origin) > ORIGIN_RADII * radius) {
      return false
    }
    // Distance to the arc's segment at u.
    let q = (this._unwrap(u, sp.k) - sp.ka) * this.steps
    q = Math.min(Math.max(Math.floor(q), 0), sp.count - 2)
    const a = this._v.fromArray(this._fine, 3 * q)
    const b = this._w.fromArray(this._fine, 3 * (q + 1)).sub(a)
    const ap = a.subVectors(body, a)
    const s = Math.min(Math.max(ap.dot(b) / b.lengthSq(), 0), 1)
    return ap.distanceTo(b.multiplyScalar(s)) < CHECK_TOLERANCE * radius
  }


  /**
   * @param {number} u
   * @returns {number} the coarse segment holding u
   */
  _segment(u) {
    const n = this.n
    if (this.closed) {
      const period = n - 1
      return Math.floor(((u % period) + period) % period)
    }
    return Math.min(Math.floor(u), n - 2)
  }


  /**
   * @param {number} u
   * @param {number} k a segment
   * @returns {number} u, a whole turn on or back if that's nearer k (closed)
   */
  _unwrap(u, k) {
    if (!this.closed) {
      return u
    }
    const period = this.n - 1
    return u + (Math.round((k + 0.5 - u) / period) * period)
  }


  /**
   * @param {number} j a coarse index, any integer on a closed line
   * @param {Vector3} target
   * @returns {Vector3}
   */
  _coarseAt(j, target) {
    const period = this.n - 1
    const i = this.closed ? ((j % period) + period) % period : j
    return target.fromArray(this.coarse, 3 * i)
  }


  /**
   * Splice a fine arc around the body, bent (for an interpolated path) so
   * it passes through the body, and re-origin the line at the body.
   *
   * @param {Vector3} body
   * @param {number} u
   */
  splice(body, u) {
    const n = this.n
    const m = this.steps
    const k = this._segment(u)
    const uk = this._unwrap(u, k)
    const ka = this.closed ? k - SPAN_SIDE : Math.max(k - SPAN_SIDE, 0)
    const kb = this.closed ? k + 1 + SPAN_SIDE : Math.min(k + 1 + SPAN_SIDE, n - 1)
    // The body's offset from the curve (the interpolation's error), faded
    // out to nothing at the arc's ends so it joins the coarse line.
    const delta = new Vector3
    if (this.curve.correct) {
      delta.subVectors(body, this.curve.at(uk, this._v))
    }
    const fade = (x) => {
      if (x < k) {
        return k > ka ? (x - ka) / (k - ka) : 1
      }
      if (x > k + 1) {
        return kb > k + 1 ? (kb - x) / (kb - k - 1) : 1
      }
      return 1
    }
    const count = ((kb - ka) * m) + 1
    const out = this._fine
    const v = this._v
    for (let q = 0; q < count; q++) {
      const x = ka + (q / m)
      if (q % m === 0) {
        this._coarseAt(ka + (q / m), v)
      } else {
        this.curve.at(x, v)
      }
      v.addScaledVector(delta, fade(x)).toArray(out, 3 * q)
    }
    this.span = {k, ka, kb, count}
    this.write(body)
  }


  /**
   * Write the drawn vertices, relative to origin, and put the line there.
   *
   * @param {Vector3} origin
   */
  write(origin) {
    this.origin.copy(origin)
    const {x: ox, y: oy, z: oz} = origin
    const attr = this.line.geometry.attributes.position
    const out = attr.array
    const c = this.coarse
    let w = 0
    const put = (src, i) => {
      out[w++] = src[i] - ox
      out[w++] = src[i + 1] - oy
      out[w++] = src[i + 2] - oz
    }
    const n = this.n
    const sp = this.span
    if (!sp) {
      for (let j = 0; j < n; j++) {
        put(c, 3 * j)
      }
    } else if (this.closed) {
      // The arc, then round the rest of the ellipse back to its start.
      const period = n - 1
      for (let q = 0; q < sp.count; q++) {
        put(this._fine, 3 * q)
      }
      for (let j = sp.kb + 1; j <= sp.ka + period; j++) {
        put(c, 3 * (((j % period) + period) % period))
      }
    } else {
      for (let j = 0; j < sp.ka; j++) {
        put(c, 3 * j)
      }
      for (let q = 0; q < sp.count; q++) {
        put(this._fine, 3 * q)
      }
      for (let j = sp.kb + 1; j < n; j++) {
        put(c, 3 * j)
      }
    }
    // Upload only what's drawn.
    attr.clearUpdateRanges()
    attr.addUpdateRange(0, w)
    attr.needsUpdate = true
    const geometry = this.line.geometry
    geometry.setDrawRange(0, w / 3)
    this.line.position.copy(origin)
    if (!geometry.boundingSphere) {
      geometry.boundingSphere = new Sphere
    }
    geometry.boundingSphere.center.subVectors(this._sphere.center, origin)
    geometry.boundingSphere.radius = this._sphere.radius
  }
}


/**
 * Fine steps per coarse segment for a sag under FINE_TOLERANCE of the
 * body's radius.  An orbit of n even steps in eccentric anomaly sags by at
 * most a·Δ²/8 (Δ = 2π/(n − 1)); even in time, by up to 1/(1 − e)² more
 * at pericentre.
 *
 * @param {number} a semi-major axis, metres
 * @param {number} e eccentricity
 * @param {number} radius the body's, metres
 * @param {number} n coarse vertices
 * @returns {number}
 */
export function fineSteps(a, e, radius, n) {
  const step = 2 * Math.PI / (n - 1)
  const sag = a * step * step / (8 * (1 - e) * (1 - e))
  return Math.min(MAX_FINE_STEPS, Math.max(1, Math.ceil(Math.sqrt(sag / (FINE_TOLERANCE * radius)))))
}
