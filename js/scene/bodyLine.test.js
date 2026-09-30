import {describe, expect, it} from 'bun:test'
import {BufferAttribute, BufferGeometry, Line, Vector3} from 'three'
import {BodyLine, CHECK_TOLERANCE, ORIGIN_RADII, fineSteps} from './bodyLine.js'


const N = 1001
const TWO_PI = 2 * Math.PI


/**
 * A closed ellipse, as Animation lays a mean-element orbit: unit size.
 *
 * @param {number} e
 * @returns {{line: Line, bodyLine: BodyLine, at: Function}}
 */
function ellipseLine(e) {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(3 * N), 3))
  const line = new Line(geometry)
  const bodyLine = new BodyLine(line, {n: N, closed: true})
  const b = Math.sqrt(1 - (e * e))
  const at = (u, target) => {
    const E = TWO_PI * u / (N - 1)
    return target.set(Math.cos(E), 0, b * Math.sin(E))
  }
  const coarse = new Float64Array(3 * N)
  const v = new Vector3
  for (let j = 0; j < N; j++) {
    at(j, v).toArray(coarse, 3 * j)
  }
  return {line, bodyLine, at, coarse}
}


/**
 * The drawn polyline's distance from a point, in the line's parent frame.
 *
 * @param {Line} line
 * @param {Vector3} p
 * @returns {number}
 */
function distance(line, p) {
  const xyz = line.geometry.attributes.position.array
  const count = line.geometry.drawRange.count
  const a = new Vector3
  const ab = new Vector3
  const ap = new Vector3
  let best = Infinity
  for (let j = 0; j + 1 < count; j++) {
    a.fromArray(xyz, 3 * j).add(line.position)
    ab.fromArray(xyz, 3 * (j + 1)).add(line.position).sub(a)
    ap.subVectors(p, a)
    const s = Math.min(Math.max(ap.dot(ab) / ab.lengthSq(), 0), 1)
    best = Math.min(best, ap.distanceTo(ab.multiplyScalar(s)))
  }
  return best
}


describe('BodyLine', () => {
  // Pluto-like: e 0.25, a body of 2e-7 of the orbit's size.
  const e = 0.25
  const radius = 2e-7
  const steps = fineSteps(1, e, radius, N)


  it('draws a closed line through the body either side of its seam', () => {
    const {line, bodyLine, at, coarse} = ellipseLine(e)
    bodyLine.setCoarse(coarse, {at, correct: false}, steps, new Vector3)
    for (const u of [0.3, N - 1.3, 0, N - 1, 500.5]) {
      const body = at(u, new Vector3)
      bodyLine.follow(body, u, radius)
      expect(distance(line, body) / radius).toBeLessThan(CHECK_TOLERANCE)
      // Closed: it still goes all the way round.
      expect(line.geometry.drawRange.count).toBeGreaterThan(N - 4)
    }
  })


  it('re-origins at the body once it has moved far enough, and not before', () => {
    const {line, bodyLine, at, coarse} = ellipseLine(e)
    bodyLine.setCoarse(coarse, {at, correct: false}, steps, new Vector3)
    const u0 = 200.1
    bodyLine.follow(at(u0, new Vector3), u0, radius)
    const origin = line.position.clone()
    // Along the arc, a little: the same splice.
    const near = at(u0 + 1e-6, new Vector3)
    expect(near.distanceTo(origin)).toBeLessThan(ORIGIN_RADII * radius)
    bodyLine.follow(near, u0 + 1e-6, radius)
    expect(line.position.equals(origin)).toBe(true)
    // Farther than ORIGIN_RADII, within the same segment: a new origin.
    const u1 = u0 + 0.5
    const far = at(u1, new Vector3)
    expect(far.distanceTo(origin)).toBeGreaterThan(ORIGIN_RADII * radius)
    bodyLine.follow(far, u1, radius)
    expect(line.position.equals(far)).toBe(true)
    expect(distance(line, far) / radius).toBeLessThan(CHECK_TOLERANCE)
  })


  it('bends the arc onto a body off the curve, and joins the coarse line', () => {
    const {line, bodyLine, at, coarse} = ellipseLine(0)
    const open = new BodyLine(line, {n: N})
    // An open line, whose curve is off the body by 100 radii.
    const off = new Vector3(0, 100 * radius, 0)
    open.setCoarse(coarse, {at, correct: true}, steps, new Vector3)
    const u = 300.4
    const body = at(u, new Vector3).add(off)
    open.follow(body, u, radius)
    expect(distance(line, body) / radius).toBeLessThan(CHECK_TOLERANCE)
    // The arc's ends are the coarse vertices themselves (in float64).
    const {ka, kb, count} = open.span
    expect(open._fine.slice(0, 3)).toEqual(coarse.slice(3 * ka, (3 * ka) + 3))
    expect(open._fine.slice(3 * (count - 1), 3 * count)).toEqual(coarse.slice(3 * kb, (3 * kb) + 3))
    expect(bodyLine).toBeDefined()
  })


  it('draws the plain line for a body off its window', () => {
    const {line, at, coarse} = ellipseLine(0)
    const open = new BodyLine(line, {n: N})
    open.setCoarse(coarse, {at, correct: true}, steps, new Vector3)
    open.follow(at(10.5, new Vector3), 10.5, radius)
    expect(line.geometry.drawRange.count).toBeGreaterThan(N)
    for (const u of [-1, N, NaN]) {
      open.follow(new Vector3, u, radius)
      expect(open.span).toBeNull()
      expect(line.geometry.drawRange.count).toBe(N)
    }
  })
})
