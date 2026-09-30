import {Quaternion, Vector3} from 'three'
import {ASTRO_UNIT_METER} from '../shared.js'
import {J2000_JD, precessionQuaternion, utcToTtJulianDay} from './celestialFrame.js'
import {eccentricAnomaly} from './meanElements.js'


// Orbit lines drawn from each body's own ephemeris, so that the body sits
// on its line.  A line is one orbital period of the body's path relative to
// its primary, centred on the simulation date and open at the far end
// (a perturbed path doesn't close), laid in the ecliptic of J2000: Animation
// turns the line's group by the same J2000 → date precession as everything
// else each frame, so the line needn't be rebuilt for precession.  It's
// rebuilt when the date has moved by REBUILD_FRACTION of a period (or
// jumped), a few samples at a time, off the per-frame path: OrbitPaths.
//
// Two ways to sample (OrbitPath):
// - Direct: every vertex is the ephemeris at its time.  For cheap
//   ephemerides, the Moon's (lunarTheory.js, ~10 µs).
// - Sparse: VSOP87C evaluates every planet in every call, ~2 ms, so a few
//   hundred samples for eight planets would be seconds.  Instead a
//   two-body ellipse osculating the path at the centre date carries the
//   shape, and the ephemeris is sampled at SPARSE_SAMPLES + 1 even times
//   over the period (more for the giants, below) only for its
//   departure from that ellipse: the perturbations and the Sun's own
//   wobble, small and smooth.  Each vertex is the ellipse at its time plus
//   the departure, interpolated (four-point Lagrange).  Vertices are even
//   in eccentric anomaly, so the chords stay short at perihelion.  A known
//   fast wobble can be taken out before interpolating and added back per
//   vertex (`offsetAt`): Earth's monthly ~4,700 km about the Earth-Moon
//   barycentre, which 17 samples a year would alias.
//
// A 1000-segment line's chords are within 5e-6 of the orbit's size of the
// curve; the interpolation stays within that too (orbitPath.test.js).


/** Vertices in an orbit line (as the old ellipse had). */
export const ORBIT_LINE_POINTS = 1001

/** A line is rebuilt when the date has moved this fraction of its period. */
export const REBUILD_FRACTION = 1 / 50

/**
 * Intervals at which a sparse path samples its ephemeris, at least: enough
 * for the terrestrial planets, whose departures are slow.
 */
export const SPARSE_SAMPLES = 16

/**
 * For Jupiter and Saturn, which perturb each other most: their departures
 * go through a few cycles a revolution (harmonics of their synodic
 * period), and 16 samples leave them 1.4e-5 of the orbit off.
 */
export const JUPITER_SATURN_SAMPLES = 32

// And at most this far apart: the heliocentric paths carry the Sun's own
// wobble about the barycentre, mostly Jupiter's pull (~0.005 AU, one cycle
// per Jupiter year), fourteen cycles in Neptune's period.  Eight samples a
// cycle interpolate it within ~1e-6 of Neptune's orbit.
const JUPITER_PERIOD_DAYS = 4332.59
const SAMPLES_PER_JUPITER_PERIOD = 8

/**
 * The Sun's GM, k² in AU³/day², in m³/day²: the two-body ellipse is only a
 * carrier for the samples, so the planets' own masses are left out.
 */
export const SUN_GM_M3_PER_DAY2 = 2.9591220828559e-4 * (ASTRO_UNIT_METER ** 3)

/** The fraction of a period for the centre's finite-difference velocity. */
const VELOCITY_STEP = 1e-3

/** Direct samples, or vertices, per slice of a build (between yields). */
const VERTICES_PER_STEP = 64

/** Per-frame time for OrbitPaths.pump, ms. */
export const FRAME_BUDGET_MS = 4

/**
 * And while the line being built isn't drawn (at load, or after a jump in
 * time), so the lines come back sooner.
 */
export const HIDDEN_BUDGET_MS = 12

const TWO_PI = 2 * Math.PI
const LAGRANGE_POINTS = 4


/**
 * A unit ellipse (semi-major axis 1) centred on the origin, major axis
 * along +X, in the XZ plane: the line Planet.newOrbit starts with and
 * Animation.layOrbitShape places on a mean-element orbit.
 *
 * @param {number} e eccentricity
 * @param {Float32Array} out ORBIT_LINE_POINTS × 3
 * @returns {Float32Array} out
 */
export function unitEllipse(e, out) {
  const b = Math.sqrt(1 - (e * e))
  const n = out.length / 3
  for (let j = 0; j < n; j++) {
    const E = TWO_PI * j / (n - 1)
    out[3 * j] = Math.cos(E)
    out[(3 * j) + 1] = 0
    out[(3 * j) + 2] = b * Math.sin(E)
  }
  return out
}


/**
 * The two-body ellipse through a position with a velocity, or null if
 * they don't make one (e.g. a stand-in ephemeris that doesn't move).
 *
 * @param {Vector3} r position, metres
 * @param {Vector3} v velocity, metres per day
 * @param {number} mu GM, m³/day²
 * @returns {object|null} {a, e, n, m0, p, q}: n in radians per day, m0 the
 *     mean anomaly at r, p and q unit vectors toward pericentre and 90°
 *     ahead in the orbit plane
 */
export function osculatingEllipse(r, v, mu) {
  const rLen = r.length()
  const a = 1 / ((2 / rLen) - (v.lengthSq() / mu))
  const h = new Vector3().crossVectors(r, v)
  // e = (v × h) / μ - r / |r|
  const eVec = new Vector3().crossVectors(v, h).divideScalar(mu).addScaledVector(r, -1 / rLen)
  const e = eVec.length()
  if (!(a > 0) || !(e < 1) || !(h.lengthSq() > 0)) {
    return null
  }
  const w = h.normalize()
  const p = e > 1e-12 ? eVec.divideScalar(e) : r.clone().normalize()
  const q = new Vector3().crossVectors(w, p)
  const b = a * Math.sqrt(1 - (e * e))
  const E0 = Math.atan2(r.dot(q) / b, (r.dot(p) / a) + e)
  return {a, e, b, n: Math.sqrt(mu / (a * a * a)), m0: E0 - (e * Math.sin(E0)), p, q}
}


/**
 * A point on an osculatingEllipse at eccentric anomaly E.
 *
 * @param {object} el osculatingEllipse
 * @param {number} E radians
 * @param {Vector3} target
 * @returns {Vector3}
 */
function ellipseAtAnomaly(el, E, target) {
  return target.copy(el.p).multiplyScalar(el.a * (Math.cos(E) - el.e)).addScaledVector(el.q, el.b * Math.sin(E))
}


/**
 * Four-point Lagrange interpolation of evenly spaced vectors.
 *
 * @param {Array<Vector3>} ys samples at u = 0, 1, …, ys.length - 1
 * @param {number} u where, in sample steps
 * @param {Vector3} target
 * @returns {Vector3}
 */
export function lagrange4(ys, u, target) {
  const j = Math.min(Math.max(Math.floor(u) - 1, 0), ys.length - LAGRANGE_POINTS)
  const s = u - j
  const w0 = -(s - 1) * (s - 2) * (s - 3) / 6
  const w1 = s * (s - 2) * (s - 3) / 2
  const w2 = -s * (s - 1) * (s - 3) / 2
  const w3 = s * (s - 1) * (s - 2) / 6
  return target.copy(ys[j]).multiplyScalar(w0)
      .addScaledVector(ys[j + 1], w1)
      .addScaledVector(ys[j + 2], w2)
      .addScaledVector(ys[j + 3], w3)
}


const tmpQuat = new Quaternion


/**
 * A position in the scene frame of a date (the ecliptic of date) turned
 * into the ecliptic of J2000: the inverse of the rotation Animation.setDate
 * applies for that date, exactly.
 *
 * @param {number} jd Julian Day (UTC)
 * @param {Vector3} v in place
 * @returns {Vector3} v
 */
export function ofDateToJ2000(jd, v) {
  return v.applyQuaternion(precessionQuaternion(J2000_JD, utcToTtJulianDay(jd), tmpQuat).invert())
}


/**
 * One body's orbit line, and how to rebuild it.
 */
export class OrbitPath {
  /**
   * @param {object} line a three Line; its geometry's positions are rewritten
   * @param {object} opts
   * @param {function(number, Vector3): Vector3} opts.positionAt the body's
   *     position relative to its primary at a Julian Day (UTC), in the scene
   *     frame of that date, metres
   * @param {number} opts.periodDays the body's orbital period
   * @param {number} [opts.mu] GM of the primary, m³/day²; given, the path is
   *     sparse (see above), else direct
   * @param {function(number, Vector3): Vector3} [opts.offsetAt] a sparse
   *     path's fast wobble, of date, left out of positionAt and added back
   * @param {number} [opts.samples] a sparse path's samples a period, at least
   */
  constructor(line, {positionAt, periodDays, mu = 0, offsetAt = null, samples = SPARSE_SAMPLES}) {
    this.line = line
    this.positionAt = positionAt
    this.periodDays = periodDays
    this.mu = mu
    this.offsetAt = offsetAt
    this.samples = samples
    /** The Julian Day the line is centred on, or null before the first build. */
    this.centre = null
    /** Half the drawn window, days. */
    this.halfWindow = 0
    this._scratch = new Float32Array(line.geometry.attributes.position.array.length)
  }


  /**
   * @param {number} jd Julian Day (UTC)
   * @returns {boolean} whether the built line holds the body at jd
   */
  covers(jd) {
    return this.centre !== null && Math.abs(jd - this.centre) <= this.halfWindow
  }


  /**
   * @param {number} jd Julian Day (UTC)
   * @returns {boolean} whether the line wants rebuilding for jd
   */
  isStale(jd) {
    return this.centre === null || Math.abs(jd - this.centre) > this.periodDays * REBUILD_FRACTION
  }


  /**
   * Rebuild the line centred on jd, a slice at a time: a generator that
   * yields after each expensive step, and writes the line when done.
   *
   * @param {number} jd Julian Day (UTC)
   * @yields {undefined}
   */
  * build(jd) {
    const out = this._scratch
    const halfWindow = yield* (this.mu ? this._sparse(jd, out) : this._direct(jd, out))
    const attr = this.line.geometry.attributes.position
    attr.array.set(out)
    attr.needsUpdate = true
    this.line.geometry.computeBoundingSphere()
    this.centre = jd
    this.halfWindow = halfWindow
    // Animation hides it again next frame if the date has left the window.
    this.line.visible = true
  }


  /**
   * Every vertex the ephemeris at its time, evenly over one period.
   *
   * @param {number} jd centre
   * @param {Float32Array} out
   * @yields {undefined}
   * @returns {number} the half window
   */
  * _direct(jd, out) {
    const n = out.length / 3
    const period = this.periodDays
    const v = new Vector3
    for (let j = 0; j < n; j++) {
      const t = jd + (period * ((j / (n - 1)) - 0.5))
      ofDateToJ2000(t, this.positionAt(t, v)).toArray(out, 3 * j)
      if (j % VERTICES_PER_STEP === VERTICES_PER_STEP - 1) {
        yield
      }
    }
    return period / 2
  }


  /**
   * The ephemeris (without any offsetAt wobble) in the ecliptic of J2000.
   *
   * @param {number} t Julian Day (UTC)
   * @param {Vector3} target
   * @returns {Vector3}
   */
  _sample(t, target) {
    this.positionAt(t, target)
    return ofDateToJ2000(t, target)
  }


  /**
   * The two-body ellipse plus the interpolated departure from it.
   *
   * @param {number} jd centre
   * @param {Float32Array} out
   * @yields {undefined}
   * @returns {number} the half window
   */
  * _sparse(jd, out) {
    // The osculating ellipse at the centre, from a central difference.
    const dt = this.periodDays * VELOCITY_STEP
    const r0 = this._sample(jd, new Vector3)
    yield
    const vel = this._sample(jd + dt, new Vector3)
    yield
    vel.sub(this._sample(jd - dt, new Vector3)).divideScalar(2 * dt)
    yield
    // The window is the body's mean sidereal period, not the osculating
    // one: the Sun's wobble (Jupiter's pull) is in the heliocentric
    // velocity, and puts Neptune's osculating period off by ~1%.
    const el = osculatingEllipse(r0, vel, this.mu)
    const period = this.periodDays
    const t0 = jd - (period / 2)
    const count = 2 * Math.ceil(Math.max(this.samples, period * SAMPLES_PER_JUPITER_PERIOD / JUPITER_PERIOD_DAYS) / 2)
    const step = period / count
    const ref = new Vector3
    const at = (t, target) => {
      if (!el) {
        return target.set(0, 0, 0)
      }
      const E = eccentricAnomaly(el.m0 + (el.n * (t - jd)), el.e)
      return ellipseAtAnomaly(el, E, target)
    }
    // The departures, at even times over the period.
    const departures = []
    for (let k = 0; k <= count; k++) {
      const t = t0 + (k * step)
      departures.push(k === count / 2 ? r0.clone() : this._sample(t, new Vector3))
      departures[k].sub(at(t, ref))
      yield
    }
    // Vertices even in the ellipse's eccentric anomaly over the window (in
    // time without an ellipse).
    const n = out.length / 3
    const halfTurn = el ? el.n * period / 2 : 0
    const eStart = el ? eccentricAnomaly(el.m0 - halfTurn, el.e) : 0
    const eSpan = el ? eccentricAnomaly(el.m0 + halfTurn, el.e) - eStart : 0
    const v = new Vector3
    const off = new Vector3
    for (let j = 0; j < n; j++) {
      let t
      if (el) {
        const E = eStart + (eSpan * j / (n - 1))
        t = jd + ((E - (el.e * Math.sin(E)) - el.m0) / el.n)
        ellipseAtAnomaly(el, E, v)
      } else {
        t = t0 + (period * j / (n - 1))
        v.set(0, 0, 0)
      }
      v.add(lagrange4(departures, (t - t0) / step, ref))
      if (this.offsetAt) {
        v.add(ofDateToJ2000(t, this.offsetAt(t, off)))
      }
      v.toArray(out, 3 * j)
      if (j % VERTICES_PER_STEP === VERTICES_PER_STEP - 1) {
        yield
      }
    }
    return period / 2
  }
}


/**
 * The rebuilds waiting, run a slice at a time within a per-frame budget.
 */
export class OrbitPaths {
  /** */
  constructor() {
    this.queue = []
    this.job = null
    /** Milliseconds of rebuilding per pump; Infinity finishes every rebuild. */
    this.budgetMs = FRAME_BUDGET_MS
    /** The budget while the line being built is hidden. */
    this.hiddenBudgetMs = HIDDEN_BUDGET_MS
    /** The last complete rebuild's duration, ms of work, for diagnostics. */
    this.lastBuildMs = 0
  }


  /**
   * Queue a path's rebuild for jd.  A queued one takes the new date; one
   * already building carries on, unless its window won't hold jd (a jump),
   * when it starts over.
   *
   * @param {OrbitPath} path
   * @param {number} jd Julian Day (UTC)
   */
  request(path, jd) {
    if (this.job && this.job.path === path) {
      if (Math.abs(jd - path.pendingJd) > path.periodDays / 2) {
        path.pendingJd = jd
        this.job = null
      }
    } else if (this.queue.includes(path)) {
      path.pendingJd = jd
    } else {
      path.pendingJd = jd
      this.queue.push(path)
    }
  }


  /**
   * Run queued rebuilds until the budget is spent: budgetMs, or
   * hiddenBudgetMs while the next line to build isn't drawn.
   *
   * @param {number} [budgetMs]
   */
  pump(budgetMs) {
    if (budgetMs === undefined) {
      const next = this.job ? this.job.path : this.queue[0]
      budgetMs = (next && !next.line.visible) ? Math.max(this.budgetMs, this.hiddenBudgetMs) : this.budgetMs
    }
    const start = performance.now()
    while ((this.job || this.queue.length > 0) && performance.now() - start < budgetMs) {
      if (!this.job) {
        const path = this.queue[0]
        this.job = {path, it: path.build(path.pendingJd), ms: 0}
      }
      const sliceStart = performance.now()
      const done = this.job.it.next().done
      this.job.ms += performance.now() - sliceStart
      if (done) {
        this.lastBuildMs = this.job.ms
        this.queue.shift()
        this.job = null
      }
    }
  }
}
