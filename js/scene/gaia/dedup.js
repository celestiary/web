import {pointPixel} from '../points/tileTree.js'


/**
 * The merge with the bundled catalogue (js/scene/Gaia.md, "The merge"): the
 * catalogue keeps every star it has, with its names, and a Gaia star that
 * is one of them is left out of the tiles.  Two tests, in order:
 *
 * 1. **Hipparcos number**: Gaia's cross-match names the star's Hipparcos-2
 *    best neighbour, and the catalogue has that HIP.
 * 2. **Position and magnitude**: a catalogue star within MATCH_RADIUS_ARCSEC
 *    of it at the catalogue's epoch (J1991.25, where its positions are;
 *    the Gaia star carried back by its own motion), and the Gaia star not
 *    more than MATCH_BRIGHTER_MAG brighter than it.  This takes the
 *    catalogue stars the cross-match missed (it has no match for some
 *    bright stars and close pairs), and a close pair's second star, whose
 *    light the catalogue's single entry already holds.  A position-only
 *    solution (no parallax or proper motion: some of the brightest,
 *    saturated stars, whose positions can be arcseconds off) is matched
 *    out to POSITION_ONLY_RADIUS_ARCSEC, if its V is within
 *    MATCH_BRIGHTER_MAG of the catalogue star's either way.
 * 3. **A pair's light** (build.js, after the first two): a Gaia star within
 *    PAIR_RADIUS_ARCSEC of a catalogue star whose light is more than the
 *    Gaia stars already matched to it hold, by at least PAIR_SHARE of the
 *    star's own: the catalogue's entry is a pair Gaia resolves (its
 *    magnitude the pair's), and this is the rest of it.  A light budget:
 *    an entry can't stand for more light than it has.
 */


/**
 * Arcseconds: wide enough for a close pair's second star, whose light the
 * catalogue entry's magnitude can hold, and narrow enough that a chance
 * match is rare: the catalogue's 106,747 circles of 2″ cover 2.5
 * millionths of the sky, so a few chance matches in a million Gaia stars
 * (each of which drops a real star; the build reports the matches by
 * separation, to check).
 */
export const MATCH_RADIUS_ARCSEC = 2
/**
 * Arcseconds: the widest pair a catalogue entry's magnitude may hold both
 * stars of.  Hipparcos's detector's field was 38″ across, and pairs closer
 * than about 10-20″ were measured together (ESA 1997, vol. 1, §2.3).
 */
export const PAIR_RADIUS_ARCSEC = 20
/**
 * The share of a Gaia star's light a catalogue entry must have spare (over
 * the Gaia stars already matched to it) to take it as part of the entry:
 * a half, against the photometry's scatter between the two catalogues.
 */
export const PAIR_SHARE = 0.5
/**
 * Arcseconds, for a position-only Gaia solution: ζ Her's, V 2.9, is 14.7″
 * from the catalogue's ζ Her, V 2.8.
 */
export const POSITION_ONLY_RADIUS_ARCSEC = 20
/** A Gaia star this much brighter than the catalogue star by it is another star. */
export const MATCH_BRIGHTER_MAG = 0.75
/** The order of the cells the catalogue is bucketed by: ~3.4′ across. */
const INDEX_ORDER = 10
const ARCSEC = Math.PI / (180 * 3600)


/**
 * @typedef {object} CatalogueIndex
 * @property {Set<number>} hips The catalogue's HIP numbers
 * @property {Map<number, Array<{dir: Array<number>, mag: number, hip: number}>>} cells Its stars by order-10 cell
 */


/**
 * Bucket the bundled catalogue's stars by direction, for the position test.
 *
 * @param {Array<object>} stars StarProps (StarsCatalog.js): x, y, z in
 *   light-years, absMag, hipId
 * @returns {CatalogueIndex}
 */
export function catalogueIndex(stars) {
  const hips = new Set()
  const cells = new Map()
  for (const s of stars) {
    hips.add(s.hipId)
    const r = Math.hypot(s.x, s.y, s.z)
    if (!(r > 0)) {
      continue
    }
    const dir = [s.x / r, s.y / r, s.z / r]
    const pix = pointPixel({x: dir[0], y: dir[1], z: dir[2]}, INDEX_ORDER)
    if (!cells.has(pix)) {
      cells.set(pix, [])
    }
    cells.get(pix).push({dir, mag: s.mag, hip: s.hipId})
  }
  return {hips, cells}
}


/**
 * The cells a small circle round a direction can touch: its own, and those
 * of points a radius off it in eight directions.
 *
 * @param {Array<number>} dir Unit, catalogue frame
 * @param {number} radius Radians
 * @returns {Set<number>}
 */
function cellsAround(dir, radius) {
  const out = new Set([pointPixel({x: dir[0], y: dir[1], z: dir[2]}, INDEX_ORDER)])
  // Two directions across the line of sight.
  const ref = Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
  const a = normalize(cross(dir, ref))
  const b = cross(dir, a)
  for (let k = 0; k < 8; k++) {
    const t = k * Math.PI / 4
    const c = Math.cos(t) * radius
    const s = Math.sin(t) * radius
    const p = [dir[0] + (c * a[0]) + (s * b[0]), dir[1] + (c * a[1]) + (s * b[1]), dir[2] + (c * a[2]) + (s * b[2])]
    out.add(pointPixel({x: p[0], y: p[1], z: p[2]}, INDEX_ORDER))
  }
  return out
}


/**
 * @param {Array<number>} u
 * @param {Array<number>} v
 * @returns {Array<number>}
 */
function cross(u, v) {
  return [(u[1] * v[2]) - (u[2] * v[1]), (u[2] * v[0]) - (u[0] * v[2]), (u[0] * v[1]) - (u[1] * v[0])]
}


/**
 * @param {Array<number>} v
 * @returns {Array<number>}
 */
function normalize(v) {
  const r = Math.hypot(...v)
  return v.map((c) => c / r)
}


/**
 * @param {object} rec A GaiaRecord: hip, dirHip, v (its V)
 * @param {CatalogueIndex} index
 * @param {object} [opts]
 * @param {number} [opts.radiusArcsec]
 * @param {number} [opts.brighterMag]
 * @returns {?{by: string, hip: number, sepArcsec: number}} The catalogue
 *   star it is, or null if it is a new star
 */
export function matchCatalogue(rec, index, {radiusArcsec = MATCH_RADIUS_ARCSEC, brighterMag = MATCH_BRIGHTER_MAG} = {}) {
  if (rec.hip !== null && rec.hip !== undefined && index.hips.has(rec.hip)) {
    return {by: 'hip', hip: rec.hip, sepArcsec: NaN}
  }
  const wide = rec.positionOnly === true
  const radius = (wide ? Math.max(radiusArcsec, POSITION_ONLY_RADIUS_ARCSEC) : radiusArcsec) * ARCSEC
  const cosR = Math.cos(radius)
  const closeR = Math.cos(radiusArcsec * ARCSEC)
  let best = null
  for (const pix of cellsAround(rec.dirHip, radius)) {
    for (const s of index.cells.get(pix) ?? []) {
      const dot = (s.dir[0] * rec.dirHip[0]) + (s.dir[1] * rec.dirHip[1]) + (s.dir[2] * rec.dirHip[2])
      if (dot < cosR || rec.v < s.mag - brighterMag) {
        continue
      }
      // Past the close radius, only a position-only star of the same V.
      if (dot < closeR && rec.v > s.mag + brighterMag) {
        continue
      }
      const sep = Math.acos(Math.min(1, dot)) / ARCSEC
      if (!best || sep < best.sepArcsec) {
        best = {by: 'position', hip: s.hip, sepArcsec: sep}
      }
    }
  }
  return best
}


/**
 * The catalogue stars within a radius of a direction, nearest first.
 *
 * @param {Array<number>} dir Unit, catalogue frame
 * @param {CatalogueIndex} index
 * @param {number} radiusArcsec
 * @returns {Array<{hip: number, mag: number, sepArcsec: number}>}
 */
export function catalogueNeighbours(dir, index, radiusArcsec) {
  const radius = radiusArcsec * ARCSEC
  const cosR = Math.cos(radius)
  const out = []
  for (const pix of cellsAround(dir, radius)) {
    for (const s of index.cells.get(pix) ?? []) {
      const dot = (s.dir[0] * dir[0]) + (s.dir[1] * dir[1]) + (s.dir[2] * dir[2])
      if (dot >= cosR) {
        out.push({hip: s.hip, mag: s.mag, sepArcsec: Math.acos(Math.min(1, dot)) / ARCSEC})
      }
    }
  }
  return out.sort((a, b) => a.sepArcsec - b.sepArcsec)
}
