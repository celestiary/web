import {
  Object3D,
  Quaternion,
  Raycaster,
  Vector2,
  Vector3,
} from 'three'
import Asterisms from './Asterisms.js'
import newGrids from './Grids.js'
import newMilkyWay from './MilkyWay.js'
import Planet from './Planet.js'
import Star from './Star.js'
import Stars from './Stars.js'
import {newCameraGoToTween, newCameraLookTween} from '../camera.js'
import * as Shared from '../shared.js'
import * as Utils from '../utils.js'


const STEP_BACK = 10


/** */
export default class Scene {
  /**
   * @param {Function} useStore Accessor to zustand store for shared application state
   * @param {object} ui
   */
  constructor(ui) {
    this.ui = ui
    ui.sceneManager = this
    this.objects = {}
    // All celestial objects live under worldGroup so a single position shift
    // rebases the entire universe (used by star navigation for float32 precision).
    // camera.platform and _starAnchor are scene-root siblings, unaffected by the shift.
    this.worldGroup = new Object3D
    this.worldGroup.name = 'WorldGroup'
    ui.scene.add(this.worldGroup)
    // Reference-frame grids (Equatorial, Ecliptic, Galactic).  Lives in the
    // worldGroup so star-navigation rebases shift it along with the
    // universe, but the grid shader ignores camera translation so the grid
    // wraps the camera as a sky reference regardless.  All hidden by
    // default; toggled via keyboard.
    this.grids = newGrids()
    this.worldGroup.add(this.grids.group)
    this.mouse = new Vector2
    this.raycaster = new Raycaster
    // this.raycaster = new CustomRaycaster;
    this.raycaster.params.Points.threshold = 3
    ui.addClickCb((click) => {
      this.onClick(click)
    })
    // Loaded later
    this.stars = null
    this.asterisms = null
    this.orbitsVisible = true
    // Toggleable settings.  Initialized to the runtime state right after
    // Scene construction (before any user / firstTime toggle): asterisms
    // and star labels are off (built / unhidden lazily); planet labels and
    // orbits are visible by default; all reference grids are hidden.  Kept
    // in sync by every toggle method below; surfaced for permalink
    // round-tripping via getSettings() / applySettings().  Letter codes
    // match permalink.js's SETTINGS_DEFAULTS.
    this._settings = {
      a: false, // asterisms
      l: false, // star labels
      p: true, // planet labels
      o: true, // orbits
      e: false, // equatorial grid
      c: false, // ecliptic grid
      g: false, // galactic grid
    }
    // Set by Celestiary; called whenever any settings flag flips so the
    // permalink can be updated.
    this.onSettingsChange = null
  }


  /** @returns {object} flat {key: bool} map matching permalink SETTINGS_DEFAULTS */
  getSettings() {
    return {...this._settings}
  }


  /**
   * Drive each settings toggle to match the requested state, idempotently.
   * Called at startup to reify either defaults or a permalink override; any
   * key whose target value already matches the current value is a no-op.
   *
   * @param {object} requested flat {key: bool} map
   */
  applySettings(requested) {
    // toggleStarLabels and toggleAsterisms guard on this.stars existing
    // (the Stars instance, not the catalog).  On a permalink load the 0ms
    // setTimeout in Celestiary.onDone can race the stars.json fetch — if
    // earth.json wins, applySettings runs while this.stars is still null
    // and the stars-dependent toggles silently no-op, leaving _settings.l
    // and _settings.a stuck at their initial values.  Defer the whole
    // apply pass until Stars is constructed; orbits / grids work either
    // way, but doing them all at once keeps _settings coherent and gives
    // a single permalink-update fire instead of two.
    if (!this.stars) {
      this.onStarsReady(() => this.applySettings(requested))
      return
    }
    const dispatch = {
      a: () => this.toggleAsterisms(),
      l: () => this.toggleStarLabels(),
      p: () => this.togglePlanetLabels(),
      o: () => this.toggleOrbits(),
      e: () => this.toggleGridEquatorial(),
      c: () => this.toggleGridEcliptic(),
      g: () => this.toggleGridGalactic(),
    }
    for (const key of Object.keys(dispatch)) {
      if (requested[key] !== undefined && requested[key] !== this._settings[key]) {
        dispatch[key]()
      }
    }
  }


  /**
   * Register a callback to fire when this.stars (the Stars instance) is
   * constructed.  Fires synchronously if already set.  Used by
   * applySettings to avoid the race described there.
   *
   * @param {Function} cb
   */
  onStarsReady(cb) {
    if (this.stars) {
      cb()
      return
    }
    if (!this._starsReadyCbs) {
      this._starsReadyCbs = []
    }
    this._starsReadyCbs.push(cb)
  }


  /** Internal: drain the stars-ready callback queue. */
  _markStarsReady() {
    const cbs = this._starsReadyCbs
    this._starsReadyCbs = null
    if (!cbs) {
      return
    }
    for (const cb of cbs) {
      cb()
    }
  }


  /** Internal: flip a single key in _settings and notify the listener. */
  _flipSetting(key) {
    this._settings[key] = !this._settings[key]
    this.onSettingsChange?.()
  }


  /**
   * Add an object to the scene.
   *
   * @param {!object} props object properties, must include type.
   * @returns {Object3D}
   */
  add(props) {
    const name = props.name
    let parentObj = this.objects[props.parent]
    let parentOrbitPosition = this.objects[`${props.parent}.orbitPosition`]
    if (props.name === 'milkyway' || props.name === 'sun') {
      parentObj = parentOrbitPosition = this.worldGroup
    }
    if (!parentObj || !parentOrbitPosition) {
      throw new Error(`No parent obj: ${parentObj} or pos: ${parentOrbitPosition} for ${name}`)
    }
    const obj3d = this.objectFactory(props)
    // Add to scene in reference frame of parent's orbit position,
    // e.g. moons orbit planets, so they have to be added to the
    // planet's orbital center.
    parentOrbitPosition.add(obj3d)
    return obj3d
  }


  /**
   * @param {object} props
   * @returns {object}
   */
  objectFactory(props) {
    switch (props.type) {
      case 'galaxy': return this.newGalaxy(props)
      case 'stars':
        this.stars = new Stars(props, this.ui)
        this._markStarsReady()
        return this.stars
      case 'star': return new Star(props, this.objects, this.ui)
      case 'planet': return new Planet(this, props)
      case 'moon': return new Planet(this, props, true)
      default:
    }
    throw new Error(`Object has unknown type: ${props.type}`)
  }


  /**
   * A primary scene object composed.
   *
   * @param {string} name
   * @param {object} props
   * @param {Function} onClick
   * @returns {Object3D}
   */
  newObject(name, props, onClick) {
    const obj = this.newGroup(name, props)
    if (!onClick) {
      throw new Error('Must provide an onClick handler')
    }
    obj.onClick = onClick
    return obj
  }


  /**
   * A secondary grouping of scene objects.
   *
   * @param name Prefix, attached to .frame suffix.
   * @param props Optional props to attach to a .props field on the frame.
   * @returns {object}
   */
  newGroup(name, props) {
    const obj = new Object3D
    this.objects[name] = obj
    obj.name = name
    if (props) {
      obj.props = props
    }
    return obj
  }


  /** @param {string} name */
  targetNamed(name) {
    this.setTarget(name)
    // this.lookAtTarget()
  }


  /** */
  targetParent() {
    const cObj = Shared.targets.cur
    if (cObj && cObj.props && cObj.props.parent) {
      this.setTarget(cObj.props.parent)
    }
  }


  /** */
  targetNode(index) {
    const cObj = Shared.targets.cur
    if (cObj && cObj.props && cObj.props.system && cObj.props.system) {
      const sys = cObj.props.system
      if (sys[index - 1]) {
        this.setTarget(sys[index - 1])
      }
    }
  }


  /** */
  targetCurNode() {
    const cObj = Shared.targets.cur
    if (cObj && cObj.props && cObj.props.name) {
      this.setTarget(cObj.props.name)
    }
  }


  /**
   * Abstract target setter — all target-changing entry points (keyboard 'h',
   * 'u', '0'-'9', onDone, etc) funnel here.  Syncs the committed-path store
   * field (which also clears committedStar) so the breadcrumb + info panel
   * reflect the new target rather than a stale star selection.
   *
   * @param {string} name
   */
  setTarget(name) {
    const obj = this.objects[name]
    if (!obj) {
      throw new Error(`scene#setTarget: no matching target: ${name}`)
    }
    Shared.targets.obj = obj
    // Animated in ThreeUI.renderLoop
    Shared.targets.tween = newCameraLookTween(this.ui.camera, obj.matrixWorld)

    const store = this.ui && this.ui.useStore
    if (store && typeof store.getState === 'function') {
      const setter = store.getState().setCommittedPath
      if (typeof setter === 'function') {
        setter(this._pathFor(name))
      }
    }
  }


  /**
   * Walk the parent chain up from `name` via scene.objects' stored props
   * until we hit the milkyway root.  Used by setTarget to compute the
   * breadcrumb path without depending on the Loader's lazy pathByName.
   *
   * @param {string} name
   * @returns {string[]}
   */
  _pathFor(name) {
    if (name === 'milkyway') {
      return [name]
    }
    const parts = []
    const seen = new Set()
    let cur = name
    while (cur && cur !== 'milkyway' && this.objects[cur] && !seen.has(cur)) {
      parts.unshift(cur)
      seen.add(cur)
      const props = this.objects[cur].props
      cur = props && props.parent
    }
    return parts
  }


  /** */
  lookAtTarget() {
    if (!Shared.targets.obj) {
      console.error('scene.js#lookAtTarget: no target obj to look at.')
      return
    }
    const obj = Shared.targets.obj
    const tPos = Shared.targets.pos
    this.ui.scene.updateMatrixWorld()
    tPos.setFromMatrixPosition(obj.matrixWorld)
    this.ui.camera.lookAt(tPos)
  }


  /**
   * Navigate camera to a planet (star=null) or a star catalog entry.
   *
   * Flow:
   *   Phase 1 (synchronous): rebase WorldGroup + reparent camera platform to
   *     the target's anchor (planet: obj.orbitPosition, star: _starAnchor),
   *     preserving the camera's world transform so there's no visible jump.
   *   Phase 2 (tween): look tween rotates toward the target's NEW world
   *     position, then tweenNextFn launches the fly-in.
   *
   * Doing the rebase/reparent up-front means both tween phases operate in
   * a single consistent coordinate frame — the old two-step split left the
   * look tween aimed at the pre-rebase position and the fly-in handoff then
   * had to re-rotate through any coordinate shift, which was visible as a
   * camera jerk on star → planet or star → star transitions.
   *
   * Arrival distance = radius × STEP_BACK so both bodies fill the same
   * apparent angular diameter regardless of absolute size.
   *
   * @param {object|null} star StarProps entry from StarsCatalog, or null for planet.
   */
  goTo(star = null) {
    const isPlanet = star === null
    const obj = isPlanet ? Shared.targets.obj : null
    if (isPlanet && !obj) {
      console.error('Scene.goTo called with no target obj.')
      return
    }
    this.ui.scene.updateMatrixWorld()

    // Capture PRE-rebase camera world transform.
    const camWorldPos = new Vector3()
    const camWorldQuat = new Quaternion()
    this.ui.camera.getWorldPosition(camWorldPos)
    this.ui.camera.getWorldQuaternion(camWorldQuat)
    const wgOld = this.worldGroup.position.clone()

    // Rebase WorldGroup so the target lands at world origin.
    this.worldGroup.position.set(
      isPlanet ? 0 : -star.x,
      isPlanet ? 0 : -star.y,
      isPlanet ? 0 : -star.z,
    )
    this.ui.scene.updateMatrixWorld()

    // Shift the captured camera world pos by the same wg delta, so the camera
    // "moves with the universe" even when its parent (_starAnchor) is in
    // scene-root and doesn't track wg.  This gives star → star and star → planet
    // navigation a meaningful travel distance, and (crucially) keeps the
    // camera's view direction to the previously-targeted body invariant across
    // the rebase, so the follow-up look tween has a real rotation to animate.
    const wgDelta = this.worldGroup.position.clone().sub(wgOld)
    camWorldPos.add(wgDelta)

    // Reparent platform to target anchor with identity local transform.
    const anchor = isPlanet ? obj.orbitPosition : this._getOrCreateStarAnchor()
    anchor.add(this.ui.camera.platform)
    this.ui.camera.platform.position.set(0, 0, 0)
    this.ui.camera.platform.quaternion.identity()
    this.ui.scene.updateMatrixWorld()

    // Restore camera's (shifted) world transform.
    this.ui.camera.position.copy(this.ui.camera.platform.worldToLocal(camWorldPos.clone()))
    const platformWorldQuat = new Quaternion()
    this.ui.camera.platform.getWorldQuaternion(platformWorldQuat)
    this.ui.camera.quaternion.copy(platformWorldQuat.invert().multiply(camWorldQuat))

    const targetWorldPos = isPlanet ?
      new Vector3().setFromMatrixPosition(obj.matrixWorld) :
      new Vector3(0, 0, 0)

    if (isPlanet) {
      Shared.targets.cur = obj
    }

    // Arrival pose: approach along camera→target line.
    const dir = camWorldPos.clone().sub(targetWorldPos)
    if (dir.lengthSq() > 0) {
      dir.normalize()
    } else {
      dir.set(0, 0, 1)
    }
    const camDist = isPlanet ?
      (obj.initialCameraDistance ?? (obj.props.radius.scalar * STEP_BACK)) :
      (star.radius * STEP_BACK)
    const arrivalWorld = targetWorldPos.clone().addScaledVector(dir, camDist)
    const arrivalLocal = this.ui.camera.platform.worldToLocal(arrivalWorld)

    // Single unified tween that overlaps rotation and movement.
    Shared.targets.tween = newCameraGoToTween(this.ui.camera, targetWorldPos, arrivalLocal)
    Shared.targets.tweenNextFn = null
  }


  /** @returns {Object3D} */
  _getOrCreateStarAnchor() {
    if (!this._starAnchor) {
      this._starAnchor = new Object3D
      this._starAnchor.name = 'StarAnchor'
      this.ui.scene.add(this._starAnchor)
    }
    return this._starAnchor
  }


  track() {
    if (Shared.targets.track) {
      Shared.targets.track = null
    } else {
      Shared.targets.track = Shared.targets.obj
    }
  }


  follow() {
    if (Shared.targets.follow) {
      Shared.targets.follow = null
    } else if (Shared.targets.obj) {
      if (Shared.targets.obj.orbitPosition) {
        Shared.targets.follow = Shared.targets.obj.orbitPosition
      } else {
        console.error('Target to follow has no orbitPosition property.')
      }
    } else {
      console.error('No target object to follow.')
    }
  }


  /** @param {object} mouse */
  onClick(mouse) {
    // TODO: picking disabled
  }


  /** */
  toggleAsterisms() {
    if (this.asterisms === null && this.stars !== null) {
      // Defer the actual Asterisms construction until the stars catalog
      // has loaded.  Without this, on permalink loads (which use a 0ms
      // setTimeout in Celestiary.onDone) the asterism build runs against
      // an empty starByHip map and silently produces zero line segments —
      // so reload / permalink users would see no constellations even
      // though the catalog itself was about to load fine.
      // _asterismsPending guards against repeated toggle calls during the
      // catalog-load window enqueueing duplicate callbacks (each would
      // build its own Asterisms once ready).
      if (this._asterismsPending) {
        return
      }
      this._asterismsPending = true
      this._flipSetting('a')
      this.stars.onCatalogReady(() => {
        const asterisms = new Asterisms(this.ui, this.stars, () => {
          this.stars.add(asterisms)
          this.asterisms = asterisms
          this.asterisms.visible = this._settings.a
          this._asterismsPending = false
        })
      })
      return
    }
    if (this.asterisms) {
      this.asterisms.visible = !this.asterisms.visible
      this._flipSetting('a')
    }
  }


  /** */
  toggleOrbits() {
    Utils.visitSetProperty(this.objects['sun'], 'name', 'orbit', 'visible', this.orbitsVisible = !this.orbitsVisible)
    this._flipSetting('o')
  }


  /** */
  togglePlanetLabels() {
    Utils.visitToggleProperty(this.objects['sun'], 'name', 'label LOD', 'visible')
    this._flipSetting('p')
  }


  /** */
  toggleStarLabels() {
    if (this.stars) {
      this.stars.labelLOD.visible = !this.stars.labelLOD.visible
      this._flipSetting('l')
    }
  }


  /** */
  toggleGridEquatorial() {
    if (this.grids) {
      this.grids.equatorial.visible = !this.grids.equatorial.visible
      this._flipSetting('e')
    }
  }


  /** */
  toggleGridEcliptic() {
    if (this.grids) {
      this.grids.ecliptic.visible = !this.grids.ecliptic.visible
      this._flipSetting('c')
    }
  }


  /** */
  toggleGridGalactic() {
    if (this.grids) {
      this.grids.galactic.visible = !this.grids.galactic.visible
      this._flipSetting('g')
    }
  }


  /**
   * @param {object} galaxyProps
   * @returns {object}
   */
  newGalaxy(galaxyProps) {
    const group = this.newObject(galaxyProps.name, galaxyProps, (click) => {
      // console.log('Well done, you found the galaxy!');
    })
    this.objects[`${galaxyProps.name}.orbitPosition`] = group
    // Procedural barred-spiral Milky Way as a background star cloud.  Built in
    // galactic-centre coords and translated so the Sun (world origin) lands on
    // a spiral arm.  Lives in worldGroup so star-navigation rebases shift it
    // along with everything else, keeping the universe coherent.
    group.add(newMilkyWay())
    return group
  }
}
