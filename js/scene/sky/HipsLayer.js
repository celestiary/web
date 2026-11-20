import {BufferGeometry, Float32BufferAttribute, Group, Mesh, Quaternion, TextureLoader, Vector3} from 'three'
import {angle, applyTransposed, cellGrid, cellsInDisc, formatOrder, frameMatrix, newCoverage, selectOrder,
  tilePath} from './hips.js'
import {TILE_RENDER_ORDER, disposeTileMesh, newTileMaterial, prepareTileTexture} from './tileMaterial.js'


// A HiPS survey on the sky (Sky.md): the tiles of the survey's order for the
// view, within its coverage, each a GRID × GRID mesh on the unit sphere in
// the survey's frame turned to the scene's J2000 frame.  Hung from
// Scene.stellarFrame, which precesses it to the date with the stars, and
// drawn as Rubin's image is (tileMaterial.js): at the camera by the
// model-view's turn alone, at the far plane, display-referred.
//
// From the animation loop (preAnimCb): the order from the field and the
// canvas (hips.js selectOrder), the cells in view at it and at a coarser one
// drawn under it while the detail loads; at most MAX_LOADING fetches at a
// time, at most MAX_TILES kept.  A tile that fails from the survey's first
// service is asked of its mirror once; one that fails from both is marked
// missing and not asked again.

/** Each tile's mesh, vertices a side less one. */
export const GRID = 8
export const MAX_LOADING = 6
export const MAX_TILES = 128
/** Cells at one order in a view at most (a 1500 × 1000 canvas needs under 50). */
export const MAX_CELLS = 96
/** The coarser order drawn under the detail: this many orders up. */
export const FALLBACK_ORDERS = 3
/** Tiles remembered as missing at most. */
const MAX_MISSING = 4096

const toRad = Math.PI / 180
const tmpQuat = new Quaternion


/**
 * A survey's black key and look, for its tiles' material: black keyed out
 * as no data, over the manifest's `keyBlack` ramp (`[from, full]` in counts
 * of 255: a jpeg survey's, wider, Sky.md "Black as no data") or the
 * default's, and its negative shown where the manifest says `invert`.
 *
 * @param {object} survey A manifest
 * @returns {{keyBlack: boolean, keyBlackFrom?: number, keyBlackFull?: number, invert: boolean}}
 */
export function tileKey(survey) {
  const out = {keyBlack: true, invert: survey.invert === true}
  if (Array.isArray(survey.keyBlack)) {
    out.keyBlackFrom = survey.keyBlack[0] / 255
    out.keyBlackFull = survey.keyBlack[1] / 255
  }
  return out
}
const tmpDir = new Vector3
const tmpPos = new Vector3
const tmpScale = new Vector3


/**
 * A tile's geometry.
 *
 * @param {number} order
 * @param {number} pix
 * @param {Array<Array<number>>} toScene hips.js frameMatrix's
 * @returns {BufferGeometry}
 */
export function tileGeometry(order, pix, toScene) {
  const g = cellGrid(order, pix, toScene, GRID)
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(g.positions, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(g.uvs, 2))
  geometry.setIndex(g.index)
  return geometry
}


/** */
export default class HipsLayer extends Group {
  /**
   * @param {object} opts
   * @param {object} opts.survey A survey's manifest (surveys.js)
   * @param {() => {camera: object, fovDeg: number, heightPx: number, aspect: number}} opts.view
   * @param {Function} [opts.sceneReferred] hdr.js's
   * @param {(url: string) => Promise<object>} [opts.loadTexture] A three Texture's promise
   * @param {boolean} [opts.webp] Whether webp tiles may be asked for
   * @param {(drawn: boolean) => void} [opts.onDrawn] When the first tile shows, and when the last goes
   */
  constructor({survey, view, sceneReferred = null, loadTexture = null, webp = true, onDrawn = null}) {
    super()
    this.name = `hips ${survey.id}`
    this.survey = survey
    this.view = view
    this.sceneReferred = sceneReferred
    this.loadTexture = loadTexture ?? ((url) => {
      const loader = new TextureLoader()
      loader.setCrossOrigin('anonymous')
      return loader.loadAsync(url)
    })
    this.onDrawn = onDrawn
    this.toScene = frameMatrix(survey.frame)
    this.coverage = newCoverage(survey.coverage ?? null)
    /** The formats to try, most preferred first (hips.js formatOrder). */
    this.formats = formatOrder(survey.formats, webp)
    this.formatIndex = 0
    /** Whether a tile has loaded in the current format: then it is kept. */
    this.formatConfirmed = false
    /** The service asked first: the mirror, once the primary failed where it answered. */
    this.serviceIndex = 0
    /** key → {order, pix, mesh, state, used} */
    this.tiles = new Map()
    this.missing = new Set()
    this.loading = 0
    this.requested = 0
    this.frame = 0
    this.order = null
    this.drawn = false
    this.disposed = false
    this._cells = null
    this.preAnimCb = () => this.update()
  }


  /** @returns {string} The tile format asked for now */
  get ext() {
    return this.formats[this.formatIndex]
  }


  /**
   * The view's direction in the survey's frame and its angular radius.
   *
   * @returns {?{dir: Array<number>, radiusDeg: number, fovDeg: number, heightPx: number}}
   */
  viewInFrame() {
    const v = this.view()
    if (!v?.camera || !(v.fovDeg > 0) || !(v.heightPx > 0)) {
      return null
    }
    v.camera.getWorldDirection(tmpDir)
    this.updateWorldMatrix(true, false)
    this.matrixWorld.decompose(tmpPos, tmpQuat, tmpScale)
    tmpDir.applyQuaternion(tmpQuat.invert()).normalize()
    const half = v.fovDeg / 2 * toRad
    const radiusDeg = Math.atan(Math.tan(half) * Math.hypot(1, v.aspect || 1)) / toRad
    const dir = applyTransposed(this.toScene, [tmpDir.x, tmpDir.y, tmpDir.z])
    return {dir, radiusDeg, fovDeg: v.fovDeg, heightPx: v.heightPx}
  }


  /**
   * The cells wanted for a view: the coarser order's, then the detail's,
   * nearest the centre first.  Kept while the view moves less than a
   * twentieth of its radius.
   *
   * @param {object} view viewInFrame's
   * @param {number} order
   * @returns {Array<{order: number, pix: number}>}
   */
  cellsFor(view, order) {
    const c = this._cells
    if (c && c.order === order && c.radiusDeg === view.radiusDeg &&
        angle(c.dir, view.dir) < view.radiusDeg * toRad / 20) {
      return c.cells
    }
    const radius = view.radiusDeg * toRad
    const orders = [Math.max(this.survey.minOrder ?? 0, order - FALLBACK_ORDERS), order]
    const cells = []
    for (const o of new Set(orders)) {
      for (const pix of cellsInDisc(o, view.dir, radius, {coverage: this.coverage, limit: MAX_CELLS})) {
        cells.push({order: o, pix})
      }
    }
    this._cells = {order, radiusDeg: view.radiusDeg, dir: view.dir, cells}
    return cells
  }


  /** Choose the tiles for this frame, fetch the missing ones, drop the old. */
  update() {
    if (!this.visible || this.disposed) {
      return
    }
    const view = this.viewInFrame()
    if (!view) {
      return
    }
    this.frame++
    const order = selectOrder(this.survey, view.fovDeg, view.heightPx)
    this.order = order
    const shown = new Set()
    for (const t of this.cellsFor(view, order)) {
      const key = `${t.order}/${t.pix}`
      if (this.missing.has(key)) {
        continue
      }
      shown.add(key)
      let tile = this.tiles.get(key)
      if (!tile) {
        if (this.loading >= MAX_LOADING) {
          continue
        }
        tile = this.startTile(t, key)
      }
      tile.used = this.frame
    }
    let n = 0
    for (const [key, tile] of this.tiles) {
      if (tile.mesh) {
        tile.mesh.visible = shown.has(key)
        n += tile.mesh.visible ? 1 : 0
      }
    }
    this.setDrawn(n > 0)
    this.evict()
  }


  /** @param {boolean} drawn */
  setDrawn(drawn) {
    if (drawn !== this.drawn) {
      this.drawn = drawn
      this.onDrawn?.(drawn)
    }
  }


  /**
   * @param {number} order
   * @param {number} pix
   * @param {number} service Index in the survey's serviceUrls
   * @param {string} [ext] The format, the current one by default
   * @returns {string}
   */
  tileUrl(order, pix, service, ext = this.ext) {
    const base = this.survey.serviceUrls[service].replace(/\/+$/, '')
    return `${base}/${tilePath(order, pix, ext)}`
  }


  /**
   * @param {{order: number, pix: number}} t
   * @param {string} key
   * @returns {object} The tile's entry
   */
  startTile(t, key) {
    const tile = {...t, mesh: null, state: 'loading', used: this.frame}
    this.tiles.set(key, tile)
    const services = this.survey.serviceUrls.length
    const order = [this.serviceIndex, ...[...Array(services).keys()].filter((i) => i !== this.serviceIndex)]
    const attempt = (k, ext = this.ext) => {
      this.loading++
      this.requested++
      this.loadTexture(this.tileUrl(t.order, t.pix, order[k], ext)).then((texture) => {
        this.loading--
        if (this.disposed || this.tiles.get(key) !== tile) {
          texture.dispose?.()
          return
        }
        if (ext === this.ext) {
          this.formatConfirmed = true
        }
        if (k > 0) {
          // The first service failed where this one answered: ask this one first from now on.
          this.serviceIndex = order[k]
        }
        const material = newTileMaterial(this.sceneReferred, tileKey(this.survey))
        material.uniforms.map.value = prepareTileTexture(texture)
        const mesh = new Mesh(tileGeometry(t.order, t.pix, this.toScene), material)
        mesh.name = `hips ${this.survey.id} ${key}`
        mesh.frustumCulled = false
        mesh.visible = false
        mesh.renderOrder = TILE_RENDER_ORDER + t.order
        tile.mesh = mesh
        tile.state = 'ready'
        this.add(mesh)
      }, () => {
        this.loading--
        if (this.disposed || this.tiles.get(key) !== tile) {
          return
        }
        if (k + 1 < order.length) {
          attempt(k + 1, ext)
          return
        }
        // No tile in this format has loaded yet: the survey may not serve
        // it (a record can list one it doesn't).  Fall back to the next
        // format once, for the survey, and ask this tile again in it; a
        // tile asked in the old format meanwhile is asked again too.
        if (!this.formatConfirmed && ext === this.ext && this.formatIndex === 0 && this.formats.length > 1) {
          this.formatIndex++
        }
        if (ext !== this.ext) {
          attempt(0, this.ext)
          return
        }
        // Missing from every service (a hole in the coverage, or a 404):
        // not asked again.
        this.tiles.delete(key)
        this.missing.add(key)
        if (this.missing.size > MAX_MISSING) {
          this.missing.delete(this.missing.values().next().value)
        }
      })
    }
    attempt(0)
    return tile
  }


  /** Over MAX_TILES, drop the ready tiles not in view, least recently used first. */
  evict() {
    if (this.tiles.size <= MAX_TILES) {
      return
    }
    const old = [...this.tiles.entries()]
        .filter(([, t]) => t.state !== 'loading' && t.used < this.frame)
        .sort((a, b) => a[1].used - b[1].used)
    for (const [key, tile] of old) {
      if (this.tiles.size <= MAX_TILES) {
        break
      }
      this.tiles.delete(key)
      disposeTileMesh(tile.mesh)
    }
  }


  /** @returns {number} Tiles drawn now */
  get drawnCount() {
    let n = 0
    for (const t of this.tiles.values()) {
      n += t.mesh?.visible ? 1 : 0
    }
    return n
  }


  /** Out of the scene, its tiles freed. */
  dispose() {
    this.disposed = true
    for (const tile of this.tiles.values()) {
      disposeTileMesh(tile.mesh)
    }
    this.tiles.clear()
    this.setDrawn(false)
    this.removeFromParent()
  }
}
