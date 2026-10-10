/**
 * Which tiles of a point population to draw and load this frame
 * (js/scene/Gaia.md, "The budget"), from the tile tree's manifest alone:
 * a point is wanted if it is in the field and brighter, from the camera,
 * than the limiting magnitude plus a margin; tiles are taken brightest
 * first, and no more points than the budget.
 *
 * The tiles' magnitudes are from the Sun.  From a camera D light-years from
 * the Sun a point d light-years out is at least d − D away, so it is
 * brighter by at most 5·log10(d / (d − D)), and its direction is within
 * asin(D / d) of the Sun's view of it.  A tile's nearest point bounds both
 * for the tile, and its subtree's nearest for its descendants.  From the
 * solar system (D a few AU) both are nothing, and the tiling is the plain
 * magnitude-ordered sky; from another star the bounds widen, and from
 * inside a tile's reach (D ≥ its nearest point) every point of it is
 * wanted, in every direction.  So the selection is right from anywhere,
 * conservatively, with no octree.
 */


/**
 * @param {number} distMin Light-years, the nearest point
 * @param {number} camDist Light-years, the camera from the Sun
 * @returns {number} How much brighter, at most, a point can be from the
 *   camera than from the Sun, magnitudes (Infinity inside its reach)
 */
export function brightening(distMin, camDist) {
  if (camDist <= 0) {
    return 0
  }
  if (!(distMin > camDist)) {
    return Infinity
  }
  return 5 * Math.log10(distMin / (distMin - camDist))
}


/**
 * @param {number} distMin Light-years
 * @param {number} camDist Light-years
 * @returns {number} The most a point's direction from the camera can be
 *   off its direction from the Sun, radians (π inside its reach)
 */
export function parallaxSpread(distMin, camDist) {
  if (camDist <= 0) {
    return 0
  }
  if (!(distMin > camDist)) {
    return Math.PI
  }
  return Math.asin(camDist / distMin)
}


/**
 * @param {object} tile TileInfo (tileTree.js)
 * @param {object} view
 * @param {boolean} subtree Bound the tile's descendants too
 * @returns {boolean} Whether any of its points can be in the field
 */
export function tileInView(tile, view, subtree) {
  const spread = parallaxSpread(subtree ? tile.distMinSub : tile.distMin, view.camDist)
  if (spread >= Math.PI) {
    return true
  }
  const c = tile.centre
  const d = view.dir
  const cos = (c[0] * d[0]) + (c[1] * d[1]) + (c[2] * d[2])
  const angle = Math.acos(Math.max(-1, Math.min(1, cos)))
  return angle <= view.halfAngle + tile.radius + spread
}


/**
 * A minimal binary heap by key, smallest first.
 */
class Heap {
  /** */
  constructor() {
    this.items = []
  }


  /**
   * @param {number} key
   * @param {object} value
   */
  push(key, value) {
    const a = this.items
    a.push({key, value})
    let i = a.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (a[p].key <= a[i].key) {
        break
      }
      [a[p], a[i]] = [a[i], a[p]]
      i = p
    }
  }


  /** @returns {?object} The smallest */
  pop() {
    const a = this.items
    if (a.length === 0) {
      return null
    }
    const top = a[0]
    const last = a.pop()
    if (a.length > 0) {
      a[0] = last
      let i = 0
      for (;;) {
        const l = (2 * i) + 1
        const r = l + 1
        let m = i
        if (l < a.length && a[l].key < a[m].key) {
          m = l
        }
        if (r < a.length && a[r].key < a[m].key) {
          m = r
        }
        if (m === i) {
          break
        }
        [a[m], a[i]] = [a[i], a[m]]
        i = m
      }
    }
    return top
  }


  /** @returns {number} */
  get size() {
    return this.items.length
  }
}


/**
 * How many of a tile's points are at or brighter than a magnitude, from its
 * sorted magnitudes; before it is loaded, an estimate from its range.
 *
 * @param {object} tile TileInfo
 * @param {number} cut Magnitude from the Sun
 * @param {?Float32Array} mags The loaded tile's magnitudes, sorted
 * @returns {number}
 */
export function countBrighter(tile, cut, mags) {
  if (cut >= tile.magFaint) {
    return tile.count
  }
  if (cut < tile.magBright) {
    return 0
  }
  if (mags) {
    let lo = 0
    let hi = mags.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (mags[mid] <= cut) {
        lo = mid + 1
      } else {
        hi = mid
      }
    }
    return lo
  }
  // Star counts rise by about 10^0.4 a magnitude (Euclidean, uniform
  // density): estimate the share inside the tile's range so.
  const span = tile.magFaint - tile.magBright
  if (!(span > 0)) {
    return tile.count
  }
  const f = ((10 ** (0.4 * (cut - tile.magBright))) - 1) / ((10 ** (0.4 * span)) - 1)
  return Math.ceil(tile.count * Math.max(0, Math.min(1, f)))
}


/**
 * @typedef {object} SelectView
 * @property {Array<number>} dir The camera's view axis, unit, catalogue frame
 * @property {number} halfAngle Half the field's diagonal, radians
 * @property {number} camDist The camera from the Sun, light-years
 * @property {number} limit The magnitude to draw to, margin included
 * @property {number} budget The most points to draw
 */


/**
 * @typedef {object} Selected
 * @property {object} tile TileInfo
 * @property {number} cut Draw the tile's points at or brighter than this
 *   magnitude from the Sun (the limit plus the tile's brightening)
 * @property {number} maxCount At most this many (the budget's share)
 * @property {number} estimate The points this is expected to draw
 */


/**
 * Walk the tile tree brightest first: a tile is wanted if it can be in the
 * field and its brightest point, from the camera, can pass the limit; its
 * children are visited if its subtree's can.  Stops at the budget.
 *
 * @param {Array<object>} roots The order-0 TileInfos
 * @param {Function} childrenOf (tile) => its child TileInfos
 * @param {SelectView} view
 * @param {Function} [loadedMags] (tile) => its sorted magnitudes if loaded, else null
 * @returns {{selected: Array<Selected>, estimate: number, visited: number, budgetHit: boolean}}
 */
export function selectTiles(roots, childrenOf, view, loadedMags = () => null) {
  const heap = new Heap()
  for (const t of roots) {
    heap.push(t.magBright - brightening(t.distMin, view.camDist), t)
  }
  const selected = []
  let estimate = 0
  let visited = 0
  let budgetHit = false
  while (heap.size > 0) {
    const {value: tile} = heap.pop()
    visited++
    if (!tileInView(tile, view, true)) {
      continue
    }
    const own = brightening(tile.distMin, view.camDist)
    if (tileInView(tile, view, false) && tile.magBright - own <= view.limit) {
      if (estimate >= view.budget) {
        budgetHit = true
        break
      }
      const cut = view.limit + own
      const n = countBrighter(tile, cut, loadedMags(tile))
      const maxCount = Math.max(0, view.budget - estimate)
      const take = Math.min(n, maxCount)
      if (n > maxCount) {
        budgetHit = true
      }
      if (take > 0) {
        selected.push({tile, cut, maxCount, estimate: take})
        estimate += take
      }
    }
    // Its descendants are all fainter, from the Sun, than its faintest.
    if (tile.hasChildren && tile.magFaint - brightening(tile.distMinSub, view.camDist) <= view.limit) {
      for (const child of childrenOf(tile)) {
        heap.push(child.magBright - brightening(child.distMin, view.camDist), child)
      }
    }
  }
  return {selected, estimate, visited, budgetHit}
}
