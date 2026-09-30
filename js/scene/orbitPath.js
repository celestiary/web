import {Quaternion, Vector3} from 'three'
import {ASTRO_UNIT_METER} from '../shared.js'
import {BodyLine, fineSteps} from './bodyLine.js'
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
// Once built, a line is never hidden.  A path's shape changes over decades
// to millennia, so the last line stays a good picture while the next one is
// built, even when the date runs faster than rebuilds finish (a high time
// rate, where hiding a line whose window had passed its body made it
// flicker) or has jumped.  A rebuild writes a scratch array and copies it
// into the geometry in one step when it's done, so a part-built line is
// never drawn.
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
// curve; the interpolation stays within that too (orbitPath.test.js).  Close
// up that's still up to 0.8 of Neptune's radius, so the line is drawn
// through a BodyLine (bodyLine.js): a fine arc of the same curve around the
// body, bent onto the body's own position, and float32 made exact near it.


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
 * And while the line being built doesn't hold its body at the latest date
 * (its first build, a jump, or a time rate faster than rebuilds), so it
 * catches up sooner.
 */
export const CATCH_UP_BUDGET_MS = 12

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
   * @param {number} [opts.a] the orbit's semi-major axis, metres, and
   * @param {number} [opts.e] its eccentricity, and
   * @param {number} [opts.radius] the body's radius, metres: for the fine
   *     arc drawn around the body (bodyLine.js)
   */
  constructor(line, {positionAt, periodDays, mu = 0, offsetAt = null, samples = SPARSE_SAMPLES,
    a = 0, e = 0, radius = 0}) {
    this.line = line
    this.positionAt = positionAt
    this.periodDays = periodDays
    this.mu = mu
    this.offsetAt = offsetAt
    this.samples = samples
    this.radius = radius
    /** The Julian Day the line is centred on, or null before the first build. */
    this.centre = null
    /** Half the drawn window, days. */
    this.halfWindow = 0
    /** The coarse index of a date on the built line; null before it. */
    this.paramAt = null
    const n = line.geometry.attributes.position.count
    /** The drawn line: coarse, fine arc, origin. */
    this.drawn = new BodyLine(line, {n})
    this._fineSteps = radius > 0 && a > 0 ? fineSteps(a, e, radius, n) : 1
    this._scratch = new Float64Array(3 * n)
    this._mid = new Vector3
    // The body as last followed, to splice a new build around at once.
    this._body = new Vector3
    this._bodyJd = NaN
  }


  /**
   * Keep the drawn line through the body at jd (bodyLine.js).
   *
   * @param {number} jd Julian Day (UTC)
   * @param {Vector3} body its position in the line's frame (the ecliptic of
   *     J2000, relative to the primary), metres
   */
  follow(jd, body) {
    this._bodyJd = jd
    this._body.copy(body)
    if (this.paramAt && this.radius > 0) {
      this.drawn.follow(body, this.paramAt(jd), this.radius)
    }
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
    if (!Number.isFinite(jd)) {
      return
    }
    const out = this._scratch
    const built = yield* (this.mu ? this._sparse(jd, out) : this._direct(jd, out))
    // An ephemeris evaluated where it isn't defined: keep the last line.
    if (!allFinite(out)) {
      return
    }
    // The whole line at once, so a part-built one is never drawn.
    const n = out.length / 3
    const mid = this._mid.fromArray(out, 3 * Math.floor(n / 2))
    this.drawn.setCoarse(out, {at: built.at, correct: true}, this._fineSteps, mid)
    this.paramAt = built.paramAt
    this.centre = jd
    this.halfWindow = built.halfWindow
    // Around the body at once, not a frame later.
    if (Number.isFinite(this._bodyJd)) {
      this.follow(this._bodyJd, this._body)
    }
    // Hidden only until its first build (Animation.newOrbitPath).
    this.line.visible = true
  }


  /**
   * Every vertex the ephemeris at its time, evenly over one period.
   *
   * @param {number} jd centre
   * @param {Float64Array} out
   * @yields {undefined}
   * @returns {object} {halfWindow, at, paramAt}: the half window, days; the
   *     curve at a coarse index (fractional); and a date's coarse index
   */
  * _direct(jd, out) {
    const n = out.length / 3
    const period = this.periodDays
    const t0 = jd - (period / 2)
    const at = (u, target) => {
      const t = t0 + (period * u / (n - 1))
      return ofDateToJ2000(t, this.positionAt(t, target))
    }
    const v = new Vector3
    for (let j = 0; j < n; j++) {
      at(j, v).toArray(out, 3 * j)
      if (j % VERTICES_PER_STEP === VERTICES_PER_STEP - 1) {
        yield
      }
    }
    return {halfWindow: period / 2, at, paramAt: (t) => (t - t0) * (n - 1) / period}
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
   * @param {Float64Array} out
   * @yields {undefined}
   * @returns {object} as _direct's
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
    // time without an ellipse).  The fine arc drawn around the body is the
    // same curve, at fractional indices.
    const n = out.length / 3
    const halfTurn = el ? el.n * period / 2 : 0
    const eStart = el ? eccentricAnomaly(el.m0 - halfTurn, el.e) : 0
    const eSpan = el ? eccentricAnomaly(el.m0 + halfTurn, el.e) - eStart : 0
    const dep = new Vector3
    const off = new Vector3
    const curveAt = (u, v) => {
      let t
      if (el) {
        const E = eStart + (eSpan * u / (n - 1))
        t = jd + ((E - (el.e * Math.sin(E)) - el.m0) / el.n)
        ellipseAtAnomaly(el, E, v)
      } else {
        t = t0 + (period * u / (n - 1))
        v.set(0, 0, 0)
      }
      v.add(lagrange4(departures, (t - t0) / step, dep))
      if (this.offsetAt) {
        v.add(ofDateToJ2000(t, this.offsetAt(t, off)))
      }
      return v
    }
    const paramAt = (t) => {
      if (!el) {
        return (t - t0) * (n - 1) / period
      }
      return (eccentricAnomaly(el.m0 + (el.n * (t - jd)), el.e) - eStart) * (n - 1) / eSpan
    }
    const v = new Vector3
    for (let j = 0; j < n; j++) {
      curveAt(j, v).toArray(out, 3 * j)
      if (j % VERTICES_PER_STEP === VERTICES_PER_STEP - 1) {
        yield
      }
    }
    return {halfWindow: period / 2, at: curveAt, paramAt}
  }
}


/**
 * @param {Float64Array} xyz
 * @returns {boolean} whether every value is finite
 */
function allFinite(xyz) {
  for (let j = 0; j < xyz.length; j++) {
    if (!Number.isFinite(xyz[j])) {
      return false
    }
  }
  return true
}


/**
 * The rebuilds waiting, run a slice at a time within a per-frame budget,
 * always for the latest date asked.
 */
export class OrbitPaths {
  /** */
  constructor() {
    this.queue = []
    this.job = null
    /** Milliseconds of rebuilding per pump; Infinity finishes every rebuild. */
    this.budgetMs = FRAME_BUDGET_MS
    /** The budget while the next line doesn't hold its body (see above). */
    this.catchUpBudgetMs = CATCH_UP_BUDGET_MS
    /** The last complete rebuild's duration, ms of work, for diagnostics. */
    this.lastBuildMs = 0
    /** Milliseconds, for the budget; tests set a deterministic one. */
    this.clock = performance.now.bind(performance)
  }


  /**
   * Queue a path's rebuild for jd, the latest date.  A queued one takes
   * the new date.  One already building carries on, unless its window
   * won't hold jd (a jump), when it starts over for jd, once: a date that
   * keeps running ahead of the rebuild (a high time rate) would otherwise
   * restart it every frame, and it would never finish.  After it finishes,
   * Animation asks again for the date then.
   *
   * @param {OrbitPath} path
   * @param {number} jd Julian Day (UTC)
   */
  request(path, jd) {
    if (!Number.isFinite(jd)) {
      return
    }
    path.pendingJd = jd
    const job = this.job
    if (job && job.path === path) {
      if (!job.retargeted && Math.abs(jd - job.jd) > path.periodDays / 2) {
        this.job = this.newJob(path, true)
      }
    } else if (!this.queue.includes(path)) {
      this.queue.push(path)
    }
  }


  /**
   * @param {OrbitPath} path
   * @param {boolean} retargeted
   * @returns {object} a rebuild of path for its pendingJd
   */
  newJob(path, retargeted) {
    const jd = path.pendingJd
    return {path, jd, it: path.build(jd), ms: 0, retargeted}
  }


  /**
   * Run queued rebuilds until the budget is spent: budgetMs, or
   * catchUpBudgetMs while the next line doesn't hold its body at the
   * latest date.  A queued rebuild the date no longer needs (time turned
   * back into the line's window) is dropped.
   *
   * @param {number} [budgetMs]
   */
  pump(budgetMs) {
    if (budgetMs === undefined) {
      const next = this.job ? this.job.path : this.queue[0]
      const catchUp = next && !next.covers(next.pendingJd)
      budgetMs = catchUp ? Math.max(this.budgetMs, this.catchUpBudgetMs) : this.budgetMs
    }
    const start = this.clock()
    while ((this.job || this.queue.length > 0) && this.clock() - start < budgetMs) {
      if (!this.job) {
        const path = this.queue[0]
        if (!path.isStale(path.pendingJd)) {
          this.queue.shift()
          continue
        }
        this.job = this.newJob(path, false)
      }
      const sliceStart = this.clock()
      const done = this.job.it.next().done
      this.job.ms += this.clock() - sliceStart
      if (done) {
        this.lastBuildMs = this.job.ms
        this.queue.shift()
        this.job = null
      }
    }
  }
}
