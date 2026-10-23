import fs from 'node:fs'
import {describe, expect, it} from 'bun:test'
import {
  CROSS_PLANE_MAX_LAT_DEG,
  argumentOfLatitude,
  clearsEarth,
  clusterPlanes,
  inService,
  iridiumLinks,
  latitudeOf,
} from './iridium.js'
import {recordsOf} from './loadNetworks.js'


const DEG = Math.PI / 180
const R = 7158e3 // Iridium's ~780 km
const INC = 86.4


/**
 * A circular orbit's position and velocity direction, +Y the pole.
 *
 * @param {number} raan degrees
 * @param {number} u argument of latitude, degrees
 * @returns {{r: Array<number>, v: Array<number>}}
 */
function state(raan, u) {
  const [O, i, w] = [raan * DEG, INC * DEG, u * DEG]
  // In the usual z-up frame, then (x, y, z) → (x, z, −y).
  const n = [Math.cos(O), Math.sin(O), 0]
  const m = [-Math.sin(O) * Math.cos(i), Math.cos(O) * Math.cos(i), Math.sin(i)]
  const r = n.map((a, k) => R * ((a * Math.cos(w)) + (m[k] * Math.sin(w))))
  const v = n.map((a, k) => (-a * Math.sin(w)) + (m[k] * Math.cos(w)))
  const remap = ([x, y, z]) => [x, z, -y]
  return {r: remap(r), v: remap(v)}
}


/**
 * Six planes of eleven, 31.6° apart in node, phased as Iridium's are.
 *
 * @param {object} [opts]
 * @param {number} [opts.u0] the first satellite's argument of latitude
 * @param {Array<number>} [opts.drop] satellites missing, by index
 * @returns {{pos: Float64Array, vel: Float64Array, raan: Array<number>}}
 */
function constellation({u0 = 10, drop = []} = {}) {
  const raan = []
  const pos = []
  const vel = []
  for (let p = 0; p < 6; p++) {
    for (let s = 0; s < 11; s++) {
      if (drop.includes((p * 11) + s)) {
        continue
      }
      const node = (240 + (p * 31.6)) % 360
      const {r, v} = state(node, u0 + (s * 360 / 11) + (p * 360 / 22))
      raan.push(node)
      pos.push(...r)
      vel.push(...v)
    }
  }
  return {pos: Float64Array.from(pos), vel: Float64Array.from(vel), raan}
}


describe('Iridium network model', () => {
  it('finds the satellites in service by mean motion', () => {
    const recs = [14.3422, 14.3421, 14.3423, 14.4328, 14.7225].map((meanMotion) => ({meanMotion}))
    expect(inService(recs)).toEqual([true, true, true, false, false])
  })

  it('clusters six planes, numbered east from the seam', () => {
    const {raan} = constellation()
    const planes = clusterPlanes(raan)
    expect(planes.map((p) => p.length)).toEqual([11, 11, 11, 11, 11, 11])
    // Plane 1 is the one at 240°, east of the 202° gap; plane 6 at 38°.
    expect(raan[planes[0][0]]).toBeCloseTo(240, 6)
    expect(raan[planes[5][0]]).toBeCloseTo(38, 6)
  })

  it('measures the argument of latitude along the motion', () => {
    for (const u of [0, 45, 135, 300]) {
      const {r, v} = state(77, u)
      expect(argumentOfLatitude(r, v) / DEG).toBeCloseTo(u, 6)
    }
    expect(latitudeOf(state(0, 90).r)).toBeCloseTo(INC, 6)
  })

  it('links each satellite ahead and behind in its plane, and to neighbouring planes but not across the seam', () => {
    const {pos, vel, raan} = constellation()
    const planes = clusterPlanes(raan)
    const {inPlane, crossPlane} = iridiumLinks(pos, vel, planes)
    expect(inPlane).toHaveLength(66)
    const planeOf = new Map(planes.flatMap((p, k) => p.map((i) => [i, k])))
    for (const [a, b] of crossPlane) {
      expect(Math.abs(planeOf.get(a) - planeOf.get(b))).toBe(1)
      for (const i of [a, b]) {
        expect(Math.abs(latitudeOf(pos, 3 * i))).toBeLessThanOrEqual(CROSS_PLANE_MAX_LAT_DEG)
      }
    }
    // Every neighbouring pair of planes is linked; the seam (1 and 6) is not.
    const pairs = new Set(crossPlane.map(([a, b]) => [planeOf.get(a), planeOf.get(b)].sort().join()))
    expect([...pairs].sort()).toEqual(['0,1', '1,2', '2,3', '3,4', '4,5'])
    // Each satellite below the cut-off has a link either side, at most two a side.
    const degree = new Map
    crossPlane.flat().forEach((i) => degree.set(i, (degree.get(i) ?? 0) + 1))
    expect(Math.max(...degree.values())).toBeLessThanOrEqual(4)
  })

  it('has no link across a gap in a plane, nor through Earth', () => {
    const {pos, vel, raan} = constellation({drop: [3]})
    const {inPlane} = iridiumLinks(pos, vel, clusterPlanes(raan))
    // The ring of 10 has 10 neighbours, but the two either side of the gap
    // are 65° apart: their line passes under the atmosphere.
    expect(inPlane).toHaveLength(65 - 1)
    const antipodes = Float64Array.from([R, 0, 0, -R, 0, 0])
    expect(clearsEarth(antipodes, 0, 1)).toBe(false)
  })

  it('reads the snapshot: 67 in service in six planes', () => {
    const recs = recordsOf(JSON.parse(fs.readFileSync(new URL('../../../public/data/networks/iridium.json', import.meta.url))), 'iridium')
    const service = inService(recs)
    expect(recs).toHaveLength(80)
    expect(service.filter(Boolean)).toHaveLength(67)
    const planes = clusterPlanes(recs.map((r) => r.satrec.nodeo / DEG), service)
    expect(planes).toHaveLength(6)
    expect(planes.every((p) => p.length >= 11)).toBe(true)
  })
})
