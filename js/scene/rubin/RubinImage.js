import {BufferGeometry, Float32BufferAttribute, Group, Mesh, Quaternion, TextureLoader, Vector3} from 'three'
import {TILE_RENDER_ORDER, disposeTileMesh, newTileMaterial, prepareTileTexture} from '../sky/tileMaterial.js'
import {equatorialToScene, pixToWorld} from './wcs.js'


// The sky Rubin imaged (Rubin.md, "The imagery"; #333): NOIRLab's discovery
// composite noirlab2626d over the field, from a tile pyramid read through a
// manifest (public/data/rubin/noirlab2626d.json: the tiles' URL pattern and
// levels, the credit and licence, the WCS fitted to Gaia).  Each tile is a
// GRID × GRID mesh whose vertices the WCS puts on the celestial sphere, in
// the star catalogue's J2000 frame: the group hangs from Scene.stellarFrame,
// which precesses it to the date with the stars, and each tile is drawn
// centred on the camera, so there is no parallax anywhere in the system.
//
// The material is the sky tiles' (sky/tileMaterial.js).  Drawn after the opaque bodies with depth test on and no depth write, its
// depth at the far plane as the stars' is, over the star points (the photograph has its own stars, which land on Gaia's to
// its fit's 0.6″) and under the overlays (the path, the pixel).  The tiles
// are display-referred sRGB, written through sceneReferred so the tone map
// gives each texel back as it was: the picture reads as the photograph at
// any exposure, the meter's gain at night included.
//
// The level is chosen from the field and the canvas (selectLevel); only the
// tiles in view are fetched, at most MAX_LOADING at a time, from the
// animation loop (preAnimCb), and at most MAX_TILES are kept.  A coarse
// level (BASE_LEVEL) is drawn whole under the detail while it loads.

/** Each tile's mesh, vertices a side less one. */
export const GRID = 8
/**
 * The sphere's radius, metres.  The tiles are drawn centred on the camera
 * and their depth is put at the far plane in the vertex shader, so it is a
 * direction only: a unit sphere.  At 1e15 m the frame was smeared into
 * swirls on SwiftShader (the perspective-correct interpolation at w = 1e15),
 * where at 1e7 m it was crisp.
 */
export const RADIUS = 1
/** The level drawn whole under the detail. */
export const BASE_LEVEL = 2
export const MAX_TILES = 96
export const MAX_LOADING = 6

const toRad = Math.PI / 180
const tmpQuat = new Quaternion
const tmpDir = new Vector3
const tmpPos = new Vector3


/**
 * The coarsest level whose pixel is no bigger than a screen pixel, or the
 * deepest there is.
 *
 * @param {object} manifest The imagery's manifest
 * @param {number} fovDeg The camera's field, vertical
 * @param {number} heightPx The canvas's height, device pixels
 * @returns {number} A level in manifest.tiles.levels
 */
export function selectLevel(manifest, fovDeg, heightPx) {
  const {levels} = manifest.tiles
  const {width, scaleArcsec} = manifest.wcs
  const screenArcsec = fovDeg * 3600 / heightPx
  for (const l of levels) {
    if (scaleArcsec * width / l.width <= screenArcsec) {
      return l.level
    }
  }
  return levels[levels.length - 1].level
}


/**
 * A tile's pixel box at full resolution.
 *
 * @param {object} manifest
 * @param {object} l The level's entry
 * @param {number} x
 * @param {number} y
 * @returns {{x0: number, y0: number, x1: number, y1: number, fx: number, fy: number}} fx, fy: the tile's
 *   share of a whole tile's side (edge tiles are short)
 */
export function tileBox(manifest, l, x, y) {
  const {tileSize} = manifest.tiles
  const {width, height} = manifest.wcs
  const sx = width / l.width
  const sy = height / l.height
  const px1 = Math.min(l.width, (x + 1) * tileSize)
  const py1 = Math.min(l.height, (y + 1) * tileSize)
  return {x0: x * tileSize * sx, y0: y * tileSize * sy, x1: px1 * sx, y1: py1 * sy,
    fx: (px1 - (x * tileSize)) / tileSize, fy: (py1 - (y * tileSize)) / tileSize}
}


/**
 * The tiles of a level in a view.
 *
 * @param {object} manifest
 * @param {number} level
 * @param {Array<number>} dir The view's direction, scene J2000 frame, unit
 * @param {number} radiusDeg The view's angular radius (its half diagonal)
 * @returns {Array<{level: number, x: number, y: number}>}
 */
export function visibleTiles(manifest, level, dir, radiusDeg) {
  const l = manifest.tiles.levels.find((e) => e.level === level)
  const out = []
  const v = [0, 0, 0]
  for (let y = 0; y < l.rows; y++) {
    for (let x = 0; x < l.cols; x++) {
      const b = tileBox(manifest, l, x, y)
      const c = pixToWorld(manifest.wcs, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2)
      equatorialToScene(c.ra, c.dec, v)
      const tileRadiusDeg = Math.hypot(b.x1 - b.x0, b.y1 - b.y0) / 2 * manifest.wcs.scaleArcsec / 3600
      const cos = (v[0] * dir[0]) + (v[1] * dir[1]) + (v[2] * dir[2])
      const angleDeg = Math.acos(Math.max(-1, Math.min(1, cos))) / toRad
      if (angleDeg <= radiusDeg + tileRadiusDeg) {
        out.push({level, x, y})
      }
    }
  }
  return out
}


/**
 * A tile's mesh's geometry: GRID × GRID cells, each vertex at its pixel's
 * place on the sphere, uv down the tile from its top-left (flipY off).
 *
 * @param {object} manifest
 * @param {object} l The level's entry
 * @param {number} x
 * @param {number} y
 * @param {number} [radius]
 * @returns {BufferGeometry}
 */
export function tileGeometry(manifest, l, x, y, radius = RADIUS) {
  const b = tileBox(manifest, l, x, y)
  const positions = []
  const uvs = []
  const index = []
  const v = [0, 0, 0]
  for (let j = 0; j <= GRID; j++) {
    for (let i = 0; i <= GRID; i++) {
      const px = b.x0 + ((b.x1 - b.x0) * i / GRID)
      const py = b.y0 + ((b.y1 - b.y0) * j / GRID)
      const w = pixToWorld(manifest.wcs, px, py)
      equatorialToScene(w.ra, w.dec, v)
      positions.push(v[0] * radius, v[1] * radius, v[2] * radius)
      // The tile's own image, short at the edges: the whole texture.
      uvs.push(i / GRID, j / GRID)
    }
  }
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const a = (j * (GRID + 1)) + i
      index.push(a, a + GRID + 1, a + 1, a + 1, a + GRID + 1, a + GRID + 2)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geometry.setIndex(index)
  return geometry
}


/**
 * @param {string} pattern The manifest's tiles.url
 * @param {number} level
 * @param {number} x
 * @param {number} y
 * @returns {string}
 */
export function tilePath(pattern, level, x, y) {
  return pattern.replace('{level}', level).replace('{x}', x).replace('{y}', y)
}


/** */
export default class RubinImage extends Group {
  /**
   * @param {object} opts
   * @param {object} opts.manifest The imagery's manifest
   * @param {(path: string) => string} opts.resolve A tile's path to its URL (dataUrl)
   * @param {() => {camera: object, fovDeg: number, heightPx: number, aspect: number}} opts.view
   * @param {Function} [opts.sceneReferred] hdr.js's
   * @param {(url: string) => Promise<object>} [opts.loadTexture] A three Texture's promise
   */
  constructor({manifest, resolve, view, sceneReferred = null, loadTexture = null}) {
    super()
    this.name = 'rubin image'
    this.manifest = manifest
    this.resolve = resolve
    this.view = view
    this.sceneReferred = sceneReferred
    this.loadTexture = loadTexture ?? ((url) => new TextureLoader().loadAsync(url))
    /** key → {level, x, y, mesh, state, used} */
    this.tiles = new Map()
    this.loading = 0
    this.frame = 0
    this.level = null
    this.disposed = false
    this.preAnimCb = () => this.update()
  }


  /**
   * The view's direction and angular radius in the group's frame.
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
    this.matrixWorld.decompose(tmpPos, tmpQuat, new Vector3)
    tmpDir.applyQuaternion(tmpQuat.invert()).normalize()
    const half = v.fovDeg / 2 * toRad
    const radiusDeg = Math.atan(Math.tan(half) * Math.hypot(1, v.aspect || 1)) / toRad
    return {dir: [tmpDir.x, tmpDir.y, tmpDir.z], radiusDeg, fovDeg: v.fovDeg, heightPx: v.heightPx}
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
    const level = selectLevel(this.manifest, view.fovDeg, view.heightPx)
    this.level = level
    const wanted = []
    const base = Math.min(level, BASE_LEVEL)
    wanted.push(...visibleTiles(this.manifest, base, view.dir, view.radiusDeg))
    if (level !== base) {
      wanted.push(...visibleTiles(this.manifest, level, view.dir, view.radiusDeg))
    }
    const shown = new Set()
    for (const t of wanted) {
      const key = `${t.level}/${t.x}_${t.y}`
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
    for (const [key, tile] of this.tiles) {
      if (tile.mesh) {
        tile.mesh.visible = shown.has(key)
      }
    }
    this.evict()
  }


  /**
   * @param {{level: number, x: number, y: number}} t
   * @param {string} key
   * @returns {object} The tile's entry
   */
  startTile(t, key) {
    const tile = {...t, mesh: null, state: 'loading', used: this.frame}
    this.tiles.set(key, tile)
    this.loading++
    const url = this.resolve(tilePath(this.manifest.tiles.url, t.level, t.x, t.y))
    this.loadTexture(url).then((texture) => {
      this.loading--
      if (this.disposed || this.tiles.get(key) !== tile) {
        texture.dispose?.()
        return
      }
      const l = this.manifest.tiles.levels.find((e) => e.level === t.level)
      const material = newTileMaterial(this.sceneReferred)
      material.uniforms.map.value = prepareTileTexture(texture)
      const mesh = new Mesh(tileGeometry(this.manifest, l, t.x, t.y), material)
      mesh.name = `rubin image ${key}`
      mesh.frustumCulled = false
      mesh.renderOrder = TILE_RENDER_ORDER + t.level
      tile.mesh = mesh
      tile.state = 'ready'
      this.add(mesh)
    }, () => {
      this.loading--
      tile.state = 'failed'
    })
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
      this.dropTile(key, tile)
    }
  }


  /**
   * @param {string} key
   * @param {object} tile
   */
  dropTile(key, tile) {
    this.tiles.delete(key)
    disposeTileMesh(tile.mesh)
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
    for (const [key, tile] of [...this.tiles]) {
      this.dropTile(key, tile)
    }
    this.removeFromParent()
  }
}
