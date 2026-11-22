/**
 * The imagery provider that gives Earth's globe ion's detail over the
 * month's Blue Marble (detailTransfer.js; CESIUM.md, "Detail over the
 * month's colour"): a wrapper of ion's provider, one per month shown, which
 * makes each tile on the CPU from Bing's tile, its ancestor at the Blue
 * Marble's scale and the month's Blue Marble at the tile.  A tile is 256 px:
 * a few milliseconds of arithmetic, once per tile and month.  The detail's
 * ratios are Bing's alone, so they are cached across the months' providers,
 * and a second month's tile costs only its colour.
 */
import {
  BaseSampler, PromiseCache, ancestorTile, detailRatios, lowpassLevel, lumaOf, tileLonLats, transferTile,
} from './detailTransfer.js'


/** Bing's tiles' ratios kept, across months (256 KB each). */
const RATIO_CACHE = 96
/** Bing's ancestors' luminances kept (256 KB each). */
const LOW_CACHE = 32


/**
 * An image's RGBA at its size.
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
 * Cesium's imagery comes as an ImageBitmap decoded flipped (Resource
 * fetchImage's flipY, which WebGL can't do to a bitmap), or as an image
 * that the upload flips.
 *
 * @param {object} image
 * @returns {boolean}
 */
function decodedFlipped(image) {
  return typeof ImageBitmap === 'function' && image instanceof ImageBitmap
}


const caches = new WeakMap()
/**
 * @param {object} inner A ready imagery provider (ion's)
 * @returns {{ratios: PromiseCache, lows: PromiseCache}} Its caches, shared by every month's wrapper
 */
function cachesOf(inner) {
  if (!caches.has(inner)) {
    caches.set(inner, {ratios: new PromiseCache(RATIO_CACHE), lows: new PromiseCache(LOW_CACHE)})
  }
  return caches.get(inner)
}


/**
 * Wrap a ready provider (ion's world imagery) to give detail over a month's
 * base.
 *
 * @param {object} Cesium
 * @param {object} inner
 * @param {object} opts
 * @param {function(number, number): Promise<Uint8ClampedArray>} opts.fetchBaseTile
 *   The month's base tile's RGBA by column and row
 * @param {{tilesX: number, tilesY: number, tileSize: number}} opts.grid The base's finest level
 * @param {boolean} [opts.raw] Pass the inner's tiles through, unchanged (`?detail=raw`, for comparison)
 * @returns {object} An ImageryProvider
 */
export function detailProvider(Cesium, inner, {fetchBaseTile, grid, raw = false}) {
  const scheme = inner.tilingScheme
  const size = inner.tileWidth
  const lowLevel = lowpassLevel(grid.tilesX * grid.tileSize, size, scheme.getNumberOfXTilesAtLevel(0))
  const mercator = scheme instanceof Cesium.WebMercatorTilingScheme
  const base = new BaseSampler(fetchBaseTile, grid)
  const {ratios, lows} = cachesOf(inner)
  const discard = (image) => {
    const policy = inner.tileDiscardPolicy
    return Boolean(policy?.isReady?.() && policy.shouldDiscardImage(image))
  }
  const luma = (image) => (discard(image) ? null : lumaOf(pixelsOf(image, size), decodedFlipped(image), size))
  const low = (x, y, level) => {
    const a = ancestorTile(x, y, level, lowLevel)
    return lows.get(`${a.x}/${a.y}/${a.level}`, () => Promise.resolve(inner.requestImage(a.x, a.y, a.level)).then(luma))
  }
  const ratiosOf = (x, y, level, request) => {
    const key = `${x}/${y}/${level}`
    if (!ratios.map.has(key)) {
      const fine = inner.requestImage(x, y, level, request)
      if (!fine) {
        // Throttled: Cesium asks again.
        return undefined
      }
      return ratios.get(key, () => Promise.all([fine.then(luma), low(x, y, level)]).then(([f, l]) =>
        (f && l ? detailRatios(f, l, {x, y, level, lowLevel, size}) : null)))
    }
    return ratios.get(key)
  }
  return {
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
    getTileCredits(x, y, level) {
      return inner.getTileCredits(x, y, level)
    },
    requestImage(x, y, level, request) {
      if (raw) {
        return inner.requestImage(x, y, level, request)
      }
      const r = ratiosOf(x, y, level, request)
      if (!r) {
        return undefined
      }
      const rect = scheme.tileXYToRectangle(x, y, level)
      const lonLats = tileLonLats(rect, size, mercator)
      const deg = 180 / Math.PI
      return Promise.all([r, base.load(rect.west * deg, rect.east * deg, rect.south * deg, rect.north * deg)])
          .then(([rs]) => new ImageData(transferTile(rs, lonLats, base), size, size))
    },
    pickFeatures() {
      return undefined
    },
  }
}
