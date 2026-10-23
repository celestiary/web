import Measure from '@pablo-mayrgundter/measure.js'
import {Vector3} from 'three'


// The space around a pair of bodies, a primary and a secondary that orbits
// it (the Sun and a planet, a planet and a moon, Pluto and Charon): the five
// Lagrange points of the circular restricted three-body problem, the
// secondary's Hill sphere, and its synchronous orbit (Lagrange.md; #272).
//
// The points are in the pair's own frame, in units of the distance between
// the two: the primary at the origin, the secondary at (1, 0), +y the way
// the secondary moves.  The scene places them on the pair's line of the
// moment, scaled by its separation of the moment (the "pulsating" frame), so
// they follow the real, eccentric, perturbed orbits the ephemerides draw.


/** Newton's constant, m³ kg⁻¹ s⁻² (CODATA 2018). */
export const G = 6.6743e-11
export const POINT_NAMES = ['L1', 'L2', 'L3', 'L4', 'L5']
const NEWTON_ITERATIONS = 50
const NEWTON_TOLERANCE = 1e-15
const HALF_SQRT3 = Math.sqrt(3) / 2


/**
 * The collinear points' distances, the roots of Szebehely's quintics in the
 * mass ratio (Theory of Orbits, 1967, §4.5), by Newton's method from the
 * Hill approximations.
 *
 * @param {number} mu the secondary's share of the mass, m / (M + m), in (0, 0.5]
 * @returns {{l1: number, l2: number, l3: number}} L1 and L2 from the
 *     secondary, toward and away from the primary, and L3 from the primary
 *     on the far side, in units of the separation
 */
export function collinearDistances(mu) {
  const hill = Math.cbrt(mu / 3)
  const m = 1 - mu
  return {
    l1: newton(hill, [1, -(3 - mu), 3 - (2 * mu), -mu, 2 * mu, -mu]),
    l2: newton(hill, [1, 3 - mu, 3 - (2 * mu), -mu, -2 * mu, -mu]),
    l3: newton(1 - (7 * mu / 12), [1, 2 + mu, 1 + (2 * mu), -m, -2 * m, -m]),
  }
}


/**
 * A root of a polynomial by Newton's method.
 *
 * @param {number} x0 the start
 * @param {Array<number>} coeffs highest power first
 * @returns {number} the root
 */
function newton(x0, coeffs) {
  let x = x0
  for (let k = 0; k < NEWTON_ITERATIONS; k++) {
    // Horner's rule, for the value and the derivative together.
    let v = 0
    let d = 0
    for (const c of coeffs) {
      d = (d * x) + v
      v = (v * x) + c
    }
    const dx = v / d
    x -= dx
    if (Math.abs(dx) <= NEWTON_TOLERANCE * Math.abs(x)) {
      break
    }
  }
  return x
}


/**
 * The five points in the pair's frame: the primary at the origin, the
 * secondary at (1, 0), +y its direction of motion.  L4 leads the secondary
 * by 60°, L5 trails it.
 *
 * @param {number} mu m / (M + m)
 * @returns {Array<{name: string, x: number, y: number}>}
 */
export function lagrangePoints(mu) {
  const {l1, l2, l3} = collinearDistances(mu)
  return [
    {name: 'L1', x: 1 - l1, y: 0},
    {name: 'L2', x: 1 + l2, y: 0},
    {name: 'L3', x: -l3, y: 0},
    {name: 'L4', x: 0.5, y: HALF_SQRT3},
    {name: 'L5', x: 0.5, y: -HALF_SQRT3},
  ]
}


/**
 * The points placed on the pair as it is: along the secondary's place r
 * from the primary, scaled by |r|, and in its orbit's plane, the side of
 * motion given by the orbit's pole (r × v).
 *
 * @param {Array<{x: number, y: number}>} points lagrangePoints()
 * @param {Vector3} r the secondary's place relative to the primary
 * @param {Vector3} pole the orbit's pole, r × v (any length)
 * @param {Array<Vector3>} [targets] receive the places; made if absent
 * @returns {Array<Vector3>}
 */
export function placePoints(points, r, pole, targets = points.map(() => new Vector3)) {
  const d = r.length()
  const along = tmpAlong.copy(r).divideScalar(d)
  const ahead = tmpAhead.crossVectors(pole, along).normalize()
  points.forEach((p, k) => {
    targets[k].copy(along).multiplyScalar(p.x * d).addScaledVector(ahead, p.y * d)
  })
  return targets
}
const tmpAlong = new Vector3
const tmpAhead = new Vector3


/**
 * The radius of the secondary's Hill sphere, where its gravity rules over
 * the primary's tide, at its pericentre: a (1 − e) ∛(μ / 3).  Moons stay
 * well inside it, within about half to a third of it.
 *
 * @param {number} a semi-major axis, metres
 * @param {number} e eccentricity
 * @param {number} mu m / (M + m)
 * @returns {number} metres
 */
export function hillRadius(a, e, mu) {
  return a * (1 - e) * Math.cbrt(mu / 3)
}


/**
 * The radius of the circular orbit whose period is the body's day:
 * ∛(GM P² / 4π²).
 *
 * @param {number} gm the body's GM, m³/s²
 * @param {number} periodSecs its sidereal rotation period (either sign)
 * @returns {number} metres
 */
export function synchronousRadius(gm, periodSecs) {
  return Math.cbrt(gm * periodSecs * periodSecs / (4 * Math.PI * Math.PI))
}


/**
 * A body's synchronous orbit, and whether it can hold one: not when it lies
 * inside the body, nor outside its Hill sphere, where the primary's tide
 * takes it away (Mercury, Venus, the Moon and every tidally locked moon,
 * whose synchronous orbit is ∛3 times its Hill radius).
 *
 * @param {object} body
 * @param {number} body.gm m³/s²
 * @param {number} body.rotationSecs its sidereal day
 * @param {number} body.radius metres
 * @param {number} [body.hill] its Hill radius, metres, if it orbits anything
 * @returns {?{radius: number, altitude: number, why: ?string}} why is null
 *     for an orbit it can hold, else 'inside' or 'beyondHill'; null without a
 *     day
 */
export function synchronousOrbit({gm, rotationSecs, radius, hill}) {
  if (!(gm > 0) || !rotationSecs) {
    return null
  }
  const r = synchronousRadius(gm, rotationSecs)
  const why = r <= radius ? 'inside' : (hill > 0 && r >= hill ? 'beyondHill' : null)
  return {radius: r, altitude: r - radius, why}
}


/**
 * @param {string|{scalar: number}|number} mass a descriptor's mass: its
 *     string ("5.97219e27 g"), the reified Measure (grams, reify.js), or kg
 * @returns {number} kg, or NaN
 */
export function massKg(mass) {
  if (typeof mass === 'number') {
    return mass
  }
  if (typeof mass === 'string') {
    return Measure.parse(mass).convertToUnit().scalar / 1000
  }
  return mass && typeof mass === 'object' ? Number(mass.scalar) / 1000 : NaN
}
