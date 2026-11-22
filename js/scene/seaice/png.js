/**
 * A PNG's palette indices, not its colours: GIBS's sea ice tiles are 8-bit
 * colour-mapped PNGs whose index is the colour map's `ref`, so the index is
 * the datum itself (seaIceSource.js).  A canvas would hand back colours,
 * colour-managed by the browser, to be matched against the palette; this
 * reads the indices exactly, and runs in bun's tests with no DOM.
 *
 * Only what GIBS sends: 8-bit indexed colour (type 3), not interlaced.
 * The scanlines' filters are PNG's five (the spec, section 9).
 */


const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const COLOUR_INDEXED = 3


/**
 * @param {Uint8Array} bytes A whole PNG file
 * @returns {Promise<{width: number, height: number, indices: Uint8Array}>}
 *   Its pixels' palette indices, row 0 at the top
 */
export async function decodeIndexedPng(bytes) {
  for (let i = 0; i < SIGNATURE.length; i++) {
    if (bytes[i] !== SIGNATURE[i]) {
      throw new Error('not a PNG')
    }
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let width = 0
  let height = 0
  const idat = []
  let at = SIGNATURE.length
  while (at + 8 <= bytes.length) {
    const length = view.getUint32(at)
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7])
    const data = bytes.subarray(at + 8, at + 8 + length)
    if (type === 'IHDR') {
      width = view.getUint32(at + 8)
      height = view.getUint32(at + 12)
      const depth = data[8]
      const colour = data[9]
      const interlace = data[12]
      if (depth !== 8 || colour !== COLOUR_INDEXED || interlace !== 0) {
        throw new Error(`PNG not 8-bit indexed, uninterlaced (depth ${depth}, colour ${colour}, interlace ${interlace})`)
      }
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    at += 12 + length
  }
  if (!width || !height || idat.length === 0) {
    throw new Error('PNG has no image')
  }
  const raw = await inflate(idat)
  return {width, height, indices: unfilter(raw, width, height)}
}


/**
 * @param {Array<Uint8Array>} parts The IDAT chunks' data, a zlib stream
 * @returns {Promise<Uint8Array>} Inflated
 */
async function inflate(parts) {
  const stream = new Blob(parts).stream().pipeThrough(new DecompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}


/**
 * Undo the scanlines' filters, one byte a pixel.
 *
 * @param {Uint8Array} raw The inflated scanlines, each led by its filter byte
 * @param {number} width
 * @param {number} height
 * @returns {Uint8Array} width × height
 */
export function unfilter(raw, width, height) {
  const out = new Uint8Array(width * height)
  if (raw.length < (width + 1) * height) {
    throw new Error('PNG data short')
  }
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (width + 1)]
    const src = (y * (width + 1)) + 1
    const row = y * width
    const up = row - width
    for (let x = 0; x < width; x++) {
      const a = x > 0 ? out[row + x - 1] : 0
      const b = y > 0 ? out[up + x] : 0
      const c = x > 0 && y > 0 ? out[up + x - 1] : 0
      const v = raw[src + x]
      let p
      switch (filter) {
        case 0: p = v; break
        case 1: p = v + a; break
        case 2: p = v + b; break
        case 3: p = v + ((a + b) >> 1); break
        case 4: p = v + paeth(a, b, c); break
        default: throw new Error(`PNG filter ${filter}`)
      }
      out[row + x] = p & 0xff
    }
  }
  return out
}


/**
 * @param {number} a Left
 * @param {number} b Up
 * @param {number} c Up left
 * @returns {number} PNG's Paeth predictor
 */
function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) {
    return a
  }
  return pb <= pc ? b : c
}
