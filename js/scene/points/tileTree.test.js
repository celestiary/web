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


describe('tileTree with a rule for its roots', () => {
  // The catalogue's shape (Stars.md, "Brightness tiers"): the roots hold
  // every point to mag 6.5 and a few fainter ones, the rest go down.
  const points = syntheticPoints(20000, 11)
  const marked = new Set(points.filter((p, i) => p.mag > 9 && i % 97 === 0))
  const hold = (p) => p.mag <= 6.5 || marked.has(p)
  const tiles = buildTileTree(points, {cap: 50, maxOrder: 4, rootsHold: hold})

  it('gives the roots exactly what the rule takes, however many', () => {
    const roots = tiles.filter((t) => t.order === 0)
    expect(roots.length).toBe(12)
    expect(roots.reduce((a, t) => a + t.count, 0)).toBe(points.filter(hold).length)
    expect(roots.some((t) => t.count > 50)).toBe(true)
    for (const t of tiles.filter((x) => x.order > 0)) {
      expect(t.points.every((p) => !hold(p))).toBe(true)
    }
  })

  it('bounds the roots\' descendants by magSub, which the row carries', () => {
    const byKey = new Map(tiles.map((t) => [`${t.order}/${t.pix}`, t]))
    for (const t of tiles.filter((x) => x.order > 0)) {
      const root = byKey.get(`0/${t.pix >> (2 * t.order)}`)
      expect(t.magBright).toBeGreaterThanOrEqual(root.magSub)
      expect(root.magSub).toBeLessThan(root.magFaint)
    }
    const root = tiles.find((t) => t.order === 0)
    const row = manifestRow(root)
    expect(row.length).toBe(9)
    expect(tileFromRow(row).magSub).toBeLessThanOrEqual(root.magSub)
    // A plain tree's rows are as before: the faintest bounds what's below.
    const plain = buildTileTree(points, {cap: 500, maxOrder: 4})
    expect(plain.every((t) => manifestRow(t).length === 8)).toBe(true)
    const info = tileFromRow(manifestRow(plain[0]))
    expect(info.magSub).toBe(info.magFaint)
  })
})
