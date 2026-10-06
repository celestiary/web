import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RedFormat,
  RepeatWrapping,
  ClampToEdgeWrapping,
  UnsignedByteType,
} from 'three'
import {dataUrl} from '../../dataUrl.js'
import {monthlyPath} from '../monthly.js'
import {
  CLOUD_TILE_LEVEL,
  TILE_PX,
  cloudSource,
  coverageFromBundled,
  tileGrid,
  tileRect,
  tileUrl,
  unmixTile,
} from './cloudSource.js'


/**
 * Earth's cloud coverage map: one byte a pixel, equirectangular, −180° at
 * the left edge and north at the top (texture row 0), as the Blue Marble
 * is laid out.  Built in the browser from the simulation date's NASA GIBS
 * true-colour mosaic (cloudSource.js), tile by tile as the tiles arrive, so
 * nothing waits for it: until a tile is in, its region keeps what it had
 * (nothing, at first).  Planet.md, "Clouds".
 *
 * update() is called every frame (the shell's preAnimCb); it starts a load
 * when the date's source changes and has stayed changed for SETTLE_MS (a
 * clock running at days a second doesn't start a load a frame).  A load
 * for a stale date is abandoned between tiles.
 */
export default class CloudMap {
  /**
   * @param {object} opts
   * @param {string} opts.groundPattern The Blue Marble's monthly path under
   *   textures/, with {MM} (earth.json texture_monthly)
   * @param {string} opts.bundledPath The bundled cloud texture, under
   *   textures/ (earth/earth_atmos.jpg)
   */
  constructor({groundPattern, bundledPath}) {
    const {width, height} = tileGrid(CLOUD_TILE_LEVEL)
    this.width = width
    this.height = height
    this.groundPattern = groundPattern
    this.bundledPath = bundledPath
    this.coverage = new Uint8Array(width * height)
    this.texture = new DataTexture(this.coverage, width, height, RedFormat, UnsignedByteType)
    this.texture.wrapS = RepeatWrapping
    this.texture.wrapT = ClampToEdgeWrapping
    this.texture.magFilter = LinearFilter
    this.texture.minFilter = LinearMipmapLinearFilter
    this.texture.generateMipmaps = true
    this.texture.unpackAlignment = 1
    this.texture.name = 'cloud coverage'
    // What's shown, for the app and tests: {kind, date, satellites,
    // tilesDone, tilesTotal, tilesFailed}.
    this.status = {kind: 'none'}
    this._wantedKey = null
    this._wantedSince = 0
    this._loadingKey = null
    this._generation = 0
    this._grounds = new Map()
    this._bundled = null
    // Loading needs a DOM (image decoding, canvases); the bun tests have
    // none, and must not reach the network.
    this.enabled = typeof document !== 'undefined' && typeof createImageBitmap === 'function'
  }


  /**
   * @param {number} simMs The simulation time
   * @param {number} [nowMs] The real time
   */
  update(simMs, nowMs = Date.now()) {
    if (!this.enabled) {
      return
    }
    const source = cloudSource(simMs, nowMs)
    const key = source.kind === 'daily' ? source.date : 'bundled'
    const now = performance.now()
    if (key !== this._wantedKey) {
      this._wantedKey = key
      this._wantedSince = now
    }
    if (key === this._loadingKey) {
      return
    }
    // The first load straight away; later ones once the date has settled.
    if (this._loadingKey !== null && now - this._wantedSince < SETTLE_MS) {
      return
    }
    this._loadingKey = key
    const generation = ++this._generation
    const load = source.kind === 'daily' ? this._loadDaily(source, generation) : this._loadBundled(source, generation)
    load.catch((err) => {
      console.warn(`[clouds] couldn't build the cloud map for ${key}; no clouds`, err)
    })
  }


  /**
   * @param {number} generation
   * @returns {boolean} Whether a newer load has started
   */
  _stale(generation) {
    return generation !== this._generation
  }


  /** Mark the texture for upload. */
  _changed() {
    this.texture.needsUpdate = true
  }


  /**
   * The bundled texture, as coverage, for dates with no mosaic.
   *
   * @param {object} source
   * @param {number} generation
   */
  async _loadBundled(source, generation) {
    this.status = {kind: 'bundled', reason: source.reason, loaded: false}
    const bundled = await this._bundledCoverage()
    if (this._stale(generation)) {
      return
    }
    this.coverage.set(bundled)
    this._changed()
    this.status = {kind: 'bundled', reason: source.reason, loaded: true}
  }


  /**
   * A day's mosaic, tile by tile: each tile unmixed against the month's
   * Blue Marble, its gaps from the secondary layer, what neither saw from
   * the bundled texture.  A tile neither layer could serve has no clouds,
   * and the load warns once.
   *
   * @param {object} source cloudSource's daily source
   * @param {number} generation
   */
  async _loadDaily(source, generation) {
    const {date, layers} = source
    const {cols, rows} = tileGrid(CLOUD_TILE_LEVEL)
    this.status = {
      kind: 'daily', date, satellites: layers.map((l) => l.satellite),
      tilesDone: 0, tilesTotal: cols * rows, tilesFailed: 0,
    }
    const status = this.status
    const month = Number(date.slice(5, 7))
    const [ground, bundled] = await Promise.all([this._ground(month), this._bundledCoverage()])
    if (this._stale(generation)) {
      return
    }
    const unseen = new Uint8Array(this.width * this.height)
    const tiles = []
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        tiles.push({row, col})
      }
    }
    let warned = false
    const one = async ({row, col}) => {
      if (this._stale(generation)) {
        return
      }
      const rect = tileRect(CLOUD_TILE_LEVEL, row, col)
      let missing = rect.w * rect.h
      let any = false
      for (let i = 0; i < layers.length && missing > rect.w * rect.h * GAPS_WORTH_FILLING; i++) {
        const pixels = await fetchTile(tileUrl(layers[i].layer, date, CLOUD_TILE_LEVEL, row, col))
        if (this._stale(generation)) {
          return
        }
        if (!pixels) {
          continue
        }
        if (!any) {
          markRegion(unseen, rect, this.width, 1)
        }
        any = true
        missing = unmixTile(pixels, TILE_PX, rect, ground, this.coverage, bundled, unseen, this.width, true)
      }
      if (!any) {
        // No clouds there, rather than the last day's.
        fillRegion(this.coverage, rect, this.width, 0)
        status.tilesFailed++
        if (!warned) {
          warned = true
          console.warn(`[clouds] NASA GIBS had no tile for ${date} at level ${CLOUD_TILE_LEVEL}, row ${row}, ` +
            `col ${col} (${layers.map((l) => l.satellite).join(', ')}); no clouds there`)
        }
      }
      status.tilesDone++
      this._changed()
    }
    await runLimited(tiles, CONCURRENT_TILES, one)
  }


  /**
   * @param {number} month 1-12
   * @returns {Promise<Uint8ClampedArray>} The month's Blue Marble, RGBA at
   *   the map's size
   */
  _ground(month) {
    if (!this._grounds.has(month)) {
      const url = dataUrl(`textures/${monthlyPath(this.groundPattern, month)}.jpg`)
      this._grounds.set(month, fetchPixels(url, this.width, this.height).catch((err) => {
        this._grounds.delete(month)
        throw err
      }))
    }
    return this._grounds.get(month)
  }


  /** @returns {Promise<Uint8Array>} The bundled texture as coverage, at the map's size */
  _bundledCoverage() {
    if (!this._bundled) {
      this._bundled = fetchPixels(dataUrl(`textures/${this.bundledPath}`), this.width, this.height).then((rgba) => {
        const out = new Uint8Array(this.width * this.height)
        for (let i = 0; i < out.length; i++) {
          out[i] = Math.round(coverageFromBundled(rgba[4 * i]) * 255)
        }
        return out
      }).catch((err) => {
        this._bundled = null
        throw err
      })
    }
    return this._bundled
  }
}


// A changed date waits this long, ms, before its clouds load.
const SETTLE_MS = 1000

// Tiles fetched at once.
const CONCURRENT_TILES = 4

// A tile's gaps worth the secondary layer's tile: more than this share of
// it unseen (VIIRS's are rare outside polar night; MODIS's run between its
// swaths at the equator).
const GAPS_WORTH_FILLING = 0.002

// Fetch attempts per tile: the network can drop one.
const TILE_ATTEMPTS = 2
const HTTP_NOT_FOUND = 404


/**
 * @param {string} url A GIBS tile
 * @returns {Promise<Uint8ClampedArray|null>} Its RGBA, TILE_PX square, or
 *   null where GIBS has none (404: a day missing from the layer) or the
 *   network failed twice
 */
async function fetchTile(url) {
  for (let attempt = 0; attempt < TILE_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url)
      if (response.status === HTTP_NOT_FOUND) {
        return null
      }
      if (!response.ok) {
        continue
      }
      return await decodePixels(await response.blob(), TILE_PX, TILE_PX)
    } catch {
      // Try again, then give up on the tile.
    }
  }
  return null
}


/**
 * @param {string} url An image
 * @param {number} width
 * @param {number} height
 * @returns {Promise<Uint8ClampedArray>} Its RGBA, scaled to width × height
 */
async function fetchPixels(url, width, height) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`)
  }
  return decodePixels(await response.blob(), width, height)
}


/**
 * @param {Blob} blob An encoded image
 * @param {number} width
 * @param {number} height
 * @returns {Promise<Uint8ClampedArray>} Its RGBA, scaled to width × height
 */
async function decodePixels(blob, width, height) {
  const bitmap = await createImageBitmap(blob)
  const canvas = typeof OffscreenCanvas === 'function' ?
    new OffscreenCanvas(width, height) :
    Object.assign(document.createElement('canvas'), {width, height})
  const ctx = canvas.getContext('2d', {willReadFrequently: true})
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close?.()
  return ctx.getImageData(0, 0, width, height).data
}


/**
 * @param {Uint8Array} map A byte a pixel
 * @param {object} rect {x, y, w, h}
 * @param {number} width The map's
 * @param {number} value
 */
function fillRegion(map, rect, width, value) {
  for (let j = 0; j < rect.h; j++) {
    const start = ((rect.y + j) * width) + rect.x
    map.fill(value, start, start + rect.w)
  }
}


/**
 * @param {Uint8Array} mask
 * @param {object} rect
 * @param {number} width
 * @param {number} value
 */
function markRegion(mask, rect, width, value) {
  fillRegion(mask, rect, width, value)
}


/**
 * Run `fn` over `items`, at most `limit` at a time.
 *
 * @param {Array} items
 * @param {number} limit
 * @param {Function} fn async
 * @returns {Promise<void>}
 */
async function runLimited(items, limit, fn) {
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      await fn(items[next++])
    }
  }
  await Promise.all(Array.from({length: Math.min(limit, items.length)}, worker))
}
