import {describe, expect, it} from 'bun:test'
import {syntheticPoints} from './syntheticPoints.js'
import {buildTileTree, manifestRow, pointPixel, tileFromRow} from './tileTree.js'


describe('tileTree', () => {
  const points = syntheticPoints(30000)
  const tiles = buildTileTree(points, {cap: 500, maxOrder: 4})
  const byKey = new Map(tiles.map((t) => [`${t.order}/${t.pix}`, t]))

  it('puts every point in exactly one tile', () => {
    const seen = new Set()
    for (const t of tiles) {
      for (const p of t.points) {
        expect(seen.has(p)).toBe(false)
        seen.add(p)
      }
    }
    expect(seen.size).toBe(points.length)
  })

  it('fills a tile to its cap before going down, except at the deepest order', () => {
    for (const t of tiles) {
      if (t.order < 4) {
        expect(t.count).toBeLessThanOrEqual(500)
      }
      if (t.hasChildren) {
        expect(t.count).toBe(500)
      }
    }
    // The band makes the tree uneven: some cells go deeper than others.
    const orders = new Set(tiles.map((t) => t.order))
    expect(orders.size).toBeGreaterThan(2)
  })

  it('sorts each tile, and makes every child fainter than its parent', () => {
    for (const t of tiles) {
      for (let i = 1; i < t.points.length; i++) {
        expect(t.points[i].mag).toBeGreaterThanOrEqual(t.points[i - 1].mag)
      }
      expect(t.magBright).toBe(t.points[0].mag)
      expect(t.magFaint).toBe(t.points[t.points.length - 1].mag)
      if (t.order > 0) {
        const parent = byKey.get(`${t.order - 1}/${Math.floor(t.pix / 4)}`)
        expect(parent.hasChildren).toBe(true)
        expect(t.magBright).toBeGreaterThanOrEqual(parent.magFaint)
        expect(parent.distMinSub).toBeLessThanOrEqual(t.distMinSub)
      }
      expect(t.distMinSub).toBeLessThanOrEqual(t.distMin)
    }
  })

  it('keeps each point in its tile\'s cell, and its cone', () => {
    for (const t of tiles) {
      const info = tileFromRow(manifestRow(t))
      for (const p of t.points) {
        expect(pointPixel(p, t.order)).toBe(t.pix)
        const r = Math.hypot(p.x, p.y, p.z)
        const dot = ((p.x * info.centre[0]) + (p.y * info.centre[1]) + (p.z * info.centre[2])) / r
        expect(Math.acos(Math.min(1, dot))).toBeLessThanOrEqual(info.radius)
      }
    }
  })

  it('rounds the manifest\'s bounds outward', () => {
    const t = {order: 2, pix: 17, count: 3, magBright: 5.12345, magFaint: 7.00001, distMin: 10.0009, distMinSub: 9.9999,
      hasChildren: true}
    expect(manifestRow(t)).toEqual([2, 17, 3, 5.123, 7.001, 10, 9.999, 1])
    const info = tileFromRow(manifestRow(t))
    expect(info.key).toBe('2/17')
    expect(info.hasChildren).toBe(true)
  })
})
