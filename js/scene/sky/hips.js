import {MAX_ORDER, locToVec, nest2xyf, parentPixel, pix2loc, pixelCone, xyf2loc} from '../points/healpix.js'


// The addressing of an IVOA HiPS 1.0 survey (Sky.md): HEALPix tiles on the
// celestial sphere, NESTED, in the survey's frame.  Pure: tile paths, the
// order for a view, the cells in view, a cell's grid on the sphere, the
// frames, and the coverage (a MOC).  HipsLayer.js draws with it.
//
// A HiPS frame vector is healpix.js's: x toward longitude 0 on the equator,
// z the frame's north pole (RA and Dec for `equatorial`, l and b for
// `galactic`).  The scene's J2000 frame is the catalogue's (wcs.js
// equatorialToScene, galacticFrame.js): x the equinox, y the ecliptic's
// north pole, z −(ecliptic y).

/** A base cell's side, degrees: sqrt(4π / 12) rad. */
export const BASE_CELL_DEG = Math.sqrt(4 * Math.PI / 12) * 180 / Math.PI
/** The deepest order drawn: healpix.js's (a texel of 0.05″ at 512 px). */
export const DEEPEST_ORDER = MAX_ORDER

const toRad = Math.PI / 180
/** cellsInDisc's guard on a descent's width (a disc of 180° at order 6 is 49,152). */
const HARD_LIMIT = 200000
/** J2000's obliquity, as wcs.js and galacticFrame.js have it. */
const OBLIQUITY = 23.4392811 * toRad
const C = Math.cos(OBLIQUITY)
const S = Math.sin(OBLIQUITY)
/** Equatorial (ICRS) to scene, rows. */
const EQUATORIAL = [
  [1, 0, 0],
  [0, -S, C],
  [0, -C, -S],
]
/** Galactic to equatorial (ICRS): the transpose of the IAU's equatorial-to-galactic (Hipparcos, vol. 1, 1.5.3). */
const GAL_TO_EQ = [
  [-0.0548755604, 0.4941094279, -0.8676661490],
  [-0.8734370902, -0.4448296300, -0.1980763734],
  [-0.4838350155, 0.7469822445, 0.4559837762],
]


/**
 * @param {Array<Array<number>>} a
 * @param {Array<Array<number>>} b
 * @returns {Array<Array<number>>} a · b
 */
function mul(a, b) {
  return a.map((row) => [0, 1, 2].map((j) => (row[0] * b[0][j]) + (row[1] * b[1][j]) + (row[2] * b[2][j])))
}


const FRAMES = {
  equatorial: EQUATORIAL,
  galactic: mul(EQUATORIAL, GAL_TO_EQ),
}


/**
 * @param {string} frame A HiPS `hips_frame`: `equatorial` or `galactic`
 * @returns {Array<Array<number>>} The rotation from the frame to the scene's J2000 frame, rows
 */
export function frameMatrix(frame) {
  const m = FRAMES[frame]
  if (!m) {
    throw new Error(`HiPS frame not handled: ${frame}`)
  }
  return m
}


/**
 * @param {Array<Array<number>>} m
 * @param {Array<number>} v
 * @param {Array<number>} [out]
 * @returns {Array<number>} m · v
 */
export function apply(m, v, out = [0, 0, 0]) {
  const [x, y, z] = v
  out[0] = (m[0][0] * x) + (m[0][1] * y) + (m[0][2] * z)
  out[1] = (m[1][0] * x) + (m[1][1] * y) + (m[1][2] * z)
  out[2] = (m[2][0] * x) + (m[2][1] * y) + (m[2][2] * z)
  return out
}


/**
 * @param {Array<Array<number>>} m
 * @param {Array<number>} v
 * @param {Array<number>} [out]
 * @returns {Array<number>} mᵀ · v: a scene direction back in the frame
 */
export function applyTransposed(m, v, out = [0, 0, 0]) {
  const [x, y, z] = v
  out[0] = (m[0][0] * x) + (m[1][0] * y) + (m[2][0] * z)
  out[1] = (m[0][1] * x) + (m[1][1] * y) + (m[2][1] * z)
  out[2] = (m[0][2] * x) + (m[1][2] * y) + (m[2][2] * z)
  return out
}


/**
 * @param {number} lonDeg RA or l
 * @param {number} latDeg Dec or b
 * @returns {Array<number>} The frame's unit vector
 */
export function lonLatToVec(lonDeg, latDeg) {
  return locToVec(Math.sin(latDeg * toRad), lonDeg * toRad)
}


/**
 * A tile's path in the survey (HiPS 1.0, 4.2): the directory holds 10,000
 * tiles.
 *
 * @param {number} order
 * @param {number} pix NESTED
 * @param {string} ext `webp`, `png`, `jpg`
 * @returns {string} `Norder{k}/Dir{D}/Npix{n}.{ext}`
 */
export function tilePath(order, pix, ext) {
  return `Norder${order}/Dir${Math.floor(pix / 10000) * 10000}/Npix${pix}.${ext}`
}


/**
 * @param {number} order
 * @param {number} tileWidth Pixels a tile's side
 * @returns {number} A tile pixel's side at the order, degrees
 */
export function tilePixelDeg(order, tileWidth = 512) {
  return BASE_CELL_DEG / ((2 ** order) * tileWidth)
}


/**
 * The coarsest order whose tile pixel is no bigger than a screen pixel,
 * within the survey's orders (and DEEPEST_ORDER).
 *
 * @param {{minOrder: number, maxOrder: number, tileWidth: number}} survey
 * @param {number} fovDeg The camera's vertical field
 * @param {number} heightPx The canvas's height, device pixels
 * @returns {number}
 */
export function selectOrder(survey, fovDeg, heightPx) {
  const lo = survey.minOrder ?? 0
  const hi = Math.min(survey.maxOrder, DEEPEST_ORDER)
  const screenDeg = fovDeg / heightPx
  for (let k = lo; k <= hi; k++) {
    if (tilePixelDeg(k, survey.tileWidth) <= screenDeg) {
      return k
    }
  }
  return hi
}


/**
 * The preferred tile format of those a survey offers: webp, then png, then jpg.
 *
 * @param {Array<string>} formats The survey's, e.g. ['png', 'webp']
 * @param {boolean} [webp] Whether the browser decodes webp
 * @returns {string} The file extension
 */
export function chooseFormat(formats, webp = true) {
  return formatOrder(formats, webp)[0]
}


/**
 * The image formats a survey offers, most preferred first: webp, png, jpeg.
 *
 * @param {Array<string>} formats The survey's
 * @param {boolean} [webp] Whether the browser decodes webp
 * @returns {Array<string>} File extensions; throws if none is an image
 */
export function formatOrder(formats, webp = true) {
  const has = (f) => formats.includes(f)
  const out = []
  if (webp && has('webp')) {
    out.push('webp')
  }
  if (has('png')) {
    out.push('png')
  }
  if (has('jpeg') || has('jpg')) {
    out.push('jpg')
  }
  if (!out.length) {
    throw new Error(`No image format among ${formats.join(', ')}`)
  }
  return out
}


/**
 * @param {Array<number>} a Any length
 * @param {Array<number>} b Any length
 * @returns {number} The angle between, radians (atan2 of the cross and dot
 *   products: exact at small angles, where acos of the dot isn't)
 */
export function angle(a, b) {
  const dot = (a[0] * b[0]) + (a[1] * b[1]) + (a[2] * b[2])
  const cx = (a[1] * b[2]) - (a[2] * b[1])
  const cy = (a[2] * b[0]) - (a[0] * b[2])
  const cz = (a[0] * b[1]) - (a[1] * b[0])
  return Math.atan2(Math.hypot(cx, cy, cz), dot)
}


/**
 * A survey's coverage from a MOC in its JSON form (MOC 1.1: order → NESTED
 * cells, possibly at several orders).
 *
 * @param {?{[order: string]: Array<number>}} moc null for the whole sky
 * @returns {{maxOrder: number, intersects: (order: number, pix: number) => boolean, cellCount: number}}
 */
export function newCoverage(moc) {
  if (!moc) {
    return {maxOrder: 0, cellCount: 12, intersects: () => true, all: true}
  }
  /** order → Set of cells wholly in. */
  const full = new Map
  /** order → Set of cells with some of the coverage in (the cells' ancestors). */
  const partial = new Map
  let maxOrder = 0
  let cellCount = 0
  for (const [k, cells] of Object.entries(moc)) {
    const order = Number(k)
    if (!(order >= 0) || !Array.isArray(cells) || cells.length === 0) {
      continue
    }
    maxOrder = Math.max(maxOrder, order)
    const set = full.get(order) ?? new Set
    full.set(order, set)
    for (const pix of cells) {
      set.add(pix)
      cellCount++
      for (let o = 0; o <= order; o++) {
        const p = partial.get(o) ?? new Set
        partial.set(o, p)
        p.add(parentPixel(pix, order, o))
      }
    }
  }
  return {
    maxOrder,
    cellCount,
    all: false,
    intersects(order, pix) {
      if (order <= maxOrder && partial.get(order)?.has(pix)) {
        return true
      }
      // A coarser cell of the coverage that holds this one.
      for (const [o, set] of full) {
        if (o < order && set.has(parentPixel(pix, order, o))) {
          return true
        }
      }
      return false
    },
  }
}


/**
 * A MOC in its JSON form from cells at one order, each four siblings all in
 * merged into their parent, up to the base cells.
 *
 * @param {number} order
 * @param {Array<number>|Set<number>} cells NESTED at the order
 * @returns {{[order: string]: Array<number>}} order → sorted cells, orders with none left out
 */
export function mocFromCells(order, cells) {
  const out = {}
  let level = new Set(cells)
  for (let o = order; o >= 0; o--) {
    const parents = new Map
    for (const pix of level) {
      const p = Math.floor(pix / 4)
      parents.set(p, (parents.get(p) ?? 0) + 1)
    }
    const kept = []
    const up = new Set
    for (const pix of level) {
      if (o > 0 && parents.get(Math.floor(pix / 4)) === 4) {
        up.add(Math.floor(pix / 4))
      } else {
        kept.push(pix)
      }
    }
    if (kept.length) {
      out[o] = kept.sort((a, b) => a - b)
    }
    level = up
  }
  return out
}


/**
 * The NESTED cells at an order that meet a disc: a descent from the base
 * cells, each kept while its bounding cone (healpix.js pixelCone) meets the
 * disc and, given a coverage, while it meets the coverage.  Conservative: a
 * cell near the disc's edge may be in when it only nearly meets it.
 *
 * @param {number} order
 * @param {Array<number>} centre The disc's centre, a unit vector in the HEALPix frame
 * @param {number} radius Radians
 * @param {object} [opts]
 * @param {?object} [opts.coverage] newCoverage's
 * @param {number} [opts.limit] Stop past this many cells (a guard; the caller's view should never get there)
 * @returns {Array<number>} The cells, nearest the centre first
 */
export function cellsInDisc(order, centre, radius, {coverage = null, limit = 4096} = {}) {
  let level = [...Array(12).keys()]
  for (let o = 0; o <= order; o++) {
    const next = []
    for (const pix of level) {
      if (coverage && !coverage.intersects(o, pix)) {
        continue
      }
      const cone = pixelCone(o, pix)
      const d = angle(cone.centre, centre)
      if (d > radius + cone.radius) {
        continue
      }
      if (o === order) {
        next.push({pix, d})
      } else {
        for (let c = 0; c < 4; c++) {
          next.push((pix * 4) + c)
        }
      }
    }
    if (next.length > HARD_LIMIT) {
      throw new Error(`cellsInDisc: over ${HARD_LIMIT} cells at order ${o}`)
    }
    if (o === order) {
      return next.sort((a, b) => a.d - b.d).slice(0, limit).map((e) => e.pix)
    }
    level = next
  }
  return []
}


/**
 * Whether a disc meets a coverage: any of its cells at the coverage's
 * deepest order (or the given one, if coarser) in the disc.
 *
 * @param {object} coverage newCoverage's
 * @param {Array<number>} centre Unit vector, HEALPix frame
 * @param {number} radius Radians
 * @param {number} [maxOrder] The deepest order to look at
 * @returns {boolean}
 */
export function discMeetsCoverage(coverage, centre, radius, maxOrder = 8) {
  if (coverage.all) {
    return true
  }
  return cellsInDisc(Math.min(coverage.maxOrder, maxOrder), centre, radius, {coverage, limit: 1}).length > 0
}


/**
 * A point of a cell as a tile's image puts it: image column u and row v,
 * each 0..1 from the tile's top-left (HiPS 1.0's layout, Aladin's: the
 * cell's south corner, (dx, dy) = (0, 0), is the image's top-left, its
 * north corner the bottom-right, its west corner, (0, 1), the top-right).
 * So the row runs along HEALPix x and the column along y.  Settled on real
 * tiles (Sky.md, "The tile's orientation").
 *
 * @param {number} order
 * @param {number} pix NESTED
 * @param {number} u Image column, 0..1 left to right
 * @param {number} v Image row, 0..1 top to bottom
 * @returns {{z: number, phi: number}}
 */
export function tileUvToLoc(order, pix, u, v) {
  const nside = 2 ** order
  const {ix, iy, face} = nest2xyf(pix, order)
  return xyf2loc((ix + v) / nside, (iy + u) / nside, face)
}


/**
 * A cell's grid on the sphere, in the scene's frame: (grid + 1)² vertices,
 * row by row from the tile's top-left, with their uv (v down the image, for
 * a texture read with flipY off), and the triangles' indices.
 *
 * @param {number} order
 * @param {number} pix
 * @param {Array<Array<number>>} toScene frameMatrix's
 * @param {number} [grid]
 * @returns {{positions: Float32Array, uvs: Float32Array, index: Array<number>}}
 */
export function cellGrid(order, pix, toScene, grid = 8) {
  const n = grid + 1
  const positions = new Float32Array(n * n * 3)
  const uvs = new Float32Array(n * n * 2)
  const index = []
  const v = [0, 0, 0]
  const s = [0, 0, 0]
  for (let j = 0; j <= grid; j++) {
    for (let i = 0; i <= grid; i++) {
      const loc = tileUvToLoc(order, pix, i / grid, j / grid)
      apply(toScene, locToVec(loc.z, loc.phi, v), s)
      const k = (j * n) + i
      positions.set(s, k * 3)
      uvs[k * 2] = i / grid
      uvs[(k * 2) + 1] = j / grid
    }
  }
  for (let j = 0; j < grid; j++) {
    for (let i = 0; i < grid; i++) {
      const a = (j * n) + i
      index.push(a, a + n, a + 1, a + 1, a + n, a + n + 1)
    }
  }
  return {positions, uvs, index}
}


/**
 * A cell's centre, scene frame.
 *
 * @param {number} order
 * @param {number} pix
 * @param {Array<Array<number>>} toScene
 * @returns {Array<number>}
 */
export function cellCentre(order, pix, toScene) {
  const c = pix2loc(order, pix)
  return apply(toScene, locToVec(c.z, c.phi))
}
