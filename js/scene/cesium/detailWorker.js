/**
 * The detail's tiles, off the main thread (CESIUM.md, "Detail over the
 * month's colour"): a worker of its own build (esbuild/common.js
 * detailWorkerConfig, docs/cesium/detail-worker.js) that takes Bing's tile,
 * its ancestor and the month's Blue Marble tiles as ImageBitmaps (decoded
 * off the main thread by createImageBitmap), reads their pixels on an
 * OffscreenCanvas, and makes the tile (DetailComposer), sent back as a
 * transferred buffer.  Its caches are the composer's: a tile's ratios, an
 * ancestor's luminance and a Blue Marble tile's pixels are read once.
 *
 * A message: {id, job} with job as DetailComposer.compose's but with
 * `fine`, `low` (ImageBitmaps or null, `flipped` if decoded flipped) and
 * `base` ([[x, y, ImageBitmap]...]) for its getters.  The answer: {id,
 * buffer} or {id, error}.
 */
import {DetailComposer, lumaOf} from './detailTransfer.js'


const composer = new DetailComposer()
const canvases = new Map()


/**
 * @param {object} bitmap
 * @param {number} size
 * @returns {Uint8ClampedArray} Its RGBA at size × size
 */
function pixelsOf(bitmap, size) {
  let ctx = canvases.get(size)
  if (!ctx) {
    ctx = new OffscreenCanvas(size, size).getContext('2d', {willReadFrequently: true})
    canvases.set(size, ctx)
  }
  ctx.clearRect(0, 0, size, size)
  ctx.drawImage(bitmap, 0, 0, size, size)
  return ctx.getImageData(0, 0, size, size).data
}


self.onmessage = ({data: {id, job}}) => {
  const closing = [job.fine, job.low, ...job.base.map((b) => b[2])]
  try {
    const size = job.tile.size
    const base = new Map(job.base.map(([x, y, bitmap]) => [`${x}/${y}`, bitmap]))
    const out = composer.compose({
      ...job,
      fineLuma: () => (job.fine ? lumaOf(pixelsOf(job.fine, size), job.flipped, size) : null),
      lowLuma: () => (job.low ? lumaOf(pixelsOf(job.low, size), job.flipped, size) : null),
      basePixels: (x, y) => pixelsOf(base.get(`${x}/${y}`), job.grid.tileSize),
    })
    self.postMessage({id, buffer: out.buffer}, [out.buffer])
  } catch (err) {
    self.postMessage({id, error: String(err?.message ?? err)})
  } finally {
    // Clones of the main thread's: this side's copies.
    for (const b of closing) {
      b?.close?.()
    }
  }
}
