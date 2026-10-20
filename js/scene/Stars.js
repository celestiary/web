import {
  Group,
  LOD,
  Points,
  Vector3,
} from 'three'
import Loader from '../Loader.js'
import Object from './object.js'
import PickLabels from './PickLabels.js'
import SpriteSheet from './SpriteSheet.js'
import StarsBufferGeometry from './StarsBufferGeometry.js'
import StarsCatalog, {FAVES} from './StarsCatalog.js'
import TargetLabel, {targetLabelShown} from './TargetLabel.js'
import {assertDefined} from '../assert.js'
import {FAR_OBJ, STARS_RADIUS_METER, overlay} from '../shared.js'
import {named} from '../utils.js'
import {fadeMaterial} from './fade.js'
import {rteCameraLocal} from './rte.js'
import {newStarsMaterial} from './starsMaterial.js'
import {newCataloguePopulation, starTiersEnabled} from './catalogue/cataloguePopulation.js'
import {LUMINOUS_LABEL_ABS_MAG} from './catalogue/tiers.js'


// > 10k is too much for my old laptop.
const MAX_LABELS = 10000
/**
 * The faint tiers stream in after the first load's reveal (Celestiary
 * calls streamRest, beside the ephemeris), or when something needs them; a
 * scene no one reveals (the guide's) gets them this long after its stars
 * are drawn.
 */
export const STREAM_REST_AFTER_MS = 3000

/** */
export default class Stars extends Object {
  /**
   * The catalogue, given (the guide's), or loaded: as brightness tiers on
   * the point-population engine (Stars.md, "Brightness tiers"), the naked
   * eye's sky and every named star first, or, with `?starTiers=0` or if
   * the tiles can't be had, stars.dat whole, as before.
   *
   * @param {object} props
   * @param {Function} ui Accessor to zustand store for shared application state
   * @param {object} [catalog]
   * @param {Function} [onLoadCb]
   * @param {boolean} [showLabels]
   * @param {object} [opts]
   * @param {boolean} [opts.tiers] Load as tiers (default: unless `?starTiers=0`)
   * @param {Function} [opts.fetchFn] For tests: the tiles' fetch
   * @param {string} [opts.baseUrl] For tests: the tiles' directory
   */
  constructor(props, ui, catalog, onLoadCb, showLabels = false, opts = {}) {
    super('Stars', props)
    assertDefined(ui, ui.useStore)
    this.ui = ui
    this.labelsGroup = named(new Group, 'LabelsGroup')
    this.labelsGroup.renderOrder = 0
    this.onLoadCb = onLoadCb
    this.faves = FAVES
    this.labelLOD = named(new LOD, 'LabelsLOD')
    this.labelLOD.visible = showLabels
    this.labelLOD.addLevel(this.labelsGroup, 1)
    this.labelLOD.addLevel(FAR_OBJ, STARS_RADIUS_METER)
    // On the overlay layer (shared.js overlay): out of the meter's frame.
    overlay(this.labelLOD)
    this.add(this.labelLOD)
    this.geom = null
    // Catalog readiness signalling.  The catalog object is mutated in place
    // during async load, so subscribing to starsCatalog identity in the
    // store doesn't fire a change event — we maintain our own callback list
    // that's drained once load completes.  Anyone needing a populated
    // catalog (asterisms, search, etc) calls onCatalogReady(cb) and gets
    // either an immediate dispatch (if already loaded) or a deferred one.
    this._catalogReady = false
    this._catalogReadyCbs = []
    // The whole catalogue in (every tier), or nothing more coming.
    this._catalogComplete = false
    this._catalogCompleteCbs = []
    // whenStar's waits for a star whose tier isn't in yet.
    this._starWaiters = []
    // The tiers' population (null for a given catalogue or stars.dat), and
    // the stars' one material.
    this.population = null
    this.pointsMaterial = null
    this.starPoints = null

    // Used by guide/Asterisms.jsx to center camera.
    this.labelCenterPosByName = {}
    // The HIP numbers the catalogue's label sheet names (showLabels).
    this.labelledHips = new Set()
    // The target star's own label, whatever its magnitude (TargetLabel.js).
    // Scene sets `labelSettings` to its toggles; the defaults are the
    // catalogue labels' own and no body labels.
    this.targetLabel = new TargetLabel(this)
    this.labelSettings = () => ({l: this.labelLOD.visible, p: false})
    // Its opacity: the label groups' that show it (Scene's fades; fade.js).
    this.targetLabelFade = {value: 1}
    this.preAnimCb = () => this.syncTargetLabel()

    if (catalog instanceof StarsCatalog) {
      if (!catalog.starByHip) {
        throw new Error('Invalid stars catalog')
      }
      this.catalog = catalog
      this.show()
      if (showLabels) {
        this.showLabels()
      }
      this.ui.useStore.setState({starsCatalog: this.catalog})
      this._markCatalogReady()
      this._markCatalogComplete()
    } else {
      this.catalog = new StarsCatalog()
      // Expose the (empty) catalog immediately so About / search wiring can
      // hold the reference; re-publish once the bright tier is in so
      // subscribers that gate on numStars > 0 (SearchIndex's StarsProvider
      // registration) see the transition.
      this.ui.useStore.setState({starsCatalog: this.catalog})
      const tiers = opts.tiers ?? (typeof location === 'undefined' || starTiersEnabled(location.search))
      if (tiers) {
        this._loadTiers(opts)
      } else {
        this._loadWhole()
      }
    }
  }


  /** stars.dat whole, then the names: the path before tiers, and their fallback. */
  _loadWhole() {
    // The tiers' fallback has asked for the names already.
    const names = this._namesPromise ?? null
    this.catalog.load(() => (names ?? Promise.resolve()).then(() => {
      this.show()
      if (!this.starLabelSpriteSheet) {
        this.showLabels()
      }
      this.ui.useStore.setState({starsCatalog: this.catalog})
      this._markCatalogReady()
      this._markCatalogComplete()
    }), () => this._markCatalogComplete(), !names)
  }


  /**
   * The catalogue as brightness tiers (catalogue/cataloguePopulation.js):
   * the manifest, then the bright tier (the roots' pack: every star to V
   * 6.5 and every named one) and the names, then the rest, what the view
   * wants first.  The catalogue is ready (`onCatalogReady`: the labels,
   * the asterisms, the search) with the bright tier and the names; it is
   * complete (`onCatalogComplete`: the human expansion, a search by number)
   * with every tier.  A failed manifest or tile falls back to stars.dat.
   *
   * @param {object} opts The constructor's
   */
  _loadTiers({fetchFn, baseUrl} = {}) {
    const material = newStarsMaterial()
    this.pointsMaterial = material
    this._namesIn = false
    this._shaderReady = false
    // The Sun, at HIP 0, as stars.dat's reader puts it: the favourites'
    // labels name it, and it has its own point (_onTierShader).
    this.catalog.addSun()
    const population = newCataloguePopulation({
      ui: this.ui, material, fetchFn, baseUrl,
      onTile: (t, data) => this._addTile(data),
      onFail: (keys) => this._fallBack(`${keys.length} tiles lost`),
    })
    const update = population.preAnimCb
    population.preAnimCb = (time, jd) => {
      update(time, jd)
      // The safety net for streamRest.
      if (this.drawn()) {
        const now = performance.now()
        this._drawnAt ??= now
        if (now - this._drawnAt >= STREAM_REST_AFTER_MS) {
          this.streamRest()
        }
      }
    }
    // Nothing draws before the shader's sources are in.
    population.visible = false
    this.population = population
    this.add(population)
    population.start().then(() => {
      if (this.population !== population) {
        return
      }
      if (population.status !== 'ready') {
        this._fallBack(`no manifest (${population.status})`)
        return
      }
      // With the bright tier, not after it (stars.dat's shader waited for
      // the whole file).
      new Loader().loadShaders(material, () => this._onTierShader(population))
    })
    this._namesPromise = this.catalog.loadNames().catch((e) => {
      console.warn(`Stars: the names failed to load: ${e?.message ?? e}`)
    }).then(() => {
      this._namesIn = true
      this._maybeReady()
    })
  }


  /**
   * The tiers' shader is in: draw them, and the Sun's own point (the
   * catalogue's geometry held it at HIP 0; it isn't in stars.dat or the
   * tiles), which also carries the camera to the labels' uniforms each
   * frame, as the one geometry's points did.
   *
   * @param {object} population
   */
  _onTierShader(population) {
    if (this.population !== population) {
      return
    }
    this._shaderReady = true
    population.visible = true
    const material = this.pointsMaterial
    const sunMap = new Map([[0, this.catalog.addSun()]])
    const sunPoint = named(new Points(new StarsBufferGeometry({starByHip: sunMap}), material), 'SunStarPoint')
    // Always drawn (its bounding sphere is a point), so the labels' camera
    // follows every frame.
    sunPoint.frustumCulled = false
    const camHigh = material.uniforms.uCamPosWorldHigh.value
    const camLow = material.uniforms.uCamPosWorldLow.value
    sunPoint.onBeforeRender = (renderer, scene, camera) => {
      rteCameraLocal(sunPoint, camera, camHigh, camLow)
      this._labelsCamera(camHigh, camLow)
    }
    this.sunPoint = sunPoint
    this.add(sunPoint)
    this._maybeReady()
  }


  /** @param {object} data A tile's (catalogue/catalogueTile.js) */
  _addTile(data) {
    this.catalog.addStars(data.stars)
    this._maybeReady()
    this._runStarWaiters()
    if (this.population?.done()) {
      this._markCatalogComplete()
    }
  }


  /** Ready when the bright tier and the names are in; picking once drawn. */
  _maybeReady() {
    const population = this.population
    if (!this._catalogReady && population && this._namesIn && population.rootsLoaded()) {
      this.showLabels()
      this.ui.useStore.setState({starsCatalog: this.catalog})
      this._markCatalogReady()
      this._runStarWaiters()
    }
    if (this._catalogReady && this._shaderReady && !this._pickLabels) {
      this._pickLabels = new PickLabels(this.ui, this)
      this.onLoadCb?.()
    }
  }


  /**
   * The tiles can't be had (no manifest, a request failed): stars.dat
   * whole, as before the tiers.  What the tiles brought is replaced, not
   * drawn twice; the labels, if built, stay (they are the bright tier's,
   * which stars.dat has too).
   */
  _fallBack(why) {
    const population = this.population
    if (!population) {
      return
    }
    // Quietly where there's no data at all (the tests' pages).
    if (population.status === 'ready') {
      console.warn(`Stars: the catalogue's tiers failed (${why}); reading stars.dat whole`)
    }
    this.population = null
    this.remove(population)
    for (const tile of population.loaded.values()) {
      tile.points.geometry.dispose()
    }
    if (this.sunPoint) {
      this.remove(this.sunPoint)
      this.sunPoint = null
    }
    this._loadWhole()
  }


  /**
   * @param {object} camHigh Vector3
   * @param {object} camLow Vector3
   */
  _labelsCamera(camHigh, camLow) {
    // Catalog labels sit inside a LOD wrapper; their onBeforeRender is not
    // guaranteed to fire every frame after a WorldGroup rebase.  Update from
    // here instead: these points are a direct child of Stars and always
    // render.  The labels are in the same frame (the LOD and its group are
    // unrotated).
    const lm = this.starLabelSpriteSheet?.sprites?.material
    if (lm) {
      lm.uniforms.uCamPosWorldHigh.value.copy(camHigh)
      lm.uniforms.uCamPosWorldLow.value.copy(camLow)
    }
  }


  /**
   * Whether the catalogue's points are drawn: the scene's stars for the
   * first load's reveal and the meter (ThreeUi.sceneReady).  As tiers: the
   * bright tier in, its shader, and the tiles this view wants, to its
   * limit plus the engine's margin (a deep or telescope link waits for its
   * faint tiles; the Sun's view, for the bright tier alone).  Once drawn,
   * drawn: a later view that wants a tile still on its way (the tiers
   * stream in for a second or two) isn't the scene loading again, for the
   * meter (exposure.js frameCanBeEmpty) or a tour's arrival.
   *
   * @returns {boolean}
   */
  drawn() {
    if (!this._drawn) {
      this._drawn = this.population ?
        this._catalogReady && this._shaderReady && this.population.viewReady() :
        Boolean(this.starPoints)
    }
    return this._drawn
  }


  /** @returns {boolean} Whether every tier is in, or nothing more will come */
  catalogComplete() {
    return this._catalogComplete
  }


  /**
   * Fetch the faint tiers now: until this the catalogue fetches only its
   * bright tier and what the view wants, so the first load's bandwidth goes
   * to what the reveal shows.  Called at the reveal (Celestiary.frame), and
   * by whatever needs the whole catalogue.
   */
  streamRest() {
    this.population?.releaseRest()
  }


  /**
   * Register a callback to fire once the whole catalogue is in (every
   * tier), or nothing more will come.  At once if so.
   *
   * @param {Function} cb
   */
  onCatalogComplete(cb) {
    if (this._catalogComplete) {
      cb()
      return
    }
    this._catalogCompleteCbs.push(cb)
  }


  /**
   * @returns {Promise<void>} When the whole catalogue is in, which it asks
   *   for now (streamRest)
   */
  whenComplete() {
    this.streamRest()
    return new Promise((resolve) => this.onCatalogComplete(resolve))
  }


  /** Internal: drain the completion queue. */
  _markCatalogComplete() {
    if (this._catalogComplete) {
      return
    }
    this._catalogComplete = true
    const cbs = this._catalogCompleteCbs
    this._catalogCompleteCbs = []
    for (const cb of cbs) {
      cb()
    }
    this._runStarWaiters()
  }


  /**
   * A star by its HIP number, once its tier is in: at once for one already
   * loaded (every named star is, with the bright tier), else when its
   * tier lands.  A link or a search to a faint unnamed star waits so.
   *
   * @param {number} hipId
   * @param {Function} cb Called with the star (StarProps)
   * @param {Function} [onMissing] Called if the whole catalogue is in without it
   */
  whenStar(hipId, cb, onMissing) {
    const settle = () => {
      const star = this.catalog.starByHip.get(hipId)
      if (star) {
        cb(star)
        return true
      }
      if (this._catalogComplete) {
        console.warn(`No star HIP ${hipId}`)
        onMissing?.()
        return true
      }
      return false
    }
    this.onCatalogReady(() => {
      if (!settle()) {
        // Not in the bright tier: the rest, now.
        this._starWaiters.push(settle)
        this.streamRest()
      }
    })
  }


  /** Internal: answer the waits whose star has come, or never will. */
  _runStarWaiters() {
    if (!this._catalogReady || this._starWaiters.length === 0) {
      return
    }
    this._starWaiters = this._starWaiters.filter((settle) => !settle())
  }


  /**
   * The loaded stars' positions for picking (PickLabels.js), with each
   * one's HIP number: the one geometry's, or built from the catalogue as
   * its tiers come in.  `version` changes as it grows.
   *
   * @returns {{coords: Float32Array, idsByNdx: Int32Array, version: *}}
   */
  pickIndex() {
    if (this.geom) {
      return {coords: this.geom.coords, idsByNdx: this.geom.idsByNdx, version: this.geom}
    }
    const version = this.catalog.version
    if (!this._pickIndex || this._pickIndex.version !== version) {
      const stars = [...this.catalog.starByHip.values()]
      const coords = new Float32Array(3 * stars.length)
      const idsByNdx = new Int32Array(stars.length)
      stars.forEach((star, i) => {
        coords[3 * i] = star.x
        coords[(3 * i) + 1] = star.y
        coords[(3 * i) + 2] = star.z
        idsByNdx[i] = star.hipId
      })
      this._pickIndex = {coords, idsByNdx, version}
    }
    return this._pickIndex
  }


  /**
   * @param {number} hipId
   * @returns {?{points: object, index: number}} The Points drawing a star,
   *   and its index there (ThreeUi.starProbe)
   */
  pointOf(hipId) {
    if (this.starPoints) {
      const index = this.geom.idsByNdx.indexOf(hipId)
      return index >= 0 ? {points: this.starPoints, index} : null
    }
    for (const tile of this.population?.loaded.values() ?? []) {
      const index = tile.hips ? tile.hips.indexOf(hipId) : -1
      if (index >= 0) {
        return {points: tile.points, index}
      }
    }
    return hipId === 0 && this.sunPoint ? {points: this.sunPoint, index: 0} : null
  }


  /**
   * Register a callback to fire once the stars catalog has finished
   * loading.  If already loaded, fires synchronously.  Used by
   * Scene.toggleAsterisms to avoid building an empty asterism geometry
   * (would happen on a permalink load that races the catalog fetch).
   *
   * @param {Function} cb
   */
  onCatalogReady(cb) {
    if (this._catalogReady) {
      cb()
      return
    }
    this._catalogReadyCbs.push(cb)
  }


  /** Internal: drain the readiness callback queue. */
  _markCatalogReady() {
    if (this._catalogReady) {
      return
    }
    this._catalogReady = true
    const cbs = this._catalogReadyCbs
    this._catalogReadyCbs = []
    for (const cb of cbs) {
      cb()
    }
  }


  /** */
  show() {
    this.geom = new StarsBufferGeometry(this.catalog)
    // One material for every star point (starsMaterial.js; HDR.md,
    // "Physical stars"), the point populations' too (Gaia.md).
    const starsMaterial = newStarsMaterial()
    this.pointsMaterial = starsMaterial
    new Loader().loadShaders(starsMaterial, () => {
      const starPoints = named(new Points(this.geom, starsMaterial), 'StarsPoints')
      starPoints.sortParticles = true
      starPoints.renderOrder = 0
      // RTE: update camera-position uniforms every frame so the high/low split
      // tracks the current camera position in star catalog coordinates (this
      // object's local frame: under the StellarFrame, J2000; see rte.js).
      const camHigh = starsMaterial.uniforms.uCamPosWorldHigh.value
      const camLow = starsMaterial.uniforms.uCamPosWorldLow.value
      starPoints.onBeforeRender = (renderer, scene, camera) => {
        rteCameraLocal(starPoints, camera, camHigh, camLow)
        this._labelsCamera(camHigh, camLow)
      }
      this.starPoints = starPoints
      this.add(starPoints)
      if (!this._pickLabels) {
        this._pickLabels = new PickLabels(this.ui, this)
      }
      if (this.onLoadCb) {
        this.onLoadCb()
      }
    })
  }


  /**
   * Make a star the one whose name is shown whatever its magnitude, or
   * none.  Only records it: the label is built by the animation loop
   * (`syncTargetLabel`), so a target change does no DOM work.
   *
   * @param {?object} star StarProps entry; null when the target isn't a star
   * @param {string} [name]
   */
  setTargetStar(star, name) {
    this.targetLabel.set(star, name)
  }


  /**
   * Build, show, hide or drop the target star's label to match the
   * target and the label toggles (`targetLabelShown`).  Each frame.
   *
   * @returns {?object} The label (a Points), if there is one
   */
  syncTargetLabel() {
    const {l, p, lOpacity = 1, pOpacity = 1} = this.labelSettings()
    const hipId = this.targetLabel.hipId
    const inCatalogue = this.labelledHips.has(hipId)
    const label = this.targetLabel.update(targetLabelShown({
      wanted: hipId !== null,
      starLabels: !!l,
      bodyLabels: !!p,
      inCatalogue,
    }))
    if (label) {
      // As faded as the groups that show it: 'l' (unless the catalogue's
      // sheet names the star) and 'p'.
      fadeMaterial(label.material, this.targetLabelFade)
      this.targetLabelFade.value = Math.max(l && !inCatalogue ? lOpacity : 0, p ? pOpacity : 0)
    }
    return label
  }


  /** */
  showLabels(level = 2) {
    const toShow = []
    this.addFaves(toShow)
    this.catalog.starByHip.forEach((star, hipId) => {
      if (this.faves.get(hipId)) {
        return
      }
      const names = this.catalog.namesByHip.get(hipId)
      if (names && names.length > level) {
        toShow.push([star, names[0]])
      } else if (star.absMag < LUMINOUS_LABEL_ABS_MAG) {
        toShow.push([star, `HIP ${hipId}`])
      }
      if (toShow.length >= MAX_LABELS) {
        console.warn(`Stars#showLabels: hit max count of ${MAX_LABELS}`)
      }
    })
    const maxLabel = 'Rigel Kentaurus B'
    this.starLabelSpriteSheet = new SpriteSheet(toShow.length, maxLabel, undefined, [0, 0], true)
    for (let i = 0; i < toShow.length; i++) {
      const [star, name] = toShow[i]
      this.showStarName(star, name)
    }
    this.labelledHips = new Set(toShow.map(([star]) => star.hipId))
    const labelPoints = overlay(this.starLabelSpriteSheet.compile())
    // A double click or tap on one goes to its star (labelPick.js).
    labelPoints.userData.labelTargets = toShow.map(([star, name]) => ({kind: 'star', star, name}))
    this.labelsGroup.add(labelPoints)
  }


  /** */
  showStarName(star, name) {
    const sPos = new Vector3(star.x, star.y, star.z)
    this.starLabelSpriteSheet.add(star.x, star.y, star.z, name)
    this.labelCenterPosByName[name] = sPos
  }


  /** */
  addFaves(toShow) {
    this.faves.forEach((name, hipId) => {
      const star = this.catalog.starByHip.get(hipId)
      if (star === undefined) {
        throw new Error(`Undefined star for hipId(${hipId})`)
      }
      toShow.push([star, name])
    })
  }
}
