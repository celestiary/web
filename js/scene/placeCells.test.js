import {describe, expect, it} from 'bun:test'
import {cellInView, groupByCell, horizonAngle} from './placeCells.js'
import {latLngAltToBodyFixed} from '../coords.js'


const place = (lat, lng, n = `${lat},${lng}`) => ({n, lat, lng})
const unit = (lat, lng) => latLngAltToBodyFixed(lat, lng, 0, 1)


describe('groupByCell', () => {
  it('puts every place in one cell, with its place in the tier', () => {
    const entries = [place(10, 10), place(12, 14), place(-60, 100), place(10, -170), place(89, 0), place(-90, 0)]
    const cells = groupByCell(entries)
    expect(cells.flatMap((c) => c.items.map((i) => i.rank)).sort()).toEqual([0, 1, 2, 3, 4, 5])
    for (const c of cells) {
      for (const {e, rank} of c.items) {
        expect(e).toBe(entries[rank])
      }
    }
    // The first two are 4 degrees apart, in one cell of 30.
    expect(cells.find((c) => c.items.some((i) => i.rank === 0)).items.length).toBe(2)
  })

  it('gives each cell a unit vector to the middle of its places and the angle to the farthest', () => {
    const cells = groupByCell([place(10, 10), place(20, 20), place(5, 25)])
    expect(cells.length).toBe(1)
    const [c] = cells
    expect(Math.hypot(c.x, c.y, c.z)).toBeCloseTo(1, 9)
    for (const {e} of c.items) {
      const u = unit(e.lat, e.lng)
      const angle = Math.acos((u.x * c.x) + (u.y * c.y) + (u.z * c.z))
      expect(angle).toBeLessThanOrEqual(c.radius + 1e-9)
    }
    expect(c.radius).toBeGreaterThan(0)
  })

  it('copes with the poles, and a longitude of exactly 180 or -180', () => {
    const [cell] = groupByCell([place(80, 0), place(85, 10), place(90, 20)])
    expect(Number.isFinite(cell.x)).toBe(true)
    expect(cell.y).toBeGreaterThan(0.99) // the middle is at the pole
    expect(cell.radius).toBeGreaterThan(0)
    expect(groupByCell([place(0, 180), place(0, -180)]).length).toBe(1)
    expect(groupByCell([place(90, 0)]).length).toBe(1)
    expect(groupByCell([place(-90, 0)]).length).toBe(1)
  })
})


describe('horizonAngle', () => {
  it('is the angle from the nadir to the horizon', () => {
    expect(horizonAngle(1, 1)).toBe(0)
    expect(horizonAngle(2, 1)).toBeCloseTo(Math.PI / 3)
    expect(horizonAngle(0.5, 1)).toBe(0)
    // At the Moon's surface (2 m up) it is a few thousandths of a radian.
    expect(horizonAngle(1.7374e6 + 2, 1.7374e6)).toBeLessThan(0.002)
  })
})


describe('cellInView', () => {
  const cells = groupByCell([place(0, 0), place(1, 1), place(0, 100), place(-80, 20), place(60, -120)])
  const near = (lat, lng, cap) => cells.filter((c) => cellInView(c, unit(lat, lng), cap))
      .flatMap((c) => c.items.map((i) => i.rank)).sort()

  it('takes the cells under the camera and not the far side', () => {
    expect(near(0, 0, 0.1)).toEqual([0, 1])
    expect(near(0, 180, 0.1)).toEqual([])
  })

  it('takes more as the horizon widens, all of them from far away', () => {
    expect(near(0, 0, 1.8)).toEqual([0, 1, 2, 3]) // 100 and 81 degrees off, not the one at 105
    expect(near(0, 0, Math.PI)).toEqual([0, 1, 2, 3, 4])
  })

  it('never leaves out a place that is on the near side', () => {
    // Every place inside the horizon's cap is in a cell that is taken.
    for (const [lat, lng, cap] of [[0, 0, 0.3], [30, -100, 0.9], [-70, 20, 0.2], [5, 100, 0.01]]) {
      const taken = new Set(near(lat, lng, cap))
      const cam = unit(lat, lng)
      for (const {e} of cells.flatMap((c) => c.items)) {
        const u = unit(e.lat, e.lng)
        const angle = Math.acos(Math.min(1, (u.x * cam.x) + (u.y * cam.y) + (u.z * cam.z)))
        if (angle <= cap) {
          expect(taken.has(cells.flatMap((c) => c.items).find((i) => i.e === e).rank)).toBe(true)
        }
      }
    }
  })
})
