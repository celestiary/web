import {readFileSync} from 'fs'
import {KdTree, catalogPositions, computeSpread, statsAt, yearsAtProgress} from './Colonization.js'
import StarsCatalog from './StarsCatalog.js'
import {toArrayBuffer} from '../utils.js'


describe('Colonization', () => {
  it('KdTree#nearest matches brute force', () => {
    const n = 500
    const pos = new Float64Array(n * 3).map(() => (Math.random() - 0.5) * 100)
    const tree = new KdTree(pos)
    const d2 = (i, j) => [0, 1, 2].reduce((s, c) => s + ((pos[(3 * i) + c] - pos[(3 * j) + c]) ** 2), 0)
    for (const q of [0, 17, 250, 499]) {
      const brute = Array.from({length: n}, (_, j) => j)
          .filter((j) => j !== q)
          .sort((a, b) => d2(q, a) - d2(q, b))
          .slice(0, 5)
      expect(tree.nearest(q, 5)).toEqual(brute)
    }
  })

  it('computeSpread on a line of stars', () => {
    // Stars 5ly apart on a line, origin at the left end.
    const pos = new Float64Array([0, 0, 0, 5, 0, 0, 10, 0, 0, 15, 0, 0])
    const s = computeSpread(pos, 0, {speedC: 0.5, numNeighbors: 1, launchDelayYears: 100})
    expect(s.numReached).toEqual(4)
    expect(Array.from(s.hop)).toEqual([0, 1, 2, 3])
    expect(Array.from(s.parent)).toEqual([-1, 0, 1, 2])
    expect(Array.from(s.arriveYears)).toEqual([0, 10, 120, 230])
    expect(s.maxHop).toEqual(3)
    expect(s.maxYears).toEqual(230)
    expect(statsAt(s, 0)).toEqual({numColonized: 1, hop: 0})
    expect(statsAt(s, 120)).toEqual({numColonized: 3, hop: 2})
    expect(statsAt(s, 1e9)).toEqual({numColonized: 4, hop: 3})
    expect(yearsAtProgress(s, 0.5, 'years')).toEqual(115)
    // Arrivals [0, 10, 120, 230]: a third of the way is the 2nd star.
    expect(yearsAtProgress(s, 1 / 3, 'stars')).toBeCloseTo(10)
    expect(yearsAtProgress(s, 1, 'stars')).toEqual(230)
    expect(yearsAtProgress(s, 0, 'stars')).toEqual(0)
  })

  it('computeSpread bridges disconnected clusters', () => {
    // Two pairs far apart; 1 neighbor each leaves 2 components.
    const pos = new Float64Array([0, 0, 0, 1, 0, 0, 100, 0, 0, 101, 0, 0])
    const s = computeSpread(pos, 0, {numNeighbors: 1})
    expect(s.numBridges).toEqual(1)
    expect(s.numReached).toEqual(4)
    expect(Array.from(s.hop)).toEqual([0, 1, 2, 3])
  })

  it('computeSpread reaches the whole catalog', () => {
    const catalog = new StarsCatalog()
    catalog.read(toArrayBuffer(readFileSync('./public/data/stars.dat')))
    const {pos, originNdx, hipIds} = catalogPositions(catalog)
    expect(hipIds[originNdx]).toEqual(0)
    const s = computeSpread(pos, originNdx)
    expect(s.numReached).toEqual(s.numStars)
    expect(s.maxHop).toBeGreaterThan(10)
    // Alpha Centauri A (HIP 71683) is a first hop.
    expect(s.hop[Array.from(hipIds).indexOf(71683)]).toEqual(1)
  })
})
