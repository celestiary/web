import {describe, expect, it} from 'bun:test'
import {Matrix4, Quaternion, Vector3} from 'three'
import FlightPath, {
  EASE_TIME_MAX_MS, FLIGHT_MAX_MS, FLIGHT_MIN_MS, NEAR_RADII, flightDuration, timePlan,
} from './flight.js'


const R = 6.371e6
const DAY_MS = 86400000


/**
 * @param {Vector3} eye
 * @param {Vector3} target
 * @returns {Quaternion} A camera at eye facing target
 */
function facing(eye, target) {
  return new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(eye, target, new Vector3(0, 1, 0)))
}


/**
 * @param {Quaternion} q
 * @returns {Vector3} Where a camera with it looks
 */
function lookOf(q) {
  return new Vector3(0, 0, -1).applyQuaternion(q)
}


describe('timePlan', () => {
  it('no change of date is none', () => {
    expect(timePlan(0, 2)).toBe('none')
  })

  it('far from every body, at the start', () => {
    expect(timePlan(30 * DAY_MS, NEAR_RADII + 1)).toBe('start')
    expect(timePlan(-DAY_MS, Infinity)).toBe('start')
  })

  it('near a body, a short change eases along the way and a longer one dips', () => {
    expect(timePlan(EASE_TIME_MAX_MS, 3)).toBe('ease')
    expect(timePlan(-EASE_TIME_MAX_MS, 3)).toBe('ease')
    expect(timePlan(EASE_TIME_MAX_MS + 1, 3)).toBe('dip')
  })
})


describe('flightDuration', () => {
  it('grows with the decades of altitude and the turn, within its bounds', () => {
    expect(flightDuration(2 * R, 2 * R, 0)).toBe(FLIGHT_MIN_MS)
    const across = flightDuration(2 * R, 2 * R, Math.PI)
    const down = flightDuration(1e11, 1e7, 0)
    expect(across).toBeGreaterThan(FLIGHT_MIN_MS)
    expect(down).toBeGreaterThan(FLIGHT_MIN_MS)
    expect(flightDuration(3e19, 169, 1)).toBe(FLIGHT_MAX_MS)
    expect(flightDuration(169, 3e19, 1)).toBe(FLIGHT_MAX_MS)
  })
})


describe('FlightPath', () => {
  const startPos = new Vector3(1.5e11, 0, 0)
  const start = {position: startPos, quaternion: facing(startPos, new Vector3(1.5e11, 0, -1e9)), fov: 45}
  const endPos = new Vector3(0, 0.5 * R, 1.8 * R)
  const end = {position: endPos, quaternion: facing(endPos, new Vector3(0, 10 * R, 0)), fov: 0.9}
  const path = new FlightPath(start, R)

  it('starts where the camera is and ends exactly on the view', () => {
    const p0 = path.pose(0, end)
    expect(p0.position.distanceTo(startPos)).toBeLessThan(1e-3)
    expect(Math.abs(p0.quaternion.dot(start.quaternion))).toBeCloseTo(1, 9)
    expect(p0.fov).toBeCloseTo(45, 9)
    const p1 = path.pose(1, end)
    expect(p1.position).toEqual(endPos)
    expect(p1.quaternion).toEqual(end.quaternion)
    expect(p1.fov).toBe(0.9)
    expect(p1.travel).toBe(1)
  })

  it('closes in geometrically, without a step, and faces the body on the way', () => {
    const n = 400
    let last = path.pose(0, end)
    for (let i = 1; i <= n; i++) {
      const p = path.pose(i / n, end)
      const ratio = p.position.length() / last.position.length()
      expect(ratio).toBeLessThanOrEqual(1 + 1e-9)
      expect(Math.abs(Math.log10(ratio))).toBeLessThan(0.1)
      expect(p.quaternion.angleTo(last.quaternion)).toBeLessThan(0.05)
      last = p
    }
    // Between the turns it faces the body's centre.
    const mid = path.pose(0.45, end)
    expect(lookOf(mid.quaternion).dot(mid.position.clone().negate().normalize())).toBeGreaterThan(0.9999)
    // The field narrows only in the last turn.
    expect(path.pose(0.55, end).fov).toBeCloseTo(45, 9)
  })

  it('on a long descent the direction comes round by the middle', () => {
    const over = new Vector3(R + 169, 0, 0).applyAxisAngle(new Vector3(0, 1, 0), 1)
    const landing = {position: over, quaternion: facing(over, new Vector3(0, 0, 0)), fov: 45}
    const p = path.pose(0.5, landing)
    expect(p.position.clone().normalize().angleTo(over.clone().normalize())).toBeLessThan(1e-6)
    // And never goes under the ground.
    for (let i = 0; i <= 100; i++) {
      expect(path.pose(i / 100, landing).position.length()).toBeGreaterThanOrEqual(R)
    }
  })

  it('measures the altitudes and the turn', () => {
    const {alt0, alt1, angle} = path.measure(end)
    expect(alt0).toBeCloseTo(1.5e11 - R, 0)
    expect(alt1).toBeCloseTo(endPos.length() - R, 3)
    expect(angle).toBeCloseTo(startPos.angleTo(endPos), 9)
  })
})
