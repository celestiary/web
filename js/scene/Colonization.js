// Graph analysis of a hypothetical spread of humans from the Sun to
// neighboring stars.
//
// Each star is a node.  Edges connect every star to its k nearest
// neighbors (symmetrized), which models "hop to a nearby star" with
// hop lengths that naturally stretch where the catalog thins out.  If
// the kNN graph has disconnected clusters, each one is bridged to its
// nearest outside star so the spread reaches the edge of the catalog.
//
// The spread is a layered BFS from the Sun: hop count is the fewest
// number of hops from the Sun.  Among the parents that achieve that
// fewest-hops count, the one giving the earliest arrival is chosen.
// Arrival time = parent arrival + launch delay + distance / speed.
// Ships leave the origin at time zero; colonies wait the launch delay
// before sending ships onward.

import {LIGHTYEAR_METER} from '../shared.js'


export const DEFAULT_PARAMS = {
  speedC: 0.5,
  numNeighbors: 10,
  launchDelayYears: 100,
}


/**
 * @typedef {{
 *   numStars: number,
 *   numReached: number,
 *   hop: Int32Array,
 *   parent: Int32Array,
 *   departYears: Float64Array,
 *   arriveYears: Float64Array,
 *   order: Int32Array,
 *   maxHop: number,
 *   maxYears: number,
 *   medianHopLy: number,
 *   meanHopLy: number,
 *   maxHopLy: number,
 *   numBridges: number,
 *   sortedArriveYears: Float64Array,
 *   firstArriveByHop: Float64Array,
 * }} Spread
 */


/**
 * @param {object} catalog StarsCatalog
 * @returns {{pos: Float64Array, originNdx: number, hipIds: Int32Array}}
 *   Positions in light-years, packed xyz, and index of the Sun
 */
export function catalogPositions(catalog) {
  const stars = Array.from(catalog.starByHip.values())
  const pos = new Float64Array(stars.length * 3)
  const hipIds = new Int32Array(stars.length)
  let originNdx = 0
  stars.forEach((star, i) => {
    pos[3 * i] = star.x / LIGHTYEAR_METER
    pos[(3 * i) + 1] = star.y / LIGHTYEAR_METER
    pos[(3 * i) + 2] = star.z / LIGHTYEAR_METER
    hipIds[i] = star.hipId
    if (star.hipId === 0) {
      originNdx = i
    }
  })
  return {pos, originNdx, hipIds}
}


/**
 * @param {Spread} spread
 * @param {number} years Years since departure from origin
 * @returns {{numColonized: number, hop: number}} Stars reached
 *   (including origin) and the furthest hop reached by then
 */
export function statsAt(spread, years) {
  return {
    numColonized: upperBound(spread.sortedArriveYears, years),
    hop: Math.max(0, upperBound(spread.firstArriveByHop, years) - 1),
  }
}


/**
 * Maps timeline progress to years since launch.  'years' pacing is
 * linear in time.  'stars' pacing advances evenly by number of stars
 * colonized, so the long tail of slow outlier hops doesn't dominate.
 *
 * @param {Spread} spread
 * @param {number} progress 0 to 1
 * @param {string} pacing 'years' or 'stars'
 * @returns {number} Years since launch
 */
export function yearsAtProgress(spread, progress, pacing) {
  const p = Math.min(Math.max(progress, 0), 1)
  if (pacing === 'years') {
    return p * spread.maxYears
  }
  const arrive = spread.sortedArriveYears
  const x = p * (arrive.length - 1)
  const i = Math.min(Math.floor(x), arrive.length - 2)
  if (i < 0) {
    return 0
  }
  return arrive[i] + ((arrive[i + 1] - arrive[i]) * (x - i))
}


/** @returns {number} Count of sorted values <= x */
function upperBound(sorted, x) {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid] <= x) {
      lo = mid + 1
    } else {
      hi = mid
    }
  }
  return lo
}


/**
 * @param {Float64Array} pos Star positions in light-years, packed xyz
 * @param {number} originNdx Index of the star humans start from
 * @param {object} [params] See DEFAULT_PARAMS
 * @returns {Spread}
 */
export function computeSpread(pos, originNdx, params = {}) {
  const {speedC, numNeighbors, launchDelayYears} = {...DEFAULT_PARAMS, ...params}
  if (!(speedC > 0)) {
    throw new Error(`Speed must be positive: ${speedC}`)
  }
  const n = pos.length / 3
  const tree = new KdTree(pos)
  const adj = knnGraph(tree, numNeighbors)
  const numBridges = connect(tree, adj)
  const hop = new Int32Array(n).fill(-1)
  const parent = new Int32Array(n).fill(-1)
  const departYears = new Float64Array(n)
  const arriveYears = new Float64Array(n).fill(Infinity)
  const order = new Int32Array(n)
  let numReached = 0
  hop[originNdx] = 0
  arriveYears[originNdx] = 0
  order[numReached++] = originNdx
  let frontier = [originNdx]
  while (frontier.length > 0) {
    const next = []
    for (const u of frontier) {
      const depart = u === originNdx ? 0 : arriveYears[u] + launchDelayYears
      for (const v of adj[u]) {
        if (hop[v] !== -1 && hop[v] <= hop[u]) {
          continue
        }
        const arrive = depart + (dist(pos, u, v) / speedC)
        if (hop[v] === -1) {
          hop[v] = hop[u] + 1
          next.push(v)
          order[numReached++] = v
        } else if (arrive >= arriveYears[v]) {
          continue
        }
        parent[v] = u
        departYears[v] = depart
        arriveYears[v] = arrive
      }
    }
    frontier = next
  }
  let maxHop = 0
  let maxYears = 0
  const hopLens = []
  for (let i = 0; i < n; i++) {
    if (hop[i] > maxHop) {
      maxHop = hop[i]
    }
    if (parent[i] !== -1) {
      if (arriveYears[i] > maxYears) {
        maxYears = arriveYears[i]
      }
      hopLens.push(dist(pos, i, parent[i]))
    }
  }
  hopLens.sort((a, b) => a - b)
  const sortedArriveYears = new Float64Array(numReached)
  const firstArriveByHop = new Float64Array(maxHop + 1).fill(Infinity)
  for (let o = 0; o < numReached; o++) {
    const i = order[o]
    sortedArriveYears[o] = arriveYears[i]
    firstArriveByHop[hop[i]] = Math.min(firstArriveByHop[hop[i]], arriveYears[i])
  }
  sortedArriveYears.sort()
  // Monotonic so it can be binary searched.
  for (let h = 1; h <= maxHop; h++) {
    firstArriveByHop[h] = Math.max(firstArriveByHop[h], firstArriveByHop[h - 1])
  }
  return {
    numStars: n,
    numReached,
    hop,
    parent,
    departYears,
    arriveYears,
    order,
    maxHop,
    maxYears,
    medianHopLy: hopLens.length ? hopLens[hopLens.length >> 1] : 0,
    meanHopLy: hopLens.length ? hopLens.reduce((a, b) => a + b, 0) / hopLens.length : 0,
    maxHopLy: hopLens.length ? hopLens[hopLens.length - 1] : 0,
    numBridges,
    sortedArriveYears,
    firstArriveByHop,
  }
}


/**
 * @typedef {{
 *   path: Array<number>,
 *   hops: number,
 *   arriveYears: number,
 *   transitYears: number,
 *   waitYears: number,
 *   pathLy: number,
 *   directLy: number,
 *   minHopLy: number,
 *   maxHopLy: number,
 *   meanHopLy: number,
 * }} PathStats
 */


/**
 * The route the spread took from the origin to a star, by parent links.
 *
 * @param {Spread} spread
 * @param {Float64Array} pos Star positions in light-years, packed xyz
 * @param {number} ndx Star index
 * @param {number} speedC The speed the spread was computed with
 * @returns {PathStats|null} null if the star wasn't reached; path runs
 *   origin first, ndx last
 */
export function pathTo(spread, pos, ndx, speedC) {
  if (spread.hop[ndx] === -1) {
    return null
  }
  const path = []
  for (let i = ndx; i !== -1; i = spread.parent[i]) {
    path.push(i)
  }
  path.reverse()
  let pathLy = 0
  let minHopLy = Infinity
  let maxHopLy = 0
  for (let h = 1; h < path.length; h++) {
    const d = dist(pos, path[h - 1], path[h])
    pathLy += d
    minHopLy = Math.min(minHopLy, d)
    maxHopLy = Math.max(maxHopLy, d)
  }
  const hops = path.length - 1
  const arriveYears = spread.arriveYears[ndx]
  const transitYears = pathLy / speedC
  return {
    path,
    hops,
    arriveYears,
    transitYears,
    waitYears: arriveYears - transitYears,
    pathLy,
    directLy: dist(pos, path[0], ndx),
    minHopLy: hops ? minHopLy : 0,
    maxHopLy,
    meanHopLy: hops ? pathLy / hops : 0,
  }
}


/**
 * Line width for a hop: linear from the first hop's width to the last's.
 * Mirrors the lines' vertex shader.
 *
 * @param {number} hop 1-based
 * @param {number} maxHop
 * @param {number} first Width at hop 1
 * @param {number} last Width at maxHop
 * @returns {number}
 */
export function hopWidth(hop, maxHop, first, last) {
  const t = maxHop > 1 ? (hop - 1) / (maxHop - 1) : 0
  return first + ((last - first) * t)
}


/**
 * How much the pulse brightens a hop's segments, 0 to 1.  The pulse sits T
 * seconds on each hop in turn: the hop it's on is 1, and with a trail the N
 * hops behind it step back down to 0.  Mirrors the lines' vertex shader.
 *
 * @param {number} pulseHop The hop the pulse is on (fractions ignored)
 * @param {number} hop 1-based
 * @param {number} trail N, hops a trail takes to fade; 0 for none
 * @returns {number}
 */
export function pulseBoost(pulseHop, hop, trail) {
  const behind = Math.floor(pulseHop) - hop
  if (behind < 0 || behind > trail) {
    return 0
  }
  return 1 - (behind / (trail + 1))
}


/**
 * @param {number} maxHop
 * @param {number} trail
 * @returns {number} Steps in one pulse cycle: through every hop, then until
 *   the trail has faded off the last one
 */
export function pulseCycle(maxHop, trail) {
  return maxHop + trail + 1
}


/**
 * Symmetric k-nearest-neighbor adjacency lists.
 *
 * @param {KdTree} tree
 * @param {number} k
 * @returns {Array<Array<number>>}
 */
export function knnGraph(tree, k) {
  const n = tree.n
  const adj = new Array(n)
  for (let i = 0; i < n; i++) {
    adj[i] = []
  }
  for (let i = 0; i < n; i++) {
    for (const j of tree.nearest(i, k)) {
      addEdge(adj, i, j)
    }
  }
  return adj
}


/**
 * Bridge disconnected clusters until the graph is connected, Borůvka
 * style: every cluster other than the largest links its closest star
 * to the nearest star outside the cluster.
 *
 * @param {KdTree} tree
 * @param {Array<Array<number>>} adj Modified in place
 * @returns {number} Number of bridges added
 */
export function connect(tree, adj) {
  let numBridges = 0
  for (;;) {
    const comp = components(adj)
    const sizes = new Map()
    for (const c of comp) {
      sizes.set(c, (sizes.get(c) || 0) + 1)
    }
    if (sizes.size <= 1) {
      return numBridges
    }
    let largest = -1
    sizes.forEach((size, c) => {
      if (largest === -1 || size > sizes.get(largest)) {
        largest = c
      }
    })
    const best = new Map() // comp -> [dist, from, to]
    for (let i = 0; i < comp.length; i++) {
      const c = comp[i]
      if (c === largest) {
        continue
      }
      const [j, d] = tree.nearestWhere(i, (other) => comp[other] !== c)
      const cur = best.get(c)
      if (j !== -1 && (!cur || d < cur[0])) {
        best.set(c, [d, i, j])
      }
    }
    for (const [, i, j] of best.values()) {
      addEdge(adj, i, j)
      numBridges++
    }
  }
}


/**
 * @param {Array<Array<number>>} adj
 * @returns {Int32Array} Component id by node
 */
function components(adj) {
  const comp = new Int32Array(adj.length).fill(-1)
  let id = 0
  const stack = []
  for (let s = 0; s < adj.length; s++) {
    if (comp[s] !== -1) {
      continue
    }
    comp[s] = id
    stack.push(s)
    while (stack.length) {
      const u = stack.pop()
      for (const v of adj[u]) {
        if (comp[v] === -1) {
          comp[v] = id
          stack.push(v)
        }
      }
    }
    id++
  }
  return comp
}


/** Add undirected edge, skipping duplicates. */
function addEdge(adj, i, j) {
  if (i !== j && !adj[i].includes(j)) {
    adj[i].push(j)
    adj[j].push(i)
  }
}


/** @returns {number} Distance between stars i and j */
function dist(pos, i, j) {
  return Math.sqrt(dist2(pos, i, j))
}


/** @returns {number} Squared distance between stars i and j */
function dist2(pos, i, j) {
  const dx = pos[3 * i] - pos[3 * j]
  const dy = pos[(3 * i) + 1] - pos[(3 * j) + 1]
  const dz = pos[(3 * i) + 2] - pos[(3 * j) + 2]
  return (dx * dx) + (dy * dy) + (dz * dz)
}


/**
 * Static 3D k-d tree over packed xyz points, stored implicitly as a
 * permutation of point indices: each subrange [lo, hi) has its
 * splitting point at the middle, split on axis depth % 3.
 */
export class KdTree {
  /** @param {Float64Array} pos Packed xyz */
  constructor(pos) {
    this.pos = pos
    this.n = pos.length / 3
    this.ndx = new Int32Array(this.n)
    for (let i = 0; i < this.n; i++) {
      this.ndx[i] = i
    }
    this.build(0, this.n, 0)
  }


  /** Recursively partition so the median of [lo, hi) is in the middle. */
  build(lo, hi, depth) {
    if (hi - lo <= 1) {
      return
    }
    const mid = (lo + hi) >> 1
    this.select(lo, hi - 1, mid, depth % 3)
    this.build(lo, mid, depth + 1)
    this.build(mid + 1, hi, depth + 1)
  }


  /** Quickselect on this.ndx[lo..hi] so the kth is in place for the axis. */
  select(lo, hi, k, axis) {
    const ndx = this.ndx
    const pos = this.pos
    while (hi > lo) {
      const pivot = pos[(3 * ndx[(lo + hi) >> 1]) + axis]
      let i = lo
      let j = hi
      while (i <= j) {
        while (pos[(3 * ndx[i]) + axis] < pivot) {
          i++
        }
        while (pos[(3 * ndx[j]) + axis] > pivot) {
          j--
        }
        if (i <= j) {
          const t = ndx[i]
          ndx[i] = ndx[j]
          ndx[j] = t
          i++
          j--
        }
      }
      if (k <= j) {
        hi = j
      } else if (k >= i) {
        lo = i
      } else {
        return
      }
    }
  }


  /**
   * @param {number} q Query point index
   * @param {number} k
   * @returns {Array<number>} Indices of up to k nearest points, excluding q
   */
  nearest(q, k) {
    const best = [] // sorted [d2, ndx], ascending
    this.search(q, 0, this.n, 0, (j) => j !== q, best, k)
    return best.map((b) => b[1])
  }


  /**
   * @param {number} q Query point index
   * @param {Function} accept Predicate on candidate point index
   * @returns {Array<number>} [index, distance] of nearest accepted point, or [-1, Infinity]
   */
  nearestWhere(q, accept) {
    const best = []
    this.search(q, 0, this.n, 0, (j) => j !== q && accept(j), best, 1)
    return best.length ? [best[0][1], Math.sqrt(best[0][0])] : [-1, Infinity]
  }


  /** Recursive kNN search with pruning. */
  search(q, lo, hi, depth, accept, best, k) {
    if (hi <= lo) {
      return
    }
    const pos = this.pos
    const mid = (lo + hi) >> 1
    const p = this.ndx[mid]
    if (accept(p)) {
      const d2 = dist2(pos, q, p)
      if (best.length < k || d2 < best[best.length - 1][0]) {
        let i = best.length
        while (i > 0 && best[i - 1][0] > d2) {
          i--
        }
        best.splice(i, 0, [d2, p])
        if (best.length > k) {
          best.pop()
        }
      }
    }
    const axis = depth % 3
    const delta = pos[(3 * q) + axis] - pos[(3 * p) + axis]
    const [nearLo, nearHi, farLo, farHi] = delta < 0 ?
      [lo, mid, mid + 1, hi] : [mid + 1, hi, lo, mid]
    this.search(q, nearLo, nearHi, depth + 1, accept, best, k)
    if (best.length < k || delta * delta < best[best.length - 1][0]) {
      this.search(q, farLo, farHi, depth + 1, accept, best, k)
    }
  }
}
