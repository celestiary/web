/**
 * Two-body (Kepler) orbit tools for heliocentric trajectories.
 *
 * Everything is SI: meters, seconds, radians.  Vectors are plain [x, y, z]
 * arrays in the heliocentric ecliptic J2000 frame, so this module has no
 * three.js dependency and runs unchanged under `bun test`.
 *
 * Lambert's problem is craft/lambert.js's, shared with the cislunar
 * transfers (Craft.md).
 *
 * An orbit is described by its shape (a, e), the epoch of a perihelion
 * passage (tPeri), and two unit vectors rather than the three classical
 * angles: `periDir` points from the focus to perihelion and `alongDir` is 90
 * degrees ahead of it in the direction of motion.  That avoids the node and
 * perihelion singularities of circular and near-ecliptic orbits, both of
 * which this mission uses.
 */

// https://en.wikipedia.org/wiki/Standard_gravitational_parameter
export const GM_SUN = 1.32712440018e20
export const GM_VENUS = 3.24859e14
// https://en.wikipedia.org/wiki/Astronomical_unit
export const AU = 149597870700
// IAU 2015 nominal solar radius.  PSP's quoted "9.86 solar radii" uses this.
export const R_SUN = 6.957e8
export const R_VENUS = 6.0518e6
export const DAY = 86400
export const TWO_PI = Math.PI * 2


export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s]
export const dot = (a, b) => (a[0] * b[0]) + (a[1] * b[1]) + (a[2] * b[2])
export const cross = (a, b) => [
  (a[1] * b[2]) - (a[2] * b[1]),
  (a[2] * b[0]) - (a[0] * b[2]),
  (a[0] * b[1]) - (a[1] * b[0]),
]
export const norm = (a) => Math.sqrt(dot(a, a))
export const unit = (a) => scale(a, 1 / norm(a))


/**
 * Solve Kepler's equation E - e sin E = M for an elliptic orbit.
 *
 * Newton's method started at E = pi converges for every M in [0, pi] and
 * every e in [0, 1), which matters here: the sun-grazing legs have e > 0.9,
 * where the usual E = M start can diverge.  Negative M uses the odd symmetry.
 *
 * @param {number} M Mean anomaly, any range
 * @param {number} e Eccentricity in [0, 1)
 * @returns {number} Eccentric anomaly in [-pi, pi]
 */
export function solveKepler(M, e) {
  let m = M % TWO_PI
  if (m > Math.PI) {
    m -= TWO_PI
  } else if (m < -Math.PI) {
    m += TWO_PI
  }
  const sign = m < 0 ? -1 : 1
  m = Math.abs(m)
  let E = e < 0.5 ? m : Math.PI
  for (let i = 0; i < 100; i++) {
    const d = (E - (e * Math.sin(E)) - m) / (1 - (e * Math.cos(E)))
    E -= d
    if (Math.abs(d) < 1e-14) {
      break
    }
  }
  return sign * E
}


/** @returns {number} Orbital period for semi-major axis a */
export function periodOf(a, gm = GM_SUN) {
  return TWO_PI * Math.sqrt((a * a * a) / gm)
}


/** @returns {number} Semi-major axis for an orbital period */
export function semiMajorAxisOf(period, gm = GM_SUN) {
  return Math.cbrt(gm * Math.pow(period / TWO_PI, 2))
}


/** @returns {number} Speed at distance r on an orbit of semi-major axis a (vis-viva) */
export function visViva(r, a, gm = GM_SUN) {
  return Math.sqrt(gm * ((2 / r) - (1 / a)))
}


/** @returns {number} Circular orbit speed at distance r */
export function circularSpeed(r, gm = GM_SUN) {
  return Math.sqrt(gm / r)
}


/**
 * Build an orbit from its apsides (or one apsis and a period) and its
 * orientation.
 *
 * @param {object} p
 * @param {number} p.periapsis Perihelion distance from the focus
 * @param {number} [p.apoapsis] Aphelion distance; give this or `period`
 * @param {number} [p.period] Orbital period; give this or `apoapsis`
 * @param {number} p.tPeri Time of a perihelion passage, seconds
 * @param {Array<number>} p.periDir Unit vector toward perihelion
 * @param {Array<number>} p.normal Unit orbit normal (angular momentum direction)
 * @param {number} [p.gm]
 * @returns {object} orbit
 */
export function makeOrbit({periapsis, apoapsis, period, tPeri, periDir, normal, gm = GM_SUN}) {
  const a = apoapsis === undefined ? semiMajorAxisOf(period, gm) : (periapsis + apoapsis) / 2
  const e = 1 - (periapsis / a)
  if (!(e >= 0 && e < 1)) {
    throw new Error(`makeOrbit: not an ellipse, e=${e}`)
  }
  const p = unit(periDir)
  const h = unit(normal)
  return {
    a,
    e,
    tPeri,
    periDir: p,
    alongDir: unit(cross(h, p)),
    normal: h,
    gm,
    period: periodOf(a, gm),
    periapsis,
    apoapsis: a * (1 + e),
  }
}


/**
 * Build the orbit through a state vector.
 *
 * @param {Array<number>} r Position
 * @param {Array<number>} v Velocity
 * @param {number} t Time of the state, seconds
 * @param {number} [gm]
 * @returns {object} orbit
 */
export function orbitFromState(r, v, t, gm = GM_SUN) {
  const rm = norm(r)
  const h = cross(r, v)
  const eVec = sub(scale(cross(v, h), 1 / gm), scale(r, 1 / rm))
  const e = norm(eVec)
  const a = 1 / ((2 / rm) - (dot(v, v) / gm))
  if (!(a > 0 && e < 1)) {
    throw new Error(`orbitFromState: not an ellipse, a=${a} e=${e}`)
  }
  const E = Math.atan2(dot(r, v) / Math.sqrt(gm * a), 1 - (rm / a))
  const M = E - (e * Math.sin(E))
  const period = periodOf(a, gm)
  // A circular orbit has no perihelion; measure anomaly from the state itself.
  const periDir = e > 1e-9 ? unit(eVec) : unit(r)
  return makeOrbit({
    periapsis: a * (1 - e),
    apoapsis: a * (1 + e),
    tPeri: t - ((M / TWO_PI) * period),
    periDir,
    normal: unit(h),
    gm,
  })
}


/**
 * Position and velocity on an orbit at a time.
 *
 * @param {object} orbit From makeOrbit or orbitFromState
 * @param {number} t Seconds
 * @returns {{r: Array<number>, v: Array<number>, dist: number, speed: number, trueAnomaly: number}}
 */
export function orbitState(orbit, t) {
  const {a, e, tPeri, periDir, alongDir, gm, period} = orbit
  const M = ((t - tPeri) / period) * TWO_PI
  const E = solveKepler(M, e)
  const cosE = Math.cos(E)
  const sinE = Math.sin(E)
  const b = Math.sqrt(1 - (e * e))
  const dist = a * (1 - (e * cosE))
  const x = a * (cosE - e)
  const y = a * b * sinE
  const k = Math.sqrt(gm * a) / dist
  const vx = -k * sinE
  const vy = k * b * cosE
  return {
    r: add(scale(periDir, x), scale(alongDir, y)),
    v: add(scale(periDir, vx), scale(alongDir, vy)),
    dist,
    speed: Math.hypot(vx, vy),
    trueAnomaly: Math.atan2(b * sinE, cosE - e),
  }
}


/**
 * Times along an orbit spaced evenly in eccentric anomaly, for drawing: a
 * sun-grazing ellipse sampled evenly in time is a polygon at perihelion,
 * where it moves fastest and bends most.
 *
 * @param {object} orbit From makeOrbit or orbitFromState
 * @param {number} t0 Seconds
 * @param {number} t1 Seconds, > t0; at most one revolution is returned
 * @param {number} n Intervals
 * @returns {Array<number>} n + 1 times from t0, increasing
 */
export function sampleTimes(orbit, t0, t1, n) {
  const {e, tPeri, period} = orbit
  const anomalyAt = (t) => {
    const M = ((t - tPeri) / period) * TWO_PI
    const k = Math.floor((M + Math.PI) / TWO_PI)
    return solveKepler(M - (k * TWO_PI), e) + (k * TWO_PI)
  }
  const E0 = anomalyAt(t0)
  const E1 = t1 - t0 >= period ? E0 + TWO_PI : anomalyAt(t1)
  const times = []
  for (let i = 0; i <= n; i++) {
    const E = E0 + (((E1 - E0) * i) / n)
    times.push(tPeri + (((E - (e * Math.sin(E))) / TWO_PI) * period))
  }
  times[0] = t0
  return times
}
