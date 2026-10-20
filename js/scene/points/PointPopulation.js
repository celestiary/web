import {BufferGeometry, Group, Matrix4, Points, Vector3} from 'three'
import {J2000_JD} from '../celestialFrame.js'
import {rteCameraLocal} from '../rte.js'
import {countBrighter, selectTiles, tileInView} from './selection.js'
import {INDEX_FILE, decodePack, packPath, tilePath} from './tileFormat.js'
import {tileFromRow} from './tileTree.js'
import {LIGHTYEAR_METER} from '../../shared.js'


/**
 * The point-population engine (js/scene/Gaia.md, "The engine"): a tiled,
 * magnitude-ordered population drawn as points, loaded progressively and
 * drawn to a budget.  One instance per population.  What a population
 * brings:
 *
 * - its tiles (tileFormat.js) and manifest (tileTree.js), under a base URL;
 * - `decode(buf)`: a tile to its points' attributes and their sorted
 *   magnitudes (starTile.js for stars);
 * - `material`: what draws them (starsMaterial.js for stars; it must take
 *   the RTE camera uniforms, uCamPosWorldHigh and Low);
 * - its epoch, for a material that moves its points (uMotionYears).
 *
 * Every frame (`update`, from the scene's animation callback) it works out
 * the view in its own frame, asks selection.js which tiles to draw to the
 * limiting magnitude plus a margin, within the point budget, sets each
 * loaded tile's draw range to its share, and fetches the wanted tiles that
 * aren't loaded, brightest first, a few at a time.  Tiles not wanted for a
 * while are dropped once more than `memoryPoints` are loaded.
 *
 * With no manifest at its URL (no data built yet) it draws nothing and
 * asks for nothing more.
 *
 * A population that must be held whole (the bundled catalogue, whose
 * stars the names, search, labels and picking resolve: Stars.md,
 * "Brightness tiers") is `complete`: its roots are fetched as soon as the
 * manifest is in, whatever the view, then what the view wants, then every
 * other tile, brightest first, and none is dropped.  `drawAll` draws every
 * point of each loaded tile in the field, not just those to the limit plus
 * the margin, so the catalogue's frame is the one it drew as a single
 * geometry; the margin then orders the fetches and says when the view's
 * tiles are in (`viewReady`).  A manifest's `packs` put several tiles in
 * one file (tileFormat.js encodePack): a pack is fetched when any of its
 * tiles is wanted, and all of them are added.
 */


/** The default most points a population draws in a frame. */
export const DEFAULT_BUDGET = 500000
/**
 * Magnitudes past the limiting magnitude that are drawn: a star 1 mag under
 * the limit has 40% of a just-visible star's light, which still lifts its
 * pixel off black through the tone map's toe (HDR.md: "fainter ones less,
 * down into black smoothly"); 2 would be 16%, and twice the points.
 */
export const DEFAULT_MARGIN_MAG = 1
/** Tile requests in flight at once. */
export const MAX_IN_FLIGHT = 4
/** Points kept loaded, beyond which tiles not drawn recently are dropped. */
export const DEFAULT_MEMORY_POINTS = 2 * DEFAULT_BUDGET

/**
 * Pixels past the frame's edge a point can still light: half the star
 * sprite's largest quad (exposure.js STAR_MAX_SIZE_PX, 160), so a bright
 * star just outside the frame still draws its halo into it.
 */
export const EDGE_PAD_PX = 80
/**
 * A tile's light comes in over this long from when it lands (`fadeGain`),
 * once the population has been shown (`markShown`): stars that pop in at
 * full brightness in one frame are seen as a pop (#259's review: the
 * catalogue's faint tiers raised a dark field's light 20% in a frame).
 */
export const FADE_IN_MS = 1800
/** Days in a Julian year. */
const JULIAN_YEAR_DAYS = 365.25

const _camWorld = new Vector3
const _dirWorld = new Vector3
const _inv = new Matrix4


/**
 * A tile's gain on its points' light (the star shader's `uTileGain`, on
 * their flux, so the fade is physical in the additive HDR buffer: a star
 * fading in is a fainter star, not a transparent one), from how long ago
 * it landed: 0 then, 1 after `fadeMs`, smoothstep between, so neither end
 * is a step in the light's rate.
 *
 * @param {number} elapsedMs Since it landed
 * @param {number} [fadeMs]
 * @returns {number} 0 to 1
 */
export function fadeGain(elapsedMs, fadeMs = FADE_IN_MS) {
  if (!(fadeMs > 0)) {
    return 1
  }
  const x = Math.max(0, Math.min(1, elapsedMs / fadeMs))
  return x * x * (3 - (2 * x))
}


/**
 * @typedef {object} PopulationHost What the scene gives a population each frame
 * @property {Function} camera () => the camera, or null
 * @property {Function} limitingMagnitude () => the star field's limit now (ThreeUi.limitingMagnitude)
 * @property {Function} [aspect] () => the viewport's width over height
 * @property {Function} [heightPx] () => the viewport's height, pixels
 */


/** */
export default class PointPopulation extends Group {
  /**
   * @param {object} opts
   * @param {string} opts.name
   * @param {string} opts.baseUrl The directory holding index.json and the tiles, with or without a trailing slash
   * @param {Function} opts.decode (ArrayBuffer) => {count, attributes, mags}
   * @param {object} opts.material A ShaderMaterial taking the RTE uniforms
   * @param {PopulationHost} opts.host
   * @param {number} [opts.budget]
   * @param {number} [opts.marginMag]
   * @param {number} [opts.memoryPoints]
   * @param {boolean} [opts.complete] Fetch every tile, the roots first, and keep them
   * @param {boolean} [opts.drawAll] Draw every point of the loaded tiles in the field
   * @param {boolean} [opts.holdRest] A complete population: fetch only the
   *   roots and what the view wants until `releaseRest()`
   * @param {Function} [opts.onTile] (tileInfo, decoded) => after each tile is added
   * @param {Function} [opts.onFail] (keys) => after a request for these tiles failed
   * @param {number} [opts.fadeInMs] How long a tile's light takes to come in
   * @param {boolean} [opts.shown] Whether tiles that land now fade in: false
   *   until `markShown()` for a population whose first tiles a reveal covers
   * @param {Function} [opts.fetchFn] For tests: (url) => Promise<Response>
   * @param {Function} [opts.now] For tests: the clock, ms
   */
  constructor({name, baseUrl, decode, material, host, budget = DEFAULT_BUDGET, marginMag = DEFAULT_MARGIN_MAG,
    memoryPoints = DEFAULT_MEMORY_POINTS, complete = false, drawAll = false, holdRest = false, onTile = null,
    onFail = null, fadeInMs = FADE_IN_MS, shown = true, fetchFn = null, now = null}) {
    super()
    this.name = name
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
    this.decode = decode
    this.material = material
    this.host = host
    this.budget = budget
    this.marginMag = marginMag
    this.memoryPoints = complete ? Infinity : memoryPoints
    this.complete = complete
    this.drawAll = drawAll
    this.holdRest = holdRest
    this.onTile = onTile
    this.onFail = onFail
    this.fadeInMs = fadeInMs
    this.shown = shown
    this.now = now ?? (() => performance.now())
    // The material's per-draw gain (starsMaterial.js uTileGain), if it has one.
    this._tileGain = material.uniforms.uTileGain ?? null
    this.fetchFn = fetchFn ?? ((url) => fetch(url))
    /** 'idle' | 'loading' | 'ready' | 'absent' | 'error' */
    this.status = 'idle'
    this.manifest = null
    this.tiles = new Map()
    this.roots = []
    /** key → {points, mags, ids, count, lastWanted} */
    this.loaded = new Map()
    this.inFlight = new Set()
    this.failed = new Set()
    // Requests in flight: a pack is one request for several tiles.
    this.requests = 0
    // Tile key → its pack's name, and a pack's tiles (the manifest's packs).
    this.packOf = new Map()
    this.packTiles = new Map()
    // For a complete population: every tile, the roots first, then
    // brightest first; and the keys the last frame wanted, in its order.
    this._fetchOrder = []
    this._wantedOrder = []
    this.frame = 0
    this.counters = {requests: 0, bytes: 0, evicted: 0, decodeMs: 0}
    this.last = {selected: 0, drawn: 0, estimate: 0, budgetHit: false, limit: NaN, visited: 0}
    this._camHigh = material.uniforms.uCamPosWorldHigh.value
    this._camLow = material.uniforms.uCamPosWorldLow.value
    this._childrenOf = (t) => {
      const out = []
      for (let k = 0; k < 4; k++) {
        const c = this.tiles.get(`${t.order + 1}/${(4 * t.pix) + k}`)
        if (c) {
          out.push(c)
        }
      }
      return out
    }
    this._loadedMags = (t) => this.loaded.get(t.key)?.mags ?? null
  }


  /**
   * Fetch the manifest.  Quietly absent if there isn't one.
   *
   * @returns {Promise<void>}
   */
  async start() {
    if (this.status !== 'idle') {
      return
    }
    this.status = 'loading'
    try {
      const rsp = await this.fetchFn(`${this.baseUrl}${INDEX_FILE}`)
      if (!rsp.ok) {
        this.status = 'absent'
        return
      }
      this.setManifest(await rsp.json())
    } catch {
      this.status = 'absent'
    }
  }


  /** @param {object} manifest The population's index.json */
  setManifest(manifest) {
    if (manifest?.format !== 'celestiary-points' || !Array.isArray(manifest.tiles)) {
      this.status = 'error'
      return
    }
    this.manifest = manifest
    for (const row of manifest.tiles) {
      const t = tileFromRow(row)
      this.tiles.set(t.key, t)
      if (t.order === 0) {
        this.roots.push(t)
      }
    }
    for (const [pack, keys] of Object.entries(manifest.packs ?? {})) {
      this.packTiles.set(pack, keys)
      for (const key of keys) {
        this.packOf.set(key, pack)
      }
    }
    this._fetchOrder = [...this.tiles.values()].sort((a, b) =>
      ((a.order === 0 ? 0 : 1) - (b.order === 0 ? 0 : 1)) || (a.magBright - b.magBright))
    this.status = 'ready'
    if (this.complete) {
      // The roots now, with no view: they are the whole sky's brightest.
      this._pump()
    }
  }


  /**
   * @param {number} jde The date, TT Julian Day, for a moving population
   */
  setDate(jde) {
    const u = this.material.uniforms.uMotionYears
    if (u && Number.isFinite(jde)) {
      // Julian years from the population's epoch (J2000.0 for Gaia's tiles).
      u.value = ((jde - J2000_JD) / JULIAN_YEAR_DAYS) - ((this.manifest?.epoch ?? 2000) - 2000)
    }
  }


  /**
   * The view in this population's frame: the camera's position (light-years
   * from the Sun) and axis, the field's half diagonal and the limit.
   *
   * @param {object} camera
   * @returns {?object} selection.js's view, or null with no camera
   */
  view(camera) {
    if (!camera) {
      return null
    }
    this.updateWorldMatrix(true, false)
    _inv.copy(this.matrixWorld).invert()
    camera.getWorldPosition(_camWorld).applyMatrix4(_inv)
    camera.getWorldDirection(_dirWorld).transformDirection(_inv)
    const cam = _camWorld.clone().divideScalar(LIGHTYEAR_METER)
    const aspect = this.host.aspect?.() ?? camera.aspect ?? 1
    const tanHalf = Math.tan((camera.fov ?? 45) * Math.PI / 360)
    const heightPx = this.host.heightPx?.() ?? 1080
    const padRad = EDGE_PAD_PX * ((camera.fov ?? 45) * Math.PI / 180) / Math.max(heightPx, 1)
    const halfAngle = Math.atan(tanHalf * Math.sqrt(1 + (aspect * aspect))) + padRad
    const limit = this.host.limitingMagnitude()
    return {
      cam: [cam.x, cam.y, cam.z], camDist: cam.length(), dir: [_dirWorld.x, _dirWorld.y, _dirWorld.z],
      halfAngle, limit: (Number.isFinite(limit) ? limit : 6.5) + this.marginMag, budget: this.budget,
    }
  }


  /**
   * Choose, draw and fetch for this frame.
   *
   * @returns {?object} The selection, or null if nothing to do
   */
  update() {
    if (this.status === 'idle') {
      this.start()
      return null
    }
    if (this.status !== 'ready') {
      return null
    }
    const view = this.view(this.host.camera())
    if (!view) {
      return null
    }
    this.frame++
    this.updateFades()
    const result = selectTiles(this.roots, this._childrenOf, view, this._loadedMags)
    const wanted = new Set()
    let drawn = 0
    const toFetch = []
    for (const s of result.selected) {
      wanted.add(s.tile.key)
      const tile = this.loaded.get(s.tile.key)
      if (tile) {
        tile.lastWanted = this.frame
        if (!this.drawAll) {
          const n = Math.min(countBrighter(s.tile, s.cut, tile.mags), s.maxCount, Math.max(0, this.budget - drawn))
          tile.points.geometry.setDrawRange(0, n)
          tile.points.visible = n > 0
          drawn += n
        }
      } else if (!this.inFlight.has(s.tile.key) && !this.failed.has(s.tile.key)) {
        toFetch.push(s.tile)
      }
    }
    if (this.drawAll) {
      // Every point of each loaded tile that can be in the field.
      for (const [key, tile] of this.loaded) {
        const n = tileInView(this.tiles.get(key), view, false) ? tile.count : 0
        tile.points.geometry.setDrawRange(0, n)
        tile.points.visible = n > 0
        drawn += n
      }
    } else {
      for (const [key, tile] of this.loaded) {
        if (!wanted.has(key)) {
          tile.points.visible = false
        }
      }
    }
    this._wantedOrder = toFetch
    this._pump()
    this.evict()
    // Selected tiles not loaded yet, in flight or waiting: 0 once settled.
    const absent = result.selected.filter((s) => !this.loaded.has(s.tile.key) && !this.failed.has(s.tile.key))
    this.last = {selected: result.selected.length, drawn, estimate: result.estimate, budgetHit: result.budgetHit,
      limit: view.limit, visited: result.visited, camDistLy: view.camDist, missing: absent.length}
    return result
  }


  /**
   * Fetch what is wanted, up to MAX_IN_FLIGHT requests: the last frame's
   * wanted tiles, brightest first; for a complete population the roots
   * before them and every other tile after.  Run each frame and as each
   * request lands, so a complete population loads at the network's pace,
   * not the frame rate's.
   */
  _pump() {
    if (this.status !== 'ready') {
      return
    }
    const pending = (t) => !this.loaded.has(t.key) && !this.inFlight.has(t.key) && !this.failed.has(t.key)
    let queue = this._wantedOrder
    if (this.complete) {
      // The roots alone first: the bright tier is what the first load
      // waits for, and nothing else shares its bandwidth until it's in.
      const rootsPending = this.roots.some((t) => !this.loaded.has(t.key) && !this.failed.has(t.key))
      queue = rootsPending ? this.roots : [...this._wantedOrder, ...(this.holdRest ? [] : this._fetchOrder)]
    }
    for (const t of queue) {
      if (this.requests >= MAX_IN_FLIGHT) {
        break
      }
      if (pending(t)) {
        this.fetchTile(t)
      }
    }
  }


  /**
   * @param {object} t TileInfo
   * @returns {Promise<void>}
   */
  async fetchTile(t) {
    const pack = this.packOf.get(t.key)
    if (pack !== undefined) {
      return this.fetchPack(pack)
    }
    this.inFlight.add(t.key)
    this.requests++
    this.counters.requests++
    let data = null
    try {
      const rsp = await this.fetchFn(`${this.baseUrl}${tilePath(t.order, t.pix)}`)
      if (!rsp.ok) {
        throw new Error(`HTTP ${rsp.status}`)
      }
      const buf = await rsp.arrayBuffer()
      this.counters.bytes += buf.byteLength
      data = this._decode(buf)
    } catch (e) {
      this.failed.add(t.key)
      console.warn(`${this.name}: tile ${t.key} failed: ${e.message}`)
    } finally {
      this.inFlight.delete(t.key)
      this.requests--
    }
    // Outside the fetch's try: what a consumer throws isn't a lost tile.
    if (data) {
      this._add(t, data)
    } else {
      this.onFail?.([t.key])
    }
    if (this.complete) {
      this._pump()
    }
  }


  /**
   * Fetch a pack and add every tile in it.
   *
   * @param {string} pack Its name in the manifest
   * @returns {Promise<void>}
   */
  async fetchPack(pack) {
    const keys = this.packTiles.get(pack) ?? []
    keys.forEach((k) => this.inFlight.add(k))
    this.requests++
    this.counters.requests++
    let decoded = null
    try {
      const rsp = await this.fetchFn(`${this.baseUrl}${packPath(pack)}`)
      if (!rsp.ok) {
        throw new Error(`HTTP ${rsp.status}`)
      }
      const buf = await rsp.arrayBuffer()
      this.counters.bytes += buf.byteLength
      const inPack = decodePack(buf)
      if (inPack.length !== keys.length || inPack.some((e, i) => e.key !== keys[i])) {
        throw new Error(`pack ${pack} doesn't hold the tiles its manifest lists`)
      }
      decoded = inPack.map((e) => [this.tiles.get(e.key), this._decode(e.buf)])
    } catch (e) {
      keys.forEach((k) => this.failed.add(k))
      console.warn(`${this.name}: pack ${pack} failed: ${e.message}`)
    } finally {
      keys.forEach((k) => this.inFlight.delete(k))
      this.requests--
    }
    // Outside the fetch's try: what a consumer throws isn't a lost pack.
    if (decoded) {
      decoded.forEach(([t, data]) => this._add(t, data))
    } else {
      this.onFail?.(keys)
    }
    if (this.complete) {
      this._pump()
    }
  }


  /**
   * @param {ArrayBuffer} buf A tile
   * @returns {object} decode's result
   */
  _decode(buf) {
    const t0 = performance.now()
    const data = this.decode(buf)
    this.counters.decodeMs += performance.now() - t0
    return data
  }


  /**
   * @param {object} t TileInfo
   * @param {object} data decode's result
   */
  _add(t, data) {
    this.addTile(t, data)
    this.onTile?.(t, data)
  }


  /**
   * A complete population held to its roots and its view's tiles
   * (`holdRest`) fetches the rest now, brightest first.
   */
  releaseRest() {
    if (this.holdRest) {
      this.holdRest = false
      this._pump()
    }
  }


  /**
   * @returns {boolean} Whether nothing more will come: every tile of the
   *   manifest loaded or failed (or there is no manifest)
   */
  done() {
    if (this.status === 'absent' || this.status === 'error') {
      return true
    }
    if (this.status !== 'ready') {
      return false
    }
    for (const key of this.tiles.keys()) {
      if (!this.loaded.has(key) && !this.failed.has(key)) {
        return false
      }
    }
    return true
  }


  /** @returns {boolean} Every root loaded: the whole sky's brightest */
  rootsLoaded() {
    return this.status === 'ready' && this.roots.length > 0 && this.roots.every((t) => this.loaded.has(t.key))
  }


  /**
   * @returns {boolean} Whether every tile this frame's view wants, to the
   *   limiting magnitude plus the margin, is in: false before the first
   *   frame.  The margin's stars, under the limit, still light a pixel
   *   through the tone map's toe: at the naked eye's limit, a field of the
   *   catalogue's has a quarter of its light from stars past 6.5
   *   (Stars.md, "Brightness tiers").
   */
  viewReady() {
    return this.status === 'ready' && this.frame > 0 && this.last.missing === 0
  }


  /**
   * From now, tiles that land fade in (`fadeGain`): what landed before is
   * at full light, as the reveal that shows the population covers it.
   */
  markShown() {
    this.shown = true
  }


  /**
   * Each loaded tile's gain, by how long ago it landed.  Each frame.
   *
   * @returns {number} Tiles still fading
   */
  updateFades() {
    const now = this.now()
    let fading = 0
    for (const tile of this.loaded.values()) {
      if (tile.gain < 1) {
        tile.gain = fadeGain(now - tile.landedAt, this.fadeInMs)
        fading += tile.gain < 1 ? 1 : 0
      }
    }
    return fading
  }


  /**
   * @param {object} t TileInfo
   * @param {object} data decode's result
   */
  addTile(t, data) {
    const geometry = new BufferGeometry()
    for (const [name, attr] of Object.entries(data.attributes)) {
      geometry.setAttribute(name, attr)
    }
    geometry.setDrawRange(0, 0)
    const points = new Points(geometry, this.material)
    points.name = `${this.name} ${t.key}`
    // The selection culls by tile; the vertex shader places the points
    // (RTE), so three's bounding sphere, in metres from a float32 copy,
    // has nothing to add.
    points.frustumCulled = false
    points.visible = false
    // Fading in from 0 if the population is shown, else at full light.
    const tile = {points, mags: data.mags, ids: data.ids ?? null, hips: data.hips ?? null, count: data.count,
      lastWanted: this.frame, landedAt: this.now(), gain: this.shown && this.fadeInMs > 0 ? 0 : 1}
    const tileGain = this._tileGain
    points.onBeforeRender = (renderer, scene, camera) => {
      rteCameraLocal(points, camera, this._camHigh, this._camLow)
      if (tileGain) {
        // The tiles share one material: each draw uploads its own gain.
        tileGain.value = tile.gain
        this.material.uniformsNeedUpdate = true
      }
    }
    this.add(points)
    this.loaded.set(t.key, tile)
  }


  /** Drop the least recently wanted tiles past the memory limit. */
  evict() {
    let total = 0
    for (const tile of this.loaded.values()) {
      total += tile.count
    }
    if (total <= this.memoryPoints) {
      return
    }
    const old = [...this.loaded.entries()].filter(([, t]) => t.lastWanted < this.frame)
        .sort((a, b) => a[1].lastWanted - b[1].lastWanted)
    for (const [key, tile] of old) {
      if (total <= this.memoryPoints) {
        break
      }
      this.remove(tile.points)
      tile.points.geometry.dispose()
      this.loaded.delete(key)
      total -= tile.count
      this.counters.evicted++
    }
  }


  /**
   * @returns {object} What it holds and draws, for the console, tests and
   *   the perf overlay's JSON
   */
  stats() {
    let loadedPoints = 0
    let visibleTiles = 0
    for (const tile of this.loaded.values()) {
      loadedPoints += tile.count
      if (tile.points.visible) {
        visibleTiles++
      }
    }
    return {
      name: this.name, status: this.status, manifestTiles: this.tiles.size, manifestPoints: this.manifest?.count ?? 0,
      loadedTiles: this.loaded.size, loadedPoints, visibleTiles, inFlight: this.inFlight.size, failed: this.failed.size,
      inFlightRequests: this.requests, done: this.done(),
      budget: this.budget, marginMag: this.marginMag, ...this.counters, ...this.last,
    }
  }
}

