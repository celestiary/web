/**
 * The imagery provider that gives Earth's globe ion's detail over the
 * month's Blue Marble (detailTransfer.js; CESIUM.md, "Detail over the
 * month's colour"): a wrapper of ion's provider, one per month shown.
 *
 * The main thread only gathers each tile's images: Bing's tile and its
 * ancestor at the Blue Marble's scale (ImageBitmaps, decoded off the main
 * thread by Cesium's createImageBitmap), and the month's Blue Marble tiles
 * under it (fetched and decoded the same way).  A worker reads their pixels
 * and makes the tile (detailWorker.js), and hands back its buffer, which
 * Cesium uploads as ImageData.  Made on the main thread, a tile's reads and
 * arithmetic were 50-400 ms tasks, and the hand-off stuttered at 17 fps on
 * an M2.  Without a worker (none, or one that fails) the same composer runs
 * here, as before.
 */
import {DetailComposer, PromiseCache, ancestorTile, lowpassLevel, lumaOf} from './detailTransfer.js'


/** Images kept on the main thread, so a second month's tile fetches nothing again. */
const FINE_CACHE = 24
const LOW_CACHE = 32
const BASE_CACHE = 48

/** Workers, and tiles in flight on each; the rest wait here. */
const POOL_SIZE = 2
const IN_FLIGHT = 3


/**
 * An image's RGBA at its size, on the main thread (the fallback).
 *
 * @param {object} image An ImageBitmap, image or canvas
 * @param {number} size
 * @returns {Uint8ClampedArray}
 */
function pixelsOf(image, size) {
  const canvas = typeof OffscreenCanvas === 'function' ?
    new OffscreenCanvas(size, size) :
    Object.assign(document.createElement('canvas'), {width: size, height: size})
  const ctx = canvas.getContext('2d', {willReadFrequently: true})
  ctx.drawImage(image, 0, 0, size, size)
  return ctx.getImageData(0, 0, size, size).data
}


/**
 * @param {object} image
 * @returns {boolean} Whether it is an ImageBitmap: Cesium's imagery so is
 *   decoded flipped (Resource fetchImage's flipY, which WebGL can't do to a
 *   bitmap), and so can go to a worker
 */
function isBitmap(image) {
  return typeof ImageBitmap === 'function' && image instanceof ImageBitmap
}


/**
 * The workers that make the detail's tiles.  A tile goes to the worker its
 * key hashes to, so its ratios are cached in one place; each takes
 * IN_FLIGHT at a time, and the rest queue here, where a tile Cesium has
 * given up on is dropped before it is sent.
 */
export class DetailWorkers {
  /**
   * @param {function(): object} makeWorker
   * @param {number} [size]
   */
  constructor(makeWorker, size = POOL_SIZE) {
    this.failed = false
    // Tiles the workers made, for a probe.
    this.made = 0
    this.nextId = 1
    this.pending = new Map()
    this.workers = []
    for (let i = 0; i < size; i++) {
      const worker = makeWorker()
      const slot = {worker, busy: 0, queue: []}
      worker.onmessage = ({data}) => this._answer(slot, data)
      worker.onerror = () => this._fail()
      this.workers.push(slot)
    }
  }


  /**
   * @param {object} job detailWorker.js's
   * @param {function(): boolean} cancelled Whether Cesium has given the tile up
   * @returns {Promise<ArrayBuffer>} The tile's RGBA
   */
  run(job, cancelled) {
    let h = 0
    for (let i = 0; i < job.key.length; i++) {
      h = ((h * 31) + job.key.charCodeAt(i)) | 0
    }
    const slot = this.workers[Math.abs(h) % this.workers.length]
    return new Promise((resolve, reject) => {
      slot.queue.push({job, cancelled, resolve, reject})
      this._pump(slot)
    })
  }


  _pump(slot) {
    while (slot.busy < IN_FLIGHT && slot.queue.length > 0) {
      const task = slot.queue.shift()
      if (task.cancelled()) {
        task.reject(new Error('cancelled'))
        continue
      }
      const id = this.nextId++
      this.pending.set(id, {...task, slot})
      slot.busy++
      // The bitmaps are cloned, not transferred: the main thread keeps them
      // for the next month's tile.
      slot.worker.postMessage({id, job: task.job})
    }
  }


  _answer(slot, {id, buffer, error}) {
    const task = this.pending.get(id)
    this.pending.delete(id)
    slot.busy--
    if (task) {
      if (error) {
        task.reject(new Error(error))
      } else {
        this.made++
        task.resolve(buffer)
      }
    }
    this._pump(slot)
  }


  /** A worker that can't run (no OffscreenCanvas, a script error): all to the main thread. */
  _fail() {
    this.failed = true
    for (const task of this.pending.values()) {
      task.reject(new Error('worker failed'))
    }
    this.pending.clear()
  }
}


let workers = null
/**
 * @returns {?DetailWorkers} The page's, made at the first ask; null where
 *   there are no module-free workers or OffscreenCanvas
 */
function pool() {
  if (workers === null && typeof Worker === 'function' && typeof OffscreenCanvas === 'function' &&
      typeof location === 'object' && new URLSearchParams(location.search).get('detailWorker') !== '0') {
    try {
      const url = new URL('detail-worker.js', globalThis.CESIUM_BASE_URL ?? new URL('cesium/', document.baseURI)).href
      workers = new DetailWorkers(() => new Worker(url))
    } catch {
      workers = false
    }
  }
  return workers && !workers.failed ? workers : null
}


/**
 * Wrap a ready provider (ion's world imagery) to give detail over a month's
 * base.
 *
 * @param {object} Cesium
 * @param {object} inner
 * @param {object} opts
 * @param {number} opts.month 1-12
 * @param {function(number, number): Promise<ImageBitmap>} opts.fetchBaseTile
 *   The month's base tile, decoded, by column and row
 * @param {{tilesX: number, tilesY: number, tileSize: number}} opts.grid The base's finest level
 * @param {boolean} [opts.raw] Pass the inner's tiles through, unchanged (`?detail=raw`, for comparison)
 * @returns {object} An ImageryProvider; `useWorker` false makes its tiles here
 */
export function detailProvider(Cesium, inner, {month, fetchBaseTile, grid, raw = false}) {
  const scheme = inner.tilingScheme
  const size = inner.tileWidth
  const lowLevel = lowpassLevel(grid.tilesX * grid.tileSize, size, scheme.getNumberOfXTilesAtLevel(0))
  const mercator = scheme instanceof Cesium.WebMercatorTilingScheme
  const caches = cachesOf(inner)
  const bases = new PromiseCache(BASE_CACHE)
  const discard = (image) => {
    const policy = inner.tileDiscardPolicy
    return Boolean(policy?.isReady?.() && policy.shouldDiscardImage(image))
  }
  const cancelled = (request) => () => request?.state === Cesium.RequestState?.CANCELLED
  const provider = {
    useWorker: true,
    get tilingScheme() {
      return scheme
    },
    get rectangle() {
      return inner.rectangle
    },
    get tileWidth() {
      return size
    },
    get tileHeight() {
      return inner.tileHeight
    },
    get maximumLevel() {
      return inner.maximumLevel
    },
    // At lowLevel the ratio is 1: the detail starts a level finer.
    get minimumLevel() {
      return raw ? inner.minimumLevel : lowLevel + 1
    },
    get tileDiscardPolicy() {
      return raw ? inner.tileDiscardPolicy : undefined
    },
    get errorEvent() {
      return inner.errorEvent
    },
    get credit() {
      return inner.credit
    },
    get proxy() {
      return inner.proxy
    },
    get hasAlphaChannel() {
      return raw ? inner.hasAlphaChannel : false
    },
    lowLevel,
    /** @returns {?DetailWorkers} The page's workers, for a probe */
    get workers() {
      return workers || null
    },
    getTileCredits(x, y, level) {
      return inner.getTileCredits(x, y, level)
    },
    requestImage(x, y, level, request) {
      if (raw) {
        return inner.requestImage(x, y, level, request)
      }
      const key = `${x}/${y}/${level}`
      let fine
      if (caches.fine.map.has(key)) {
        fine = caches.fine.get(key)
      } else {
        const asked = inner.requestImage(x, y, level, request)
        if (!asked) {
          // Throttled: Cesium asks again.
          return undefined
        }
        fine = caches.fine.get(key, () => Promise.resolve(asked))
      }
      const a = ancestorTile(x, y, level, lowLevel)
      const lowKey = `${a.x}/${a.y}/${a.level}`
      const low = caches.low.get(lowKey, () => Promise.resolve(inner.requestImage(a.x, a.y, a.level)))
      const rect = scheme.tileXYToRectangle(x, y, level)
      const deg = 180 / Math.PI
      const under = caches.composer.samplerFor(month, grid)
          .tilesUnder(rect.west * deg, rect.east * deg, rect.south * deg, rect.north * deg)
      const baseTiles = Promise.all(under.map(([bx, by]) =>
        bases.get(`${bx}/${by}`, () => fetchBaseTile(bx, by)).then((bitmap) => [bx, by, bitmap])))
      return Promise.all([fine, low, baseTiles]).then(([f, l, base]) => {
        const job = {
          key, lowKey, month, grid, mercator,
          tile: {x, y, level, lowLevel, size},
          rect: {west: rect.west, south: rect.south, east: rect.east, north: rect.north},
          fine: f && !discard(f) ? f : null,
          low: l && !discard(l) ? l : null,
          base,
        }
        const sendable = (image) => image === null || isBitmap(image)
        const workerPool = provider.useWorker && sendable(job.fine) && sendable(job.low) ? pool() : null
        if (workerPool) {
          return workerPool.run({...job, flipped: true}, cancelled(request))
              .then((buffer) => new ImageData(new Uint8ClampedArray(buffer), size, size))
              .catch((err) => {
                if (err.message === 'cancelled') {
                  throw err
                }
                // The worker failed: here, as before.
                return composeHere(caches.composer, job, size)
              })
        }
        return composeHere(caches.composer, job, size)
      })
    },
    pickFeatures() {
      return undefined
    },
  }
  return provider
}


/**
 * A tile made on the main thread: the fallback, and `useWorker` false.
 *
 * @param {DetailComposer} composer
 * @param {object} job
 * @param {number} size
 * @returns {ImageData}
 */
function composeHere(composer, job, size) {
  const luma = (image) => (image ? lumaOf(pixelsOf(image, size), isBitmap(image), size) : null)
  const base = new Map(job.base.map(([x, y, bitmap]) => [`${x}/${y}`, bitmap]))
  const out = composer.compose({
    ...job,
    fineLuma: () => luma(job.fine),
    lowLuma: () => luma(job.low),
    basePixels: (x, y) => pixelsOf(base.get(`${x}/${y}`), job.grid.tileSize),
  })
  return new ImageData(out, size, size)
}


const caches = new WeakMap()
/**
 * @param {object} inner A ready imagery provider (ion's)
 * @returns {object} Its caches, shared by every month's wrapper: the fine
 *   tiles and ancestors as images, and the main thread's composer
 */
function cachesOf(inner) {
  if (!caches.has(inner)) {
    caches.set(inner, {fine: new PromiseCache(FINE_CACHE), low: new PromiseCache(LOW_CACHE), composer: new DetailComposer()})
  }
  return caches.get(inner)
}
