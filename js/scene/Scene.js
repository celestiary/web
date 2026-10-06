import {
  Group,
  Object3D,
  Quaternion,
  Raycaster,
  Vector2,
  Vector3,
} from 'three'
import Asterisms from './Asterisms.js'
import ColonizationLines from './ColonizationLines.js'
import newGrids from './Grids.js'
import newMilkyWay from './MilkyWay.js'
import Planet from './Planet.js'
import SpriteSheet from './SpriteSheet.js'
import Star from './Star.js'
import Stars from './Stars.js'
import StellarFrame from './StellarFrame.js'
import {latLngAltToBodyFixed} from '../coords.js'
import {newCameraGoToTween, newCameraLandTween, newCameraLookTween} from '../camera.js'
import {pickSurfaceLatLng} from './Picker.js'
import {hitLabel, labelBoxes} from './labelPick.js'
import {labelTextColor} from '../shared.js'
import * as Shared from '../shared.js'
import * as Utils from '../utils.js'


/** Default observer altitude for Scene.land — eye height. */
export const DEFAULT_LAND_ALT_M = 2


/**
 * Format lat/lng as a compact, human-readable string for the dblclick
 * marker label, e.g. "30.27°N, 97.74°W".  Two decimals: tight enough to
 * resolve a city block at Earth scale (~1 km), short enough to keep the
 * sprite sheet small.
 *
 * @param {number} lat
 * @param {number} lng
 * @returns {string}
 */
export function formatLatLng(lat, lng) {
  const ns = lat >= 0 ? 'N' : 'S'
  const ew = lng >= 0 ? 'E' : 'W'
  return `${Math.abs(lat).toFixed(2)}°${ns}, ${Math.abs(lng).toFixed(2)}°${ew}`
}


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
    // The J2000 catalogues (stars, labels, asterisms, Milky Way) hang under
    // stellarFrame, which precesses them to the simulation date so they share
    // the planets' frame, the ecliptic of date (DESIGN.md "Frames and
    // time").  Parented in newGalaxy; Animation drives it.  The galactic grid
    // is J2000 too, so it follows; and a star the camera has travelled to
    // stays at the world origin as the frame turns about the Sun.
    this.stellarFrame = new StellarFrame()
    this._galacticGridJ2000 = this.grids.galactic.quaternion.clone()
    this._starTarget = null
    this.stellarFrame.onChange((q) => {
      this.grids.galactic.quaternion.multiplyQuaternions(q, this._galacticGridJ2000)
      if (this._starTarget) {
        this.worldGroup.position.copy(this.starPosition(this._starTarget, this.worldGroup.position)).negate()
      }
    })
    this.mouse = new Vector2
    this.raycaster = new Raycaster
    // this.raycaster = new CustomRaycaster;
    this.raycaster.params.Points.threshold = 3
    ui.addClickCb((click) => {
      this.onClick(click)
    })
    if (typeof ui.addDblClickCb === 'function') {
      ui.addDblClickCb((click) => {
        this.onDblClick(click)
      })
    }
    // Loaded later
    this.stars = null
    this.asterisms = null
    // Human expansion lines (ColonizationLines), built by the expansion drawer.
    this.colonization = null
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
      U: true, // Milky Way galaxy
      x: true, // human expansion lines, once computed
      v: true, // nav panels / heads-up display (Celestiary-owned, see registerSettingApplier)
    }
    // Custom appliers for settings keys that the Scene doesn't own directly
    // (Celestiary registers 'v' here).  applySettings dispatches to these
    // alongside the built-in toggle methods.
    this._customAppliers = {}
    // Set by Celestiary; called whenever any settings flag flips so the
    // permalink can be updated.
    this.onSettingsChange = null
  }


  /**
   * Register a key handler so applySettings can drive a toggle the Scene
   * doesn't own (e.g. the Celestiary-level nav panels).  The applier
   * function should perform the same effect as a user keypress and update
   * Scene._settings via _flipSetting (or by calling back into a method
   * that does).
   *
   * @param {string} key one of the SETTINGS_DEFAULTS keys
   * @param {Function} fn
   */
  registerSettingApplier(key, fn) {
    this._customAppliers[key] = fn
  }


  /**
   * Public flip — updates _settings[key] and notifies the listener.
   * Exposed so Celestiary-owned toggles (which can't easily call the
   * underscore-prefixed internal version from outside) can keep the
   * canonical state in sync.
   *
   * @param {string} key
   */
  flipSetting(key) {
    this._flipSetting(key)
  }


  /** @returns {boolean} current value of a single setting */
  getSetting(key) {
    return this._settings[key]
  }


  /**
   * Flat {key: bool} map matching permalink SETTINGS_DEFAULTS.
   *
   * Two special-case keys are merged in here rather than tracked in
   * `_settings`:
   *
   *   - `L` (landed) — sourced from `Shared.targets.landed` so any code
   *     path that pins or unpins the surface mode (Scene.land, Scene.goTo)
   *     drives this without going through a Scene toggle.
   *   - `A` (AR-fallback) — defaults false here; the permalink writer in
   *     Celestiary._schedulePermalinkUpdate overwrites it with the live
   *     ARController.isActive() value before encoding.  The default-false
   *     here ensures every key in SETTINGS_DEFAULTS has a slot, satisfying
   *     the round-trip contract for code that snapshots getSettings().
   *
   * @returns {object}
   */
  getSettings() {
    return {...this._settings, L: Shared.targets.landed, A: false}
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
      U: () => this.toggleGalaxy(),
      x: () => this.toggleColonization(),
      ...this._customAppliers,
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


  /**
   * Call back with the asterisms (Asterisms) once they're built: now if
   * they are, else when 'a' first shows them.  Never while they're off
   * from the start.
   *
   * @param {Function} cb
   */
  onAsterismsReady(cb) {
    if (this.asterisms) {
      cb(this.asterisms)
      return
    }
    (this._asterismsReadyCbs ??= []).push(cb)
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
   * The one way the target changes (DESIGN.md, "The target").  Every entry
   * point funnels here: a click on a label, the search (a pick, Look at,
   * Go), the keys ('h', 'u', '0'-'9'), going and landing, and a link.  It
   * sets what 'c' faces, 'g' goes to and 't' tracks (`Shared.targets.obj`,
   * and `Shared.targets.label` for what isn't a body), and the store's
   * `committedTarget`, which the breadcrumb, the info panel and the page
   * title follow, then calls `onTargetChange` (Celestiary: the location
   * hash).  The camera never moves.
   *
   * - body: the target, and its surface preloads
   * - place: its body is `obj`, the place `label`
   * - star: `label`; `obj` stays the body it was
   * - asterism: `label` (the centroid of its stars)
   *
   * @param {string|object} target A body's name, or a target as labelPick.js
   *   gives them: {kind: 'body', name}, {kind: 'place', body, name, lat, lng,
   *   alt}, {kind: 'star', star, name}, {kind: 'asterism', name, position}
   * @param {object} [opts]
   * @param {boolean} [opts.look] Turn the camera to face it, over the look
   *   tween (default); false to leave the camera as it is, as a click on a
   *   label does
   */
  setTarget(target, {look = true} = {}) {
    const t = this._normalizeTarget(target)
    let obj = null
    if (t.kind === 'body' || t.kind === 'place') {
      const name = t.kind === 'body' ? t.name : t.body
      obj = this.objects[name]
      if (!obj) {
        throw new Error(`scene#setTarget: no matching target: ${name}`)
      }
      Shared.targets.obj = obj
      // Start loading its surface (and, for a moon, its planet's) now, not
      // when the camera arrives.
      obj.preloadNear?.()
      this.objects[obj.props?.parent]?.preloadNear?.()
    }
    Shared.targets.label = t.kind === 'body' ? null : t
    // Animated in ThreeUI.renderLoop
    if (look) {
      const pos = t.kind === 'body' ? obj.matrixWorld : this.labelPosition(t)
      if (pos) {
        Shared.targets.tween = newCameraLookTween(this.ui.camera, pos)
      }
    }
    const state = this.ui?.useStore?.getState?.()
    const path = obj ? this._pathFor(t.kind === 'body' ? t.name : t.body) : []
    if (typeof state?.setCommittedTarget === 'function') {
      state.setCommittedTarget(t, path)
    } else if (t.kind === 'star') {
      state?.setCommittedStar?.({hipId: t.hipId, displayName: t.name, star: t.star})
    } else if (obj) {
      state?.setCommittedPath?.(path)
    }
    this.onTargetChange?.(t)
  }


  /**
   * @param {string|object} target As setTarget takes it
   * @returns {object} The target as {kind, ...}; a star's with its hipId
   *   and a name
   */
  _normalizeTarget(target) {
    if (typeof target === 'string') {
      return {kind: 'body', name: target}
    }
    if (!target?.kind) {
      throw new Error(`scene#setTarget: not a target: ${target}`)
    }
    if (target.kind === 'star') {
      const hipId = target.star.hipId
      const name = target.name ?? this.stars?.catalog?.getNameOrId?.(hipId) ?? `HIP ${hipId}`
      return {...target, hipId, name: String(name)}
    }
    return target
  }


  /**
   * @returns {?object} The target, as setTarget took it: a place's, star's
   *   or asterism's (`Shared.targets.label`), else the targeted body's
   */
  getTarget() {
    if (Shared.targets.label) {
      return Shared.targets.label
    }
    const name = Shared.targets.obj?.props?.name
    return name ? {kind: 'body', name} : null
  }


  /**
   * Target a catalogue star and turn the camera in place to face it
   * (`setTarget` of the star, with the look tween).  It is where the
   * stellarFrame puts it, shifted by the current worldGroup rebase.
   *
   * @param {object} star StarProps entry from StarsCatalog (x, y, z in m)
   * @param {string} [name]
   */
  lookAtStar(star, name) {
    this.setTarget({kind: 'star', star, name})
  }


  /**
   * Target a surface point (lat/lng in degrees, alt in m over the sphere)
   * on a body and turn the camera in place to face it (`setTarget` of the
   * place, with the look tween).
   *
   * @param {string} bodyName
   * @param {number} lat
   * @param {number} lng
   * @param {number} [alt]
   * @param {string} [name] The place's name, else its coordinates
   */
  lookAtPlace(bodyName, lat, lng, alt = 0, name = formatLatLng(lat, lng)) {
    this.setTarget({kind: 'place', body: bodyName, name, lat, lng, alt})
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


  /**
   * Turn the camera to face the target, at once: 'c', and every frame while
   * tracking ('t').  The target is setTarget's: a place, star or asterism
   * (`Shared.targets.label`), else the targeted body.  A place is where it
   * is on its body this frame, so tracking one follows it as the body turns.
   */
  lookAtTarget() {
    const label = Shared.targets.label
    if (label) {
      const pos = this.labelPosition(label)
      if (pos) {
        this.ui.camera.lookAt(pos)
      }
      return
    }
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
   * Turn the camera, over the look tween, to face a label's point:
   * what going to an asterism comes to, as it is a direction, not a place
   * to arrive at.  The camera doesn't move.
   *
   * @param {object} label An asterism, place or star label target
   */
  lookAtLabel(label) {
    const pos = this.labelPosition(label)
    if (pos) {
      Shared.targets.tween = newCameraLookTween(this.ui.camera, pos)
    }
  }


  /**
   * @param {object} label A labelPick.js target
   * @param {Vector3} [out]
   * @returns {?Vector3} Where the label's subject is, world space; null if
   *   it can't be placed (a body not in the scene, the stars not loaded)
   */
  labelPosition(label, out = new Vector3) {
    this.ui.scene.updateMatrixWorld()
    switch (label.kind) {
      case 'star':
        return this.worldGroup.localToWorld(this.starPosition(label.star, out))
      case 'body': {
        const node = this.objects[label.name]
        return node ? node.getWorldPosition(out) : null
      }
      case 'place': {
        const node = this.objects[label.body]
        const r = node?.props?.radius?.scalar
        if (!r) {
          return null
        }
        return node.localToWorld(out.copy(latLngAltToBodyFixed(label.lat, label.lng, label.alt ?? 0, r)))
      }
      case 'asterism': {
        if (!this.stars) {
          return null
        }
        const {x, y, z} = label.position
        return this.stars.localToWorld(out.set(x, y, z))
      }
      default:
        return null
    }
  }


  /**
   * A catalogue star's position relative to the Sun in the scene frame
   * (ecliptic of date): its J2000 catalogue position turned by the
   * stellarFrame's precession.  Use it wherever a star's raw x/y/z would
   * otherwise meet scene positions.
   *
   * @param {object} star StarProps entry from StarsCatalog (x, y, z in m)
   * @param {Vector3} [target]
   * @returns {Vector3}
   */
  starPosition(star, target = new Vector3) {
    return this.stellarFrame.toParent(target.set(star.x, star.y, star.z))
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
   * Where it goes is the target after (`setTarget`, without the look).
   *
   * @param {object|null} star StarProps entry from StarsCatalog, or null for planet.
   * @param {string} [starName] The star's name, for the breadcrumb
   */
  goTo(star = null, starName = undefined) {
    const isPlanet = star === null
    const obj = isPlanet ? Shared.targets.obj : null
    if (isPlanet && !obj) {
      console.error('Scene.goTo called with no target obj.')
      return
    }
    if (isPlanet) {
      this.setTarget(obj.props?.name ?? obj.name, {look: false})
    } else {
      this.setTarget({kind: 'star', star, name: starName}, {look: false})
    }
    this.ui.scene.updateMatrixWorld()

    // Capture PRE-rebase camera world transform.
    const camWorldPos = new Vector3()
    const camWorldQuat = new Quaternion()
    this.ui.camera.getWorldPosition(camWorldPos)
    this.ui.camera.getWorldQuaternion(camWorldQuat)
    const wgOld = this.worldGroup.position.clone()

    // Rebase WorldGroup so the target lands at world origin.  A star is
    // where the stellarFrame puts it (precessed), and is kept there as the
    // frame turns (the onChange in the constructor).
    this._starTarget = star
    if (isPlanet) {
      this.worldGroup.position.set(0, 0, 0)
    } else {
      this.starPosition(star, this.worldGroup.position).negate()
    }
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

    // Reset drag mode to 'auto' on planet navigation so the next
    // pointerdown re-evaluates pickDragMode against the actual camera
    // position (which may end up at orbit altitude OR ground level if
    // a permalink restore lands the camera on the surface).  Manual
    // pan/orbit selections from a previous body don't carry over.
    // Also clear any prior 'landed' state — orbit-style nav unpins the
    // observer from the surface.
    if (isPlanet) {
      const state = this.ui.useStore?.getState?.()
      state?.setDragMode?.('auto')
      state?.setLanded?.(false)
      Shared.targets.landed = false
    }
  }


  /**
   * Pin the camera at a surface location and switch to first-person ('pan')
   * drag mode.  Reparents the camera platform to the rotating planet
   * Object3D — children of that node inherit axial tilt + sidereal rotation
   * via the scene graph, so the observer stays "stuck" to the surface as
   * the body spins.
   *
   * Arrival pose: camera at body-fixed XYZ for (lat, lng, alt); look
   * direction = outward along the surface normal (the user faces the sky,
   * which is the whole point of the feature — they can pan-drag to look
   * down).  The existing newCameraGoToTween animates from the user's
   * current view.
   *
   * @param {string} bodyName Body name (must exist in this.objects with .props.radius)
   * @param {number} lat Latitude in degrees
   * @param {number} lng Longitude in degrees, east-positive
   * @param {number} [alt] Altitude above surface in meters; default DEFAULT_LAND_ALT_M
   * @param {object} [opts]
   * @param {boolean} [opts.instant] Snap into the landed pose with no tween
   *   (used by permalink restore); caller may then set camera.quaternion to
   *   the saved view direction.
   * @param {object} [opts.target] The target after (`setTarget`, without
   *   the look): a place being landed at; else the body
   */
  land(bodyName, lat, lng, alt = DEFAULT_LAND_ALT_M, opts = {}) {
    const bodyNode = this.objects[bodyName]
    if (!bodyNode) {
      throw new Error(`Scene.land: no body ${bodyName}`)
    }
    const r = bodyNode.props?.radius?.scalar
    if (!r) {
      throw new Error(`Scene.land: body ${bodyName} has no radius`)
    }

    this.ui.scene.updateMatrixWorld()

    // Capture pre-land camera world transform so the tween starts from the
    // user's actual view rather than snapping to identity.
    const camWorldPos = new Vector3()
    const camWorldQuat = new Quaternion()
    this.ui.camera.getWorldPosition(camWorldPos)
    this.ui.camera.getWorldQuaternion(camWorldQuat)

    // Reparent to the rotating body.  This is the key difference from goTo
    // (which uses orbitPosition, before sidereal rotation) — child of the
    // rotating planet means the camera tracks surface rotation for free.
    bodyNode.add(this.ui.camera.platform)
    this.ui.camera.platform.position.set(0, 0, 0)
    this.ui.camera.platform.quaternion.identity()
    this.ui.scene.updateMatrixWorld()

    // Restore camera's prior world pose in the new platform-local frame.
    this.ui.camera.position.copy(this.ui.camera.platform.worldToLocal(camWorldPos.clone()))
    const platformWorldQuat = new Quaternion()
    this.ui.camera.platform.getWorldQuaternion(platformWorldQuat)
    this.ui.camera.quaternion.copy(platformWorldQuat.invert().multiply(camWorldQuat))

    Shared.targets.cur = bodyNode

    // Arrival local pose = body-fixed XYZ for (lat, lng, alt).  Platform is
    // identity at body origin, so platform-local == body-local.
    // Over the terrain there, when a Cesium layer knows it (from the tiles
    // loaded so far; ThreeUI keeps the camera over the ground as finer ones
    // arrive).  Not for a permalink restore: its altitude was measured over
    // the sphere, terrain included.
    const ground = opts.instant ? 0 : this.ui.layers?.groundHeightAt?.(bodyNode, lat, lng) ?? 0
    const arrivalLocal = latLngAltToBodyFixed(lat, lng, alt + ground, r)

    if (opts.instant) {
      // Snap into the landed pose; permalink restore will overwrite
      // quaternion afterward to recover the saved look direction.
      this.ui.camera.position.copy(arrivalLocal)
      Shared.targets.tween = null
      Shared.targets.tweenNextFn = null
    } else {
      // Spline-based landing: spacecraft-style approach that arrives
      // tangent to the surface, with the camera looking forward along
      // the runway direction at touchdown (horizon view).  The tween
      // owns both position AND orientation per frame.
      Shared.targets.tween = newCameraLandTween(this.ui.camera, arrivalLocal, r)
      Shared.targets.tweenNextFn = null
    }

    // Reset drag mode to 'auto' so pickDragMode picks 'pan' here at the
    // surface AND naturally flips back to 'orbit' when the user later
    // zooms out past the auto-switch threshold.  Earlier we forced
    // 'pan' explicitly, which felt right at touchdown but stayed sticky:
    // zooming out past orbit altitude kept dragging in pan mode forever.
    // Mark landed for permalink + UI; this is independent of drag mode.
    const state = this.ui.useStore?.getState?.()
    state?.setDragMode?.('auto')
    state?.setLanded?.(true)
    Shared.targets.landed = true

    this.setTarget(opts.target ?? bodyName, {look: false})
  }


  /**
   * Enter AR mode: apply the AR scene-visibility preset and disable the
   * atmosphere post-pass.  Returns a snapshot of the prior state so
   * `exitAR(snapshot)` can restore it.
   *
   * Preset (Stage 1, no camera passthrough yet):
   *   - asterisms ON, star labels ON, planet labels ON
   *   - orbits OFF, all reference grids OFF
   *   - atmosphere OFF (otherwise daytime sky paints over the stars; in
   *     Stage 2 the atmosphere will return with premultiplied-alpha blend
   *     so it tints the camera passthrough instead of opaque-painting it)
   *
   * Planet meshes are left visible — they form a virtual "ground" beneath
   * the observer when landed at altitude ~2 m, which is exactly the
   * spatial reference users want.
   *
   * @returns {object} snapshot for exitAR()
   */
  enterAR() {
    const snapshot = {
      settings: {...this._settings},
      uiArMode: this.ui._arMode,
      hiddenInAR: [],
    }
    // Atmosphere off — checked by ThreeUI._updateAtmUniforms each frame.
    this.ui._arMode = true
    // Hide busy/over-bright meshes for Stage 1 (sky-only view).  Three
    // distinct rendering issues otherwise paint over the starfield:
    //   1. `'planet surface and guides'` — at surface altitude 2 m, the
    //      camera near plane (`dynamicNear` clamps to ≥ 100 m) depth-clips
    //      the close ground, leaving only the distant lit limb visible.
    //      The PointLight sunlight (3.7e28 lm) + tone-mapping exposure
    //      (3e-16, tuned for from-space viewing) clips that limb to white.
    //   2. `'atmosphere'` — the Sun's additive `BackSide` halo shell
    //      from `newAtmosphere()`, which flashes when the camera aims
    //      at it.
    //   3. `'MilkyWay'` — the procedural galaxy is intentionally noisy
    //      (additive yellow-orange bulge particles, sparse bright
    //      cluster stand-ins).  At AR sensor jitter scale, those bright
    //      particles pop in and out of the field as flicker.  The real
    //      catalog stars + asterisms remain visible.
    // Stage 2 (camera passthrough + premultiplied-alpha atmosphere) will
    // reintroduce ground visuals.  Restored in `exitAR()`.
    snapshot.frozenLabelLODs = []
    this.ui.scene.traverse((obj) => {
      if (obj.visible &&
          (obj.name === 'planet surface and guides' ||
           obj.name === 'atmosphere' ||
           obj.name === 'MilkyWay')) {
        snapshot.hiddenInAR.push(obj)
        obj.visible = false
      }
      // Force-enable each `'label LOD'` so togglePlanetLabels actually
      // does something at surface altitude.  These LODs are tuned for
      // from-space viewing — `labelTooNearDist ≈ surfaceR * 30` (191k km
      // for Earth) — so at a 2 m altitude the camera distance is well
      // *inside* the near threshold, and the LOD selects the FAR_OBJ
      // placeholder (an empty Object3D).  Toggling labelLOD.visible has
      // no visible effect because the selected child renders nothing.
      // Disable autoUpdate and pin the labelSheet level visible; restore
      // both on exit so from-space LOD behaviour returns intact.
      if (obj.isLOD && obj.name === 'label LOD') {
        const childStates = obj.levels.map((lv) => ({
          object: lv.object,
          visible: lv.object.visible,
        }))
        snapshot.frozenLabelLODs.push({
          lod: obj,
          autoUpdate: obj.autoUpdate,
          childStates,
        })
        obj.autoUpdate = false
        for (const lv of obj.levels) {
          lv.object.visible = lv.object.name !== 'LODFarObj'
        }
      }
    })
    this.applySettings({
      a: true, // asterisms
      l: true, // star labels
      p: true, // planet labels
      o: false, // orbits
      e: false, // equatorial grid
      c: false, // ecliptic grid
      g: false, // galactic grid
    })
    return snapshot
  }


  /**
   * Restore the scene state captured by `enterAR()`.
   *
   * @param {object} snapshot Return value of enterAR()
   */
  exitAR(snapshot) {
    if (!snapshot) {
      return
    }
    this.ui._arMode = snapshot.uiArMode || false
    if (Array.isArray(snapshot.hiddenInAR)) {
      for (const obj of snapshot.hiddenInAR) {
        obj.visible = true
      }
    }
    if (Array.isArray(snapshot.frozenLabelLODs)) {
      for (const entry of snapshot.frozenLabelLODs) {
        entry.lod.autoUpdate = entry.autoUpdate
        for (const cs of entry.childStates) {
          cs.object.visible = cs.visible
        }
      }
    }
    if (snapshot.settings) {
      this.applySettings(snapshot.settings)
    }
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


  /**
   * Track the target ('t'), on and off: every frame the camera faces it
   * (`lookAtTarget`, from Celestiary's animation callback), whatever the
   * target is then: a body, a star, an asterism, or a place, which it
   * follows as its body turns.  Changing the target while tracking tracks
   * the new one.
   */
  track() {
    Shared.targets.track = !Shared.targets.track
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


  /**
   * Click or tap handler.  On a label (a star's, a planet's or moon's, an
   * asterism's, a place's) it targets what the label names and does
   * nothing else (`setTarget`, without the look): 'c' turns to face it, 'g'
   * goes.  A click
   * on empty sky or on a body's disc does nothing.  The double click is
   * `onDblClick`, which goes.  Not while the star picker is on, whose own
   * double click picks the star.
   *
   * @param {PointerEvent} e
   */
  onClick(e) {
    const label = this._starPickerOn() ? null : this.pickLabel(e)
    if (label) {
      this.setTarget(label, {look: false})
    }
  }


  /** @returns {boolean} Whether the crosshair star picker is on */
  _starPickerOn() {
    return Boolean(this.ui.useStore?.getState?.().isStarsSelectActive)
  }


  /**
   * Double-click or double-tap handler.  On a label, goes to what it names
   * (onLabelDblClick, set by Celestiary): a body or a star as 'g' does, a
   * place by landing there, an asterism by turning to face it.  The click
   * that began it already targeted it (`onClick` runs on both clicks).
   * Not while the star picker is on.
   *
   * Otherwise ray-sphere intersects the click against the
   * current body and, on hit, drops a temporary lat/lng marker at the spot
   * and lands there.  Works on any body with a `props.radius.scalar` that
   * isn't a star (stars are excluded so a dblclick on the Sun doesn't
   * teleport the user to its photosphere).  It lets the user land anywhere
   * on the surface, including bodies without a catalogued places file.
   *
   * @param {PointerEvent} e
   */
  onDblClick(e) {
    const label = this._starPickerOn() ? null : this.pickLabel(e)
    if (label) {
      this.onLabelDblClick?.(label)
      return
    }
    const cur = Shared.targets.cur
    if (!cur || !cur.props || !cur.props.radius?.scalar) {
      return
    }
    // Stars get raycast-targeted via the search/PickLabels flow.  Bodies
    // are identified vs stars by the absence of spectralType (matches
    // landableBodyName in Celestiary.js).
    if (cur.props.spectralType !== undefined) {
      return
    }
    const pick = pickSurfaceLatLng(this.ui, e, cur)
    if (!pick) {
      return
    }
    this._setTempMarker(cur, pick.lat, pick.lng)
    this.land(cur.props.name, pick.lat, pick.lng)
  }


  /**
   * @param {PointerEvent} e
   * @returns {object|null} The target of the label at e (labelPick.js):
   *   {kind: 'body', name} or {kind: 'star', star, name}; null if none
   */
  pickLabel(e) {
    const canvas = this.ui.renderer?.domElement
    if (!canvas?.getBoundingClientRect) {
      return null
    }
    const boxes = labelBoxes(this.ui.scene, this.ui.camera, canvas.getBoundingClientRect(),
        this.ui.renderer.getPixelRatio?.() ?? 1)
    return hitLabel(e.clientX, e.clientY, boxes)
  }


  /**
   * Drop (or replace) a one-entry lat/lng SpriteSheet on the rotating body
   * Object3D so the user can see where their dblclick landed.  Attached as
   * a child of the body so it inherits axial tilt + sidereal rotation
   * automatically.  Stashed on `bodyNode._tempMarker` so the next dblclick
   * can dispose the previous one without a global registry.
   *
   * @param {Object3D} bodyNode  Rotating planet Object3D (scene.objects[name])
   * @param {number} lat
   * @param {number} lng
   */
  _setTempMarker(bodyNode, lat, lng) {
    if (bodyNode._tempMarker) {
      this._disposeTempMarker(bodyNode)
    }
    const radius = bodyNode.props.radius.scalar
    const text = formatLatLng(lat, lng)
    // surfaceVisibility=true matches Places — back-hemisphere discard so the
    // marker can't bleed through to the far side of the body as it rotates.
    const sheet = new SpriteSheet(1, text, undefined, [0, 0], false, true)
    const xyz = latLngAltToBodyFixed(lat, lng, 0, radius)
    sheet.add(xyz.x, xyz.y, xyz.z, text, labelTextColor)
    const points = sheet.compile()
    const g = new Group()
    g.name = `${bodyNode.props.name}.tempMarker`
    g.userData.isTempMarker = true
    g.userData.sheet = sheet
    g.add(points)
    // Track 'p' overlay-group visibility so the global presentation toggle
    // ('V') and the per-overlay toggle ('p') both pick up the marker.
    g.visible = this.getSetting ? this.getSetting('p') : true
    bodyNode.add(g)
    bodyNode._tempMarker = g
  }


  /**
   * Dispose the SpriteSheet GPU resources for a body's temp marker and
   * detach it from the scene graph.  Optional-chains every dispose hop so
   * a child Object3D without geometry/material (e.g. test stubs) doesn't
   * throw — the cleanup is best-effort.
   *
   * @param {Object3D} bodyNode
   */
  _disposeTempMarker(bodyNode) {
    const g = bodyNode._tempMarker
    if (!g) {
      return
    }
    bodyNode.remove(g)
    const points = g.children[0]
    points?.geometry?.dispose?.()
    const mat = points?.material
    mat?.uniforms?.map?.value?.dispose?.()
    mat?.dispose?.()
    bodyNode._tempMarker = null
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
          const cbs = this._asterismsReadyCbs ?? []
          this._asterismsReadyCbs = null
          cbs.forEach((cb) => cb(asterisms))
        })
      })
      return
    }
    if (this.asterisms) {
      this.asterisms.visible = !this.asterisms.visible
      this._flipSetting('a')
    }
  }


  /**
   * The human expansion lines (ColonizationLines), added to the stars on
   * first use.  A scene annotation: shown per the 'x' setting, so 'x' and
   * the global 'V' both hide them.  See DESIGN.md "Overlays & visibility
   * groups".
   *
   * @returns {ColonizationLines|null} null until the stars are loaded
   */
  getColonization() {
    if (this.colonization === null && this.stars !== null) {
      this.colonization = new ColonizationLines()
      this.colonization.visible = this._settings.x
      this.stars.add(this.colonization)
    }
    return this.colonization
  }


  /** Remove the human expansion lines (its app stopped), freeing them. */
  removeColonization() {
    if (this.colonization) {
      this.colonization.dispose()
      this.colonization.removeFromParent()
      this.colonization = null
    }
  }


  /** Show or hide the human expansion lines ('x'). */
  toggleColonization() {
    this._flipSetting('x')
    if (this.colonization) {
      this.colonization.visible = this._settings.x
    }
    this.ui.useStore?.setState?.({isColonizationVisible: this._settings.x})
  }


  /**
   * Move the camera along its line to the target, as a zoom would.
   *
   * @param {number} lightYears Distance from the target
   */
  setCameraDistance(lightYears) {
    const {camera, controls} = this.ui
    const eye = camera.position.clone().sub(controls.target)
    if (eye.length() === 0) {
      return
    }
    eye.setLength(lightYears * Shared.LIGHTYEAR_METER)
    camera.position.copy(controls.target).add(eye)
    this.ui.onCameraChange?.()
  }


  /** */
  toggleOrbits() {
    Utils.visitSetProperty(this.objects['sun'], 'name', 'orbit', 'visible', this.orbitsVisible = !this.orbitsVisible)
    this._flipSetting('o')
  }


  /**
   * Toggle planet/moon name labels AND surface place labels.  Both belong
   * to the 'p' overlay group: planet names live in their own LOD object
   * named 'label LOD' (matched by visitToggleProperty); surface places
   * (cities, craters, landing sites) live as a `places` property on the
   * rotating planet Object3D, set in Planet.newPlanet.  Toggling them
   * together gives the user one knob for "all planet-related labels"
   * — and means the global 'V' presentation toggle hides them all
   * together too via this same method.  See DESIGN.md "Overlays &
   * visibility groups".
   */
  togglePlanetLabels() {
    Utils.visitToggleProperty(this.objects['sun'], 'name', 'label LOD', 'visible')
    for (const name of Object.keys(this.objects)) {
      const obj = this.objects[name]
      if (obj && obj.places && typeof obj.places.visible === 'boolean') {
        obj.places.visible = !obj.places.visible
      }
      // Dblclick-dropped lat/lng markers live in the same 'p' overlay group
      // as the named places — flip them together so the user has one knob.
      if (obj && obj._tempMarker && typeof obj._tempMarker.visible === 'boolean') {
        obj._tempMarker.visible = !obj._tempMarker.visible
      }
    }
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
   * Toggle the procedural Milky Way background.  Found by name traversal
   * since the Points mesh is created inside `newGalaxy()` and not pinned
   * to a Scene field.  Default-hidden by `enterAR()` (the additive bulge
   * particles flicker badly at AR sensor jitter scale); the user can flip
   * this back on with the 'U' shortcut once in AR.
   */
  toggleGalaxy() {
    let target = null
    this.ui.scene.traverse((obj) => {
      if (obj.name === 'MilkyWay') {
        target = obj
      }
    })
    if (target) {
      target.visible = !target.visible
      this._flipSetting('U')
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
    // The galaxy's children (the stars, and through them the asterisms and
    // star labels) are J2000 catalogues: they go in the stellarFrame, which
    // precesses them to the date.  The Sun is parented to worldGroup instead
    // (Scene.add).
    group.add(this.stellarFrame)
    this.objects[`${galaxyProps.name}.orbitPosition`] = this.stellarFrame
    // Procedural barred-spiral Milky Way as a background star cloud.  Built in
    // galactic-centre coords and translated so the Sun (world origin) lands on
    // a spiral arm.  Lives in worldGroup so star-navigation rebases shift it
    // along with everything else, keeping the universe coherent.
    this.stellarFrame.add(newMilkyWay())
    return group
  }
}
