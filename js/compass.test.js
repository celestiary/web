import {describe, expect, it} from 'bun:test'
import {Quaternion, Vector3} from 'three'
import {groundAxes, headingOf, orientationFor} from './compass.js'


const DEG = Math.PI / 180
const pole = new Vector3(0, 1, 0)

/** @returns {Vector3} Up over a point at latitude `lat`, longitude 0 (body +X) */
const upAt = (lat) => new Vector3(Math.cos(lat * DEG), Math.sin(lat * DEG), 0)

/** @returns {Vector3} The forward of a world orientation */
const fwdOf = (q) => new Vector3(0, 0, -1).applyQuaternion(q)


describe('the compass\'s geometry (#361, step 3)', () => {
  it('finds north and east on the ground: north toward the pole, east its cross with up', () => {
    const north = new Vector3()
    const east = new Vector3()
    groundAxes(upAt(0), pole, north, east)
    expect(north.distanceTo(new Vector3(0, 1, 0))).toBeLessThan(1e-12)
    // At longitude 0 (+X), east (90° E) is −Z in the body frame (DESIGN.md, body frames).
    expect(east.distanceTo(new Vector3(0, 0, -1))).toBeLessThan(1e-12)
  })

  it('reads the heading and pitch it was turned to, at any latitude', () => {
    for (const lat of [-60, 0, 7, 45, 89]) {
      for (const h of [0, 30, 90, 179, -120]) {
        for (const p of [-80, -20, 0, 35]) {
          const up = upAt(lat)
          const q = orientationFor(up, pole, h * DEG, p * DEG)
          const r = headingOf(up, pole, fwdOf(q))
          expect(r.pitch / DEG).toBeCloseTo(p, 9)
          expect(Math.abs(Math.atan2(Math.sin(r.heading - (h * DEG)), Math.cos(r.heading - (h * DEG))))).toBeLessThan(1e-9)
        }
      }
    }
  })

  it('leaves no roll: the camera\'s right lies along the ground', () => {
    const up = upAt(30)
    const q = orientationFor(up, pole, 70 * DEG, -25 * DEG)
    const right = new Vector3(1, 0, 0).applyQuaternion(q)
    expect(Math.abs(right.dot(up))).toBeLessThan(1e-12)
  })

  it('straight down from the air, north is the top of the view', () => {
    const up = upAt(20)
    const q = orientationFor(up, pole, 0, -Math.PI / 2)
    expect(fwdOf(q).dot(up)).toBeCloseTo(-1, 12)
    const north = new Vector3()
    groundAxes(up, pole, north, new Vector3())
    expect(new Vector3(0, 1, 0).applyQuaternion(q).dot(north)).toBeCloseTo(1, 12)
  })

  it('has a north at the pole itself', () => {
    const q = orientationFor(new Vector3(0, 1, 0), pole, 0, 0, new Quaternion())
    expect(Number.isFinite(q.x + q.y + q.z + q.w)).toBe(true)
  })
})
