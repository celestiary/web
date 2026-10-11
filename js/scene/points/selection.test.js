import {describe, expect, it} from 'bun:test'
import {brightening, countBrighter, parallaxSpread, selectTiles} from './selection.js'
import {syntheticPoints} from './syntheticPoints.js'
import {buildTileTree, manifestRow, tileFromRow} from './tileTree.js'


/**
 * The tree as the renderer has it: TileInfos from the manifest rows, and
 * each one's points (as if loaded).
 *
 * @param {Array<object>} points
 * @param {number} cap
 * @returns {object}
 */
function tree(points, cap) {
  const nodes = buildTileTree(points, {cap, maxOrder: 5})
  const infos = new Map()
  const pointsOf = new Map()
  const tileOfPoint = new Map()
  for (const n of nodes) {
    const info = tileFromRow(manifestRow(n))
    infos.set(info.key, info)
    pointsOf.set(info.key, n.points)
    for (const p of n.points) {
      tileOfPoint.set(p, info.key)
    }
  }
  const children = (t) => [0, 1, 2, 3].map((k) => infos.get(`${t.order + 1}/${(4 * t.pix) + k}`)).filter(Boolean)
  const roots = [...infos.values()].filter((t) => t.order === 0)
  const mags = (t) => Float32Array.from(pointsOf.get(t.key).map((p) => p.mag))
  return {infos, pointsOf, tileOfPoint, children, roots, mags}
}


/**
 * @param {Array<number>} v
 * @returns {Array<number>}
 */
function unit(v) {
  const r = Math.hypot(...v)
  return v.map((c) => c / r)
}


/**
 * Every point in the field, brighter from the camera than the limit, must
 * be drawn: its tile selected with a cut at or past its magnitude from the
 * Sun.  A brute-force check of the selection's bounds.
 *
 * @param {object} t tree()
 * @param {Array<object>} points
 * @param {object} view selectTiles' view, plus cam (light-years)
 * @returns {{wanted: number, selected: object}}
 */
function checkCovered(t, points, view) {
  const result = selectTiles(t.roots, t.children, view, t.mags)
  const cutOf = new Map(result.selected.map((s) => [s.tile.key, s.cut]))
  const cosHalf = Math.cos(view.halfAngle)
  let wanted = 0
  for (const p of points) {
    const rel = [p.x - view.cam[0], p.y - view.cam[1], p.z - view.cam[2]]
    const dCam = Math.hypot(...rel)
    const dir = rel.map((c) => c / dCam)
    const inField = ((dir[0] * view.dir[0]) + (dir[1] * view.dir[1]) + (dir[2] * view.dir[2])) >= cosHalf
    const magCam = p.mag + (5 * Math.log10(dCam / Math.hypot(p.x, p.y, p.z)))
    if (inField && magCam <= view.limit) {
      wanted++
      const cut = cutOf.get(t.tileOfPoint.get(p))
      if (!(cut >= p.mag)) {
        throw new Error(`a point of mag ${magCam.toFixed(2)} from the camera, in the field, wasn't drawn`)
      }
    }
  }
  return {wanted, selected: result}
}


describe('selection', () => {
  const points = syntheticPoints(40000, 11)
  const t = tree(points, 400)

  it('bounds the brightening and the turn from off the Sun', () => {
    expect(brightening(100, 0)).toBe(0)
    expect(brightening(100, 50)).toBeCloseTo(5 * Math.log10(2), 12)
    expect(brightening(100, 100)).toBe(Infinity)
    expect(parallaxSpread(100, 0)).toBe(0)
    expect(parallaxSpread(100, 50)).toBeCloseTo(Math.PI / 6, 12)
    expect(parallaxSpread(10, 20)).toBe(Math.PI)
  })

  it('counts a loaded tile\'s points to a cut, and estimates an unloaded one\'s', () => {
    const tile = {count: 4, magBright: 1, magFaint: 4}
    const mags = Float32Array.from([1, 2, 2, 4])
    expect(countBrighter(tile, 0.5, mags)).toBe(0)
    expect(countBrighter(tile, 2, mags)).toBe(3)
    expect(countBrighter(tile, 4, mags)).toBe(4)
    const est = countBrighter(tile, 3, null)
    expect(est).toBeGreaterThan(0)
    expect(est).toBeLessThan(4)
  })

  it('draws the whole sky to a limit from the Sun, exactly', () => {
    const view = {cam: [0, 0, 0], camDist: 0, dir: [1, 0, 0], halfAngle: Math.PI, limit: 7, budget: Infinity}
    const {wanted, selected} = checkCovered(t, points, view)
    expect(selected.estimate).toBe(wanted)
    expect(selected.estimate).toBe(points.filter((p) => p.mag <= 7).length)
  })

  it('takes only the tiles over a narrow field, deep', () => {
    const dir = unit([1, 0.05, -0.3])
    const view = {cam: [0, 0, 0], camDist: 0, dir, halfAngle: 3 * Math.PI / 180, limit: 12, budget: Infinity}
    const {wanted, selected} = checkCovered(t, points, view)
    expect(wanted).toBeGreaterThan(10)
    // The field is 1/1,500 of the sky; the tiles over it far fewer than all.
    expect(selected.selected.length).toBeLessThan(t.infos.size / 4)
  })

  it('is right from another star, 40 light-years out', () => {
    for (const [cam, dir] of [[[40, 0, 0], [1, 0, 0]], [[0, 25, -30], unit([0.2, -1, 0.1])]]) {
      const camDist = Math.hypot(...cam)
      for (const halfAngle of [Math.PI, 0.3, 0.02]) {
        const view = {cam, camDist, dir, halfAngle, limit: 8, budget: Infinity}
        checkCovered(t, points, view)
      }
    }
  })

  it('holds the budget, brightest tiles first', () => {
    const view = {cam: [0, 0, 0], camDist: 0, dir: [1, 0, 0], halfAngle: Math.PI, limit: 12, budget: 5000}
    const {selected, estimate, budgetHit} = selectTiles(t.roots, t.children, view, t.mags)
    expect(budgetHit).toBe(true)
    expect(estimate).toBeLessThanOrEqual(5000)
    expect(estimate).toBeGreaterThan(4500)
    // The roots, the brightest of every cell, are all in.
    for (const root of t.roots) {
      expect(selected.some((s) => s.tile === root)).toBe(true)
    }
  })
})
