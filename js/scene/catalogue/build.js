import {INDEX_FILE, encodePack, encodeTile, packPath} from '../points/tileFormat.js'
import {buildTileTree, manifestRow} from '../points/tileTree.js'
import {
  BRIGHT_TIER_MAG,
  CATALOGUE_FLAGS,
  LUMINOUS_LABEL_ABS_MAG,
  MAX_ORDER,
  ROOTS_PACK,
  TILE_CAP,
  apparentMag,
  inBrightTier,
  namedHips,
} from './tiers.js'


/**
 * The catalogue's tiers built from stars.dat and starnames.dat (tiers.js;
 * Stars.md, "Brightness tiers"), without the file system:
 * tools/stars/build.mjs reads the two and writes what this returns.
 */


/**
 * stars.dat's records as the tiler's point records: the stored float32
 * light-years, absolute V and class as they are, so a star read from a
 * tile is the star read from stars.dat.
 *
 * @param {Array<object>} raw StarsCatalog.js readCelestiaStars
 * @returns {Array<object>} PointRecords with hipId and clazz; Teff 0 (from the class)
 */
export function catalogueRecords(raw) {
  return raw.map((r) => ({
    hipId: r.hipId, x: r.x, y: r.y, z: r.z, absMag: r.absMag, clazz: r.clazz, teff: 0,
    mag: apparentMag(r.absMag, r.x, r.y, r.z),
  }))
}


/**
 * The tiers' files and manifest.
 *
 * @param {Array<object>} raw StarsCatalog.js readCelestiaStars of stars.dat
 * @param {string} namesText starnames.dat
 * @param {object} [meta] More for the manifest (its source's provenance)
 * @returns {{files: Map<string, ArrayBuffer>, manifest: object}} By path
 *   under the tiers' directory, the manifest among them
 */
export function buildCatalogueTiers(raw, namesText, meta = {}) {
  const named = namedHips(namesText)
  const records = catalogueRecords(raw)
  const tiles = buildTileTree(records, {cap: TILE_CAP, maxOrder: MAX_ORDER, rootsHold: (p) => inBrightTier(p, named)})
  const packs = {[ROOTS_PACK]: []}
  const packed = new Map([[ROOTS_PACK, []]])
  for (const t of tiles) {
    // A tile's root is its pixel's top bits: NESTED pixels nest by 4.
    const name = t.order === 0 ? ROOTS_PACK : String(t.pix >> (2 * t.order))
    if (!packed.has(name)) {
      packed.set(name, [])
      packs[name] = []
    }
    packed.get(name).push({order: t.order, pix: t.pix, buf: encodeTile(t.points, CATALOGUE_FLAGS)})
    packs[name].push(`${t.order}/${t.pix}`)
  }
  const files = new Map()
  const packBytes = {}
  for (const [name, list] of packed) {
    const buf = encodePack(list)
    files.set(packPath(name), buf)
    packBytes[name] = buf.byteLength
  }
  const roots = tiles.filter((t) => t.order === 0)
  const byOrder = {}
  for (const t of tiles) {
    byOrder[t.order] = (byOrder[t.order] ?? 0) + 1
  }
  const manifest = {
    format: 'celestiary-points',
    version: 1,
    name: 'catalogue',
    title: 'The bundled catalogue (stars.dat, Hipparcos-based), as brightness tiers',
    // Hipparcos's (Gaia.md, "Frame and epoch"); its stars don't move.
    epoch: 1991.25,
    frame: 'as stars.dat: J2000 mean ecliptic, scene axes; positions in light-years (x LIGHTYEAR_METER = metres)',
    magnitude: 'V, as stars.dat',
    ...meta,
    count: records.length,
    brightTier: {
      rule: `V <= ${BRIGHT_TIER_MAG} from the Sun, or named in starnames.dat, a favourite (StarsCatalog.js FAVES), ` +
        `or brighter than absolute V ${LUMINOUS_LABEL_ABS_MAG} (labelled by number)`,
      stars: roots.reduce((a, t) => a + t.count, 0),
      toMag: records.filter((r) => r.mag <= BRIGHT_TIER_MAG).length,
      pack: ROOTS_PACK,
    },
    tileCap: TILE_CAP,
    maxOrder: MAX_ORDER,
    flags: CATALOGUE_FLAGS,
    tileCount: tiles.length,
    tilesByOrder: byOrder,
    packBytes,
    columns: ['order', 'pix', 'count', 'magBright', 'magFaint', 'distMinLy', 'distMinSubLy', 'hasChildren',
      'magSub (the brightest below; roots only)'],
    tiles: tiles.map(manifestRow),
    packs,
  }
  files.set(INDEX_FILE, new TextEncoder().encode(`${JSON.stringify(manifest)}\n`).buffer)
  return {files, manifest}
}
