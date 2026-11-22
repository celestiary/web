/**
 * Earth's detail imagery as detail only: ion's world imagery (Bing) gives
 * the ground's texture under the Blue Marble's ~5 km texels, and the Blue
 * Marble of the simulation's month keeps its colour (CESIUM.md, "Detail
 * over the month's colour").  Bing is a mosaic of summers, so taken whole
 * it was a greener square over November's brown steppe, with other snow,
 * from the globe level it took over at.
 *
 * Each detail tile is made on the CPU from Bing's tile and its ancestor at
 * the level whose texels are the Blue Marble's (`lowLevel`):
 *
 *   shown = BlueMarble(month) × Y(Bing) / Y(Bing at lowLevel)
 *
 * in linear light, Y the luminance, the ratio clamped to [RATIO_MIN,
 * RATIO_MAX].  The ancestor, sampled bilinearly, is Bing low-passed at the
 * Blue Marble's scale, the same at the edges of neighbouring tiles; so the
 * ratio is Bing's detail finer than the Blue Marble resolves, about 1 on
 * average, and the Blue Marble's colour, hue and season stay.  At lowLevel
 * the ratio is 1, so the detail grows an octave a level from there, with
 * no edge where it starts.  Luminance, not a ratio per channel: Bing's
 * colour is the summer's, and a ratio per channel carries its green into
 * the finer scales and is noisy where a channel is dark (water, shadow).
 */


/** The detail's ratio is kept within these, against blow-outs (dark lows, glints). */
export const RATIO_MIN = 1 / 3
export const RATIO_MAX = 3

/** Added to both luminances: a floor for the ratio of dark ground, linear. */
export const LUMA_EPS = 0.003


// sRGB's curves (IEC 61966-2-1), as srgb.js has them: written here so this
// lazy chunk shares no module with the first load (AGENTS.md, keep the first
// load lean).
const DECODE = new Float32Array(256)
for (let i = 0; i < 256; i++) {
  const v = i / 255
  DECODE[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

const ENCODE_N = 16384
const ENCODE = new Uint8ClampedArray(ENCODE_N)
for (let i = 0; i < ENCODE_N; i++) {
  const v = i / (ENCODE_N - 1)
  ENCODE[i] = Math.round(255 * (v <= 0.0031308 ? 12.92 * v : (1.055 * Math.pow(v, 1 / 2.4)) - 0.055))
}


/**
 * @param {number} linear 0 to 1 (clamped)
 * @returns {number} Its sRGB byte
 */
export function encodeByte(linear) {
  return ENCODE[Math.round(Math.min(Math.max(linear, 0), 1) * (ENCODE_N - 1))]
}


/**
 * @param {number} byte An sRGB byte
 * @returns {number} Its linear value
 */
export function decodeByte(byte) {
  return DECODE[byte]
}


/**
 * The imagery level whose texels are the base's: where the provider's tiles
 * span as many texels round the globe as the base has.
 *
 * @param {number} baseTexelsAround The base's finest level's texels round the equator (8192)
 * @param {number} tileWidth The provider's
 * @param {number} levelZeroTilesX Its tiling scheme's tiles across at level 0
 * @returns {number}
 */
export function lowpassLevel(baseTexelsAround, tileWidth, levelZeroTilesX) {
  return Math.max(0, Math.round(Math.log2(baseTexelsAround / (tileWidth * levelZeroTilesX))))
}


/**
 * Linear luminance (Rec. 709) of sRGB-encoded RGBA pixels.
 *
 * @param {Uint8ClampedArray|Uint8Array} rgba
 * @param {boolean} [flipY] Read the rows bottom up (an image decoded flipped)
 * @param {number} [size] Pixels a side, for flipY
 * @returns {Float32Array}
 */
export function lumaOf(rgba, flipY = false, size = Math.sqrt(rgba.length / 4)) {
  const n = rgba.length / 4
  const out = new Float32Array(n)
  for (let p = 0; p < n; p++) {
    const q = flipY ? (((size - 1 - Math.floor(p / size)) * size) + (p % size)) * 4 : p * 4
    out[p] = (0.2126 * DECODE[rgba[q]]) + (0.7152 * DECODE[rgba[q + 1]]) + (0.0722 * DECODE[rgba[q + 2]])
  }
  return out
}


/**
 * Bilinear sample of a square grid of values at pixel coordinates (centres
 * at integers), clamped at the edges.
 *
 * @param {Float32Array} values Row-major, size × size
 * @param {number} size
 * @param {number} x
 * @param {number} y
 * @returns {number}
 */
export function sampleBilinear(values, size, x, y) {
  const cx = Math.min(Math.max(x, 0), size - 1)
  const cy = Math.min(Math.max(y, 0), size - 1)
  const x0 = Math.min(Math.floor(cx), size - 2)
  const y0 = Math.min(Math.floor(cy), size - 2)
  const fx = cx - x0
  const fy = cy - y0
  const i = (y0 * size) + x0
  const top = values[i] + ((values[i + 1] - values[i]) * fx)
  const bottom = values[i + size] + ((values[i + size + 1] - values[i + size]) * fx)
  return top + ((bottom - top) * fy)
}


/**
 * @param {number} x
 * @param {number} y
 * @param {number} level
 * @param {number} lowLevel
 * @returns {{x: number, y: number, level: number}} The tile's ancestor at lowLevel
 */
export function ancestorTile(x, y, level, lowLevel) {
  const scale = 2 ** Math.max(level - lowLevel, 0)
  return {x: Math.floor(x / scale), y: Math.floor(y / scale), level: Math.min(level, lowLevel)}
}


/**
 * The detail's ratio over a tile: its luminance over its ancestor's, the
 * ancestor sampled bilinearly at each pixel's centre, clamped.
 *
 * @param {Float32Array} fine The tile's luminance, size × size
 * @param {Float32Array} low Its ancestor's at lowLevel
 * @param {{x: number, y: number, level: number, lowLevel: number, size: number}} tile
 * @returns {Float32Array} size × size
 */
export function detailRatios(fine, low, {x, y, level, lowLevel, size}) {
  const out = new Float32Array(size * size)
  const scale = 2 ** Math.max(level - lowLevel, 0)
  const ox = x - (Math.floor(x / scale) * scale)
  const oy = y - (Math.floor(y / scale) * scale)
  for (let j = 0; j < size; j++) {
    const ly = ((((oy + ((j + 0.5) / size)) / scale) * size) - 0.5)
    for (let i = 0; i < size; i++) {
      const lx = ((((ox + ((i + 0.5) / size)) / scale) * size) - 0.5)
      const p = (j * size) + i
      const r = (fine[p] + LUMA_EPS) / (sampleBilinear(low, size, lx, ly) + LUMA_EPS)
      out[p] = Math.min(Math.max(r, RATIO_MIN), RATIO_MAX)
    }
  }
  return out
}


/**
 * The latitude of each row's centre of a tile, and the longitude of each
 * column's, degrees.
 *
 * @param {{west: number, south: number, east: number, north: number}} rect Radians
 * @param {number} size
 * @param {boolean} mercator Rows evenly spaced in Web Mercator's y, not in latitude
 * @returns {{lons: Float64Array, lats: Float64Array}}
 */
export function tileLonLats(rect, size, mercator) {
  const deg = 180 / Math.PI
  const lons = new Float64Array(size)
  const lats = new Float64Array(size)
  for (let i = 0; i < size; i++) {
    lons[i] = (rect.west + ((rect.east - rect.west) * (i + 0.5) / size)) * deg
  }
  const merc = (lat) => Math.log(Math.tan((Math.PI / 4) + (lat / 2)))
  const [n, s] = mercator ? [merc(rect.north), merc(rect.south)] : [rect.north, rect.south]
  for (let j = 0; j < size; j++) {
    const v = n + ((s - n) * (j + 0.5) / size)
    lats[j] = (mercator ? Math.atan(Math.sinh(v)) : v) * deg
  }
  return {lons, lats}
}


/**
 * The base imagery (one month's Blue Marble, equirectangular tiles of its
 * finest level) sampled bilinearly in linear light, by longitude and
 * latitude, across its tiles' edges.
 */
export class BaseSampler {
  /**
   * @param {function(number, number): Promise<Uint8ClampedArray>} fetchTile
   *   A tile's sRGB RGBA by column and row (row 0 the north)
   * @param {{tilesX: number, tilesY: number, tileSize: number}} grid
   */
  constructor(fetchTile, {tilesX, tilesY, tileSize}) {
    Object.assign(this, {fetchTile, tilesX, tilesY, tileSize})
    this.width = tilesX * tileSize
    this.height = tilesY * tileSize
    this.tiles = new Map()
  }


  /**
   * Fetch the tiles under a region (with a texel's margin).
   *
   * @param {number} west Degrees
   * @param {number} east
   * @param {number} south
   * @param {number} north
   * @returns {Promise<void>}
   */
  load(west, east, south, north) {
    return Promise.all(this.tilesUnder(west, east, south, north).map(([x, y]) => this._tile(x, y))).then(() => undefined)
  }


  /**
   * The tiles under a region (with a texel's margin), wrapped round the
   * antimeridian and clamped at the poles, each once.
   *
   * @param {number} west Degrees
   * @param {number} east
   * @param {number} south
   * @param {number} north
   * @returns {Array<Array<number>>} [column, row] each
   */
  tilesUnder(west, east, south, north) {
    const [x0, y0] = this._pixel(west, north)
    const [x1, y1] = this._pixel(east, south)
    const ts = this.tileSize
    const seen = new Map()
    for (let ty = Math.floor((y0 - 1) / ts); ty <= Math.floor((y1 + 1) / ts); ty++) {
      for (let tx = Math.floor((x0 - 1) / ts); tx <= Math.floor((x1 + 1) / ts); tx++) {
        const [x, y, key] = this._key(tx, ty)
        seen.set(key, [x, y])
      }
    }
    return [...seen.values()]
  }


  /**
   * @param {number} x Column
   * @param {number} y Row
   * @returns {boolean} Whether the tile's pixels are in
   */
  has(x, y) {
    return Boolean(this.tiles.get(this._key(x, y)[2])?.data)
  }


  /**
   * Put a tile's pixels in, as fetchTile would have.
   *
   * @param {number} x Column
   * @param {number} y Row
   * @param {Uint8ClampedArray} data RGBA
   */
  put(x, y, data) {
    const [, , key] = this._key(x, y)
    this.tiles.set(key, {data, loaded: Promise.resolve()})
  }


  /**
   * @param {number} lon Degrees
   * @param {number} lat
   * @returns {Array<number>} Pixel coordinates, centres at integers
   */
  _pixel(lon, lat) {
    return [(((lon + 180) / 360) * this.width) - 0.5, (((90 - lat) / 180) * this.height) - 0.5]
  }


  _key(tx, ty) {
    const x = ((tx % this.tilesX) + this.tilesX) % this.tilesX
    const y = Math.min(Math.max(ty, 0), this.tilesY - 1)
    return [x, y, (y * this.tilesX) + x]
  }


  _tile(tx, ty) {
    const [x, y, key] = this._key(tx, ty)
    if (!this.tiles.has(key)) {
      const entry = {data: null}
      entry.loaded = this.fetchTile(x, y).then((data) => {
        entry.data = data
      }).catch((err) => {
        this.tiles.delete(key)
        throw err
      })
      this.tiles.set(key, entry)
    }
    return this.tiles.get(key).loaded
  }


  _texel(px, py, c) {
    const ts = this.tileSize
    const [, , key] = this._key(Math.floor(px / ts), Math.floor(py / ts))
    const data = this.tiles.get(key)?.data
    if (!data) {
      return 0
    }
    const lx = ((px % ts) + ts) % ts
    const ly = Math.min(Math.max(py, 0), this.height - 1) % ts
    return DECODE[data[(((ly * ts) + lx) * 4) + c]]
  }


  /**
   * @param {number} lon Degrees
   * @param {number} lat
   * @param {Float32Array|Array<number>} out Linear RGB
   */
  sample(lon, lat, out) {
    const [x, y] = this._pixel(lon, lat)
    const cy = Math.min(Math.max(y, 0), this.height - 1)
    const x0 = Math.floor(x)
    const y0 = Math.min(Math.floor(cy), this.height - 2)
    const fx = x - x0
    const fy = cy - y0
    for (let c = 0; c < 3; c++) {
      const top = this._texel(x0, y0, c) + ((this._texel(x0 + 1, y0, c) - this._texel(x0, y0, c)) * fx)
      const bottom = this._texel(x0, y0 + 1, c) + ((this._texel(x0 + 1, y0 + 1, c) - this._texel(x0, y0 + 1, c)) * fx)
      out[c] = top + ((bottom - top) * fy)
    }
  }
}


/**
 * A detail tile: the base's colour times the detail's ratio, sRGB RGBA.
 *
 * @param {?Float32Array} ratios detailRatios', or null for none (the base alone)
 * @param {{lons: Float64Array, lats: Float64Array}} lonLats tileLonLats'
 * @param {{sample: function(number, number, Array<number>): void}} base
 * @returns {Uint8ClampedArray} size × size RGBA, row 0 the north
 */
export function transferTile(ratios, {lons, lats}, base) {
  const size = lons.length
  const out = new Uint8ClampedArray(size * size * 4)
  const rgb = [0, 0, 0]
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const p = (j * size) + i
      const r = ratios ? ratios[p] : 1
      base.sample(lons[i], lats[j], rgb)
      out[p * 4] = encodeByte(rgb[0] * r)
      out[(p * 4) + 1] = encodeByte(rgb[1] * r)
      out[(p * 4) + 2] = encodeByte(rgb[2] * r)
      out[(p * 4) + 3] = 255
    }
  }
  return out
}


/**
 * A small cache of promises, least recently used first out.
 */
export class PromiseCache {
  /** @param {number} max */
  constructor(max) {
    this.max = max
    this.map = new Map()
  }


  /**
   * @param {string} key
   * @param {function(): Promise} make
   * @returns {Promise}
   */
  get(key, make) {
    let p = this.map.get(key)
    if (p) {
      this.map.delete(key)
    } else {
      p = make()
      p.catch(() => {
        if (this.map.get(key) === p) {
          this.map.delete(key)
        }
      })
    }
    this.map.set(key, p)
    while (this.map.size > this.max) {
      this.map.delete(this.map.keys().next().value)
    }
    return p
  }
}


/**
 * A Map that forgets its least recently used entries past a size.
 */
export class LruMap {
  /** @param {number} max */
  constructor(max) {
    this.max = max
    this.map = new Map()
  }


  /**
   * @param {string} key
   * @returns {*} The value, now the most recently used, or undefined
   */
  get(key) {
    if (!this.map.has(key)) {
      return undefined
    }
    const v = this.map.get(key)
    this.map.delete(key)
    this.map.set(key, v)
    return v
  }


  /**
   * @param {string} key
   * @param {*} value
   */
  set(key, value) {
    this.map.delete(key)
    this.map.set(key, value)
    while (this.map.size > this.max) {
      this.map.delete(this.map.keys().next().value)
    }
  }
}


/** Bing's tiles' ratios kept, across months (256 KB each). */
export const RATIO_CACHE = 96
/** Bing's ancestors' luminances kept (256 KB each). */
export const LOW_CACHE = 32
/** A month's Blue Marble tiles kept as pixels (1 MB each), all months together. */
export const BASE_CACHE = 32


/**
 * The detail's tiles, made from pixels: the ratios and ancestors' and the
 * months' Blue Marble tiles kept between tiles.  Synchronous and pure but
 * for its caches, so the worker (detailWorker.js) and the main thread's
 * fallback make the same bytes.
 */
export class DetailComposer {
  /** */
  constructor() {
    this.ratios = new LruMap(RATIO_CACHE)
    this.lows = new LruMap(LOW_CACHE)
    this.samplers = new Map()
    this.baseTiles = 0
  }


  /**
   * @param {number} month
   * @param {{tilesX: number, tilesY: number, tileSize: number}} grid
   * @returns {BaseSampler} The month's, its tiles put in by compose
   */
  samplerFor(month, grid) {
    let sampler = this.samplers.get(month)
    if (!sampler) {
      sampler = new BaseSampler(() => Promise.reject(new Error('put, not fetched')), grid)
      this.samplers.set(month, sampler)
    }
    return sampler
  }


  /**
   * @param {object} job
   * @param {string} job.key The tile's, `x/y/level`
   * @param {string} job.lowKey Its ancestor's
   * @param {{x: number, y: number, level: number, lowLevel: number, size: number}} job.tile
   * @param {{west: number, south: number, east: number, north: number}} job.rect Radians
   * @param {boolean} job.mercator
   * @param {number} job.month
   * @param {{tilesX: number, tilesY: number, tileSize: number}} job.grid The base's
   * @param {function(): ?Float32Array} job.fineLuma The tile's luminance, or null (discarded)
   * @param {function(): ?Float32Array} job.lowLuma Its ancestor's, or null
   * @param {function(number, number): Uint8ClampedArray} job.basePixels A base tile's RGBA
   * @returns {Uint8ClampedArray} The detail tile, RGBA, row 0 the north
   */
  compose({key, lowKey, tile, rect, mercator, month, grid, fineLuma, lowLuma, basePixels}) {
    let ratios = this.ratios.get(key)
    if (ratios === undefined) {
      let low = this.lows.get(lowKey)
      if (low === undefined) {
        low = lowLuma()
        this.lows.set(lowKey, low)
      }
      const fine = fineLuma()
      ratios = fine && low ? detailRatios(fine, low, tile) : null
      this.ratios.set(key, ratios)
    }
    const sampler = this.samplerFor(month, grid)
    const deg = 180 / Math.PI
    const wanted = sampler.tilesUnder(rect.west * deg, rect.east * deg, rect.south * deg, rect.north * deg)
    const missing = wanted.filter(([x, y]) => !sampler.has(x, y))
    if (this.baseTiles + missing.length > BASE_CACHE) {
      // Forget them all: the next tiles bring theirs.
      for (const s of this.samplers.values()) {
        s.tiles.clear()
      }
      this.baseTiles = 0
    }
    for (const [x, y] of wanted.filter((t) => !sampler.has(t[0], t[1]))) {
      sampler.put(x, y, basePixels(x, y))
      this.baseTiles++
    }
    return transferTile(ratios, tileLonLats(rect, tile.size, mercator), sampler)
  }
}
