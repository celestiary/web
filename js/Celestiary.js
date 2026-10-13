import * as THREE from 'three'
import ARController from './ar/ARController'
import Animation from './scene/Animation'
import Choreography, {READY_TIMEOUT_MS, REVEAL_AT} from './choreography'
import ControlPanel from './ControlPanel'
import Keys from './Keys'
import Loader from './Loader'
import Scene from './scene/Scene'
import TourDriver from './tourDriver'
import {searchIndex} from './search/SearchIndex'
import GalaxiesProvider from './search/providers/GalaxiesProvider'
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
import {
  decodePermalink, decodeSettings, decodeTimeToken, encodePermalink, encodeTimeToken, pathFromFragment, permalinkHref,
} from './permalink'
import {decodeAppTokens, encodeAppTokens} from './store/appTokens'
import {goToEntry} from './search/commitEntry'
import {HOME_HISTORY_KEY, isHomeEntry, isHomepage} from './home'
import {HOME_TOUR_LOOP_FADE_MS, HOME_TOUR_STILL_MS, homeTour} from './homeTour'
import {formatTonight, lowPrecisionSun, resolveLocation, tonightTime} from './tonight'
import {hideLoading} from './loading'
import {clampEv, stepEv} from './scene/evCompensation'
import {clampStarMag, stepStarMag} from './scene/starMagnitude'
import {fetchPlaces} from './scene/Places'
import {parseTargetPath, resolvePlace, slug, targetFramePath, targetPath} from './targetPath'
import {elt} from './utils'


// Scene-annotation settings keys (see permalink.js SETTINGS_DEFAULTS).
// 'V' (Shift+v) toggles all of these together as a "presentation mode" —
// keys here are the lowercase per-overlay toggles ('a' asterisms, 'p'
// planet labels, etc.); the HTML chrome key 'v' is deliberately not in
// this list so users can hide overlays and chrome independently.
const SCENE_INFO_KEYS = ['a', 'l', 'p', 'G', 'C', 'o', 'e', 'c', 'g', 'x']
// The HTML chrome's fade, ms: index.css's --fade-ms, and the scene's
// overlays' (scene/fade.js FADE_MS).
const CHROME_FADE_MS = 400
// The class on <html> that fades the chrome out (index.css).  The page
// starts with it (public/index.html), so the chrome is hidden from the first
// paint until the load's reveal shows it, or never, for a link with 'v' off.
const CHROME_HIDDEN_CLASS = 'chrome-hidden'
// The scene's fade in from black on the first load, ms, as the loading text
// fades out (public/index.html).
const SCENE_FADE_MS = 600
// Leaving the homepage for a link's view, or coming back to it: the canvas
// fades to black over this long, the view changes under it, and the scene
// fades in from black (SCENE_FADE_MS) once it's in.
const CUT_FADE_MS = 300
// The homepage's foreground fades out over the overlays' fade (FADE_MS) and
// is taken out of the page after this long.
const HOME_UNMOUNT_MS = 600
// The frame rate the homepage's tour is held to, to keep its cost down
// (ThreeUi.setFrameCap): a slow camera path doesn't need more.
const HOME_FRAME_CAP_FPS = 30
// Frames the tour draws, unseen, before the homepage's reveal (frame).
const HOME_SETTLE_FRAMES = 20
// Tonight's sky (openTonight): the field, wide, as the eye takes in the
// sky, and how high over the horizon it faces, toward the equator.
const TONIGHT_FOV_DEG = 70
const TONIGHT_ELEVATION_DEG = 50


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
    // The scene fills the window, less the widgets dock and, on a phone,
    // the drawer's sheet (setInsets).  Kept so on every resize, as a phone
    // rotates or its browser bars come and go.
    this._insets = {right: 0, bottom: 0}
    this._sizeContainer(canvasContainer)
    const animCb = (scene) => {
      this.animation.animate(scene)
      // Before tracking, so it faces the target from where the camera now is.
      this.scene.syncFollow()
      if (Shared.targets.track) {
        // Centre the target, whatever roll the view has.
        this.scene.lookAtTarget({keepRoll: true})
      }
      this.frame(performance.now())
    }
    this.ui = new ThreeUi(canvasContainer, animCb)
    // The scene is shown when it's in, by the first load's reveal.
    this.ui.holdCanvas()
    window.addEventListener('resize', () => this._layout())
    this.ui.layers.time = this.time
    this.ui.configLargeScene()
    this.ui.useStore = useStore
    this.ui.onCameraChange = () => this._schedulePermalinkUpdate()
    this.camera = this.ui.camera
    this.scene = new Scene(this.ui)
    this.scene.onLabelDblClick = (label) => this.goToLabel(label)
    // The link names the target (targetPath.js), so a new one rewrites it.
    this.scene.onTargetChange = () => this._schedulePermalinkUpdate()
    // Any settings toggle (asterisms, grids, etc.) updates the permalink so
    // the URL always reflects the live view configuration.
    this.scene.onSettingsChange = () => this._schedulePermalinkUpdate()
    // 't' and 'f' say what they switched, on the readout (onNavMode).
    this.scene.onModeChange = (mode, on, note) => this._announce(this._navModeListeners, mode, on, note)
    // 'v' (nav panels) is a Celestiary-level toggle — register the applier
    // so Scene.applySettings can drive it on permalink restore.
    this.scene.registerSettingApplier('v', () => this._toggleNav())
    this.loader = new Loader()
    this.controlPanel = new ControlPanel(navElt, this.loader)
    this.firstTime = true
    this._permalinkTimer = null
    // Hear of a change of the exposure compensation (onExposureCompensation).
    this._evListeners = new Set
    // And of the stars' setting (onStarMagnitude).
    this._starMagListeners = new Set
    // And of tracking and following being switched (onNavMode).
    this._navModeListeners = new Set
    // And of what tonight's sky used (onNotice).
    this._noticeListeners = new Set
    // While a link is put back: what it restores (tracking, following, the
    // exposure, the stars' setting) isn't announced on the readout, which
    // is for what the user does (_announce).
    this._restoring = false
    // The link holds the clock's pause, rate and date.
    this.time.onTimeScaleChange(() => this._schedulePermalinkUpdate())
    // Callbacks waiting for a body to load, by name (_loadBody).
    this._bodyWaiters = {}
    // AR (mobile sky-view).  Constructed lazily — most users won't enter
    // AR mode, and the controller has no per-frame cost when inactive
    // (ThreeUI.renderLoop checks isActive() before calling updateFrame).
    this.ar = new ARController({
      scene: this.scene,
      ui: this.ui,
      time: this.time,
      useStore: useStore,
    })
    this.ui.arController = this.ar
    this._registerSearchProviders()
    this._subscribePreview()
    // The widgets drawer and its apps are in the permalink too.
    this.useStore.subscribe((state, prev) => {
      if (state.widgets !== prev.widgets) {
        this._schedulePermalinkUpdate()
      }
    })
    // The chrome ('v'), hidden from the first paint (CHROME_HIDDEN_CLASS)
    // until the reveal; _setNav fades it.
    this.navVisible = false
    this._chromeRevealed = false
    this._navShowPending = false
    this._navHideAt = null
    // The homepage (home.js; DESIGN.md "Homepage"): the bare URL, no
    // fragment and no path.  A tour of the live scene plays behind it
    // (tourDriver.js), still for prefers-reduced-motion.
    this.homeShown = isHomepage(location, document.baseURI)
    this.homePhase = 'hidden'
    this.tour = new TourDriver({scene: this.scene, ui: this.ui, time: this.time, quietly: (fn) => this._quietly(fn)})
    // Steps on the frame clock while leaving the homepage or coming back.
    this._homeSteps = null
    // A cut to a link's view, waiting for it to arrive (_frameCut).
    this._cut = null
    // How many times the camera has been placed (_arrive), for _frameCut.
    this._arrivals = 0
    // Back to the homepage, waiting for its tour to settle (_frameHomeReturn).
    this._homeReturning = false
    // What to say on the readout once a cut's view shows (_landTonight).
    this._pendingNotice = null
    // The link's scene settings (`s=`), or the defaults, decided before
    // anything is built, so each overlay is built shown or hidden as the link
    // says and what it hides is never drawn (design/URLs.md, "Reading and
    // writing").  The overlays it shows are held back for the reveal.
    this.scene.initSettings(linkSettings(location.hash), {hold: true})
    // The first load's sequence (choreography.js), from when the camera is
    // placed (_arrive) and the scene is in (ThreeUi.sceneReady).
    this._arrivedAt = null
    // On the homepage the scene comes in under its title, the tour starts,
    // and the overlays and the chrome wait until it's left (leaveHome).
    this._reveal = new Choreography([
      {at: REVEAL_AT.loading, run: () => {
        if (this.homeShown) {
          // The page's loading title becomes the homepage's (ui/Homepage).
          this._setHomePhase('in')
          this.tour.play()
        } else {
          hideLoading()
        }
        this.ui.showCanvas(SCENE_FADE_MS)
      }},
      ...this._overlaySteps(0, () => !this.homeShown),
    ])
    if (this.homeShown) {
      this._setHomePhase('waiting')
      this._homeCost(true)
    }
    this.load()
    this.setupPathListeners()
    this.setupKeyListeners(useStore)
    canvasContainer.addEventListener('mousedown', (e) => e.preventDefault())
    // A click, a drag or the wheel on the scene leaves the homepage for it.
    const leaveForScene = () => {
      if (this.homeShown) {
        this.leaveHome()
      }
    }
    canvasContainer.addEventListener('pointerdown', leaveForScene)
    canvasContainer.addEventListener('wheel', leaveForScene, {passive: true})
    // these are here for convenience debugging from jsconsole.
    this.shared = Shared
    this.shapes = Shapes
    this.three = THREE
    this.toggleHelp = null
    window.c = this
  }


  /**
   * Set the user's exposure compensation, in stops over the metered
   * exposure (ThreeUi.setExposureCompensation): the keys' and the link's
   * (`ev=`).  A change is announced to the readout (onExposureCompensation)
   * and written to the link.
   *
   * @param {number} ev Stops, held to the range
   */
  setExposureCompensation(ev) {
    const next = clampEv(ev)
    if (next === this.ui.exposureCompensation()) {
      return
    }
    this.ui.setExposureCompensation(next)
    this._announce(this._evListeners, next)
    this._schedulePermalinkUpdate()
  }


  /** @param {number} steps Thirds of a stop; positive for brighter */
  stepExposureCompensation(steps) {
    this.setExposureCompensation(stepEv(this.ui.exposureCompensation(), steps))
  }


  /**
   * Set the stars' setting (`[` and `]`; starMagnitude.js): magnitudes over
   * the naked eye's limit, 0 by default.  A change is announced to the
   * readout (onStarMagnitude) and written to the link.
   *
   * @param {number} mag Magnitudes, held to the range
   */
  setStarMagnitude(mag) {
    const next = clampStarMag(mag)
    if (next === this.ui.starMagnitudeOffset()) {
      return
    }
    this.ui.setStarMagnitudeOffset(next)
    this._announce(this._starMagListeners, next)
    this._schedulePermalinkUpdate()
  }


  /** @param {number} steps Half magnitudes; positive for more stars */
  stepStarMagnitude(steps) {
    this.setStarMagnitude(stepStarMag(this.ui.starMagnitudeOffset(), steps))
  }


  /**
   * @param {Function} fn Called with the new setting, magnitudes, on a change
   * @returns {Function} Stops listening
   */
  onStarMagnitude(fn) {
    this._starMagListeners.add(fn)
    return () => this._starMagListeners.delete(fn)
  }


  /**
   * @param {Function} fn Called with the mode ('track' or 'follow'),
   *   whether it is on and, when 'f' couldn't turn following off, why
   *   ('root', 'landed'), when 't' or 'f' (or a link) switches it
   * @returns {Function} Stops listening
   */
  onNavMode(fn) {
    this._navModeListeners.add(fn)
    return () => this._navModeListeners.delete(fn)
  }


  /**
   * @param {Function} fn Called with the new compensation, stops, on a change
   * @returns {Function} Stops listening
   */
  onExposureCompensation(fn) {
    this._evListeners.add(fn)
    return () => this._evListeners.delete(fn)
  }


  /**
   * Tell a readout's listeners of a change, unless a link is being put back
   * (`_restoring`): only what the user does is announced.
   *
   * @param {Set<Function>} listeners
   * @param {...any} args
   */
  _announce(listeners, ...args) {
    if (!this._restoring) {
      listeners.forEach((fn) => fn(...args))
    }
  }


  /**
   * Run part of a link's restore without announcing what it sets (_announce).
   *
   * @param {Function} fn
   */
  _quietly(fn) {
    const was = this._restoring
    this._restoring = true
    try {
      fn()
    } finally {
      this._restoring = was
    }
  }


  /**
   * Each frame, from the animation callback: the first load's reveal, once
   * the scene is in; the overlays' fades; the chrome's.
   *
   * @param {number} nowMs
   */
  frame(nowMs) {
    // The homepage's tour first: the reveal waits for its target's surface.
    this.tour.frame(nowMs)
    const reveal = this._reveal
    if (!reveal.done) {
      // The homepage's tour starts by the Sun: some frames first, so the
      // meter has stopped down for its disc before it's seen.
      const settled = !this.homeShown || this.tour.frames >= HOME_SETTLE_FRAMES
      if (!reveal.started && this._arrivedAt !== null &&
          ((settled && this.ui.sceneReady()) || nowMs - this._arrivedAt >= READY_TIMEOUT_MS)) {
        reveal.start(nowMs)
      }
      reveal.frame(nowMs)
    }
    if (this._homeSteps && !this._homeSteps.done) {
      this._homeSteps.start(nowMs)
      this._homeSteps.frame(nowMs)
    }
    this._frameCut(nowMs)
    this._frameHomeReturn()
    this.scene.overlays.tick(nowMs)
    this._frameNav(nowMs)
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
          state.previewGalaxy === prev.previewGalaxy &&
          state.committedStar === prev.committedStar &&
          state.committedPath === prev.committedPath &&
          state.committedGalaxy === prev.committedGalaxy) {
        return
      }
      // Precedence: hovered/highlighted preview wins over committed selection;
      // within each level, galaxy > star > body-path.
      if (state.previewGalaxy) {
        this.controlPanel.showGalaxyPreview(state.previewGalaxy, this.scene.galaxies)
      } else if (state.previewStar) {
        this.controlPanel.showStarPreview(state.previewStar)
      } else if (state.previewPath && state.previewPath.length > 0) {
        this.controlPanel.showNavDisplay(state.previewPath)
      } else if (state.committedGalaxy) {
        this.controlPanel.showGalaxyPreview(state.committedGalaxy, this.scene.galaxies)
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
    // SPARC's galaxies, once their catalogue is in (Galaxies.md).
    this.scene.onGalaxiesReady((galaxies) => {
      searchIndex.register(new GalaxiesProvider(galaxies))
      searchIndex.invalidate()
    })
    this._placesProvider = new PlacesProvider(this.loader)
    searchIndex.register(this._placesProvider)
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


  /**
   * Load the scene for the link in the location hash, or the Sun.  The
   * drawer and its apps are restored here, on the first load only.
   */
  load() {
    this.onLoad = (name, obj) => {
      reifyMeasures(obj)
      this.scene.add(obj)
      const waiters = this._bodyWaiters[name]
      if (waiters) {
        delete this._bodyWaiters[name]
        waiters.forEach((cb) => cb())
      }
    }
    if (this.homeShown) {
      // The bare URL stays bare: its history entry is marked as the
      // homepage's, and the tour places the camera once the Sun and Earth
      // are in.
      history.replaceState?.({...(history.state ?? {}), [HOME_HISTORY_KEY]: true}, '')
      this.loader.loadPath('milkyway', this.onLoad, () => {
        this._loadBody('sun/earth', () => this._startTour())
      })
      return
    }
    const rawHash = location.hash ? location.hash.substring(1) : ''
    if (rawHash) {
      // The drawer and its apps, as the link left them (design/URLs.md).
      // On first load only, as the scene settings.  Each app restores its
      // own state from its entry here, waiting for what it needs (the
      // stars, for the Human Expansion app).
      const widgets = decodeAppTokens(decodePermalink(rawHash)?.tokens)
      if (widgets) {
        this.useStore.getState().dispatchWidgets({type: 'restore', widgets})
      }
    } else {
      location.hash = DEFAULT_TARGET
    }
    this.loader.loadPath('milkyway', this.onLoad, () => {
      this._navigate(rawHash || DEFAULT_TARGET, () => {
        // On error.
        setTimeout(() => {
          location.hash = DEFAULT_TARGET
        }, 1000)
      })
    })
  }


  /**
   * Follow a link (design/URLs.md): its path is the target (targetPath.js),
   * and the view, if it has one, is the camera in its frame (`from=`, else
   * the target's body).
   *
   * - With a view (`@…;t=…;cq=…`): the time is set, the camera is put back
   *   in its frame where the link had it, and the target is set without
   *   turning the camera, so the page shows what the link's did.
   * - A path alone goes to the target: a body flies there, a place lands,
   *   a star travels, an asterism turns to face it (from the Sun).
   *
   * @param {string} raw The hash, without its '#'
   * @param {Function} [onErr] Called if the path doesn't load
   */
  _navigate(raw, onErr) {
    const pl = decodePermalink(raw)
    const ref = parseTargetPath(pathFromFragment(raw))
    if (!ref) {
      onErr?.()
      return
    }
    this._resolveRef(ref, (resolved) => {
      const framePath = pl?.from ?? REF_FRAME[resolved.kind](resolved)
      this._loadFrame(framePath, (frame) => {
        // TODO(pablo): Hack to handle load order.  The path is loaded,
        // but not yet animated so positions will be incorrect.  So
        // schedule this after the next pass.
        setTimeout(() => this._arrive(pl, frame, resolved), pl ? 0 : (this.firstTime ? 1000 : 0))
      }, onErr)
    }, onErr)
  }


  /**
   * Put the camera in its frame, where the link had it or travelling to
   * the target, then set the target.
   *
   * @param {?object} pl The decoded link, or null for a path alone
   * @param {{kind: string, name?: string, star?: object}} frame The body or
   *   star the camera is at (_loadFrame)
   * @param {object} resolved The target's path, resolved (_resolveRef)
   */
  _arrive(pl, frame, resolved) {
    if (pl) {
      // Position planets at the saved time before goTo() orients the platform
      this.time.setTime(fromJulianDay(pl.d2000 + J2000_JD))
      this._restoreClock(pl)
      this.animation.animateAtJD(this.ui.scene, this.time.simTimeJulianDay())
      this.ui.scene.updateMatrixWorld()
      // What the link restores (going there turns following on, the
      // exposure, the stars' setting, tracking, following) is put back
      // quietly: the readout is for what the user does.
      this._quietly(() => {
        try {
          this._restoreView(pl, frame)
        } catch (e) {
          console.error('Permalink restore failed:', e)
        }
      })
      this._resolveTarget(resolved, (target) => this._quietly(() => {
        this.scene.setTarget(target, {look: false})
        // Tracking and following are on top of the target, so they follow it.
        this.scene.setTracking(pl.settings.T)
        // Following is of the camera's frame: on if the link says (`F`), or
        // if the frame is the target's own body, which is how links before
        // `F` rode (design/URLs.md).
        const ownFrame = frame.kind !== 'star' && frame.kind !== 'galaxy' &&
          (!pl.from || pl.from === REF_FRAME[resolved.kind](resolved))
        this.scene.restoreFollowing(pl.settings.F || ownFrame)
      }))
    } else {
      // Opening the page on a path: going there (and the following it turns
      // on) is the page's start, not news for the readout.  Later paths are
      // the user's ('g', a click).
      const quiet = this.firstTime ? (fn) => this._quietly(fn) : (fn) => fn()
      quiet(() => this._goToResolved(resolved, frame, quiet))
    }
    // The scene settings were applied before anything was built
    // (initSettings, in the constructor), not here, after the scene had
    // drawn with the defaults.  The reveal waits for the camera.
    this.firstTime = false
    this._arrivedAt ??= performance.now()
    this._arrivals++
    // AR-fallback resolution: if the permalink was captured in AR
    // mode (s=A), try to re-enter AR at the saved lat/lng.
    // Best-effort — on iOS Safari `requestPermission()` requires a
    // user gesture, so this auto-attempt rejects silently and the
    // user can tap the AR button (which is a real gesture) to enter.
    if (pl?.settings?.A && typeof pl.lat === 'number' && typeof pl.lng === 'number') {
      this.ar?.enter({lat: pl.lat, lng: pl.lng, alt: pl.alt}).catch(() => {
        // Silent — sensor unavailability or permission denial just
        // leaves the static permalink view as the visible result.
      })
    }
  }


  /**
   * Put the camera back where a link had it, in its frame, with no
   * animation: the inverse of `permalink()`.
   *
   * @param {object} pl The decoded link
   * @param {{kind: string, name?: string, star?: object}} frame
   */
  _restoreView(pl, frame) {
    const camera = this.ui.camera
    if (frame.kind === 'star' || frame.kind === 'galaxy') {
      // The platform at the star or galaxy, the world rebased so it's at
      // the origin (Scene.goTo); its frame's axes are the scene's.
      const point = frame.star ?? frame.galaxy
      this.scene.goTo(point)
      this.ui.scene.updateMatrixWorld()
      const starWorldPos = this.scene.worldGroup.localToWorld(this.scene.starPosition(point))
      const platformWorldQuat = camera.platform.getWorldQuaternion(new THREE.Quaternion())
      camera.position.copy(latLngAltToLocal(
          pl.lat, pl.lng, pl.alt, point.radius, new THREE.Quaternion(), platformWorldQuat))
          .add(camera.platform.worldToLocal(starWorldPos))
      camera.quaternion.set(pl.quat.x, pl.quat.y, pl.quat.z, pl.quat.w).normalize()
    } else if (pl.settings?.L) {
      // Landed restore: reparent to the rotating body, snap to the
      // saved lat/lng/alt, then overwrite quaternion to recover the
      // saved look direction.  Skips the orbit-style restore below
      // because that path leaves the camera in an orbit-relative
      // frame, but landed cq is body-relative.
      this.scene.land(frame.name, pl.lat, pl.lng, pl.alt, {instant: true})
      camera.quaternion.set(pl.quat.x, pl.quat.y, pl.quat.z, pl.quat.w).normalize()
    } else {
      // Orbit-style restore: scene.goTo() rebases WorldGroup and
      // reparents the platform to the frame body, so lat/lng resolve
      // against the platform directly.
      this.scene.setTarget(frame.name, {look: false})
      this.scene.goTo()
      this.ui.scene.updateMatrixWorld()
      const tObj = this.scene.objects[frame.name]
      const planetWorldQuat = tObj.getWorldQuaternion(new THREE.Quaternion())
      const platformWorldQuat = camera.platform.getWorldQuaternion(new THREE.Quaternion())
      camera.position.copy(latLngAltToLocal(
          pl.lat, pl.lng, pl.alt, tObj.props.radius.scalar, planetWorldQuat, platformWorldQuat))
      camera.quaternion.set(pl.quat.x, pl.quat.y, pl.quat.z, pl.quat.w).normalize()
    }
    // Permalink restore takes precedence over any pending goTo animations.
    Shared.targets.tween = null
    Shared.targets.tweenNextFn = null
    this.ui.setFov(pl.fov)
    this.setExposureCompensation(pl.ev)
    this.setStarMagnitude(pl.sm)
  }


  /**
   * Put the clock back as a link had it: paused or running, and at its
   * rate (the `time:` token; none is running at real time).  The date is
   * set already.  A link restores the clock whole, as it does `ev=`: one
   * without the token runs at real time.
   *
   * @param {object} pl The decoded link
   */
  _restoreClock(pl) {
    const {paused, rate} = decodeTimeToken(pl.tokens.time)
    this.time.setRate(rate)
    this.time.setPaused(paused)
    // The time panel's React state.
    this.setIsPaused(this.time.isPaused)
  }


  /**
   * A path alone: go to its target, as 'g' would.
   *
   * @param {object} resolved The target's path, resolved (_resolveRef)
   * @param {{kind: string, name?: string, star?: object}} frame
   * @param {Function} [quiet] Runs the steps that come later (a place's
   *   catalogue loaded) as the first is run: quietly on opening the page
   */
  _goToResolved(resolved, frame, quiet = (fn) => fn()) {
    if (resolved.kind === 'star') {
      this.scene.goTo(frame.star)
      return
    }
    if (resolved.kind === 'galaxy') {
      this.scene.goTo(frame.galaxy)
      return
    }
    if (resolved.kind === 'place') {
      this._resolveTarget(resolved, (place) => quiet(() => {
        this.scene.land(place.body, place.lat, place.lng, place.alt, {target: place})
      }), () => quiet(() => {
        // Not in the catalogue: go to its body.
        this.scene.setTarget(resolved.body)
        this.scene.goTo()
      }))
      return
    }
    this.scene.setTarget(frame.name)
    this.scene.goTo()
    if (resolved.kind === 'asterism') {
      // From the Sun, turn to face it once there.
      this._resolveTarget(resolved, (asterism) => {
        this.scene.setTarget(asterism, {look: false})
        Shared.targets.tweenNextFn = () => {
          this.scene.lookAtLabel(asterism)
          return Shared.targets.tween
        }
      })
    }
  }


  /**
   * Resolve a parsed path (targetPath.js parseTargetPath) far enough to
   * load: a body path's last segment is a body or a place (resolvePlace),
   * which needs the body above it loaded.  The target's body is loaded.
   *
   * @param {object} ref As parseTargetPath gives
   * @param {Function} cb Called with {kind: 'body', path, name},
   *   {kind: 'place', path, body, slug}, {kind: 'star', hipId} or
   *   {kind: 'asterism', slug}
   * @param {Function} [onErr]
   */
  _resolveRef(ref, cb, onErr) {
    if (ref.kind !== 'bodies') {
      cb(ref)
      return
    }
    const resolved = resolvePlace(ref.parts, this.loader.loaded)
    if (resolved) {
      this._loadBody(resolved.path, () => cb(resolved), onErr)
      return
    }
    this._loadBody(ref.parts.slice(0, -1).join('/'), () => this._resolveRef(ref, cb, onErr), onErr)
  }


  /**
   * @param {string} framePath A body's path, or a star's (`hip:N`)
   * @param {Function} cb Called with {kind: 'body', name} or
   *   {kind: 'star', star} once it's loaded
   * @param {Function} [onErr]
   */
  _loadFrame(framePath, cb, onErr) {
    const ref = parseTargetPath(framePath)
    if (ref?.kind === 'star') {
      this._whenStar(ref.hipId, (star) => cb({kind: 'star', star}), onErr)
      return
    }
    if (ref?.kind === 'galaxy') {
      this._whenGalaxy(ref.id, (galaxy) => cb({kind: 'galaxy', galaxy}), onErr)
      return
    }
    if (ref?.kind !== 'bodies') {
      onErr?.()
      return
    }
    this._loadBody(framePath, () => cb({kind: 'body', name: sceneName(ref.parts[ref.parts.length - 1])}), onErr)
  }


  /**
   * Load a body by its path, and call back once it's in the scene: now if
   * it is.  Waits on `onLoad` for it, rather than on the loader's done
   * callback, which never comes for a body another load already has in
   * flight.
   *
   * @param {string} path e.g. 'sun/earth'
   * @param {Function} cb
   * @param {Function} [onErr]
   */
  _loadBody(path, cb, onErr) {
    const name = path.split('/').pop()
    if (typeof this.loader.loaded[name] === 'object') {
      cb()
      return
    }
    (this._bodyWaiters[name] ??= []).push(cb)
    this.loader.loadPath(path, this.onLoad, () => {/* waited on in onLoad */}, onErr)
  }


  /**
   * @param {number} hipId
   * @param {Function} cb Called with the catalogue star once the stars load
   * @param {Function} [onErr] Called if there's no such star
   */
  _whenStar(hipId, cb, onErr) {
    this.scene.onStarsReady(() => this.scene.stars.onCatalogReady(() => {
      const star = this.scene.stars.catalog.starByHip.get(hipId)
      if (star) {
        cb(star)
      } else {
        console.warn(`No star HIP ${hipId}`)
        onErr?.()
      }
    }))
  }


  /**
   * @param {string} id A galaxy's id (targetPath.js: 'ngc2403')
   * @param {Function} cb Called with its record once the galaxies load
   * @param {Function} [onErr] Called if there's no such galaxy
   */
  _whenGalaxy(id, cb, onErr) {
    this.scene.onGalaxiesReady((galaxies) => {
      const galaxy = galaxies.galaxy(id)
      if (galaxy) {
        cb(galaxy)
      } else {
        console.warn(`No galaxy ${id}`)
        onErr?.()
      }
    })
  }


  /**
   * The target a resolved path names, as Scene.setTarget takes it, once
   * what it needs has loaded: a place's catalogue, the stars, the
   * asterisms (never, while 'a' has been off from the start).
   *
   * @param {object} resolved As _resolveRef gives
   * @param {Function} cb Called with the target
   * @param {Function} [onMissing] Called if it isn't in its catalogue
   */
  _resolveTarget(resolved, cb, onMissing) {
    switch (resolved.kind) {
      case 'body':
        cb(sceneName(resolved.name))
        return
      case 'place':
        fetchPlaces(resolved.body).then((places) => {
          const e = places.find((p) => slug(p.n) === resolved.slug)
          if (e) {
            cb({kind: 'place', body: resolved.body, name: e.n, lat: e.lat, lng: e.lng, alt: e.a ?? undefined})
          } else {
            console.warn(`No place ${resolved.slug} on ${resolved.body}`)
            onMissing?.()
          }
        })
        return
      case 'star':
        this._whenStar(resolved.hipId, (star) => cb({kind: 'star', star}), onMissing)
        return
      case 'galaxy':
        this._whenGalaxy(resolved.id, (galaxy) => cb({kind: 'galaxy', galaxy, name: galaxy.name}), onMissing)
        return
      case 'asterism':
        this.scene.onAsterismsReady((asterisms) => {
          const t = asterisms.targetNamed(resolved.slug)
          if (t) {
            cb(t)
          } else {
            console.warn(`No asterism ${resolved.slug}`)
            onMissing?.()
          }
        })
        return
      default:
        onMissing?.()
    }
  }


  /**
   * Go to what a label names: the double click or tap (Scene.onDblClick),
   * and 'g' on a targeted place or asterism.  As the search's Go does
   * (goToEntry): a body by its path, a star by scene.goTo, committed, a
   * place by landing there.  An asterism is a direction, not a place to
   * arrive at, so going to it turns the camera to face it.
   *
   * @param {{kind: string, name: string, star?: object}} label A labelPick.js target
   */
  goToLabel(label) {
    if (label.kind === 'asterism') {
      this.scene.lookAtLabel(label)
      return
    }
    if (label.kind === 'place') {
      this.scene.land(label.body, label.lat, label.lng, label.alt, {target: label})
      return
    }
    if (label.kind === 'galaxy') {
      this.scene.goTo(label.galaxy, label.name)
      return
    }
    goToEntry(label.kind === 'star' ?
      {kind: 'star', displayName: label.name, payload: {star: label.star, hipId: label.star.hipId}} :
      {kind: 'body', displayName: label.name, payload: {name: label.name}}, this)
  }


  /**
   * Travel to the current target ('g'): a place, star or asterism
   * (`Shared.targets.label`) as a double click on its label does, a body
   * by its path.
   */
  goTo() {
    const label = this.shared.targets.label
    if (label) {
      this.goToLabel(label)
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
    window.addEventListener('hashchange', () => {
      const raw = (window.location.hash || '#').substring(1)
      if (this.homeShown) {
        // A link opened from the homepage (Forward, the search's Go to a
        // body): leave it for there.  Back to the homepage has none.
        if (raw) {
          this.leaveHome({link: raw})
        }
        return
      }
      this._navigate(raw)
    }, false)
    // Back to the homepage's entry shows it again (design/URLs.md).
    window.addEventListener('popstate', (e) => this._onPopState(e.state))
    // Esc leaves the homepage for the live scene.
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.homeShown) {
        this.leaveHome()
      }
    })
  }


  /**
   * @param {?object} state The history entry's
   */
  _onPopState(state) {
    if (isHomeEntry(state) && isHomepage(location, document.baseURI)) {
      this.showHome()
    }
  }


  /**
   * Start the homepage's tour: held at its start (or its still, for
   * prefers-reduced-motion) until the reveal plays it.  The camera is
   * placed by its first frame (TourDriver.frame), and the page has arrived.
   */
  _startTour() {
    if (!this.homeShown) {
      return
    }
    this.tour.start(homeTour(), {
      still: prefersReducedMotion() ? HOME_TOUR_STILL_MS : null,
      loopFadeMs: HOME_TOUR_LOOP_FADE_MS,
    })
    this.firstTime = false
    this._arrivedAt ??= performance.now()
  }


  /**
   * Leave the homepage: the tour stops where it is, the foreground fades
   * out, and the overlays and the chrome come in as on a first load
   * (REVEAL_AT).  With a link, go there: a view (a card's, Forward) cuts to
   * it under black, by the app's own restore (_navigate); a path (the
   * search's Go) travels there from where the tour was.
   *
   * @param {object} [opts]
   * @param {?string} [opts.link] A fragment to open, without its '#'
   * @param {boolean} [opts.write] Without a link, write the view to the
   *   address bar now, as a new history entry, so Back returns to the
   *   homepage (what follows a search writes its own)
   * @returns {boolean} Whether it was showing
   */
  leaveHome({link = null, go = null, write = true} = {}) {
    if (!this.homeShown) {
      return false
    }
    this.homeShown = false
    this._homeReturning = false
    this.tour.stop()
    this._homeCost(false)
    this._setHomePhase('out')
    this.useStore.getState().closeSearch?.()
    this._cut = null
    const unmount = {at: HOME_UNMOUNT_MS, run: () => this._setHomePhase('hidden')}
    const pl = link ? decodePermalink(link) : null
    if (pl) {
      // The link's scene settings, as opening it would have set them, held
      // for the reveal; the HUD stays as it is, for a visitor arriving
      // from the homepage.
      this.scene.initSettings({...pl.settings, v: this.scene.getSetting('v')}, {hold: true})
    }
    const cutTo = go ?? (pl ? () => this._navigate(link) : null)
    if (!this._reveal.started) {
      // Left before the scene was in: the first load's reveal shows it all.
      this._homeSteps = new Choreography([unmount])
      if (go) {
        go()
      } else if (link) {
        this._navigate(link)
      }
      return true
    }
    if (cutTo) {
      this._cutTo(cutTo, [unmount])
      return true
    }
    this._homeSteps = new Choreography([unmount, ...this._overlaySteps(0)])
    if (link) {
      this._navigate(link)
    } else if (write) {
      const fragment = this.permalink()
      if (fragment) {
        this._writeLink(fragment)
      }
    }
    return true
  }


  /**
   * Cut to another view under black: the canvas fades out, `go` moves the
   * camera, and once it's placed (_arrivals) and the scene is in, the
   * canvas fades in and the overlays and the chrome follow (_frameCut).
   *
   * @param {Function} go Places the camera: a link's restore, a landing
   * @param {Array<object>} [steps] Others to run alongside, from now
   */
  _cutTo(go, steps = []) {
    this.ui.dimCanvas(CUT_FADE_MS)
    this._homeSteps = new Choreography([...steps, {at: CUT_FADE_MS, run: () => {
      this._cut = {arrivals: this._arrivals, since: performance.now()}
      go()
    }}])
  }


  /**
   * The homepage's "Tonight's sky" card (tonight.js): the visitor's sky
   * from the ground where they are, now if it's night, else at this
   * evening's astronomical dusk.  Their location is asked for here, on the
   * click, never on load; refused or unavailable, their time zone's city,
   * else Greenwich.  The readout says which.
   *
   * @param {object} [sources] For the tests: resolveLocation's
   * @returns {Promise<{where: object, when: object}>}
   */
  async openTonight(sources = {}) {
    const where = await resolveLocation(sources)
    const sunAt = this.animation.vsopReady() ? (jd) => {
      const e = this.animation.vsopAt(jd).earth
      return {x: -e.x, y: -e.y, z: -e.z}
    } : lowPrecisionSun
    const when = tonightTime(where.lat, where.lng, Date.now(), sunAt)
    // The app's defaults for the overlays and labels; the HUD as it is.
    this.scene.initSettings({...decodeSettings(undefined), v: this.scene.getSetting('v')}, {hold: true})
    const go = () => this._landTonight(where, when)
    if (!this.leaveHome({go, write: false})) {
      this._cutTo(go)
    }
    return {where, when}
  }


  /**
   * Land on Earth at a place and time, facing up into the sky toward the
   * equator, as tonight's sky: the clock set and running at real time.
   *
   * @param {{lat: number, lng: number}} where
   * @param {{ms: number, kind: string}} when
   */
  _landTonight(where, when) {
    this.time.setTime(when.ms)
    this.time.setRate(1)
    this.time.setPaused(false)
    this.setIsPaused(false)
    this.animation.animateAtJD(this.ui.scene, this.time.simTimeJulianDay())
    this.ui.scene.updateMatrixWorld()
    this._quietly(() => {
      this.scene.land('earth', where.lat, where.lng, undefined, {instant: true})
    })
    // Body-fixed: the platform is at Earth's centre, unturned in its frame.
    const camera = this.ui.camera
    skyward(camera.position, where.lat, TONIGHT_ELEVATION_DEG, camera.quaternion)
    this.ui.setFov(TONIGHT_FOV_DEG)
    this._arrivals++
    // Said as the scene fades in (_frameCut), not under black.
    this._pendingNotice = formatTonight(where, when)
  }


  /**
   * @param {Function} fn Called with a message for the readout: what
   *   "Tonight's sky" used
   * @returns {Function} Stops listening
   */
  onNotice(fn) {
    this._noticeListeners.add(fn)
    return () => this._noticeListeners.delete(fn)
  }


  /**
   * Open a link in the app (a homepage card): its own history entry, so
   * Back returns, then the app's restore of it (_navigate), without a
   * page load.
   *
   * @param {string} link A fragment, without its '#'
   */
  openLink(link) {
    if (this.homeShown) {
      history.pushState(null, '', permalinkHref(link, document.baseURI, location.search))
      this.leaveHome({link})
      return
    }
    location.hash = link
  }


  /**
   * Show the homepage again (Back to its entry): the overlays and the
   * chrome fade out, the canvas to black, and the tour starts over.
   */
  showHome() {
    if (this.homeShown) {
      return
    }
    this.homeShown = true
    this._cut = null
    this.scene.holdOverlays()
    this._setNav(false)
    this._chromeRevealed = false
    this._homeCost(true)
    this._setHomePhase('waiting')
    this.useStore.getState().closeSearch?.()
    this.ui.dimCanvas(CUT_FADE_MS)
    // Under black, the tour starts over; it shows once the exposure has
    // settled on its first view, as on the first load (_frameHomeReturn).
    this._homeSteps = new Choreography([{at: CUT_FADE_MS, run: () => {
      this._startTour()
      this._homeReturning = true
    }}])
  }


  /**
   * Back to the homepage, under black: once the tour has drawn some frames
   * (the meter stopped down for the Sun, not left open for a starfield),
   * the scene fades in and the tour plays.
   */
  _frameHomeReturn() {
    if (!this._homeReturning || this.tour.frames < HOME_SETTLE_FRAMES) {
      return
    }
    this._homeReturning = false
    this.tour.play()
    this.ui.showCanvas(SCENE_FADE_MS)
    this._setHomePhase('in')
  }


  /**
   * The overlays and the chrome, a beat apart (REVEAL_AT), from a start.
   *
   * @param {number} startMs Added to each step's time
   * @param {Function} [when] Each runs only if this says so when its time
   *   comes (the first load's: not while the homepage shows)
   * @returns {Array<{at: number, run: Function}>}
   */
  _overlaySteps(startMs, when = () => true) {
    const step = (at, fn) => ({at: startMs + at, run: () => {
      if (when()) {
        fn()
      }
    }})
    return [
      step(REVEAL_AT.orbits, () => this.scene.revealOverlays(['o'])),
      step(REVEAL_AT.diagrams, () => this.scene.revealOverlays(['a', 'e', 'c', 'g', 'x'])),
      step(REVEAL_AT.labels, () => this.scene.revealOverlays(['p', 'l', 'G'])),
      step(REVEAL_AT.chrome, () => {
        this._chromeRevealed = true
        this._setNav(this.scene.getSetting('v'))
      }),
    ]
  }


  /**
   * A cut to a link's view (leaveHome): once the camera is placed and the
   * scene is in (or READY_TIMEOUT_MS on), it fades in from black, then the
   * overlays and the chrome.
   *
   * @param {number} nowMs
   */
  _frameCut(nowMs) {
    const cut = this._cut
    if (!cut) {
      return
    }
    const arrived = this._arrivals > cut.arrivals && this.ui.sceneReady()
    if (!arrived && nowMs - cut.since < READY_TIMEOUT_MS) {
      return
    }
    this._cut = null
    this.ui.showCanvas(SCENE_FADE_MS)
    if (this._pendingNotice) {
      this._announce(this._noticeListeners, this._pendingNotice)
      this._pendingNotice = null
    }
    const steps = this._overlaySteps(0)
    if (this.homePhase === 'out') {
      // Not out of the page yet (these steps take the leave's place).
      steps.push({at: HOME_UNMOUNT_MS - CUT_FADE_MS, run: () => this._setHomePhase('hidden')})
    }
    this._homeSteps = new Choreography(steps)
  }


  /**
   * What the homepage costs while it shows: no Cesium layers (celestiary's
   * own Earth draws, and nothing of Cesium loads), and a frame cap.
   *
   * @param {boolean} on
   */
  _homeCost(on) {
    if (this.ui.layers) {
      this.ui.layers.suspended = on
    }
    this.ui.setFrameCap(on ? HOME_FRAME_CAP_FPS : null)
  }


  /**
   * The homepage's foreground (ui/Homepage): 'hidden' (not in the page),
   * 'waiting' (in it, unseen, for the scene), 'in', 'out' (fading out).
   *
   * @param {string} phase
   */
  _setHomePhase(phase) {
    this.homePhase = phase
    this.useStore.getState().setHomePhase?.(phase)
  }


  /**
   * Write a link to the address bar, in place of the entry's, or, on the
   * homepage's entry, as a new one after it, so Back returns to the
   * homepage.
   *
   * @param {string} fragment Without its '#'
   */
  _writeLink(fragment) {
    const href = permalinkHref(fragment, document.baseURI, location.search)
    if (isHomeEntry(history.state)) {
      history.pushState(null, '', href)
    } else {
      history.replaceState(null, '', href)
    }
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

    // === Info ===
    k.map('v', () => this._toggleNav(),
        'Target properties HUD (HTML overlay)',
        () => this.scene.getSetting('v'),
        'Info')
    k.addAction(() => useStore.getState().toggleARDebug(),
        'AR debug HUD',
        () => useStore.getState().arDebugVisible,
        'Info')
    // Presentation mode — hide every scene annotation at once.  No clean
    // single-state representation, so it stays an action button.
    k.map('V', () => this._toggleAllSceneInfo(),
        'Hide/show all scene annotations (labels, orbits, asterisms, grids)',
        undefined,
        'Info')
    // three's FPS/MS/MB panel, for judging frame cost on a real GPU.
    k.map('`', () => this.ui.togglePerfPanel(),
        'Toggle performance panel',
        () => this.ui.isPerfPanelVisible(),
        'Info')
    // The stars' limiting magnitude at a dark site (HDR.md), stepped as
    // Celestia steps it: 6.5 is the naked eye's.
    // The setting is the limit's offset from that, 0 by default, shown as
    // "Stars +1.0 mag" and in the link as sm= (starMagnitude.js).
    k.map('[', () => this.stepStarMagnitude(-1),
        'Fewer stars (limiting magnitude down 0.5)',
        undefined,
        'Info')
    k.map(']', () => this.stepStarMagnitude(1),
        'More stars (limiting magnitude up 0.5)',
        undefined,
        'Info')

    // The user's exposure compensation (evCompensation.js), a third of a
    // stop a press, as a camera's dial: to boost or cut the frame to match a
    // photograph.  '[' and ']' are the stars' limiting magnitude.
    k.map('-', () => this.stepExposureCompensation(-1),
        'Darker (exposure compensation down 1/3 EV)',
        undefined,
        'Camera')
    k.map('=', () => this.stepExposureCompensation(1),
        'Brighter (exposure compensation up 1/3 EV)',
        undefined,
        'Camera')
    // Shift+= is '+': the same key, not listed twice in Settings.
    k.keymap['+'] = k.keymap['=']

    // === Labels ===
    k.map('p', () => {
      this.scene.togglePlanetLabels()
    },
    'Planets',
    () => this.scene.getSetting('p'),
    'Labels')
    k.map('s', () => {
      this.scene.toggleStarLabels()
    },
    'Stars',
    () => this.scene.getSetting('l'),
    'Labels')
    k.map('a', () => {
      this.scene.toggleAsterisms()
    },
    'Constellations',
    () => this.scene.getSetting('a'),
    'Labels')
    // 'e' and 'E' as Celestia has them: galaxies' and globulars' names.
    k.map('e', () => {
      this.scene.toggleGalaxyLabels()
    },
    'Galaxies (named once within a magnitude of the star limit, or targeted)',
    () => this.scene.getSetting('G'),
    'Labels')
    k.map('E', () => {
      this.scene.toggleGlobularLabels()
    },
    'Globular clusters (none yet: #228)',
    () => this.scene.getSetting('C'),
    'Labels')
    k.map('U', () => {
      this.scene.toggleGalaxy()
    },
    'Milky Way (its integrated light)',
    () => this.scene.getSetting('U'),
    'Labels')
    k.map('x', () => {
      this.scene.toggleColonization()
    },
    'Human expansion lines',
    () => this.scene.getSetting('x'),
    'Labels')

    // === Orbits ===
    k.map('o', () => {
      this.scene.toggleOrbits()
    },
    'Orbits',
    () => this.scene.getSetting('o'),
    'Orbits')

    // === Grids ===
    k.map(';', () => {
      this.scene.toggleGridEquatorial()
    },
    'Equatorial',
    () => this.scene.getSetting('e'),
    'Grids')
    k.addAction(() => {
      this.scene.toggleGridEcliptic()
    },
    'Ecliptic',
    () => this.scene.getSetting('c'),
    'Grids')
    k.addAction(() => {
      this.scene.toggleGridGalactic()
    },
    'Galactic',
    () => this.scene.getSetting('g'),
    'Grids')

    // === Time ===
    k.map(' ', () => {
      this.setIsPaused(this.time.togglePause())
    },
    'Toggle time pause',
    undefined,
    'Time')
    k.map('\\', () => {
      this.time.changeTimeScale(0)
    },
    'Change time scale to real-time',
    undefined,
    'Time')
    k.map('!', () => {
      this.time.setTimeToNow()
    },
    'Set time to now',
    undefined,
    'Time')
    k.map('j', () => {
      this.time.invertTimeScale()
    },
    'Reverse time',
    undefined,
    'Time')
    k.map('k', () => {
      this.time.changeTimeScale(-1)
    },
    'Slow down time',
    undefined,
    'Time')
    k.map('l', () => {
      this.time.changeTimeScale(1)
    },
    'Speed up time',
    undefined,
    'Time')
    k.map('n', () => {
      this.time.setTimeToNow()
    },
    'Set time to now',
    undefined,
    'Time')

    // === Camera ===
    k.map(',', () => {
      this.ui.multFov(0.9)
    },
    'Narrow field-of-vision',
    undefined,
    'Camera')
    k.map('.', () => {
      this.ui.multFov(1.1)
    },
    'Broaden field-of-vision',
    undefined,
    'Camera')
    k.map('/', () => {
      this.ui.resetFov()
    },
    `Reset field-of-vision to ${ Shared.INITIAL_FOV }º`,
    undefined,
    'Camera')
    k.map('m', () => {
      const s = useStore.getState()
      const next = {auto: 'pan', pan: 'orbit', orbit: 'auto'}[s.dragMode] ?? 'auto'
      s.setDragMode(next)
    },
    'Cycle camera drag mode (Auto / Drag Pan / Move)',
    undefined,
    'Camera')
    // Numbered views — pin a child of current system as look-target.
    k.map('0', () => {
      this.scene.targetCurNode()
    },
    'Target current system',
    undefined,
    'Camera')
    for (let i = 1; i <= 9; i++) {
      k.map(`${i}`, () => {
        const ndx = i
        this.scene.targetNode(ndx)
      },
      `Look at child ${i} of current system`,
      undefined,
      'Camera')
    }

    // === Targeting ===
    k.map('c', () => {
      this.scene.lookAtTarget()
    },
    'Look at target',
    undefined,
    'Targeting')
    k.map('f', () => {
      this.scene.follow()
    },
    'Follow: ride the target\'s orbit (on after going there; off leaves it)',
    () => Boolean(Shared.targets.follow),
    'Targeting')
    k.map('g', () => {
      this.goTo()
    },
    'Go to target node',
    undefined,
    'Targeting')
    k.map('h', () => {
      // Just retarget — travel is 'g'.  setTarget syncs the store, which
      // clears committedStar so a stale "at Rigel" breadcrumb doesn't
      // linger after aiming back at the Sun.
      this.scene.targetNamed('sun')
    },
    'Set target to Sun (use "g" to travel)',
    undefined,
    'Targeting')
    k.map('t', () => {
      this.scene.track()
    },
    'Track target (keep it centred)',
    () => Shared.targets.track,
    'Targeting')
    k.map('u', () => {
      this.scene.targetParent()
    },
    'Look at parent of current system',
    undefined,
    'Targeting')

    // Arrow keys use held-key logic in ThreeUI._initArrowKeys; no-op here for Settings listing.
    k.map('ArrowUp', () => {/* no-op */}, 'Pitch camera up (hold)', undefined, 'Camera')
    k.map('ArrowDown', () => {/* no-op */}, 'Pitch camera down (hold)', undefined, 'Camera')
    k.map('ArrowLeft', () => {/* no-op */}, 'Roll camera left (hold)', undefined, 'Camera')
    k.map('ArrowRight', () => {/* no-op */}, 'Roll camera right (hold)', undefined, 'Camera')
    k.msgs['MOUSEDRAG'] = 'Drag to pitch/yaw camera'
    k.msgs['ALT+MOUSEDRAG'] = 'Option+drag to orbit target'

    this.keys = k
  }


  /**
   * Shrink the scene from the right and the bottom, for the widgets dock and,
   * on a phone, the drawer's sheet (ui/WidgetsDrawer), so they sit beside
   * the scene rather than over it.
   *
   * @param {{right: number, bottom: number}} insets Pixels each takes, 0 for none
   */
  setInsets({right = 0, bottom = 0}) {
    if (right === this._insets.right && bottom === this._insets.bottom) {
      return
    }
    this._insets = {right, bottom}
    this._layout()
  }


  /** Size the scene to the window less the insets. */
  _layout() {
    this._sizeContainer(this.ui.container)
    this.ui.onResize()
  }


  /**
   * Also sets `--scene-height`, which the info panel fits in (index.css).
   *
   * @param {HTMLElement} container
   */
  _sizeContainer(container) {
    const height = Math.max(window.innerHeight - this._insets.bottom, 1)
    container.style.width = `${Math.max(window.innerWidth - this._insets.right, 1)}px`
    container.style.height = `${height}px`
    document.documentElement?.style.setProperty('--scene-height', `${height}px`)
  }


  /**
   * Single-source-of-truth toggle for the nav panels (heads-up display).
   * Used both by the 'v' keypress and by Scene.applySettings (the applier
   * registered in the constructor), so the canonical _settings.v stays in
   * sync.  Before the first load's reveal it only sets the setting: the
   * reveal shows the chrome by it.
   */
  _toggleNav() {
    this.scene.flipSetting('v')
    if (this._chromeRevealed) {
      this._setNav(this.scene.getSetting('v'))
    }
  }


  /**
   * Fade the HTML chrome in or out: CHROME_HIDDEN_CLASS on <html> takes the
   * panels' opacity to 0 over --fade-ms (index.css).  Faded out, they are
   * taken out of layout (`display: none`, by _frameNav once the fade is
   * done), so they take no clicks or focus; `visibility: hidden` wouldn't
   * do, since the SearchBar's chip icons set `visibility: visible` and would
   * punch through it.  Faded in, they are laid out first and the class comes
   * off a frame later, so the opacity has a value to transition from.
   *
   * @param {boolean} visible
   */
  _setNav(visible) {
    this.navVisible = visible
    if (visible) {
      this._navHideAt = null
      this._navDisplay(true)
      this._navShowPending = true
    } else {
      this._navShowPending = false
      document.documentElement?.classList?.add(CHROME_HIDDEN_CLASS)
      this._navHideAt = performance.now() + CHROME_FADE_MS
    }
  }


  /**
   * The chrome's fade, each frame: the class off a frame after the panels
   * are laid out, and the panels out of layout once faded out.
   *
   * @param {number} nowMs
   */
  _frameNav(nowMs) {
    if (this._navShowPending) {
      this._navShowPending = false
      document.documentElement?.classList?.remove(CHROME_HIDDEN_CLASS)
    }
    if (this._navHideAt !== null && nowMs >= this._navHideAt) {
      this._navHideAt = null
      if (!this.navVisible) {
        this._navDisplay(false)
      }
    }
  }


  /** @param {boolean} shown The chrome in layout, or out of it */
  _navDisplay(shown) {
    const panels = [elt('nav-id'), elt('top-right'), elt('search-bar'), elt('widgets-drawer'), elt('widgets-dock')]
    panels.forEach((panel) => {
      if (panel) {
        panel.style.display = shown ? '' : 'none'
      }
    })
    // Cesium's credits overlay: its display is the Cesium layers' (shown
    // only while a layer is active), so 'v' hides it by visibility.
    const credits = elt('cesium-credits')
    if (credits) {
      credits.style.visibility = shown ? '' : 'hidden'
    }
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


  /**
   * Schedule a debounced permalink URL update 1 s after the camera settles,
   * a setting or the drawer changes, or the target changes.
   */
  _schedulePermalinkUpdate() {
    // The homepage's URL stays bare while it shows: the tour isn't a view.
    if (Shared.targets.tween !== null || this.homeShown) {
      return
    }
    clearTimeout(this._permalinkTimer)
    this._permalinkTimer = setTimeout(() => {
      // A tween started since (a goTo targets first): its end reschedules.
      if (Shared.targets.tween !== null || this.homeShown) {
        return
      }
      const fragment = this.permalink()
      if (fragment) {
        this._writeLink(fragment)
      }
    }, 1000)
  }


  /**
   * The link to this view (js/permalink.md): the target's path, the camera
   * in its frame (the body or star it's at, named by `from=` when that
   * isn't the target's), the time, the settings and the drawer.  The
   * target changing changes only the path and `from`: the camera is in the
   * same frame, where it was.
   *
   * @returns {?string} The hash, without its '#'; null before there's a
   *   frame (or at one with no radius, the galaxy)
   */
  permalink() {
    const frame = this._cameraFrame()
    if (!frame) {
      return null
    }
    const cam = this.ui.camera
    const camWorldPos = cam.getWorldPosition(new THREE.Vector3())
    const {lat, lng, alt} = worldToLatLngAlt(camWorldPos, frame.pos, frame.quat, frame.radius)
    const bodyPath = (name) => this.loader.pathByName[name] ?? null
    const target = this.scene.getTarget()
    const path = targetPath(target, bodyPath) ?? frame.path
    const from = targetFramePath(target, bodyPath) === frame.path ? null : frame.path
    const d2000 = this.time.simTimeJulianDay() - J2000_JD
    const settings = this.scene.getSettings ? this.scene.getSettings() : null
    // Mark AR-active so a recipient device with sensors can re-enter
    // AR at this lat/lng.  Saved quaternion is left as-is; the AR
    // resolution path overwrites camera orientation from sensors each
    // frame, so the saved value is harmlessly ignored on AR replay.
    if (settings && this.ar && this.ar.isActive()) {
      settings.A = true
    }
    // The clock when it isn't running at real time (the `time:` token), then
    // the drawer and the apps.
    const tokens = {
      time: encodeTimeToken(this.time.isPaused, this.time.timeScale),
      ...encodeAppTokens(this.useStore.getState().widgets),
    }
    return encodePermalink(
        path, d2000, lat, lng, alt, cam.quaternion, cam.fov, settings, tokens, from,
        this.ui.exposureCompensation(), this.ui.starMagnitudeOffset())
  }


  /**
   * @returns {?{path: string, pos: object, quat: object, radius: number}}
   *   The frame the camera is in: the star it went to, else the body it's
   *   at (`Shared.targets.cur`); its path, centre and orientation (world)
   *   and radius.  A star's axes are the scene's.  Null if none.
   */
  _cameraFrame() {
    const star = this.scene._starTarget
    if (star && this.ui.camera.platform.parent === this.scene._starAnchor) {
      this.ui.scene.updateMatrixWorld()
      return {
        path: star.isGalaxy ? `galaxy:${star.id}` : `hip:${star.hipId}`,
        pos: this.scene.worldGroup.localToWorld(this.scene.starPosition(star)),
        quat: new THREE.Quaternion(),
        radius: star.radius,
      }
    }
    const tObj = Shared.targets.cur
    if (!tObj?.props?.name || !tObj.props.radius?.scalar) {
      return null
    }
    const path = this.loader.pathByName[tObj.props.name]
    if (!path) {
      return null
    }
    return {
      path,
      pos: tObj.getWorldPosition(new THREE.Vector3()),
      quat: tObj.getWorldQuaternion(new THREE.Quaternion()),
      radius: tObj.props.radius.scalar,
    }
  }


  /**
   * Enter AR sky-view mode.  Must be called from within a user gesture
   * (button tap) so iOS Safari's `DeviceOrientationEvent.requestPermission`
   * can prompt — the browser silently rejects the prompt otherwise.
   *
   * Requires explicit lat/lng (we add geoid-derived geolocation later).
   * Body defaults to the currently committed target if it's a planet/moon
   * with a radius; otherwise to 'earth'.
   *
   * @param {object} opts
   * @param {string} [opts.body]
   * @param {number} opts.lat
   * @param {number} opts.lng
   * @param {number} [opts.alt]
   * @returns {Promise<void>}
   */
  enterAR(opts) {
    const body = opts.body ?? this._currentBodyName() ?? 'earth'
    return this.ar.enter({...opts, body})
  }


  /** Exit AR sky-view mode and restore the prior view state. */
  exitAR() {
    this.ar.exit()
  }


  /**
   * Forward an alpha-axis damping preset change to the AR controller.
   * No-op while AR is inactive — preset applies on next enterAR().
   *
   * @param {string} name  One of `getAlphaDampingNames()`
   */
  setARAlphaDamping(name) {
    this.ar.setAlphaDamping(name)
  }


  /**
   * @returns {?string} See `landableBodyName(target)`.
   */
  _currentBodyName() {
    return landableBodyName(Shared.targets.cur)
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


/**
 * Turn a camera on the ground to face the sky: toward the equator (south
 * in the north, north in the south), at an elevation over the horizon, its
 * up the zenith's side.  In the body's own frame: +Y its north pole.
 *
 * @param {object} position The camera's, body-fixed
 * @param {number} lat Degrees
 * @param {number} elevationDeg Over the horizon
 * @param {object} out The camera's quaternion, set
 * @returns {object} out
 */
export function skyward(position, lat, elevationDeg, out) {
  const up = position.clone().normalize()
  const pole = new THREE.Vector3(0, 1, 0)
  const north = pole.sub(up.clone().multiplyScalar(up.dot(pole)))
  if (north.lengthSq() < 1e-12) {
    // At a pole: any way is toward the equator.
    north.set(1, 0, 0).sub(up.clone().multiplyScalar(up.x))
  }
  north.normalize()
  const toward = lat >= 0 ? north.negate() : north
  const el = elevationDeg * Math.PI / 180
  const look = toward.multiplyScalar(Math.cos(el)).add(up.clone().multiplyScalar(Math.sin(el)))
  const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), look, up)
  return out.setFromRotationMatrix(m)
}


/** @returns {boolean} Whether the user asks for less motion */
function prefersReducedMotion() {
  try {
    return Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches)
  } catch {
    return false
  }
}


/**
 * The scene settings a page opens with: its link's `s=` when the link has a
 * view (a fragment without one opens at the defaults, as _arrive has always
 * read it), else the defaults.
 *
 * @param {string} hash location.hash, with or without its '#'
 * @returns {object} A full settings map (permalink.js SETTINGS_DEFAULTS' keys)
 */
export function linkSettings(hash) {
  const raw = (hash ?? '').replace(/^#/, '')
  return (raw && decodePermalink(raw)?.settings) || decodeSettings(undefined)
}
// The frame a link's camera is in when it names none (`from=`), by its
// target's kind: a body's own, a place's body's, the star's (the camera at
// it), and the Sun's for an asterism.
/**
 * @param {string} name A body's name in a path, as the loader has it
 * @returns {string} Its name in the scene: a variant's data file
 *   ('saturn-with-earth-moon') names the body before its first '-'
 */
function sceneName(name) {
  return name.split('-')[0]
}


const REF_FRAME = {
  body: (r) => r.path,
  place: (r) => r.path,
  star: (r) => `hip:${r.hipId}`,
  galaxy: (r) => `galaxy:${r.id}`,
  asterism: () => DEFAULT_TARGET,
}


/**
 * Decide whether a scene-graph target is a body the user can plausibly
 * "stand on" for AR purposes.  Returns the body's name if it has a
 * surface (radius > 0) AND isn't a star (lacks `spectralType`); null
 * otherwise.  Stars are excluded so tapping AR while viewing the Sun
 * doesn't silently teleport the user to the photosphere — the AR
 * caller falls back to a sensible default body (Earth) when this
 * returns null.
 *
 * @param {?object} target  Scene-graph node (typically `Shared.targets.cur`)
 * @returns {?string}
 */
export function landableBodyName(target) {
  const props = target?.props
  if (!props || !props.name) {
    return null
  }
  if (!props.radius || !props.radius.scalar) {
    return null
  }
  if (props.spectralType !== undefined) {
    return null
  }
  return props.name
}
