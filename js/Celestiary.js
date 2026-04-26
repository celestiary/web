import * as THREE from 'three'
import Animation from './scene/Animation'
import ControlPanel from './ControlPanel'
import Keys from './Keys'
import Loader from './Loader'
import Scene from './scene/Scene'
import {searchIndex} from './search/SearchIndex'
import PlacesProvider from './search/providers/PlacesProvider'
import SceneProvider from './search/providers/SceneProvider'
import StarsProvider from './search/providers/StarsProvider'
import ThreeUi from './ThreeUI'
import Time, {fromJulianDay} from './Time'
import reifyMeasures from './reify'
import * as Shapes from './scene/shapes'
import * as Shared from './shared'
import {assertArgs} from './assert'
import {latLngAltToLocal, worldToLatLngAlt} from './coords'
import {decodePermalink, decodeSettings, encodePermalink, pathFromFragment} from './permalink'
import {elt} from './utils'


// Scene-annotation settings keys (see permalink.js SETTINGS_DEFAULTS).
// 'V' (Shift+v) toggles all of these together as a "presentation mode" —
// keys here are the lowercase per-overlay toggles ('a' asterisms, 'p'
// planet labels, etc.); the HTML chrome key 'v' is deliberately not in
// this list so users can hide overlays and chrome independently.
const SCENE_INFO_KEYS = ['a', 'l', 'p', 'o', 'e', 'c', 'g']


/** Main application class. */
export default class Celestiary {
  /**
   * @param {Element} store Zustand store for sharing application state
   * @param {Element} canvasContainer
   * @param {Element} navElt
   * @param {Function} setTimeStr
   * @param {Function} setIsPaused
   */
  constructor(useStore, canvasContainer, navElt, setTimeStr, setIsPaused) {
    assertArgs(...arguments)
    this.useStore = useStore
    this.time = new Time(setTimeStr)
    this.setIsPaused = setIsPaused
    this.animation = new Animation(this.time)
    canvasContainer.style.width = `${window.innerWidth}px`
    canvasContainer.style.height = `${window.innerHeight}px`
    const animCb = (scene) => {
      this.animation.animate(scene)
      if (Shared.targets.track) {
        this.scene.lookAtTarget()
      }
    }
    this.ui = new ThreeUi(canvasContainer, animCb)
    this.ui.configLargeScene()
    this.ui.useStore = useStore
    this.ui.onCameraChange = () => this._schedulePermalinkUpdate()
    this.camera = this.ui.camera
    this.scene = new Scene(this.ui)
    // Any settings toggle (asterisms, grids, etc.) updates the permalink so
    // the URL always reflects the live view configuration.
    this.scene.onSettingsChange = () => this._schedulePermalinkUpdate()
    // 'v' (nav panels) is a Celestiary-level toggle — register the applier
    // so Scene.applySettings can drive it on permalink restore.
    this.scene.registerSettingApplier('v', () => this._toggleNav())
    this.loader = new Loader()
    this.controlPanel = new ControlPanel(navElt, this.loader)
    this.firstTime = true
    this._pendingPermalink = null
    this._permalinkTimer = null
    this._registerSearchProviders()
    this._subscribePreview()
    this.load()
    this.setupPathListeners()
    this.setupKeyListeners(useStore)
    canvasContainer.addEventListener('mousedown', (e) => e.preventDefault())
    this.navVisible = true
    // these are here for convenience debugging from jsconsole.
    this.shared = Shared
    this.shapes = Shapes
    this.three = THREE
    this.toggleHelp = null
    window.c = this
  }


  /** @returns {string} */
  getTime() {
    if (this.time === null) {
      throw new Error('Null time')
    }
    return this.time
  }


  /**
   * Single re-entry point for info-panel rendering.  Fires whenever preview or
   * committed state changes.  Precedence: previewStar > previewPath >
   * committedPath.  Without this hub the navigation path would have to render
   * the panel directly (which it used to) AND the preview code would have its
   * own render path, making flicker-free transitions impossible.
   */
  _subscribePreview() {
    this.useStore.subscribe((state, prev) => {
      if (state.previewStar === prev.previewStar &&
          state.previewPath === prev.previewPath &&
          state.committedStar === prev.committedStar &&
          state.committedPath === prev.committedPath) {
        return
      }
      // Precedence: hovered/highlighted preview wins over committed selection;
      // within each level, star > body-path.
      if (state.previewStar) {
        this.controlPanel.showStarPreview(state.previewStar)
      } else if (state.previewPath && state.previewPath.length > 0) {
        this.controlPanel.showNavDisplay(state.previewPath)
      } else if (state.committedStar) {
        this.controlPanel.showStarPreview(state.committedStar)
      } else if (state.committedPath && state.committedPath.length > 0) {
        this.controlPanel.showNavDisplay(state.committedPath)
      }
    })
  }


  /**
   * Wire the app-wide search index.  SceneProvider and PlacesProvider are
   * ready immediately; StarsProvider registers once the star catalog
   * finishes async-loading (Stars.js sets `starsCatalog` on the store).
   */
  _registerSearchProviders() {
    searchIndex.register(new SceneProvider(this.loader))
    searchIndex.register(new PlacesProvider())
    // StarsCatalog mutates in place — after load, prev.starsCatalog and
    // state.starsCatalog are the same object (both already populated), so a
    // before/after numStars comparison always sees equal.  Track registration
    // with a local flag instead, and also try once immediately in case the
    // catalog was already populated before we subscribed.
    let registered = false
    const tryRegister = (cat) => {
      if (registered || !cat || !cat.numStars || cat.numStars <= 0) {
        return false
      }
      registered = true
      searchIndex.register(new StarsProvider(cat))
      searchIndex.invalidate()
      return true
    }
    if (tryRegister(this.useStore.getState().starsCatalog)) {
      return
    }
    const unsub = this.useStore.subscribe((state) => {
      if (tryRegister(state.starsCatalog)) {
        unsub()
      }
    })
  }


  /** */
  load() {
    let path
    const rawHash = location.hash ? location.hash.substring(1) : ''
    if (rawHash) {
      this._pendingPermalink = decodePermalink(rawHash)
      path = pathFromFragment(rawHash)
    } else {
      path = DEFAULT_TARGET
      location.hash = path
    }
    this.onLoad = (name, obj) => {
      reifyMeasures(obj)
      this.scene.add(obj)
    }
    this.onDone = (loadedPath, obj) => {
      const pathParts = loadedPath.split('/')
      // Updating committedPath fires the preview subscription (_subscribePreview)
      // which owns info-panel rendering; no direct showNavDisplay here.
      this.useStore.getState().setCommittedPath(pathParts)
      // TODO(pablo): Hack to handle load order.  The path is loaded,
      // but not yet animated so positions will be incorrect.  So
      // schedule this after the next pass.
      setTimeout(() => {
        const parts = loadedPath.split('/')
        let targetName = parts[parts.length - 1]
        if (targetName.indexOf('-') >= 0) {
          targetName = targetName.split('-')[0]
        }
        const pl = this._pendingPermalink
        this._pendingPermalink = null
        if (pl) {
          // Position planets at the saved time before goTo() orients the platform
          this.time.setTime(fromJulianDay(pl.d2000 + J2000_JD))
          this.animation.animateAtJD(this.ui.scene, this.time.simTimeJulianDay())
          this.ui.scene.updateMatrixWorld()
        }
        this.scene.targetNamed(targetName)
        this.scene.goTo()
        if (pl) {
          try {
            // scene.goTo() has already rebased WorldGroup + reparented the platform
            // to the target body, so lat/lng can resolve against the platform directly.
            this.ui.scene.updateMatrixWorld()
            const tObj = Shared.targets.cur
            const planetWorldPos = new THREE.Vector3()
            tObj.getWorldPosition(planetWorldPos)
            const planetWorldQuat = new THREE.Quaternion()
            tObj.getWorldQuaternion(planetWorldQuat)
            const platformWorldQuat = new THREE.Quaternion()
            this.ui.camera.platform.getWorldQuaternion(platformWorldQuat)
            const camPos = latLngAltToLocal(
                pl.lat, pl.lng, pl.alt, tObj.props.radius.scalar,
                planetWorldQuat, platformWorldQuat,
            )
            this.ui.camera.position.copy(camPos)
            this.ui.camera.quaternion.set(pl.quat.x, pl.quat.y, pl.quat.z, pl.quat.w)
            // Permalink restore takes precedence over any pending goTo animations.
            Shared.targets.tween = null
            Shared.targets.tweenNextFn = null
            this.ui.setFov(pl.fov)
          } catch (e) {
            console.error('Permalink restore failed:', e)
          }
        }
        if (this.firstTime) {
          // Apply scene settings — either from the permalink's `s=` flags
          // or the SETTINGS_DEFAULTS table.  applySettings is idempotent;
          // any setting already at its target state is a no-op, so this
          // does the equivalent of the old "toggleAsterisms / toggleStarLabels"
          // pair for a fresh viewer, and additionally honors the
          // permalink for returning users.
          const wantedSettings = pl?.settings ?? decodeSettings(undefined)
          this.scene.applySettings(wantedSettings)
          this.firstTime = false
        }
      }, this._pendingPermalink ? 0 : (this.firstTime ? 1000 : 0))
    }
    this.loader.loadPath('milkyway', this.onLoad, () => {
      this.loader.loadPath(path, this.onLoad, this.onDone, () => {
        // On error.
        setTimeout(() => {
          location.hash = DEFAULT_TARGET
        }, 1000)
      })
    })
  }


  /**
   * Travel to the current committed target.  Precedence: a committed star
   * (set via search or crosshair dblclick) wins over the planet target —
   * otherwise 'g' from a star-scoped body would always bounce back to the
   * last-set planet via the stale Shared.targets.obj.
   */
  goTo() {
    const state = this.useStore.getState()
    if (state.committedStar && state.committedStar.star) {
      this.scene.goTo(state.committedStar.star)
      return
    }
    const tObj = this.shared.targets.obj
    if (tObj) {
      if (tObj.props && tObj.props.name) {
        const path = this.loader.pathByName[tObj.props.name]
        if (path) {
          window.location.hash = path
        } else {
          console.error(`no loaded path for ${tObj.props.name}: ${path}`)
        }
      } else {
        console.error('target obj has no name prop: ', tObj)
      }
    } else {
      console.error('no target obj!')
    }
  }


  setupPathListeners() {
    window.addEventListener('hashchange', (e) => {
      const raw = (window.location.hash || '#').substring(1)
      const path = pathFromFragment(raw)
      this._pendingPermalink = decodePermalink(raw)
      this.loader.loadPath(path, this.onLoad, this.onDone)
    }, false)
  }


  /**
   * Wire up keyboard shortcuts.
   *
   * Keys.js dispatches case-sensitively, so 'v' and 'V' bind to different
   * actions.  We use the convention:
   *
   *   - lowercase letters         = scoped toggles (one specific overlay
   *                                 element each: 'a' asterisms, 'p'
   *                                 planet labels, etc.)
   *   - uppercase / Shift letters = "wider" actions affecting many things
   *                                 at once.
   *
   * The two relevant cases today:
   *
   *   - 'v' hides the HTML chrome only — the nav panel, the search bar,
   *     and the time / target heads-up text.  Scene annotations stay
   *     visible.
   *   - 'V' (Shift+v) is "presentation mode": hides every scene
   *     annotation (planet labels, star labels, asterisms, orbits, all
   *     reference grids) and snapshots their state so a second 'V' press
   *     restores exactly what the user had.  The HTML chrome is left
   *     alone — combine with 'v' for a fully bare view.
   *
   * The order of `k.map(...)` calls drives the Settings panel listing
   * order.
   */
  setupKeyListeners(useStore) {
    const k = new Keys(window, useStore)

    // Nav panels (HTML chrome only)
    k.map('v', () => this._toggleNav(),
        'Hide/show navigation panels (HTML overlay)')

    // Presentation mode — hide every scene annotation at once.
    k.map('V', () => this._toggleAllSceneInfo(),
        'Hide/show all scene annotations (labels, orbits, asterisms, grids)')

    // Scene elements
    k.map('a', () => {
      this.scene.toggleAsterisms()
    },
    'Show/hide constellations')
    k.map('p', () => {
      this.scene.togglePlanetLabels()
    },
    'Show/hide planet and moon names')
    k.map('s', () => {
      this.scene.toggleStarLabels()
    },
    'Show/hide star names')
    k.map('o', () => {
      this.scene.toggleOrbits()
    },
    'Show/hide orbits')
    k.map(';', () => {
      this.scene.toggleGridEquatorial()
    },
    'Show/hide equatorial reference grid')
    k.map('m', () => {
      const s = useStore.getState()
      const next = {auto: 'pan', pan: 'orbit', orbit: 'auto'}[s.dragMode] ?? 'auto'
      s.setDragMode(next)
    },
    'Cycle camera drag mode (Auto / Drag Pan / Move)')
    // No keys for ecliptic / galactic per Celestia convention; click-only
    // entries appear in Settings after the keyed shortcuts.
    k.addAction(() => {
      this.scene.toggleGridEcliptic()
    },
    'Show/hide ecliptic reference grid')
    k.addAction(() => {
      this.scene.toggleGridGalactic()
    },
    'Show/hide galactic reference grid')

    // Time
    k.map(' ', () => {
      this.setIsPaused(this.time.togglePause())
    },
    'Toggle time pause')
    k.map('\\', () => {
      this.time.changeTimeScale(0)
    },
    'Change time scale to real-time')
    k.map('!', () => {
      this.time.setTimeToNow()
    },
    'Set time to now')
    k.map('j', () => {
      this.time.invertTimeScale()
    },
    'Reverse time')
    k.map('k', () => {
      this.time.changeTimeScale(-1)
    },
    'Slow down time')
    k.map('l', () => {
      this.time.changeTimeScale(1)
    },
    'Speed up time')
    k.map('n', () => {
      this.time.setTimeToNow()
    },
    'Set time to now')

    // View
    k.map(',', () => {
      this.ui.multFov(0.9)
    },
    'Narrow field-of-vision')
    k.map('.', () => {
      this.ui.multFov(1.1)
    },
    'Broaden field-of-vision')
    k.map('/', () => {
      this.ui.resetFov()
    },
    `Reset field-of-vision to ${ Shared.INITIAL_FOV }º`)

    // Numbered views
    k.map('0', () => {
      this.scene.targetCurNode()
    },
    'Target current system')
    for (let i = 1; i <= 9; i++) {
      k.map(`${i}`, () => {
        const ndx = i
        this.scene.targetNode(ndx)
      },
      `Look at child ${i} of current system`)
    }
    k.map('c', () => {
      this.scene.lookAtTarget()
    },
    'Look at target')
    k.map('f', () => {
      this.scene.follow()
    },
    'Follow current node')
    k.map('g', () => {
      this.goTo()
    },
    'Go to target node')
    k.map('h', () => {
      // Just retarget — travel is 'g'.  setTarget syncs the store, which
      // clears committedStar so a stale "at Rigel" breadcrumb doesn't
      // linger after aiming back at the Sun.
      this.scene.targetNamed('sun')
    },
    'Set target to Sun (use "g" to travel)')
    k.map('t', () => {
      this.scene.track()
    },
    'Track target node')
    k.map('u', () => {
      this.scene.targetParent()
    },
    'Look at parent of current system')

    // Arrow keys use held-key logic in ThreeUI._initArrowKeys; no-op here for Settings listing.
    k.map('ArrowUp', () => {/* no-op */}, 'Pitch camera up (hold)')
    k.map('ArrowDown', () => {/* no-op */}, 'Pitch camera down (hold)')
    k.map('ArrowLeft', () => {/* no-op */}, 'Roll camera left (hold)')
    k.map('ArrowRight', () => {/* no-op */}, 'Roll camera right (hold)')
    k.msgs['MOUSEDRAG'] = 'Drag to pitch/yaw camera'
    k.msgs['ALT+MOUSEDRAG'] = 'Option+drag to orbit target'

    this.keys = k
  }


  /**
   * Single-source-of-truth toggle for the nav panels (heads-up display).
   * Used both by the 'v' keypress and by Scene.applySettings on permalink
   * restore — the latter goes through the applier registered in the
   * constructor, so the canonical _settings.v stays in sync.
   *
   * Uses `display: none` rather than `visibility: hidden` because the
   * SearchBar's CSS sets `visibility: visible` on chip icons, which would
   * override an ancestor's `visibility: hidden` and leak the search icon
   * back through.  `display: none` removes the elements from layout
   * entirely so descendants can't punch back through.
   */
  _toggleNav() {
    const panels = [elt('nav-id'), elt('top-right'), elt('search-bar')]
    panels.forEach((panel) => {
      if (panel) {
        panel.style.display = this.navVisible ? 'none' : ''
      }
    })
    this.navVisible = !this.navVisible
    this.scene.flipSetting('v')
  }


  /**
   * "Presentation mode" — hide every scene annotation in one shot, with
   * snapshot+restore so a second press brings the user's prior state back.
   *
   * The hidden keys are the per-overlay scene toggles: planet labels (p),
   * star labels (l), asterisms (a), orbits (o), and the three reference
   * grids (e, c, g).  HTML chrome ('v') is intentionally left alone —
   * users can combine with the 'v' key for a fully bare view.
   *
   * We snapshot only the relevant keys (not the whole settings map) so
   * unrelated state changes between the press pair don't get clobbered on
   * restore.
   */
  _toggleAllSceneInfo() {
    if (this._sceneInfoSnapshot) {
      const target = {...this.scene.getSettings(), ...this._sceneInfoSnapshot}
      this._sceneInfoSnapshot = null
      this.scene.applySettings(target)
      return
    }
    const cur = this.scene.getSettings()
    const snapshot = {}
    const target = {...cur}
    for (const key of SCENE_INFO_KEYS) {
      snapshot[key] = cur[key]
      target[key] = false
    }
    this._sceneInfoSnapshot = snapshot
    this.scene.applySettings(target)
  }


  /** Schedule a debounced permalink URL update 1 s after the camera settles. */
  _schedulePermalinkUpdate() {
    if (Shared.targets.tween !== null || !Shared.targets.cur) {
      return
    }
    clearTimeout(this._permalinkTimer)
    this._permalinkTimer = setTimeout(() => {
      const tObj = Shared.targets.cur
      if (!tObj?.props?.name || !tObj.props.radius?.scalar) {
        return
      }
      const path = this.loader.pathByName[tObj.props.name]
      if (!path) {
        return
      }
      const cam = this.ui.camera
      const camWorldPos = new THREE.Vector3()
      cam.getWorldPosition(camWorldPos)
      const planetWorldPos = new THREE.Vector3()
      tObj.getWorldPosition(planetWorldPos)
      const planetWorldQuat = new THREE.Quaternion()
      tObj.getWorldQuaternion(planetWorldQuat)
      const {lat, lng, alt} = worldToLatLngAlt(
          camWorldPos, planetWorldPos, planetWorldQuat, tObj.props.radius.scalar,
      )
      const d2000 = this.time.simTimeJulianDay() - J2000_JD
      const settings = this.scene.getSettings ? this.scene.getSettings() : null
      const fragment = encodePermalink(
          path, d2000, lat, lng, alt, cam.quaternion, cam.fov, settings)
      history.replaceState(null, '', `#${fragment}`)
    }, 1000)
  }


  /** */
  hideActiveDialog() {
    document.querySelectorAll('.dialog').forEach((e) => this.hideElt(e))
  }


  /** @param {Element} elt */
  hideElt(e) {
    e.style.display = 'none'
  }


  /**
   * @param {Element} elt
   * @returns {boolean} Iff showing
   */
  toggleEltDisplay(e) {
    if (e.style.display === 'block') {
      this.hideElt(elt)
      return false
    } else {
      this.hideActiveDialog()
      e.style.display = 'block'
      return true
    }
  }


  /** */
  hideHelpOnEscape() {
    const keysElt = elt('keys-id')
    keysElt.style.display = 'none'
  }
}


const DEFAULT_TARGET = 'sun'
const J2000_JD = 2451545.0
