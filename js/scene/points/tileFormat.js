import {fromHalf, toHalf} from './float16.js'


/**
 * A point population's tiles on disk (js/scene/Gaia.md, "Tile format").
 * One tile is one binary file of columns, little-endian, its points sorted
 * by apparent magnitude from the Sun, brightest first:
 *
 *   bytes 0-7    'CELPOINT'
 *   uint32       format version (1)
 *   uint32       count, n
 *   uint32       flags: HAS_IDS, HAS_VELOCITY
 *   uint32       reserved (0)
 *   float32 ×3n  position, light-years, in the catalogue frame (the J2000
 *                ecliptic with the scene's axes: X the equinox, Y the north
 *                ecliptic pole, Z minus ecliptic Y), at the epoch
 *   uint32  ×2n  id, low and high words (Gaia's source_id), if HAS_IDS
 *   float16 ×3n  space velocity, km/s, the same axes, if HAS_VELOCITY
 *   int16   ×n   absolute visual magnitude × ABS_MAG_SCALE
 *   uint16  ×n   effective temperature, K (0: unknown)
 *
 * Columns rather than records, so each goes to the GPU or to a typed array
 * view as it is, aligned (the header is 24 bytes and every column before a
 * 2-byte one is a multiple of 4).  30 bytes a star with ids and velocity.
 */


export const MAGIC = 'CELPOINT'
export const VERSION = 1
export const HEADER_BYTES = 24
export const HAS_IDS = 1
export const HAS_VELOCITY = 2
/**
 * Absolute magnitudes in 1/1024 mag: ±32 mag, 0.001 mag a step, and the
 * bundled catalogue's 1/256 steps exactly.
 */
export const ABS_MAG_SCALE = 1024
/** The manifest's file name, beside the tiles' order directories. */
export const INDEX_FILE = 'index.json'


/**
 * @typedef {object} PointRecord One point, as the tiler holds it
 * @property {number} x Light-years, catalogue frame, at the epoch
 * @property {number} y Light-years
 * @property {number} z Light-years
 * @property {number} [vx] km/s, catalogue frame
 * @property {number} [vy] km/s
 * @property {number} [vz] km/s
 * @property {number} absMag Absolute visual magnitude
 * @property {number} teff K, 0 if unknown
 * @property {number} mag Apparent visual magnitude from the Sun at the epoch: the sort key
 * @property {bigint} [id] Its catalogue id (Gaia's source_id)
 */


/**
 * @param {number} count
 * @param {number} flags
 * @returns {number} The tile's size in bytes
 */
export function tileBytes(count, flags) {
  let size = HEADER_BYTES + (12 * count)
  if (flags & HAS_IDS) {
    size += 8 * count
  }
  if (flags & HAS_VELOCITY) {
    size += 6 * count
  }
  return size + (4 * count)
}


/**
 * @param {Array<PointRecord>} records Sorted by mag, brightest first
 * @param {number} flags HAS_IDS | HAS_VELOCITY
 * @returns {ArrayBuffer}
 */
export function encodeTile(records, flags) {
  const n = records.length
  const buf = new ArrayBuffer(tileBytes(n, flags))
  const dv = new DataView(buf)
  for (let i = 0; i < MAGIC.length; i++) {
    dv.setUint8(i, MAGIC.charCodeAt(i))
  }
  dv.setUint32(8, VERSION, true)
  dv.setUint32(12, n, true)
  dv.setUint32(16, flags, true)
  dv.setUint32(20, 0, true)
  let off = HEADER_BYTES
  for (const r of records) {
    dv.setFloat32(off, r.x, true)
    dv.setFloat32(off + 4, r.y, true)
    dv.setFloat32(off + 8, r.z, true)
    off += 12
  }
  if (flags & HAS_IDS) {
    for (const r of records) {
      const id = BigInt.asUintN(64, BigInt(r.id ?? 0))
      dv.setUint32(off, Number(id & 0xffffffffn), true)
      dv.setUint32(off + 4, Number(id >> 32n), true)
      off += 8
    }
  }
  if (flags & HAS_VELOCITY) {
    for (const r of records) {
      dv.setUint16(off, toHalf(r.vx ?? 0), true)
      dv.setUint16(off + 2, toHalf(r.vy ?? 0), true)
      dv.setUint16(off + 4, toHalf(r.vz ?? 0), true)
      off += 6
    }
  }
  for (const r of records) {
    dv.setInt16(off, Math.max(-32768, Math.min(32767, Math.round(r.absMag * ABS_MAG_SCALE))), true)
    off += 2
  }
  for (const r of records) {
    dv.setUint16(off, Math.max(0, Math.min(65535, Math.round(r.teff || 0))), true)
    off += 2
  }
  return buf
}


/**
 * @typedef {object} DecodedTile
 * @property {number} count Points
 * @property {number} flags HAS_IDS, HAS_VELOCITY
 * @property {Float32Array} position Light-years, 3 a point
 * @property {?Uint32Array} ids Low and high words, 2 a point
 * @property {?Uint16Array} velocity Half floats, km/s, 3 a point
 * @property {Int16Array} absMag × ABS_MAG_SCALE
 * @property {Uint16Array} teff K
 */


/**
 * Views onto a tile's columns; nothing is copied.
 *
 * @param {ArrayBuffer} buf
 * @returns {DecodedTile}
 */
export function decodeTile(buf) {
  const dv = new DataView(buf)
  if (buf.byteLength < HEADER_BYTES) {
    throw new Error(`Tile too short: ${buf.byteLength} bytes`)
  }
  for (let i = 0; i < MAGIC.length; i++) {
    if (dv.getUint8(i) !== MAGIC.charCodeAt(i)) {
      throw new Error('Not a point tile: bad magic')
    }
  }
  const version = dv.getUint32(8, true)
  if (version !== VERSION) {
    throw new Error(`Point tile version ${version}, expected ${VERSION}`)
  }
  const count = dv.getUint32(12, true)
  const flags = dv.getUint32(16, true)
  if (buf.byteLength !== tileBytes(count, flags)) {
    throw new Error(`Tile is ${buf.byteLength} bytes, expected ${tileBytes(count, flags)} for ${count} points`)
  }
  let off = HEADER_BYTES
  const position = new Float32Array(buf, off, 3 * count)
  off += 12 * count
  let ids = null
  if (flags & HAS_IDS) {
    ids = new Uint32Array(buf, off, 2 * count)
    off += 8 * count
  }
  let velocity = null
  if (flags & HAS_VELOCITY) {
    velocity = new Uint16Array(buf, off, 3 * count)
    off += 6 * count
  }
  const absMag = new Int16Array(buf, off, count)
  off += 2 * count
  const teff = new Uint16Array(buf, off, count)
  return {count, flags, position, ids, velocity, absMag, teff}
}


/**
 * @param {DecodedTile} tile
 * @param {number} i
 * @returns {bigint} The point's id
 */
export function tileId(tile, i) {
  if (!tile.ids) {
    return 0n
  }
  return (BigInt(tile.ids[(2 * i) + 1]) << 32n) | BigInt(tile.ids[2 * i])
}


/**
 * @param {DecodedTile} tile
 * @param {number} i
 * @returns {Array<number>} The point's velocity, km/s
 */
export function tileVelocity(tile, i) {
  if (!tile.velocity) {
    return [0, 0, 0]
  }
  const v = tile.velocity
  return [fromHalf(v[3 * i]), fromHalf(v[(3 * i) + 1]), fromHalf(v[(3 * i) + 2])]
}


/**
 * A tile's path under the population's base, by HEALPix order and NESTED
 * pixel.
 *
 * @param {number} order
 * @param {number} pix
 * @returns {string}
 */
export function tilePath(order, pix) {
  return `${order}/${pix}.bin`
}
