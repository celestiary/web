import {ang2pixNest, pixelCone, vecToLoc} from './healpix.js'


/**
 * The tiling of a point population (js/scene/Gaia.md, "Tiling"): HEALPix
 * cells by apparent magnitude, as a hierarchical progressive catalogue
 * (the HiPS catalogue scheme: Fernique et al. 2015, A&A 578, A114).  The 12
 * order-0 cells each hold the brightest `cap` points in them; the rest go
 * down to the cell's four children at order 1, each of which holds its
 * brightest `cap`, and so on, until a cell has `cap` or fewer left, or the
 * deepest order takes all that remain.  So:
 *
 * - a tile's points are all fainter than its parent's, and the brightest
 *   of the whole sky load first, whatever the view;
 * - every tile is about the same size, `cap` points, where the sky is
 *   dense (the plane) and where it is sparse, the tree going deeper where
 *   there are more stars;
 * - a field of view needs only the tiles over it, down to the order whose
 *   points reach the limiting magnitude there.
 *
 * Each tile carries what the renderer needs to decide, without loading it,
 * whether it could hold a point bright enough to draw from wherever the
 * camera is (selection.js): its brightest and faintest magnitudes from the
 * Sun, the nearest of its points, and the nearest in its whole subtree.
 *
 * The cells are cut in ecliptic coordinates, the pole the ecliptic's: the
 * catalogue frame's axes (X the equinox, Y the north ecliptic pole, Z minus
 * ecliptic Y) taken back to (X, −Z, Y).
 */


/**
 * @param {number} x Catalogue frame
 * @param {number} y
 * @param {number} z
 * @returns {Array<number>} The same vector in the cells' axes (ecliptic, z the pole)
 */
export function catalogueToCellAxes(x, y, z) {
  return [x, -z, y]
}


/**
 * @param {Array<number>} v In the cells' axes
 * @returns {Array<number>} In the catalogue frame
 */
export function cellAxesToCatalogue([x, y, z]) {
  return [x, z, -y]
}


/**
 * @param {object} p A point with x, y, z in the catalogue frame
 * @param {number} order
 * @returns {number} The NESTED pixel it is in
 */
export function pointPixel(p, order) {
  const [x, y, z] = catalogueToCellAxes(p.x, p.y, p.z)
  const loc = vecToLoc(x, y, z)
  return ang2pixNest(order, loc.z, loc.phi)
}


/**
 * @typedef {object} TileNode
 * @property {number} order HEALPix order
 * @property {number} pix NESTED
 * @property {Array<object>} points Sorted by mag, brightest first
 * @property {number} count Points
 * @property {number} magBright Apparent magnitude from the Sun of its brightest point
 * @property {number} magFaint Of its faintest
 * @property {number} distMin Light-years: its nearest point to the Sun
 * @property {number} distMinSub The nearest in it and all its descendants
 * @property {boolean} hasChildren Whether its cell has tiles below it
 */


/**
 * Build the tile tree.  Points need x, y, z (light-years, the catalogue
 * frame) and mag.
 *
 * @param {Array<object>} points
 * @param {object} [opts]
 * @param {number} [opts.cap] Points a tile holds before passing the rest down
 * @param {number} [opts.maxOrder] The deepest order; it takes all that remain
 * @returns {Array<TileNode>} Every tile, parents before children
 */
export function buildTileTree(points, {cap = 4096, maxOrder = 9} = {}) {
  if (!(cap >= 1)) {
    throw new Error(`cap must be at least 1: ${cap}`)
  }
  const sorted = points.filter((p) => Number.isFinite(p.mag)).sort((a, b) => a.mag - b.mag)
  const groupBy = (list, order) => {
    const groups = new Map()
    for (const p of list) {
      const pix = pointPixel(p, order)
      let g = groups.get(pix)
      if (!g) {
        g = []
        groups.set(pix, g)
      }
      g.push(p)
    }
    return groups
  }
  const tiles = []
  const byKey = new Map()
  // Breadth first, so parents come before children.
  let level = [...groupBy(sorted, 0).entries()].map(([pix, list]) => ({order: 0, pix, list}))
  while (level.length > 0) {
    const next = []
    level.sort((a, b) => a.pix - b.pix)
    for (const {order, pix, list} of level) {
      const last = order >= maxOrder
      const own = last ? list : list.slice(0, cap)
      const rest = last ? [] : list.slice(cap)
      let distMin = Infinity
      for (const p of own) {
        distMin = Math.min(distMin, Math.hypot(p.x, p.y, p.z))
      }
      const tile = {
        order, pix, points: own, count: own.length,
        magBright: own[0].mag, magFaint: own[own.length - 1].mag,
        distMin, distMinSub: distMin, hasChildren: rest.length > 0,
      }
      tiles.push(tile)
      byKey.set(`${order}/${pix}`, tile)
      for (const [childPix, childList] of groupBy(rest, order + 1)) {
        next.push({order: order + 1, pix: childPix, list: childList})
      }
    }
    level = next
  }
  // The subtree's nearest point, children up.
  for (let i = tiles.length - 1; i >= 0; i--) {
    const t = tiles[i]
    if (t.order > 0) {
      const parent = byKey.get(`${t.order - 1}/${Math.floor(t.pix / 4)}`)
      parent.distMinSub = Math.min(parent.distMinSub, t.distMinSub)
    }
  }
  return tiles
}


/**
 * One tile's manifest entry: a compact row, so the whole tree's index is
 * small.  Magnitudes round outward and distances down, to 0.001, so the
 * bounds stay bounds.
 *
 * @param {TileNode} t
 * @returns {Array<number>} [order, pix, count, magBright, magFaint, distMin, distMinSub, hasChildren]
 */
export function manifestRow(t) {
  const down = (v) => Math.floor(v * 1000) / 1000
  const up = (v) => Math.ceil(v * 1000) / 1000
  return [t.order, t.pix, t.count, down(t.magBright), up(t.magFaint), down(t.distMin), down(t.distMinSub),
    t.hasChildren ? 1 : 0]
}


/**
 * @typedef {object} TileInfo A tile as the renderer knows it before loading it
 * @property {string} key 'order/pix'
 * @property {number} order HEALPix order
 * @property {number} pix NESTED
 * @property {number} count Points
 * @property {number} magBright Its brightest point's magnitude from the Sun
 * @property {number} magFaint Its faintest's
 * @property {number} distMin Light-years
 * @property {number} distMinSub Light-years
 * @property {boolean} hasChildren Whether its cell has tiles below it
 * @property {Array<number>} centre Unit vector, catalogue frame
 * @property {number} radius The cone round the cell, radians
 */


/**
 * A manifest row back to a tile description, with its cone on the sky in
 * the catalogue frame.
 *
 * @param {Array<number>} row
 * @returns {TileInfo}
 */
export function tileFromRow(row) {
  const [order, pix, count, magBright, magFaint, distMin, distMinSub, hasChildren] = row
  const {centre, radius} = pixelCone(order, pix)
  return {
    key: `${order}/${pix}`, order, pix, count, magBright, magFaint, distMin, distMinSub,
    hasChildren: hasChildren === 1, centre: cellAxesToCatalogue(centre), radius,
  }
}
