import {readFileSync} from 'fs'
import {
  KdTree,
  catalogPositions,
  computeSpread,
  hopWidth,
  pathTo,
  pulseBoost,
  statsAt,
  yearsAtProgress,
} from './Colonization.js'
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

  it('pathTo follows parents and sums the route', () => {
    const pos = new Float64Array([0, 0, 0, 5, 0, 0, 10, 0, 0, 15, 0, 0])
    const s = computeSpread(pos, 0, {speedC: 0.5, numNeighbors: 1, launchDelayYears: 100})
    const p = pathTo(s, pos, 3, 0.5)
    expect(p.path).toEqual([0, 1, 2, 3])
    expect(p.hops).toEqual(3)
    expect(p.arriveYears).toEqual(230)
    expect(p.transitYears).toEqual(30)
    expect(p.waitYears).toEqual(200)
    expect(p.pathLy).toEqual(15)
    expect(p.directLy).toEqual(15)
    expect([p.minHopLy, p.maxHopLy, p.meanHopLy]).toEqual([5, 5, 5])
    const origin = pathTo(s, pos, 0, 0.5)
    expect(origin.path).toEqual([0])
    expect(origin.hops).toEqual(0)
    expect(origin.meanHopLy).toEqual(0)
  })

  it('hopWidth ramps from the first hop to the last', () => {
    expect(hopWidth(1, 61, 10, 1)).toEqual(10)
    expect(hopWidth(31, 61, 10, 1)).toEqual(5.5)
    expect(hopWidth(61, 61, 10, 1)).toEqual(1)
    expect(hopWidth(1, 1, 10, 1)).toEqual(10)
  })

  it('pulseBoost lights the current hop, and a trail steps down behind it', () => {
    expect(pulseBoost(3.7, 3, 0)).toEqual(1)
    expect(pulseBoost(4, 3, 0)).toEqual(0)
    expect(pulseBoost(2.9, 3, 0)).toEqual(0)
    // Trail of 3: the hop behind is 3/4, then 1/2, 1/4, then off.
    expect([3, 4, 5, 6, 7].map((p) => pulseBoost(p, 3, 3))).toEqual([1, 0.75, 0.5, 0.25, 0])
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
  }, 30000) // ~2 s alone, 5-8 s when other agents load the machine
})
