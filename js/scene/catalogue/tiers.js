import {FAVES} from '../StarsCatalog.js'
import {PC_TO_CATALOGUE_LY} from '../gaia/astrometry.js'
import {HAS_CLASS, HAS_HIP} from '../points/tileFormat.js'


/**
 * The bundled catalogue (stars.dat, Celestia's Hipparcos-based ~107,000
 * stars) as brightness tiers on the point-population engine
 * (js/scene/Stars.md, "Brightness tiers"; DESIGN.md, "What loads when"):
 * the same HEALPix-by-magnitude tiles Gaia's stars are (Gaia.md,
 * "Tiling"), with the catalogue's own columns, a HIP number and a class.
 *
 * - **The bright tier** is the tree's 12 roots: every star to V 6.5 from
 *   the Sun (the naked-eye sky, 8,746 stars) and every star the app names
 *   or labels whatever its magnitude (starnames.dat's 3,327, a few of them
 *   faint: Proxima, the Gliese stars; the very luminous stars the label
 *   sheet shows by number; the favourites).  So the names, the search, the
 *   label sheet, the asterisms and the favourites all resolve from it.
 * - **The rest** go down the tree from order 1, `TILE_CAP` a tile, brightest
 *   first in each cell.
 * - **Packs**: the roots travel as one file, the bright tier's one request,
 *   and each root's descendants as another (12), so the whole catalogue is
 *   14 requests with the manifest, not one a tile.
 *
 * `yarn stars` (tools/stars/build.mjs, from build.js here) writes it to
 * public/large/stars/v1/; tools/stars/stars.test.js fails when it has
 * drifted from stars.dat or starnames.dat.  This file is the rule and
 * the constants, which the app reads too; build.js, the build.
 */


/** The tiles' directory under public/ (dataUrl), by format version. */
export const CATALOGUE_TILES_DIR = 'large/stars/v1'
/** The naked eye's limit: the bright tier holds every star this bright from the Sun. */
export const BRIGHT_TIER_MAG = 6.5
/**
 * The label sheet names a star with no name by its number if it is this
 * luminous (Stars.js showLabels), so those are in the bright tier too.
 */
export const LUMINOUS_LABEL_ABS_MAG = -5
/**
 * Stars a tile below the roots holds before passing the rest down, as
 * Gaia's (gaia/build.js).  The catalogue's 97,867 fainter stars then fill
 * order 1 alone: 48 tiles, none over the cap.
 */
export const TILE_CAP = 4096
/** The deepest order, as Gaia's; the catalogue's tree stops at 1. */
export const MAX_ORDER = 9
/** The catalogue's columns: positions, HIP, absolute V, Teff (0: from the class), class. */
export const CATALOGUE_FLAGS = HAS_HIP | HAS_CLASS
/** The roots' pack: the bright tier. */
export const ROOTS_PACK = 'roots'


/**
 * @param {number} absMag
 * @param {number} x Light-years
 * @param {number} y
 * @param {number} z
 * @returns {number} Its apparent V from the Sun, as the engine reckons it
 *   (starTile.js): Celestia's light-years, PC_TO_CATALOGUE_LY to a parsec
 */
export function apparentMag(absMag, x, y, z) {
  const pc = Math.hypot(x, y, z) / PC_TO_CATALOGUE_LY
  return absMag + (5 * Math.log10(Math.max(pc, 1e-12) / 10))
}


/**
 * @param {string} text starnames.dat
 * @returns {Set<number>} The HIP numbers it names
 */
export function namedHips(text) {
  const out = new Set()
  for (const line of text.split('\n')) {
    const parts = line.split(':')
    const hip = parseInt(parts[0])
    if (parts.length >= 2 && Number.isFinite(hip)) {
      out.add(hip)
    }
  }
  return out
}


/**
 * @param {object} rec A point record (catalogueRecords)
 * @param {Set<number>} named starnames.dat's HIP numbers
 * @returns {boolean} Whether it is in the bright tier, the roots
 */
export function inBrightTier(rec, named) {
  return rec.mag <= BRIGHT_TIER_MAG || named.has(rec.hipId) || FAVES.has(rec.hipId) ||
    rec.absMag < LUMINOUS_LABEL_ABS_MAG
}
