import {BufferGeometry, Group, Matrix4, Points, Vector3} from 'three'
import {J2000_JD} from '../celestialFrame.js'
import {rteCameraLocal} from '../rte.js'
import {countBrighter, selectTiles} from './selection.js'
import {INDEX_FILE, tilePath} from './tileFormat.js'
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

/** Days in a Julian year. */
const JULIAN_YEAR_DAYS = 365.25

const _camWorld = new Vector3
const _dirWorld = new Vector3
const _inv = new Matrix4


/**
 * @typedef {object} PopulationHost What the scene gives a population each frame
 * @property {Function} camera () => the camera, or null
 * @property {Function} limitingMagnitude () => the star field's limit now (ThreeUi.limitingMagnitude)
 * @property {Function} [aspect] () => the viewport's width over height
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
   * @param {Function} [opts.fetchFn] For tests: (url) => Promise<Response>
   */
  constructor({name, baseUrl, decode, material, host, budget = DEFAULT_BUDGET, marginMag = DEFAULT_MARGIN_MAG,
    memoryPoints = DEFAULT_MEMORY_POINTS, fetchFn = null}) {
    super()
    this.name = name
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
    this.decode = decode
    this.material = material
    this.host = host
    this.budget = budget
    this.marginMag = marginMag
    this.memoryPoints = memoryPoints
    this.fetchFn = fetchFn ?? ((url) => fetch(url))
    /** 'idle' | 'loading' | 'ready' | 'absent' | 'error' */
    this.status = 'idle'
    this.manifest = null
    this.tiles = new Map()
    this.roots = []
    /** key → {points, mags, count, lastWanted} */
    this.loaded = new Map()
    this.inFlight = new Set()
    this.failed = new Set()
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
    this.status = 'ready'
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
    const halfAngle = Math.atan(tanHalf * Math.sqrt(1 + (aspect * aspect)))
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
    const result = selectTiles(this.roots, this._childrenOf, view, this._loadedMags)
    const wanted = new Set()
    let drawn = 0
    const toFetch = []
    for (const s of result.selected) {
      wanted.add(s.tile.key)
      const tile = this.loaded.get(s.tile.key)
      if (tile) {
        tile.lastWanted = this.frame
        const n = Math.min(countBrighter(s.tile, s.cut, tile.mags), s.maxCount, Math.max(0, this.budget - drawn))
        tile.points.geometry.setDrawRange(0, n)
        tile.points.visible = n > 0
        drawn += n
      } else if (!this.inFlight.has(s.tile.key) && !this.failed.has(s.tile.key)) {
        toFetch.push(s.tile)
      }
    }
    for (const [key, tile] of this.loaded) {
      if (!wanted.has(key)) {
        tile.points.visible = false
      }
    }
    for (const t of toFetch) {
      if (this.inFlight.size >= MAX_IN_FLIGHT) {
        break
      }
      this.fetchTile(t)
    }
    this.evict()
    // Selected tiles not loaded yet, in flight or waiting: 0 once settled.
    const missing = result.selected.filter((s) => !this.loaded.has(s.tile.key) && !this.failed.has(s.tile.key)).length
    this.last = {selected: result.selected.length, drawn, estimate: result.estimate, budgetHit: result.budgetHit,
      limit: view.limit, visited: result.visited, camDistLy: view.camDist, missing}
    return result
  }


  /**
   * @param {object} t TileInfo
   * @returns {Promise<void>}
   */
  async fetchTile(t) {
    this.inFlight.add(t.key)
    this.counters.requests++
    try {
      const rsp = await this.fetchFn(`${this.baseUrl}${tilePath(t.order, t.pix)}`)
      if (!rsp.ok) {
        throw new Error(`HTTP ${rsp.status}`)
      }
      const buf = await rsp.arrayBuffer()
      this.counters.bytes += buf.byteLength
      const t0 = performance.now()
      const data = this.decode(buf)
      this.counters.decodeMs += performance.now() - t0
      this.addTile(t, data)
    } catch (e) {
      this.failed.add(t.key)
      console.warn(`${this.name}: tile ${t.key} failed: ${e.message}`)
    } finally {
      this.inFlight.delete(t.key)
    }
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
    points.onBeforeRender = (renderer, scene, camera) => {
      rteCameraLocal(points, camera, this._camHigh, this._camLow)
    }
    this.add(points)
    this.loaded.set(t.key, {points, mags: data.mags, count: data.count, lastWanted: this.frame})
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
      budget: this.budget, marginMag: this.marginMag, ...this.counters, ...this.last,
    }
  }
}

