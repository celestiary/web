import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RedFormat,
  RepeatWrapping,
  UnsignedByteType,
} from 'three'
import {decodeIndexedPng} from './png.js'
import {MAP_HEIGHT, MAP_WIDTH, MIN_ICE_PIXELS, buildMap, daysToTry, recordOf, seaIceSource, tilesOf} from './seaIceSource.js'


// Cesium's layer of the map comes in this chunk too (Planet.newSeaIceNode).
export {syncSeaIceLayer} from '../cesium/seaIceLayer.js'


/**
 * Earth's sea ice concentration map (design/Cryosphere.md, phase 1;
 * Planet.md, "Sea ice"): one byte a pixel, equirectangular, north at row 0
 * (seaIceSource.js), from the simulation day's NASA GIBS tiles.  Built off
 * screen and shown whole, as the clouds' map is (CloudMap.js): until a day
 * is in the map keeps what it had (nothing, at first), and the first map
 * fades in once it can be drawn.
 *
 * Read by celestiary's surface (seaIceShader.js) and by Cesium's globe, as
 * an imagery layer made from the same bytes (cesium/seaIceLayer.js), which
 * follows `version`.
 */
export default class SeaIceMap {
  /**
   * @param {object} [opts]
   * @param {Function} [opts.shown] Whether the scene is on screen: a map
   *   first drawn after that fades in, one drawn before it doesn't
   * @param {Function} [opts.fetchTile] url → Promise<?Uint8Array> of a
   *   tile's palette indices (null: GIBS has none); for tests
   * @param {boolean} [opts.enabled] Whether to load at all; by default only
   *   in a browser (the bun tests must not reach the network)
   * @param {number} [opts.fadeInMs]
   */
  constructor({shown = () => true, fetchTile = fetchIndices, enabled, fadeInMs = SEA_ICE_FADE_IN_MS} = {}) {
    this.width = MAP_WIDTH
    this.height = MAP_HEIGHT
    this.concentration = new Uint8Array(MAP_WIDTH * MAP_HEIGHT)
    this.texture = new DataTexture(this.concentration, MAP_WIDTH, MAP_HEIGHT, RedFormat, UnsignedByteType)
    this.texture.wrapS = RepeatWrapping
    this.texture.wrapT = ClampToEdgeWrapping
    this.texture.magFilter = LinearFilter
    this.texture.minFilter = LinearMipmapLinearFilter
    this.texture.generateMipmaps = true
    this.texture.unpackAlignment = 1
    this.texture.name = 'sea ice concentration'
    // What's shown, for the app and tests: {wanted, building, date, record,
    // standin, tried, icePixels, ready}.
    this.status = {date: null, ready: false}
    // Bumped with each map put in the texture, for Cesium's layer.
    this.version = 0
    this.shown = shown
    this.fetchTile = fetchTile
    this.fadeInMs = fadeInMs
    this.enabled = enabled ?? (typeof document !== 'undefined' && typeof DecompressionStream === 'function')
    this._wantedKey = null
    this._wantedSince = 0
    this._loadingKey = null
    this._generation = 0
    this._fadeFrom = undefined
  }


  /**
   * Start the date's load once it has stood for SETTLE_MS (a clock running
   * at days a second passes through).  Called every frame.
   *
   * @param {number} simMs The simulation time
   * @param {number} [nowMs] The real time
   * @param {number} [perfNow] performance.now()
   */
  update(simMs, nowMs = Date.now(), perfNow = performance.now()) {
    if (!this.enabled) {
      return
    }
    const source = seaIceSource(simMs, nowMs)
    const key = source.date
    if (key !== this._wantedKey) {
      this._wantedKey = key
      this._wantedSince = perfNow
    }
    if (key === this._loadingKey || perfNow - this._wantedSince < SETTLE_MS) {
      return
    }
    this._loadingKey = key
    const generation = ++this._generation
    this.load(source, generation).catch((err) => {
      console.warn(`[sea ice] couldn't build the sea ice map for ${key}`, err)
    })
  }


  /**
   * A source's day, or the nearest before it that GIBS has whole (daysToTry):
   * each day's tiles fetched four at a time, its map built off screen and
   * put in the texture in one upload.  A day with a tile missing or no ice
   * on it (GIBS answers a day missing from a layer with empty tiles) gives
   * way to the next; if none is whole, the one with the most ice.
   *
   * @param {object} source seaIceSource's
   * @param {number} [generation] This load's; a newer one stops it between days
   * @returns {Promise<boolean>} Whether a map was put in
   */
  async load(source, generation = ++this._generation) {
    const stale = () => generation !== this._generation
    const status = {wanted: source.wanted, building: null, date: this.status.date, record: null,
      standin: source.standin, tried: [], icePixels: 0, ready: this.status.ready}
    this.status = status
    let best = null
    for (const date of daysToTry(source)) {
      status.building = date
      const specs = tilesOf(date)
      const tiles = await mapLimit(specs, TILE_CONCURRENCY, (s) => this.fetchTile(s.url).catch(() => null))
      if (stale()) {
        return false
      }
      const built = buildMap(date, tiles)
      status.tried.push({date, missing: built.missing, icePixels: built.icePixels})
      const whole = built.missing === 0 && built.icePixels >= MIN_ICE_PIXELS
      if (whole || built.icePixels > (best?.built.icePixels ?? 0)) {
        best = {date, built}
      }
      if (whole) {
        break
      }
    }
    status.building = null
    if (!best || best.built.icePixels === 0) {
      console.warn(`[sea ice] NASA GIBS has no sea ice for ${source.date} or the days before it`)
      return false
    }
    this.concentration.set(best.built.map)
    this.texture.needsUpdate = true
    this.version++
    Object.assign(status, {date: best.date, record: recordOf(best.date),
      icePixels: best.built.icePixels, ready: true})
    return true
  }


  /** The sea ice is drawn this frame: the first map's fade starts here. */
  drawn(perfNow = performance.now()) {
    if (this.version > 0 && this._fadeFrom === undefined) {
      this._fadeFrom = this.shown() ? perfNow : null
    }
  }


  /**
   * @param {number} [perfNow]
   * @returns {number} The share of the map drawn now, 0 to 1: 0 until a map
   *   is first drawn, then eased in; 1 at once if that was before the scene
   *   was on screen
   */
  gain(perfNow = performance.now()) {
    if (this._fadeFrom === undefined) {
      return 0
    }
    if (this._fadeFrom === null) {
      return 1
    }
    // A smoothstep, as the clouds' (PointPopulation fadeGain), not imported:
    // this is a chunk of its own, and a first-load module it imported would
    // be split from the first load into a file of its own (AGENTS.md).
    const x = Math.max(0, Math.min(1, (perfNow - this._fadeFrom) / this.fadeInMs))
    return x * x * (3 - (2 * x))
  }


  /**
   * The map as an RGBA picture for Cesium's imagery layer: the ice's colour
   * everywhere, its concentration in alpha.
   *
   * @param {Array<number>} rgb The ice's colour, sRGB bytes
   * @returns {Uint8ClampedArray} MAP_WIDTH × MAP_HEIGHT × 4, row 0 north
   */
  rgba(rgb) {
    const out = new Uint8ClampedArray(this.concentration.length * 4)
    for (let i = 0; i < this.concentration.length; i++) {
      out[4 * i] = rgb[0]
      out[(4 * i) + 1] = rgb[1]
      out[(4 * i) + 2] = rgb[2]
      out[(4 * i) + 3] = this.concentration[i]
    }
    return out
  }
}


// A date is wanted for this long, ms, before its sea ice loads.
const SETTLE_MS = 1000
const TILE_CONCURRENCY = 4
/** How long the first map takes to come in, ms (as the clouds'). */
export const SEA_ICE_FADE_IN_MS = 1200
const TILE_ATTEMPTS = 2
const TILE_TIMEOUT_MS = 30000
const HTTP_NOT_FOUND = 404


/**
 * @param {Array} items
 * @param {number} limit
 * @param {function(*): Promise} fn
 * @returns {Promise<Array>} fn's results, in items' order, at most limit at a time
 */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({length: Math.min(limit, items.length)}, worker))
  return out
}


/**
 * @param {string} url A GIBS tile
 * @returns {Promise<?Uint8Array>} Its palette indices, or null where GIBS has
 *   none (404) or the network failed twice
 */
async function fetchIndices(url) {
  for (let attempt = 0; attempt < TILE_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, {signal: AbortSignal.timeout(TILE_TIMEOUT_MS)})
      if (response.status === HTTP_NOT_FOUND) {
        return null
      }
      if (!response.ok) {
        continue
      }
      return (await decodeIndexedPng(new Uint8Array(await response.arrayBuffer()))).indices
    } catch {
      // Try again, then give up on the tile.
    }
  }
  return null
}
