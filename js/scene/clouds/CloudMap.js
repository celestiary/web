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
import {fadeGain} from '../points/PointPopulation.js'
import {sharedBlob} from '../sharedImage.js'
import {COMPLETE_BAND_DEG, buildDay, chooseDay, fadeSeam, fallbackSources, seamSource} from './cloudDay.js'
import {CLOUD_TILE_LEVEL, TILE_PX, cloudSource, coverageFromBundled, tileGrid} from './cloudSource.js'


/**
 * Earth's cloud coverage map: one byte a pixel, equirectangular, −180° at
 * the left edge and north at the top (texture row 0), as the Blue Marble
 * is laid out.  Built in the browser from the simulation date's NASA GIBS
 * true-colour mosaic (cloudSource.js), off screen as the tiles arrive, and
 * shown whole once it's built (cloudDay.js), so nothing waits for it, and a
 * part-built or unfinished day never shows its tiles' edges: until then
 * the map keeps what it had (nothing, at first).  Once the day is shown
 * the day before's westernmost tiles are fetched, and the antimeridian's
 * cut is faded into them (a second upload, of the same day).  The bundled
 * cloud texture is fetched only when a day leaves pixels unseen (polar
 * night, a tile neither layer serves), after its tiles, or for a date with
 * no daily picture.  Planet.md, "Clouds".
 *
 * update() is called every frame (the shell's preAnimCb); it starts a load
 * once the date's source has stayed the same for SETTLE_MS (a clock running
 * at days a second doesn't start a load a frame).  A load for a stale date
 * is abandoned between tiles.
 *
 * The first map fades in (gain, drawn): from nothing to whole over
 * CLOUD_FADE_IN_MS from the first frame the clouds can draw with it, as a
 * star tile's light does (PointPopulation fadeGain), rather than appearing
 * in a frame seconds after the planet is on screen.  Unless the scene
 * wasn't on screen yet (`shown`, the first load's reveal): then the
 * reveal's own fade brings them in with the planet.
 */
export default class CloudMap {
  /**
   * @param {object} opts
   * @param {string} opts.groundPattern The Blue Marble's monthly path under
   *   textures/, with {MM} (earth.json texture_monthly)
   * @param {string} opts.bundledPath The bundled cloud texture, under
   *   textures/ (earth/earth_atmos.jpg)
   * @param {string} [opts.fillPath] Its small copy, under textures/
   *   (earth/earth_atmos_fill.jpg), for a day's polar gaps
   * @param {Function} [opts.shown] Whether the scene is on screen (the
   *   first load's reveal has begun: Scene.revealed): a map first drawn
   *   after that fades in, one drawn before it doesn't
   * @param {number} [opts.fadeInMs]
   */
  constructor({groundPattern, bundledPath, fillPath = null, shown = () => true, fadeInMs = CLOUD_FADE_IN_MS}) {
    const {width, height} = tileGrid(CLOUD_TILE_LEVEL)
    this.width = width
    this.height = height
    this.groundPattern = groundPattern
    this.bundledPath = bundledPath
    this.fillPath = fillPath
    this.coverage = new Uint8Array(width * height)
    this.texture = new DataTexture(this.coverage, width, height, RedFormat, UnsignedByteType)
    this.texture.wrapS = RepeatWrapping
    this.texture.wrapT = ClampToEdgeWrapping
    this.texture.magFilter = LinearFilter
    this.texture.minFilter = LinearMipmapLinearFilter
    this.texture.generateMipmaps = true
    this.texture.unpackAlignment = 1
    this.texture.name = 'cloud coverage'
    // What's shown, for the app and tests: {kind, wanted, building,
    // date, satellites, tilesDone, tilesTotal, tilesFailed, tried, ready,
    // seam} (_loadDaily), or {kind: 'bundled', reason, loaded}.
    this.status = {kind: 'none'}
    // Whether the texture holds a day from NASA GIBS (its credit, gibs.js),
    // not the bundled clouds or nothing.
    this.fromGibs = false
    this._wantedKey = null
    this._wantedSince = 0
    this._loadingKey = null
    this._generation = 0
    this._grounds = new Map()
    this._bundled = null
    this._fill = null
    this.shown = shown
    this.fadeInMs = fadeInMs
    // Whether a map is in the texture, and when its fade began: undefined
    // until the clouds are first drawn with one (drawn), null if that was
    // before the scene was shown (no fade).
    this._landed = false
    this._fadeFrom = undefined
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
    // Once the date has settled: a permalink sets the clock just after the
    // app starts, and a clock running at days a second passes through.
    if (now - this._wantedSince < SETTLE_MS) {
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


  /** Mark the texture for upload: a map is in it. */
  _changed() {
    this.texture.needsUpdate = true
    this._landed = true
  }


  /**
   * The clouds are drawn this frame (the shell's preAnimCb, while the
   * surface under them is ready).  The first such frame with a map in the
   * texture starts its fade in, if the scene is on screen; before that
   * (the first load, under its reveal) the map is whole from the start.
   *
   * @param {number} [nowMs] performance.now()
   */
  drawn(nowMs = performance.now()) {
    if (this._landed && this._fadeFrom === undefined) {
      this._fadeFrom = this.shown() ? nowMs : null
    }
  }


  /**
   * The share of the map's coverage the clouds draw now, 0 to 1: the
   * shell's opacity and the volume's share are multiplied by it.  0 until
   * the first map has been drawn (drawn), then eased in over fadeInMs
   * (fadeGain's smoothstep); 1 at once for a map drawn before the scene
   * was shown.  A later day's map replaces the shown one whole.
   *
   * @param {number} [nowMs] performance.now()
   * @returns {number}
   */
  gain(nowMs = performance.now()) {
    if (this._fadeFrom === undefined) {
      return 0
    }
    return this._fadeFrom === null ? 1 : fadeGain(nowMs - this._fadeFrom, this.fadeInMs)
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
    this.fromGibs = false
    this._changed()
    this.status = {kind: 'bundled', reason: source.reason, loaded: true}
  }


  /**
   * A day's mosaic, built whole off screen and shown at once (cloudDay.js):
   * the wanted day's if it's complete, else the latest complete day's of
   * the DAYS_BACK before it, else the wanted day's, gaps and all.  Each
   * tile is unmixed against its month's Blue Marble, its gaps from the
   * secondary layer, what neither saw from the bundled texture.  Until it's
   * ready the map keeps what it had.  Then the seam at ±180° is faded into
   * the day before's clouds (_fadeSeam), which doesn't hold the day back.
   *
   * @param {object} source cloudSource's daily source
   * @param {number} generation
   */
  async _loadDaily(source, generation) {
    const {cols, rows} = tileGrid(CLOUD_TILE_LEVEL)
    this.status = {
      // The day wanted, the day being built, and (once it's ready) the day shown.
      kind: 'daily', wanted: source.date, building: source.date, date: null, satellites: null,
      tilesDone: 0, tilesTotal: cols * rows, tilesFailed: 0,
      // Main-thread time spent unmixing, ms, over every day tried.
      unmixMs: 0,
      // The days tried, and the share of the band each left unseen.
      tried: [],
      // Pixels of the day shown given the bundled texture's coverage.
      filled: 0,
      ready: false,
      // The antimeridian's fade into the day before, once the day is shown:
      // {date, state}, state building, blended, incomplete (the day before's
      // clouds there aren't all in GIBS), failed, or none (before the satellites).
      seam: null,
    }
    const status = this.status
    const stale = () => this._stale(generation)
    // The wanted day's ground loads alongside (its build awaits it).
    this._ground(Number(source.date.slice(5, 7))).catch(() => null)
    let msBefore = 0
    const chosen = await chooseDay(fallbackSources(source), async (s, stopAbove) => {
      const ground = await this._ground(Number(s.date.slice(5, 7)))
      if (stale()) {
        return null
      }
      Object.assign(status, {building: s.date, tilesDone: 0, tilesFailed: 0})
      msBefore = status.unmixMs
      const day = await buildDay({
        source: s, ground, bundled: (need) => this._bundledForFill(need), fetchTile, stopAbove, stale,
        onTile: ({done, failed, unmixMs}) => {
          Object.assign(status, {tilesDone: done, tilesFailed: failed, unmixMs: msBefore + unmixMs})
        },
      })
      if (day) {
        status.tried.push({date: s.date, unseenShare: day.unseenShare, complete: day.complete, filled: day.filled})
      }
      return day
    })
    if (!chosen || stale()) {
      return
    }
    const {source: shown, day} = chosen
    this.coverage.set(day.coverage)
    this.fromGibs = true
    this._changed()
    Object.assign(status, {building: null, date: shown.date, satellites: shown.layers.map((l) => l.satellite),
      tilesFailed: day.failed, complete: day.complete, unseenShare: day.unseenShare, filled: day.filled, ready: true})
    if (!day.complete) {
      console.warn(`[clouds] NASA GIBS's mosaics for ${source.date} and the days before it are incomplete; ` +
        `${(100 * day.unseenShare).toFixed(1)}% of its clouds between ${COMPLETE_BAND_DEG}° N and S are ` +
        'the bundled texture\'s')
    } else if (shown.date !== source.date) {
      console.info(`[clouds] NASA GIBS's mosaic for ${source.date} is incomplete; showing ${shown.date}'s`)
    }
    await this._fadeSeam(shown, generation)
  }


  /**
   * Fade the shown day's westernmost columns into the day before's (the
   * antimeridian's cut is between swaths a day apart: cloudDay.js, #251),
   * once that day's column of tiles is in and complete.  The day is already
   * shown whole; this only changes its west edge, in a second upload.  A day
   * before that fails or isn't complete leaves the cut as it was.
   *
   * @param {object} shown The source of the day shown
   * @param {number} generation
   */
  async _fadeSeam(shown, generation) {
    const status = this.status
    status.seam = {date: seamSource(shown)?.date ?? null, state: 'building'}
    const seam = await fadeSeam({
      map: this.coverage, shown, fetchTile, stale: () => this._stale(generation),
      groundOf: (s) => this._ground(Number(s.date.slice(5, 7))),
    })
    if (seam && !this._stale(generation)) {
      status.seam = seam
      if (seam.state === 'blended') {
        this._changed()
      }
    }
  }


  /**
   * @param {number} month 1-12
   * @returns {Promise<Uint8ClampedArray>} The month's Blue Marble, RGBA at
   *   the map's size
   */
  _ground(month) {
    if (!this._grounds.has(month)) {
      // The bytes are the surface's too, and Cesium's (sharedImage.js).
      const url = dataUrl(`textures/${monthlyPath(this.groundPattern, month)}.jpg`)
      this._grounds.set(month, sharedBlob(url).then((blob) => decodePixels(blob, this.width, this.height)).catch((err) => {
        this._grounds.delete(month)
        throw err
      }))
    }
    return this._grounds.get(month)
  }


  /**
   * @param {{detail: boolean}} need buildDay's: whether the full texture is
   *   wanted, or the small copy will do (the day's gaps are the polar night)
   * @returns {Promise<?Uint8Array>} The bundled texture as coverage, for a day
   *   with unseen pixels (buildDay): the small copy if that will do and the
   *   full texture isn't in or on its way already; or null, those pixels
   *   left clear, if it can't be had
   */
  _bundledForFill({detail}) {
    const coverage = detail || this._bundled || !this.fillPath ? this._bundledCoverage() : this._fillCoverage()
    return coverage.catch((err) => {
      console.warn('[clouds] couldn\'t load the bundled clouds to fill the day\'s gaps; they are clear', err)
      return null
    })
  }


  /** @returns {Promise<Uint8Array>} The bundled texture's small copy as coverage, at the map's size */
  _fillCoverage() {
    if (!this._fill) {
      this._fill = this._coverageOf(this.fillPath).catch((err) => {
        this._fill = null
        throw err
      })
    }
    return this._fill
  }


  /** @returns {Promise<Uint8Array>} The bundled texture as coverage, at the map's size */
  _bundledCoverage() {
    if (!this._bundled) {
      this._bundled = this._coverageOf(this.bundledPath).catch((err) => {
        this._bundled = null
        throw err
      })
    }
    return this._bundled
  }


  /**
   * @param {string} path A bundled cloud picture, under textures/
   * @returns {Promise<Uint8Array>} As coverage, at the map's size
   */
  async _coverageOf(path) {
    const rgba = await fetchPixels(dataUrl(`textures/${path}`), this.width, this.height)
    const out = new Uint8Array(this.width * this.height)
    for (let i = 0; i < out.length; i++) {
      out[i] = Math.round(coverageFromBundled(rgba[4 * i]) * 255)
    }
    return out
  }
}


// A date is wanted for this long, ms, before its clouds load.
const SETTLE_MS = 1000

/**
 * How long the first map's clouds take to come in, ms, from the first
 * frame they can be drawn (CloudMap.gain): a fade, not a wait, and not a
 * pop over a planet already on screen.
 */
export const CLOUD_FADE_IN_MS = 1200

// Fetch attempts per tile: the network can drop one.
const TILE_ATTEMPTS = 2
const HTTP_NOT_FOUND = 404
// A tile request that hasn't answered in this long, ms, is tried again: a
// stalled one held its day's map back for good.
const TILE_TIMEOUT_MS = 30000


/**
 * @param {string} url A GIBS tile
 * @returns {Promise<Uint8ClampedArray|null>} Its RGBA, TILE_PX square, or
 *   null where GIBS has none (404: a day missing from the layer) or the
 *   network failed twice
 */
async function fetchTile(url) {
  for (let attempt = 0; attempt < TILE_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, {signal: AbortSignal.timeout(TILE_TIMEOUT_MS)})
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
