import {
  AdditiveBlending,
  BufferGeometry,
  ClampToEdgeWrapping,
  DataTexture,
  Float32BufferAttribute,
  HalfFloatType,
  LinearFilter,
  Matrix3,
  Mesh,
  NoBlending,
  Object3D,
  OrthographicCamera,
  Points,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
} from 'three'
import {perf} from '../perf/perf.js'
import {ASTRO_UNIT_METER, DISPLAY_GAIN} from '../shared.js'
import {slug} from '../targetPath.js'
import {
  KPC_METER, MILKY_WAY, STORE_SCALE, SUN_G, bakeMapSteps, galaxyGlsl, galaxyNormUniforms, galaxySpecUniforms, normalize,
  prng, sceneToGalacticRotation,
} from './galaxyModel.js'
import {EMITTED_GLSL, HDR_MAX_VALUE, absoluteUniforms} from './hdr.js'
import {SAFE_LENGTH_GLSL, rteCameraLocal} from './rte.js'
import {
  ATTENUATION_MU, attenuationTable, galaxyPlacement, integratedColor, sparcSpec, typeDefaults,
} from './sparcGalaxy.js'
import {hashString} from './starSeed.js'
import {viewChanged} from './viewCache.js'


/**
 * SPARC's 175 disc galaxies (#221; Galaxies.md), each drawn from its own
 * spec (sparcGalaxy.js) through the Milky Way's model (galaxyModel.js),
 * in exposure units, in three levels of detail:
 *
 * - **far**: a point carrying the galaxy's integrated light, as a star's
 *   point carries a star's (HDR.md, "Physical stars": its illuminance over
 *   the eye's patch, a Gaussian kernel), dimmed by its dust at the angle
 *   it's seen at (attenuationTable).  One draw for all of them, and for
 *   the Milky Way's own point from far away.  A small point renderer of
 *   its own: it should move onto the point-population engine (#98) once
 *   that lands.
 * - **resolved**: once a galaxy is larger than the eye's patch, an
 *   impostor: its image along the line of sight, an orthographic march of
 *   its model into a small half-float texture, drawn on a quad facing the
 *   camera.  Re-marched only when the view of it turns or it needs more
 *   texels.  The point's light goes over to it as the galaxy grows from one
 *   patch to two, the same light either way.
 * - **near**: within NEAR_FAR bounding radii, the full perspective march,
 *   as the Milky Way's, cached at reduced resolution until the view
 *   changes; for the one nearest galaxy.
 *
 * The data is public/data/sparc/galaxies.json (tools/sparc/buildSparc.mjs).
 * Each galaxy's in-plane map is baked when it's first resolved, in slices
 * between frames, and kept for the last MAP_CACHE galaxies.
 */


/** Up to this many impostors at once, the largest on screen. */
export const MAX_IMPOSTORS = 8
/** An impostor's texels a side: from this ... */
export const IMPOSTOR_MIN_TEXELS = 32
/** ... to this. */
export const IMPOSTOR_MAX_TEXELS = 256
/** An impostor is marched again when the view of it turns this far, radians. */
export const IMPOSTOR_TURN_RAD = 0.5 * Math.PI / 180
/** At most this many impostors are marched in a frame. */
export const IMPOSTOR_MARCHES_PER_FRAME = 2
/** The full march takes over from the impostor between these distances, in bounding radii. */
export const NEAR_FAR = Object.freeze([4, 6])
/** The full march's target is at most this many rows (and half the frame's), as the Milky Way's. */
export const NEAR_MAX_HEIGHT = 540
/** Maps kept baked (Galaxies.md, "Cost"). */
export const MAP_CACHE = 10
/** A map's texels a side, for an impostor and for the full march. */
export const MAP_TEXELS = Object.freeze({impostor: 256, near: 512})
/**
 * The maps bake in slices of this many ms, back to back between frames
 * (setTimeout), as the Milky Way's does: about 0.2 s of arithmetic at 256²
 * and 0.7 s at 512².
 */
export const BAKE_SLICE_MS = 12
/** The arrival distance, in disc scale lengths: 4 scale lengths across 27° of a 45° field. */
export const VIEW_DISTANCE_HR = 16.7
/** The zoom's floor at a galaxy (its "surface"), in disc scale lengths. */
export const CORE_HR = 0.05

const DEG = Math.PI / 180


/**
 * A catalogue name as people write it: 'NGC 2403' for NGC2403, 'UGC 2885'
 * for UGC02885; the others (F568-1, KK98-251, CamB) as SPARC has them.
 *
 * @param {string} name SPARC's
 * @returns {string}
 */
export function displayName(name) {
  const m = /^(NGC|UGCA|UGC|IC|DDO|PGC)0*(\d.*)$/.exec(name)
  if (m) {
    return `${m[1]} ${m[2]}`
  }
  const eso = /^ESO0*(\d+)-G0*(\d+)$/.exec(name)
  return eso ? `ESO ${eso[1]}-${eso[2]}` : name
}


/**
 * A galaxy, as the scene and the search see it: where it is (x, y, z in the
 * catalogue frame, metres from the Sun, as a star's), its spec and its
 * light, and its names.
 *
 * @param {object} row The catalogue's
 * @param {object} defaults typeDefaults'
 * @param {number} index
 * @returns {object}
 */
export function galaxyRecord(row, defaults, index) {
  const {spec, meta} = sparcSpec(row, defaults)
  const rand = prng(hashString(`${row.name} placement`))
  const place = galaxyPlacement(row, rand)
  const kpc = KPC_METER
  const name = displayName(row.name)
  const aliases = [...new Set([row.name, row.display, row.simbad?.id, row.rc3?.name].filter(Boolean)
      .map((s) => s.replace(/\s+/g, ' ').trim()))].filter((s) => s !== name)
  return {
    isGalaxy: true,
    index,
    id: slug(row.name),
    name,
    aliases,
    row,
    spec,
    meta,
    place,
    x: place.position[0],
    y: place.position[1],
    z: place.position[2],
    // The zoom's floor and the link's reference sphere (Scene, permalink).
    radius: CORE_HR * spec.thin.hR * kpc,
    viewDistance: VIEW_DISTANCE_HR * spec.thin.hR * kpc,
    boundsM: spec.bounds.r * kpc,
    // What sets its size on screen: 4 scale lengths, about its optical radius R25.
    lightRadiusM: 4 * spec.thin.hR * kpc,
    atten: attenuationTable(spec),
    color: integratedColor(spec),
  }
}


/**
 * The Milky Way as a far point, for views from outside it (its march draws
 * it near): at the Galactic Centre, its pole the north galactic pole.
 *
 * @returns {object} A record as galaxyRecord's, without a spec to march
 */
export function milkyWayRecord() {
  // G → the catalogue frame: the transpose of sceneToGalacticRotation.
  const m = sceneToGalacticRotation()
  const toCatalog = (v) => [
    (m[0] * v[0]) + (m[3] * v[1]) + (m[6] * v[2]),
    (m[1] * v[0]) + (m[4] * v[1]) + (m[7] * v[2]),
    (m[2] * v[0]) + (m[5] * v[1]) + (m[8] * v[2]),
  ]
  const centre = toCatalog([-SUN_G[0], -SUN_G[1], -SUN_G[2]]).map((v) => v * KPC_METER)
  return {
    isGalaxy: true,
    milkyWay: true,
    name: 'Milky Way',
    x: centre[0],
    y: centre[1],
    z: centre[2],
    place: {basis: [toCatalog([1, 0, 0]), toCatalog([0, 1, 0]), toCatalog([0, 0, 1])]},
    lightRadiusM: 4 * MILKY_WAY.thin.hR * KPC_METER,
    spec: MILKY_WAY,
    atten: attenuationTable(MILKY_WAY),
    color: integratedColor(MILKY_WAY),
  }
}


/**
 * The galaxies.  An Object3D in the stellarFrame (the catalogue's frame,
 * as the stars are), holding the points, the impostors and the near march.
 */
export default class Galaxies extends Object3D {
  /** */
  constructor() {
    super()
    this.name = 'Galaxies'
    this.records = []
    this.byId = new Map()
    this._ready = []
    this._camHigh = new Vector3()
    this._camLow = new Vector3()
    this._maps = new Map()
    this._bakes = []
    this.debug = {impostors: 0, marches: 0, nearMarches: 0, near: null, bakeMs: 0, frameMs: 0}
  }


  /**
   * Fetch the catalogue and build the galaxies.
   *
   * @param {string} [url]
   * @returns {Promise<Galaxies>}
   */
  async load(url = 'data/sparc/galaxies.json') {
    const res = await fetch(url)
    this.setCatalog(await res.json())
    return this
  }


  /**
   * @param {{galaxies: Array<object>}} json galaxies.json's
   */
  setCatalog(json) {
    const rows = json.galaxies
    const defaults = typeDefaults(rows)
    this.records = rows.map((row, i) => galaxyRecord(row, defaults, i))
    this.byId = new Map(this.records.map((r) => [r.id, r]))
    this.milkyWay = milkyWayRecord()
    this._buildPoints()
    this._buildImpostors()
    this._buildNear()
    this._ready.splice(0).forEach((cb) => cb(this))
  }


  /**
   * @param {function(Galaxies): void} cb Called once the catalogue is in (now, if it is)
   */
  onReady(cb) {
    if (this.records.length > 0) {
      cb(this)
    } else {
      this._ready.push(cb)
    }
  }


  /**
   * A galaxy's rotation curve and mass model (curves.json, loaded once).
   *
   * @param {string} id
   * @param {string} [url]
   * @returns {Promise<?Array<Array<number>>>} [R kpc, Vobs, e_Vobs, Vgas, Vdisk, Vbul km/s] rows
   */
  async curve(id, url = 'data/sparc/curves.json') {
    this._curves ??= fetch(url).then((res) => res.json())
    const r = this.galaxy(id)
    return r ? (await this._curves).curves[r.row.name] ?? null : null
  }


  /**
   * @param {string} id A galaxy's id (its SPARC name as a slug: 'ngc2403')
   * @returns {?object} Its record
   */
  galaxy(id) {
    return this.byId.get(slug(id)) ?? null
  }


  // ---- Far: the points ----------------------------------------------------

  /** The points, the Milky Way's last. */
  _buildPoints() {
    const all = [...this.records, this.milkyWay]
    const n = all.length
    const position = new Float32Array(n * 3)
    const positionLow = new Float32Array(n * 3)
    const color = new Float32Array(n * 3)
    const pole = new Float32Array(n * 3)
    const atten = new Float32Array(n * 4)
    const atten0 = new Float32Array(n)
    const lightLog2 = new Float32Array(n)
    const radius = new Float32Array(n)
    const handoff = new Float32Array(n)
    all.forEach((r, i) => {
      const p = [r.x, r.y, r.z]
      for (let k = 0; k < 3; k++) {
        position[(i * 3) + k] = Math.fround(p[k])
        positionLow[(i * 3) + k] = p[k] - Math.fround(p[k])
        color[(i * 3) + k] = r.color[k]
        pole[(i * 3) + k] = r.place.basis[1][k]
      }
      for (let k = 0; k < 4; k++) {
        atten[(i * 4) + k] = r.atten[k]
      }
      atten0[i] = r.atten[4]
      lightLog2[i] = Math.log2(r.spec.L)
      radius[i] = r.lightRadiusM
      // The Milky Way's march is always there to take its light.
      handoff[i] = r.milkyWay ? 1 : 0
    })
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(position, 3))
    g.setAttribute('positionLow', new Float32BufferAttribute(positionLow, 3))
    g.setAttribute('color', new Float32BufferAttribute(color, 3))
    g.setAttribute('pole', new Float32BufferAttribute(pole, 3))
    g.setAttribute('atten', new Float32BufferAttribute(atten, 4))
    g.setAttribute('atten0', new Float32BufferAttribute(atten0, 1))
    g.setAttribute('lightLog2', new Float32BufferAttribute(lightLog2, 1))
    g.setAttribute('radius', new Float32BufferAttribute(radius, 1))
    g.setAttribute('handoff', new Float32BufferAttribute(handoff, 1))
    this._handoff = g.getAttribute('handoff')
    const material = new ShaderMaterial({
      uniforms: {
        uCamHigh: {value: this._camHigh},
        uCamLow: {value: this._camLow},
        uExposureRelative: absoluteUniforms.uExposureRelative,
        uFovDegrees: absoluteUniforms.uFovDegrees,
        uViewportHeight: absoluteUniforms.uViewportHeight,
      },
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
      blending: AdditiveBlending,
      depthTest: true,
      depthWrite: false,
      transparent: true,
      toneMapped: false,
    })
    this.points = new Points(g, material)
    this.points.name = 'GalaxyPoints'
    this.points.frustumCulled = false
    // First of the galaxies' draws: its hook decides the levels of detail
    // and marches what's needed before the impostors and the near pass draw.
    this.points.renderOrder = -3
    this.points.raycast = noRaycast
    this.points.onBeforeRender = (renderer, scene, camera) => this._frame(renderer, camera)
    this.add(this.points)
  }


  // ---- Resolved: the impostors --------------------------------------------

  /** The impostors' quads and the march that fills them. */
  _buildImpostors() {
    this._impostors = []
    const quad = new BufferGeometry()
    quad.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0], 3))
    for (let i = 0; i < MAX_IMPOSTORS; i++) {
      const material = new ShaderMaterial({
        uniforms: {
          uCamHigh: {value: this._camHigh},
          uCamLow: {value: this._camLow},
          uCentreHigh: {value: new Vector3()},
          uCentreLow: {value: new Vector3()},
          uRight: {value: new Vector3()},
          uUp: {value: new Vector3()},
          uHalf: {value: 1},
          uTex: {value: null},
          uScale: {value: 0},
          uExposureRelative: absoluteUniforms.uExposureRelative,
        },
        vertexShader: IMPOSTOR_VERT,
        fragmentShader: IMPOSTOR_FRAG,
        blending: AdditiveBlending,
        depthTest: true,
        depthWrite: false,
        transparent: true,
        toneMapped: false,
      })
      const geometry = quad.clone()
      const mesh = new Mesh(geometry, material)
      mesh.name = 'GalaxyImpostor'
      mesh.frustumCulled = false
      mesh.renderOrder = -2
      mesh.raycast = noRaycast
      geometry.setDrawRange(0, 0)
      this.add(mesh)
      this._impostors.push({mesh, material, target: null, record: null, last: null, texels: 0, weight: 0})
    }
    this._marchMaterial = new ShaderMaterial({
      uniforms: {...marchUniforms(), uRightL: {value: new Vector3()}, uUpL: {value: new Vector3()},
        uDirL: {value: new Vector3()}, uHalfKpc: {value: 1}},
      vertexShader: FULL_SCREEN_VERT,
      fragmentShader: `${galaxyGlsl(null, {uniforms: true})}${IMPOSTOR_MARCH_FRAG}`,
      blending: NoBlending,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    })
    this._marchScene = new Scene()
    this._marchMesh = new Mesh(fullScreenTriangle(), this._marchMaterial)
    this._marchMesh.frustumCulled = false
    this._marchScene.add(this._marchMesh)
    this._marchCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  }


  // ---- Near: the full march -----------------------------------------------

  /** The near pass: its march into a cached target, and its composite. */
  _buildNear() {
    const nearMarch = new ShaderMaterial({
      uniforms: {...marchUniforms(), uCamL: {value: new Vector3()}, uViewToL: {value: new Matrix3()},
        uProj: {value: new Vector4(1, 1, 0, 0)}},
      vertexShader: FULL_SCREEN_VERT,
      fragmentShader: `${galaxyGlsl(null, {uniforms: true})}${NEAR_MARCH_FRAG}`,
      blending: NoBlending,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    })
    const material = new ShaderMaterial({
      uniforms: {uTex: {value: null}, uScale: {value: 0}, uExposureRelative: absoluteUniforms.uExposureRelative},
      vertexShader: NEAR_COMPOSITE_VERT,
      fragmentShader: NEAR_COMPOSITE_FRAG,
      blending: AdditiveBlending,
      depthTest: true,
      depthWrite: false,
      transparent: true,
      toneMapped: false,
    })
    const geometry = fullScreenTriangle()
    geometry.setDrawRange(0, 0)
    const mesh = new Mesh(geometry, material)
    mesh.name = 'GalaxyNear'
    mesh.frustumCulled = false
    mesh.renderOrder = -2
    mesh.raycast = noRaycast
    this.add(mesh)
    const scene = new Scene()
    const marchMesh = new Mesh(fullScreenTriangle(), nearMarch)
    marchMesh.frustumCulled = false
    scene.add(marchMesh)
    this._near = {mesh, material, march: nearMarch, scene, target: null, record: null, last: null, weight: 0,
      size: new Vector2(), viewToCat: new Matrix3(), objRot: new Matrix3()}
  }


  // ---- Each frame ----------------------------------------------------------

  /**
   * The levels of detail, the bakes and the marches, before the galaxies
   * draw (the points' hook, first of theirs).
   *
   * @param {object} renderer
   * @param {object} camera
   */
  _frame(renderer, camera) {
    perf.begin('galaxies')
    try {
      this._frameInner(renderer, camera)
    } finally {
      perf.end('galaxies')
    }
  }


  /**
   * @param {object} renderer
   * @param {object} camera
   */
  _frameInner(renderer, camera) {
    const t0 = performance.now()
    rteCameraLocal(this, camera, this._camHigh, this._camLow)
    const cam = [this._camHigh.x + this._camLow.x, this._camHigh.y + this._camLow.y, this._camHigh.z + this._camLow.z]
    const current = renderer.getRenderTarget()
    const height = current ? current.height : renderer.getDrawingBufferSize(this._size ??= new Vector2()).y
    const pxRad = camera.fov * DEG / Math.max(height, 1)
    const patchRad = patchRadians(camera.fov, height)
    // Where each galaxy is from the camera, and how large.
    let nearest = null
    let nearestRatio = Infinity
    const resolved = []
    for (const r of this.records) {
      const d = Math.hypot(r.x - cam[0], r.y - cam[1], r.z - cam[2])
      r.distanceM = d
      const ratio = d / r.boundsM
      if (ratio < nearestRatio) {
        nearestRatio = ratio
        nearest = r
      }
      r.sizePatches = 2 * r.lightRadiusM / d / patchRad
      if (r.sizePatches > 1 && ratio > NEAR_FAR[0]) {
        resolved.push(r)
      }
    }
    // Bake what's wanted, a slice at a time.
    resolved.sort((a, b) => b.sizePatches - a.sizePatches)
    const wanted = resolved.slice(0, MAX_IMPOSTORS)
    const nearRecord = nearestRatio < NEAR_FAR[1] ? nearest : null
    // The near galaxy's first: it fills the view.
    if (nearRecord) {
      this._want(nearRecord, MAP_TEXELS.near, true)
    }
    for (const r of wanted) {
      this._want(r, MAP_TEXELS.impostor)
    }
    // The near march, and its weight.
    const nearWeight = nearRecord && this._map(nearRecord, MAP_TEXELS.near) ?
      1 - smoothstep(NEAR_FAR[0], NEAR_FAR[1], nearestRatio) : 0
    this._updateNear(renderer, camera, nearRecord, nearWeight, current)
    // The impostors.
    this._updateImpostors(renderer, camera, wanted, cam, pxRad, nearRecord, nearWeight, current)
    // Hand each galaxy's light from its point to what draws it resolved.
    let changed = false
    for (const r of this.records) {
      const ready = r === nearRecord && nearWeight >= 1 ? 1 :
        this._impostors.some((s) => s.record === r && s.ready) ? 1 : 0
      if (this._handoff.array[r.index] !== ready) {
        this._handoff.array[r.index] = ready
        changed = true
      }
    }
    if (changed) {
      this._handoff.needsUpdate = true
    }
    this.debug.frameMs = performance.now() - t0
  }


  /**
   * Queue a galaxy's map for baking at a size, if it isn't baked or baking.
   *
   * @param {object} r
   * @param {number} texels
   * @param {boolean} [first] Ahead of the queue
   */
  _want(r, texels, first = false) {
    const key = `${r.id}:${texels}`
    const hit = this._maps.get(key)
    if (hit) {
      hit.used = performance.now()
      return
    }
    const queued = this._bakes.findIndex((b) => b.key === key)
    if (queued >= 0) {
      if (first && queued > 0) {
        this._bakes.unshift(...this._bakes.splice(queued, 1))
      }
      return
    }
    const bake = {key, record: r, texels, steps: bakeMapSteps(texels, r.spec), start: performance.now()}
    if (first) {
      this._bakes.unshift(bake)
    } else {
      this._bakes.push(bake)
    }
    if (!this._baking) {
      this._baking = true
      setTimeout(() => this._bakeSlice(), 0)
    }
  }


  /** Bake for BAKE_SLICE_MS, and come back while there's more. */
  _bakeSlice() {
    const until = performance.now() + BAKE_SLICE_MS
    while (this._bakes.length > 0 && performance.now() < until) {
      const bake = this._bakes[0]
      let next = bake.steps.next()
      while (!next.done && performance.now() < until) {
        next = bake.steps.next()
      }
      if (!next.done) {
        break
      }
      this._bakes.shift()
      const map = next.value
      const norms = normalize(map, bake.record.spec)
      const tex = new DataTexture(map.data, map.size, map.size, RGBAFormat, UnsignedByteType)
      tex.minFilter = LinearFilter
      tex.magFilter = LinearFilter
      tex.wrapS = tex.wrapT = ClampToEdgeWrapping
      tex.generateMipmaps = false
      tex.needsUpdate = true
      this._maps.set(bake.key, {map, norms, texture: tex, used: performance.now()})
      this.debug.bakeMs = performance.now() - bake.start
      this._evict()
    }
    this._baking = this._bakes.length > 0
    if (this._baking) {
      setTimeout(() => this._bakeSlice(), 0)
    }
  }


  /** Drop the least recently used maps past MAP_CACHE. */
  _evict() {
    while (this._maps.size > MAP_CACHE) {
      let oldest = null
      for (const [key, m] of this._maps) {
        if (!oldest || m.used < oldest[1].used) {
          oldest = [key, m]
        }
      }
      oldest[1].texture.dispose()
      this._maps.delete(oldest[0])
      for (const s of this._impostors) {
        if (s.mapKey === oldest[0]) {
          s.record = null
          s.ready = false
        }
      }
    }
  }


  /**
   * @param {object} r
   * @param {number} texels
   * @returns {?object} Its baked map, if it is
   */
  _map(r, texels) {
    return this._maps.get(`${r.id}:${texels}`) ?? null
  }


  /**
   * Set the shared march's uniforms for a galaxy.
   *
   * @param {object} uniforms A march material's
   * @param {object} r
   * @param {object} baked _map's
   */
  _setGalaxy(uniforms, r, baked) {
    const s = galaxySpecUniforms(r.spec)
    uniforms.uGalP.value.forEach((v, i) => v.set(...s.uGalP[i]))
    uniforms.uGalC.value.forEach((v, i) => v.set(...s.uGalC[i]))
    const n = galaxyNormUniforms(baked.norms)
    uniforms.uGalaxyNorm0.value.set(...n.uGalaxyNorm0)
    uniforms.uGalaxyNorm1.value.set(...n.uGalaxyNorm1)
    uniforms.uGalaxyMap.value = baked.texture
    uniforms.uGalaxyMapScale.value.set(...baked.map.scale)
  }


  /**
   * The impostors: give the largest galaxies a quad each and march their
   * images when the view of them has turned or they need more texels.
   *
   * @param {object} renderer
   * @param {object} camera
   * @param {Array<object>} wanted The galaxies to draw resolved, largest first
   * @param {Array<number>} cam The camera, catalogue frame
   * @param {number} pxRad A pixel's angle
   * @param {?object} nearRecord The galaxy the near pass draws
   * @param {number} nearWeight Its weight
   * @param {?object} current The render target to restore
   */
  _updateImpostors(renderer, camera, wanted, cam, pxRad, nearRecord, nearWeight, current) {
    // Free the slots of galaxies no longer wanted; give the newly wanted one.
    for (const s of this._impostors) {
      if (s.record && !wanted.includes(s.record)) {
        s.record = null
        s.ready = false
      }
    }
    for (const r of wanted) {
      if (this._impostors.some((s) => s.record === r)) {
        continue
      }
      const free = this._impostors.find((s) => !s.record)
      if (free && this._map(r, MAP_TEXELS.impostor)) {
        free.record = r
        free.ready = false
        free.last = null
        free.mapKey = `${r.id}:${MAP_TEXELS.impostor}`
      }
    }
    let marches = 0
    let shown = 0
    for (const s of this._impostors) {
      const r = s.record
      if (!r) {
        s.mesh.geometry.setDrawRange(0, 0)
        continue
      }
      const baked = this._map(r, MAP_TEXELS.impostor)
      // The view of it: from the camera to its centre, and a frame on the
      // sky that its pole fixes, so rolling the camera doesn't re-march it.
      const dir = [r.x - cam[0], r.y - cam[1], r.z - cam[2]]
      const dl = Math.hypot(...dir)
      const view = dir.map((v) => v / dl)
      let right = cross(view, r.place.basis[1])
      if (Math.hypot(...right) < 1e-6) {
        right = cross(view, Math.abs(view[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0])
      }
      const rl = Math.hypot(...right)
      right = right.map((v) => v / rl)
      const up = cross(right, view)
      const texels = Math.min(Math.max(2 ** Math.ceil(Math.log2(Math.max(2 * r.boundsM / dl / pxRad, 1))),
          IMPOSTOR_MIN_TEXELS), IMPOSTOR_MAX_TEXELS)
      const turned = !s.last || angle(s.last.view, view) > IMPOSTOR_TURN_RAD || s.last.texels < texels ||
        s.last.record !== r
      if (turned && marches < IMPOSTOR_MARCHES_PER_FRAME) {
        if (!s.target || s.target.width !== texels) {
          s.target?.dispose()
          s.target = new WebGLRenderTarget(texels, texels, {type: HalfFloatType, depthBuffer: false,
            minFilter: LinearFilter, magFilter: LinearFilter, generateMipmaps: false})
        }
        const u = this._marchMaterial.uniforms
        this._setGalaxy(u, r, baked)
        // Into the galaxy's own frame: the transpose of its basis.
        const toLocal = (v) => r.place.basis.map((axis) => dot(axis, v))
        u.uRightL.value.set(...toLocal(right))
        u.uUpL.value.set(...toLocal(up))
        u.uDirL.value.set(...toLocal(view))
        u.uHalfKpc.value = r.spec.bounds.r
        renderOffscreen(renderer, s.target, this._marchScene, this._marchCamera, current)
        s.last = {view, texels, record: r}
        s.ready = true
        marches++
        this.debug.marches++
      }
      if (!s.ready) {
        s.mesh.geometry.setDrawRange(0, 0)
        continue
      }
      const m = s.material.uniforms
      m.uCentreHigh.value.set(Math.fround(r.x), Math.fround(r.y), Math.fround(r.z))
      m.uCentreLow.value.set(r.x - Math.fround(r.x), r.y - Math.fround(r.y), r.z - Math.fround(r.z))
      m.uRight.value.set(...s.last ? rightOf(s.last.view, r) : right)
      m.uUp.value.set(...s.last ? cross(rightOf(s.last.view, r), s.last.view) : up)
      m.uHalf.value = r.boundsM
      m.uTex.value = s.target.texture
      // The point's light comes over as it grows from one patch to two;
      // the near march's as the camera closes in.
      const weight = smoothstep(1, 2, r.sizePatches) * (r === nearRecord ? 1 - nearWeight : 1)
      m.uScale.value = weight / STORE_SCALE
      s.mesh.geometry.setDrawRange(0, weight > 0 ? Infinity : 0)
      shown += weight > 0 ? 1 : 0
    }
    this.debug.impostors = shown
  }


  /**
   * The near pass: the full march of the nearest galaxy, into its cached
   * target when the view has changed, composited by its own draw.
   *
   * @param {object} renderer
   * @param {object} camera
   * @param {?object} r The nearest galaxy, if near enough
   * @param {number} weight
   * @param {?object} current The render target to restore
   */
  _updateNear(renderer, camera, r, weight, current) {
    const near = this._near
    this.debug.near = weight > 0 ? r.name : null
    if (!r || !(weight > 0)) {
      near.mesh.geometry.setDrawRange(0, 0)
      near.record = null
      return
    }
    const baked = this._map(r, MAP_TEXELS.near)
    const u = near.march.uniforms
    // The camera in the galaxy's frame, kpc, in float64.
    const cam = [this._camHigh.x + this._camLow.x - r.x, this._camHigh.y + this._camLow.y - r.y,
      this._camHigh.z + this._camLow.z - r.z]
    const camL = r.place.basis.map((axis) => dot(axis, cam) / KPC_METER)
    u.uCamL.value.set(...camL)
    // View → catalogue (the camera's rotation, this object's inverse) → the galaxy's frame.
    near.viewToCat.setFromMatrix4(camera.matrixWorld)
    near.objRot.setFromMatrix4(this.matrixWorld).transpose()
    near.viewToCat.premultiply(near.objRot)
    const b = r.place.basis
    const toLocal = new Matrix3().set(b[0][0], b[0][1], b[0][2], b[1][0], b[1][1], b[1][2], b[2][0], b[2][1], b[2][2])
    u.uViewToL.value.copy(toLocal).multiply(near.viewToCat)
    const p = camera.projectionMatrix.elements
    u.uProj.value.set(p[0], p[5], p[8], p[9])
    if (current) {
      near.size.set(current.width, current.height)
    } else {
      renderer.getDrawingBufferSize(near.size)
    }
    const scale = Math.min(0.5, NEAR_MAX_HEIGHT / Math.max(near.size.y, 1))
    const w = Math.max(1, Math.round(near.size.x * scale))
    const h = Math.max(1, Math.round(near.size.y * scale))
    if (!near.target || near.target.width !== w || near.target.height !== h) {
      near.target?.dispose()
      near.target = new WebGLRenderTarget(w, h, {type: HalfFloatType, depthBuffer: false,
        minFilter: LinearFilter, magFilter: LinearFilter, generateMipmaps: false})
      near.last = null
    }
    const proj = [p[0], p[5], p[8], p[9]]
    const texel = 2 * Math.atan(1 / Math.max(p[5], 1e-12)) / h
    if (near.record !== r || viewChanged(near.last, camL, u.uViewToL.value, proj, 1e-4 * r.spec.thin.hR, texel)) {
      this._setGalaxy(u, r, baked)
      renderOffscreen(renderer, near.target, near.scene, this._marchCamera, current)
      near.last = {position: [...camL], view: u.uViewToL.value.clone(), proj}
      near.record = r
      this.debug.nearMarches++
    }
    near.material.uniforms.uTex.value = near.target.texture
    near.material.uniforms.uScale.value = weight / STORE_SCALE
    near.mesh.geometry.setDrawRange(0, Infinity)
  }
}


/**
 * Render a scene into a target and put the renderer's back.
 *
 * @param {object} renderer
 * @param {object} target
 * @param {object} scene
 * @param {object} camera
 * @param {?object} current
 */
function renderOffscreen(renderer, target, scene, camera, current) {
  const autoClear = renderer.autoClear
  renderer.autoClear = false
  renderer.setRenderTarget(target)
  renderer.render(scene, camera)
  renderer.setRenderTarget(current)
  renderer.autoClear = autoClear
}


/**
 * The impostor's right axis for a view of a galaxy (as _updateImpostors).
 *
 * @param {Array<number>} view
 * @param {object} r
 * @returns {Array<number>}
 */
function rightOf(view, r) {
  let right = cross(view, r.place.basis[1])
  if (Math.hypot(...right) < 1e-6) {
    right = cross(view, Math.abs(view[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0])
  }
  const l = Math.hypot(...right)
  return right.map((v) => v / l)
}


/**
 * The eye's patch a point's light lands in (HDR.md, "Physical stars"), as
 * stars.vert has it: a pixel, or the dark-adapted eye's 10′ (over the
 * magnification of a field narrower than 45°) where a pixel is finer.
 *
 * @param {number} fovDeg
 * @param {number} heightPx
 * @returns {number} Radians
 */
export function patchRadians(fovDeg, heightPx) {
  const magnification = Math.max(Math.tan(22.5 * DEG) / Math.tan(fovDeg * DEG / 2), 1)
  const pxRad = fovDeg * DEG / Math.max(heightPx, 1)
  return Math.max(pxRad, EYE_POINT_RAD / magnification)
}


/** The dark-adapted eye's resolution of a point, 10′ (stars.vert). */
const EYE_POINT_RAD = 10 / 60 * DEG


/**
 * A far point's light, in exposure units summed over its pixels, at
 * Earth's keyed exposure (POINT_VERT, for tests): DISPLAY_GAIN·π times its
 * illuminance over the Sun's at 1 AU, L/L_sun·(AU/d)², times what its dust
 * passes at its inclination to the line of sight.
 *
 * @param {object} r A record
 * @param {number} distanceM
 * @param {number} mu |cos| of the angle between its pole and the line of sight
 * @returns {number}
 */
export function pointLight(r, distanceM, mu) {
  return DISPLAY_GAIN * Math.PI * r.spec.L * ((ASTRO_UNIT_METER / distanceM) ** 2) * attenuationAt(r.atten, mu)
}


/**
 * @param {Array<number>} table attenuationTable's
 * @param {number} mu
 * @returns {number} Interpolated in μ
 */
export function attenuationAt(table, mu) {
  const m = Math.min(Math.max(mu, ATTENUATION_MU[ATTENUATION_MU.length - 1]), 1)
  for (let i = 0; i < ATTENUATION_MU.length - 1; i++) {
    if (m >= ATTENUATION_MU[i + 1]) {
      const t = (m - ATTENUATION_MU[i + 1]) / (ATTENUATION_MU[i] - ATTENUATION_MU[i + 1])
      return table[i + 1] + (t * (table[i] - table[i + 1]))
    }
  }
  return table[table.length - 1]
}


/**
 * @param {number} lo
 * @param {number} hi
 * @param {number} x
 * @returns {number}
 */
function smoothstep(lo, hi, x) {
  const t = Math.min(Math.max((x - lo) / (hi - lo), 0), 1)
  return t * t * (3 - (2 * t))
}


/**
 * @param {Array<number>} a
 * @param {Array<number>} b
 * @returns {Array<number>}
 */
function cross(a, b) {
  return [(a[1] * b[2]) - (a[2] * b[1]), (a[2] * b[0]) - (a[0] * b[2]), (a[0] * b[1]) - (a[1] * b[0])]
}


/**
 * @param {Array<number>} a
 * @param {Array<number>} b
 * @returns {number}
 */
function dot(a, b) {
  return (a[0] * b[0]) + (a[1] * b[1]) + (a[2] * b[2])
}


/**
 * @param {Array<number>} a Unit
 * @param {Array<number>} b Unit
 * @returns {number} The angle between them, radians
 */
function angle(a, b) {
  return Math.acos(Math.min(Math.max(dot(a, b), -1), 1))
}


/** Mesh.raycast for the galaxies' draws: they're never hit. */
function noRaycast() {
  // Picked by name through the search, not on the canvas.
}


/** @returns {object} A march material's uniforms (galaxyGlsl's shared form) */
function marchUniforms() {
  return {
    uGalaxyMap: {value: null},
    uGalaxyMapScale: {value: new Vector4(1, 1, 1, 1)},
    uGalaxyNorm0: {value: new Vector4()},
    uGalaxyNorm1: {value: new Vector4()},
    uGalP: {value: Array.from({length: 8}, () => new Vector4())},
    uGalC: {value: Array.from({length: 4}, () => new Vector3())},
  }
}


/** @returns {BufferGeometry} One triangle covering clip space */
function fullScreenTriangle() {
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3))
  g.setAttribute('uv', new Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2))
  return g
}


// ---- Shaders ---------------------------------------------------------------

// Pinned just inside the far plane and divided through to w = 1, as the
// stars are (stars.vert clipToW1): behind every body, over the Milky Way.
const CLIP_GLSL = `
const float FAR_PLANE_INSIDE = 0.999999;
const vec4 CULLED = vec4(0.0, 0.0, 2.0, 1.0);
vec4 clipToW1(vec4 clip) {
  if (!(clip.w > 0.0)) {
    return CULLED;
  }
  return vec4(clip.xy / clip.w, FAR_PLANE_INSIDE, 1.0);
}
`

// A galaxy's far point: stars.vert's arithmetic (HDR.md, "Physical
// stars") for a galaxy's light: its illuminance here over the Sun's at
// 1 AU, in logs (no square of a distance in metres), times what its dust
// passes at the angle it's seen at, over the eye's patch, as a Gaussian a
// quarter of the patch wide.  As the galaxy outgrows the patch its light
// goes to its impostor (handoff).
const POINT_VERT = `
uniform float uFovDegrees;
uniform float uViewportHeight;
uniform float uExposureRelative;
uniform vec3 uCamHigh;
uniform vec3 uCamLow;
attribute vec3 positionLow;
attribute vec3 color;
attribute vec3 pole;
attribute vec4 atten;
attribute float atten0;
attribute float lightLog2;
attribute float radius;
attribute float handoff;
varying vec3 vColor;
varying float vBrightness;
varying float vSize;
varying float vSigma;
const float PI = 3.14159265;
const float DISPLAY_GAIN = ${DISPLAY_GAIN.toFixed(4)};
const float LOG2_AU = ${Math.log2(ASTRO_UNIT_METER).toFixed(6)};
const float EYE_POINT_RAD = ${EYE_POINT_RAD.toExponential(6)};
const float TAN_HALF_EYE_FOV = 0.41421356;
const float MAX_VALUE = ${HDR_MAX_VALUE.toExponential(1)};
const float VISIBLE_VALUE = 0.004;
${SAFE_LENGTH_GLSL}
${CLIP_GLSL}
void main() {
  vColor = color;
  vec3 eye = (position - uCamHigh) + (positionLow - uCamLow);
  vec4 mv = vec4(mat3(modelViewMatrix) * eye, 1.0);
  float dist = max(safeLength(eye), 1.0);
  vec3 dir = safeNormalize(eye);
  float mu = abs(dot(dir, pole));
  // What its dust passes, by μ: 1, 0.75, 0.5, 0.25, 0.05 (attenuationTable).
  float t = mu >= 0.75 ? mix(atten.y, atten.x, (mu - 0.75) / 0.25)
    : mu >= 0.5 ? mix(atten.z, atten.y, (mu - 0.5) / 0.25)
    : mu >= 0.25 ? mix(atten.w, atten.z, (mu - 0.25) / 0.25)
    : mix(atten0, atten.w, clamp((mu - 0.05) / 0.2, 0.0, 1.0));
  float ratio = exp2(lightLog2 + 2.0 * (LOG2_AU - log2(dist)));
  float magnification = max(TAN_HALF_EYE_FOV / tan(radians(uFovDegrees) * 0.5), 1.0);
  float pxRad = radians(uFovDegrees) / max(uViewportHeight, 1.0);
  float patchRad = max(pxRad, EYE_POINT_RAD / magnification);
  float patchPx = max(floor(patchRad / pxRad + 0.5), 1.0);
  float value = DISPLAY_GAIN * PI * ratio * t / (patchRad * patchRad) * uExposureRelative;
  float sizePatches = 2.0 * radius / dist / patchRad;
  value *= mix(1.0, 1.0 - smoothstep(1.0, 2.0, sizePatches), handoff);
  float light = value * patchPx * patchPx;
  vSigma = max(0.25 * patchPx, 0.6);
  float peak = min(light / (2.0 * PI * vSigma * vSigma), MAX_VALUE);
  if (!(peak > 1.0e-7)) {
    gl_Position = CULLED;
    gl_PointSize = 0.0;
    vBrightness = 0.0;
    vSize = 1.0;
    return;
  }
  float visibleRadius = vSigma * sqrt(2.0 * log(max(peak / VISIBLE_VALUE, 1.0)));
  vSize = clamp(2.0 * visibleRadius + 2.0, 1.0, 64.0);
  gl_PointSize = vSize;
  vBrightness = peak;
  gl_Position = clipToW1(projectionMatrix * mv);
}
`

const POINT_FRAG = `
varying vec3 vColor;
varying float vBrightness;
varying float vSize;
varying float vSigma;
${EMITTED_GLSL}
void main() {
  vec2 px = (gl_PointCoord.xy - 0.5) * vSize;
  float r2 = dot(px, px);
  float k = exp(-r2 / (2.0 * vSigma * vSigma));
  float halfSize = vSize * 0.5;
  float edge = 1.0 - smoothstep(0.6 * halfSize * halfSize, halfSize * halfSize, r2);
  gl_FragColor = vec4(emitted(vColor * vBrightness * k * edge), 1.0);
}
`

// An impostor: a quad facing the camera at the galaxy, its half-width the
// galaxy's bounds, relative to the eye (rte.js) in the catalogue frame.
const IMPOSTOR_VERT = `
uniform vec3 uCamHigh;
uniform vec3 uCamLow;
uniform vec3 uCentreHigh;
uniform vec3 uCentreLow;
uniform vec3 uRight;
uniform vec3 uUp;
uniform float uHalf;
varying vec2 vUv;
${CLIP_GLSL}
void main() {
  vUv = position.xy * 0.5 + 0.5;
  vec3 eye = (uCentreHigh - uCamHigh) + (uCentreLow - uCamLow) + (position.x * uRight + position.y * uUp) * uHalf;
  gl_Position = clipToW1(projectionMatrix * vec4(mat3(modelViewMatrix) * eye, 1.0));
}
`

const IMPOSTOR_FRAG = `
uniform sampler2D uTex;
uniform float uScale;
uniform float uExposureRelative;
varying vec2 vUv;
${EMITTED_GLSL}
void main() {
  vec3 light = texture2D(uTex, vUv).rgb * (uScale * uExposureRelative);
  gl_FragColor = vec4(emitted(min(light, vec3(${HDR_MAX_VALUE.toFixed(1)}))), 1.0);
}
`

const FULL_SCREEN_VERT = `
varying vec2 vNdc;
void main() {
  vNdc = position.xy;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

// The impostor's march: parallel rays along the line of sight, one per
// texel across the galaxy's bounds, from behind the camera's side of it.
const IMPOSTOR_MARCH_FRAG = `
uniform vec3 uRightL;
uniform vec3 uUpL;
uniform vec3 uDirL;
uniform float uHalfKpc;
varying vec2 vNdc;
void main() {
  vec3 o = (vNdc.x * uRightL + vNdc.y * uUpL) * uHalfKpc - uDirL * (2.0 * uHalfKpc);
  float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  vec3 light = galaxyMarch(o, uDirL, jitter);
  gl_FragColor = vec4(min(light, vec3(${HDR_MAX_VALUE.toFixed(1)})), 1.0);
}
`

// The near march, as the Milky Way's (MilkyWay.js): the view ray through
// each pixel, turned into the galaxy's frame, from the camera there.
const NEAR_MARCH_FRAG = `
uniform vec3 uCamL;
uniform mat3 uViewToL;
uniform vec4 uProj;
varying vec2 vNdc;
void main() {
  vec3 view = vec3((vNdc.x + uProj.z) / uProj.x, (vNdc.y + uProj.w) / uProj.y, -1.0);
  vec3 d = normalize(uViewToL * normalize(view));
  float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  gl_FragColor = vec4(min(galaxyMarch(uCamL, d, jitter), vec3(${HDR_MAX_VALUE.toFixed(1)})), 1.0);
}
`

// The near march's composite: its cached target, pre-exposed, at the far plane.
const NEAR_COMPOSITE_VERT = `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.999999, 1.0);
}
`

const NEAR_COMPOSITE_FRAG = `
uniform sampler2D uTex;
uniform float uScale;
uniform float uExposureRelative;
varying vec2 vUv;
${EMITTED_GLSL}
void main() {
  vec3 light = texture2D(uTex, vUv).rgb * (uScale * uExposureRelative);
  gl_FragColor = vec4(emitted(min(light, vec3(${HDR_MAX_VALUE.toFixed(1)}))), 1.0);
}
`
