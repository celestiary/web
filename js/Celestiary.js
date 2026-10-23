import * as THREE from 'three'
import ARController from './ar/ARController'
import Animation from './scene/Animation'
import Choreography, {READY_TIMEOUT_MS, REVEAL_AT} from './choreography'
import FlightPath, {NEAR_RADII, flightDuration, flightProgress, timePlan} from './flight'
import ControlPanel from './ControlPanel'
import Keys from './Keys'
import Loader from './Loader'
import Scene, {DEFAULT_LAND_ALT_M} from './scene/Scene'
import TourDriver from './tourDriver'
import NewsTour from './newsTour'
import {searchIndex} from './search/SearchIndex'
import GalaxiesProvider from './search/providers/GalaxiesProvider'
import SatellitesProvider from './search/providers/SatellitesProvider'
import PlacesProvider from './search/providers/PlacesProvider'
import SceneProvider from './search/providers/SceneProvider'
import StarsProvider from './search/providers/StarsProvider'
import ThreeUi from './ThreeUI'
import Time, {fromJulianDay, toJulianDay} from './Time'
import reifyMeasures from './reify'
import * as Shapes from './scene/shapes'
import * as Shared from './shared'
import {assertArgs} from './assert'
import {latLngAltToBodyFixed, latLngAltToLocal, worldToLatLngAlt} from './coords'
import {
  decodeInfoToken, decodeOrbitsFade, decodeOrbitsToken, decodePeriodicToken, decodePermalink, decodeSettings,
  decodeTimeToken, encodeInfoToken, encodeOrbitsToken, encodePeriodicToken, encodePermalink, encodeTimeToken,
  pathFromFragment, permalinkHref,
} from './permalink'
import {decodeAppTokens, encodeAppTokens} from './store/appTokens'
import {goToEntry, placeTarget} from './search/commitEntry'
import {decodeNewsToken, loadChangelog, readFilter, tourStops} from './changelog'
import {HOME_HISTORY_KEY, isHomeEntry, isHomepage} from './home'
import {HOME_TOUR_LOOP_FADE_MS, HOME_TOUR_STILL_MS, homeTour} from './homeTour'
import {ease} from './tour'
import {formatTonight, lowPrecisionSun, resolveLocation, tonightTime} from './tonight'
import {hideLoading} from './loading'
import {clampEv, stepEv} from './scene/evCompensation'
import {clampStarMag, stepStarMag} from './scene/starMagnitude'
import {fetchPlaces} from './scene/Places'
import {satelliteTarget} from './scene/satellites/names'
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
// A flight from the homepage (a card, the search's Go, What's new) waits
// this long, from the click, for the foreground to have faded out and left
// the page: nothing in the scene changes meanwhile (_holdFlight).
const HOME_FLIGHT_HOLD_MS = HOME_UNMOUNT_MS
// The foreground's fade out, ms (index.css --fade-ms): a flight whose date
// needs the dark (timePlan's 'dip') takes the scene down with it (_holdFlight).
const HOME_FADE_MS = 400
// A flight's date set mid-flight ('unseen') is set by this share of the way
// whatever the view: before the final turn and the settle.
const UNSEEN_LATE_U = 0.85
// A body in the view may move across it by this much, degrees, at a change
// of date mid-flight, or by as much as the view itself turns in that frame,
// which hides it: a planet's point, a moon (_jumpCheck).  A pixel or two.
const JUMP_SHIFT_MAX_DEG = 0.05
// A frame, ms, for the turn a prediction allows (_unseenAhead): 60 fps.
const FRAME_MS = 1000 / 60
// The frame rate the homepage's tour is held to, to keep its cost down
// (ThreeUi.setFrameCap): a slow camera path doesn't need more.
const HOME_FRAME_CAP_FPS = 30
// Frames the tour draws, unseen, before the homepage's reveal (frame), and
// how far its exposure may still be from the meter's goal, stops: the
// tour starts by the Sun, and the meter must have stopped down for it.
const HOME_SETTLE_FRAMES = 20
const HOME_SETTLE_STOPS = 1
// And the meter's readings of it, after the tour has placed the camera.
const HOME_SETTLE_READINGS = 3
// The most the homepage's reveal waits for that, ms after the camera is
// placed (READY_TIMEOUT_MS for a link).
const HOME_READY_TIMEOUT_MS = 8000
// Tonight's sky (openTonight): the field, wide, as the eye takes in the
// sky, and how high over the horizon it faces, toward the equator.
const TONIGHT_FOV_DEG = 70
const TONIGHT_ELEVATION_DEG = 50
// A flight's exposure follows the body in (ThreeUi.approach) to a view
// within this many of its radii, where the body is what the view is of.
const APPROACH_MAX_RADII = 100
// Over a place this near a pole, a flight faces down to it squared to the
// prime meridian, not the pole.
const POLAR_LAT_DEG = 89


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
    // The info panel's orbit list lights elements on the bodies' orbits.
    this.controlPanel.orbitHooks = {
      elementsOf: (body, orbit) => this.animation.orbitElements(body, orbit),
      jd: () => this.animation.jd,
      fade: () => this.scene.getOrbitFade(),
      setFade: (f) => this.scene.setOrbitFade(f),
      elements: (body) => this.scene.orbitElementsOf(body),
      toggle: (body, code) => this.scene.toggleOrbitElement(body, code),
      set: (body, codes) => this.scene.setOrbitElements(body, codes),
      clearAll: () => this.scene.clearOrbitElements(),
      count: () => this.scene.getOrbitElements().size,
      preview: (body, code) => this.scene.previewOrbitElement(body, code),
    }
    // And lists the space around the body: its Hill sphere, Lagrange
    // points and synchronous orbit.
    this.controlPanel.spaceHook = (name) => this.scene.spaceAround(name)
    // And the three-body orbits at its pairs.
    this.controlPanel.periodicHooks = {
      pairs: (name) => this.scene.periodicPairsOf(name),
      toggle: (body, code) => this.scene.togglePeriodic(body, code),
      frame: () => this.scene.getPeriodicFrame(),
      setFrame: (f) => this.scene.setPeriodicFrame(f),
    }
    // Opening or folding the panel's lists rewrites the link (`info:`).
    this.controlPanel.onUiChange = () => this._schedulePermalinkUpdate()
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
    // The changelog tour (newsTour.js; DESIGN.md "What's new"): a link to it
    // (`#;news:tour`) opens the page on it, with no homepage in between.
    this._newsStart = this.homeShown ? decodeNewsToken(location.hash) : null
    this._news = null
    // The changelog, once asked for (loadNews).
    this._newsEntries = null
    // How many times the camera had been placed when the tour's stop began.
    this._newsMark = 0
    // The frame clock of a flight held by the tour's pause (_frameFlight).
    this._flightLastMs = null
    this.tour = new TourDriver({scene: this.scene, ui: this.ui, time: this.time, quietly: (fn) => this._quietly(fn)})
    // Steps on the frame clock while leaving the homepage or coming back.
    this._homeSteps = null
    // A cut to a link's view, waiting for it to arrive (_frameCut).
    this._cut = null
    // A flight from the homepage to a view (_flyTo), and the one whose
    // frame is still loading (_flyToLink) or that waits for the foreground
    // to fade out (_holdFlight).
    this._flight = null
    this._flightToken = null
    this._flightHold = null
    // A flight launched from a hold that took the scene dark: its date is set
    // in that dark, with no dip of its own (_flyTo).
    this._launchDark = false
    // The meter's readings when the tour started (_homeSettled).
    this._homeMeterMark = 0
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
    // Whether the first load's reveal brings the overlays in: not once the
    // homepage has been left after it began, whose own steps do (leaveHome).
    this._revealOverlays = true
    // The first load's sequence (choreography.js), from when the camera is
    // placed (_arrive) and the scene is in (ThreeUi.sceneReady).
    this._arrivedAt = null
    // On the homepage the scene comes in under its title, the tour starts,
    // and the overlays and the chrome wait until it's left (leaveHome).
    this._reveal = new Choreography([
      {at: REVEAL_AT.loading, run: () => {
        if (this.homeShown && this._newsStart) {
          // A link to the changelog tour: the foreground never shows.
          hideLoading()
          this.tour.play()
          this._startNewsFromLink()
        } else if (this.homeShown) {
          // The page's loading title becomes the homepage's (ui/Homepage).
          this._setHomePhase('in')
          this.tour.play()
        } else {
          hideLoading()
        }
        this.ui.showCanvas(SCENE_FADE_MS)
      }},
      ...this._overlaySteps(0, () => !this.homeShown && this._revealOverlays),
    ])
    if (this.homeShown) {
      this._setHomePhase(this._newsStart ? 'hidden' : 'waiting')
      this._homeCost(true)
    }
    this.load()
    this.setupPathListeners()
    this.setupKeyListeners(useStore)
    canvasContainer.addEventListener('mousedown', (e) => e.preventDefault())
    // A click, a drag or the wheel on the scene leaves the homepage for it.
    // And stops a flight from it where it is.
    const leaveForScene = () => {
      if (this._news) {
        this.stopNewsTour()
      } else if (this.homeShown) {
        this.leaveHome()
      } else {
        this.stopFlight()
      }
    }
    canvasContainer.addEventListener('pointerdown', leaveForScene)
    canvasContainer.addEventListener('wheel', leaveForScene, {passive: true})
    // these are here for convenience debugging from jsconsole.
    this.shared = Shared
    this.shapes = Shapes
    this.three = THREE
    this.searchIndex = searchIndex
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
      const settled = !this.homeShown || this._homeSettled()
      const timeout = this.homeShown ? HOME_READY_TIMEOUT_MS : READY_TIMEOUT_MS
      if (!reveal.started && this._arrivedAt !== null &&
          ((settled && this.ui.sceneReady()) || nowMs - this._arrivedAt >= timeout)) {
        reveal.start(nowMs)
        // VSOP87C's chunk (2.6 MB) is fetched now, with the scene on screen,
        // not ahead of it: until it is in the planets are on mean elements,
        // and glide to the series' places (Animation.planetCoords).
        this.animation.loadEphemeris()
        // And the star catalogue's faint tiers, which the scene's view
        // didn't need, each fading in from now (Stars.md, "Brightness
        // tiers").
        this.scene.stars?.revealed?.()
      }
      reveal.frame(nowMs)
    }
    if (this._homeSteps && !this._homeSteps.done) {
      this._homeSteps.start(nowMs)
      this._homeSteps.frame(nowMs)
    }
    this._frameFlight(nowMs)
    this._frameCut(nowMs)
    this._frameHomeReturn(nowMs)
    this._news?.frame(nowMs)
    this.scene.overlays.tick(nowMs)
    this.controlPanel.frame(nowMs)
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
          state.committedGalaxy === prev.committedGalaxy &&
          state.committedTarget === prev.committedTarget) {
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
      } else if (state.committedTarget?.kind === 'satellite' && this.scene.satellites) {
        this.controlPanel.showSatellite(this.scene.satellites.record(state.committedTarget.id),
            this.time.simTimeJulianDay(), this.scene.satelliteData?.fetched)
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
    // Earth's satellites, as the galaxies, below (Satellites.md).
    this.scene.onSatellitesReady((satellites) => {
      searchIndex.register(new SatellitesProvider(satellites))
      searchIndex.invalidate()
    })
    searchIndex.loadOnSearch(() => this.scene.loadSatellites())
    // SPARC's galaxies, once their catalogue is in (Galaxies.md).
    this.scene.onGalaxiesReady((galaxies) => {
      searchIndex.register(new GalaxiesProvider(galaxies))
      searchIndex.invalidate()
    })
    // Their catalogue is fetched for the first search, if nothing has yet (#258).
    searchIndex.loadOnSearch(() => this.scene.loadGalaxies())
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
    // The bright tier has every named star; a search by number for a faint
    // one waits for the rest (Stars.md, "Brightness tiers"): rebuilt once
    // they're in, so a query already asked is asked again (onChange), and
    // the homepage's Enter (ensureSearchable) waits for them.
    this.scene.onStarsReady(() => {
      const stars = this.scene.stars
      if (typeof stars?.whenComplete === 'function') {
        searchIndex.loadOnSearch(() => stars.whenComplete())
        stars.onCatalogComplete(() => searchIndex.markStale())
      }
    })
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
      // The search's bodies are the loader's: a search open as they load
      // (the homepage's, from the start) finds them once they're in.
      searchIndex.markStale()
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
      const tokens = decodePermalink(rawHash)?.tokens
      const widgets = decodeAppTokens(tokens)
      if (widgets) {
        this.useStore.getState().dispatchWidgets({type: 'restore', widgets})
      }
      // The orbital elements lit on the bodies' orbits; each body's diagram
      // shows once it has loaded (Scene.add).
      this.scene.restoreOrbitElements(decodeOrbitsToken(tokens?.orbits))
      this.scene.setOrbitFade(decodeOrbitsFade(tokens?.orbits), true)
      // The three-body orbits shown, once their pairs are the target's.
      this.scene.restorePeriodic(decodePeriodicToken(tokens?.periodic))
      // The info panel's lists, open or folded as they were.
      this.controlPanel.restoreUiState(decodeInfoToken(tokens?.info))
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
        const ownFrame = frame.kind !== 'star' && frame.kind !== 'galaxy' && resolved.kind !== 'satellite' &&
          (!pl.from || pl.from === REF_FRAME[resolved.kind](resolved))
        this.scene.restoreFollowing(pl.settings.F || ownFrame)
        // A satellite is ridden from its node, which the link's frame (Earth)
        // isn't: ride it again, from where the camera is.
        if (resolved.kind === 'satellite' && pl.settings.F) {
          this.scene.setFollowing(true)
        }
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
    if (resolved.kind === 'satellite') {
      this._resolveTarget(resolved, (sat) => quiet(() => {
        this.scene.setTarget(sat, {look: false})
        this.scene.goTo()
      }), () => quiet(() => {
        this.scene.setTarget('earth')
        this.scene.goTo()
      }))
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
   * @param {Function} cb Called with the catalogue star once its tier is in:
   *   with the bright tier for a named star, later for a faint unnamed one
   *   (Stars.whenStar; Stars.md, "Brightness tiers")
   * @param {Function} [onErr] Called if there's no such star
   */
  _whenStar(hipId, cb, onErr) {
    this.scene.onStarsReady(() => this.scene.stars.whenStar(hipId, cb, onErr))
  }


  /**
   * @param {string} id A galaxy's id (targetPath.js: 'ngc2403')
   * @param {Function} cb Called with its record once the galaxies load
   * @param {Function} [onErr] Called if there's no such galaxy
   */
  _whenGalaxy(id, cb, onErr) {
    // Fetched now if the view hasn't yet (#258); a failure is a missing galaxy.
    this.scene.loadGalaxies().then((galaxies) => {
      const galaxy = galaxies?.galaxy(id)
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
        // The body's catalogue: the place, and its labels for when the camera
        // gets there.  One request (Places.js loadPlaces).
        this.scene.objects[resolved.body]?.places?.ensureLoaded()
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
      case 'satellite':
        // Their snapshot is fetched now if the view hasn't yet.
        this.scene.loadSatellites().then((sats) => {
          const rec = sats?.record(resolved.id)
          if (rec) {
            cb(satelliteTarget(rec))
          } else {
            console.warn(`No satellite ${resolved.id}`)
            onMissing?.()
          }
        })
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
    if (label.kind === 'satellite') {
      this.scene.setTarget(label, {look: false})
      this.scene.goTo()
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
      const news = decodeNewsToken(raw)
      if (news) {
        // A link to the changelog tour, opened in this page (Forward, a
        // pasted link).
        this.startNewsTour(news)
        return
      }
      // Any other link takes the scene from a tour under way.
      this._abandonNewsTour({reveal: true})
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
    // Esc leaves the homepage for the live scene, and stops a flight from
    // it where it is.
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') {
        return
      }
      if (this._news) {
        this.stopNewsTour()
      } else if (this.homeShown) {
        this.leaveHome()
      } else {
        this.stopFlight()
      }
    })
    // The changelog tour is a presentation: its keys, and no others.  Before
    // the app's own (Keys), so a key it takes isn't also a go or a toggle.
    window.addEventListener('keydown', (e) => this._onNewsKey(e), true)
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
    // The meter must see the tour's first view before it shows (_homeSettled).
    this._homeMeterMark = this.ui.meterReadings ?? 0
    // Planned for the scene's date, the live time (homeTour.js): which night
    // side it passes over.  Planned again each time round.
    const plan = () => homeTour(this.time.simTime, {sunAt: this._sunAt()})
    this.tour.start(plan(), {
      still: prefersReducedMotion() ? HOME_TOUR_STILL_MS : null,
      loopFadeMs: HOME_TOUR_LOOP_FADE_MS,
      replan: plan,
    })
    this.firstTime = false
    this._arrivedAt ??= performance.now()
  }


  /**
   * Leave the homepage: the tour stops where it is, the foreground fades
   * out, and the overlays and the chrome come in as on a first load
   * (REVEAL_AT).  With a link's view (a card's, Forward) or a flight (the
   * search, tonight's sky), the camera flies there from where the tour
   * was, and they come in once it's there (_flyTo); a path alone travels
   * there by the app's own go (_navigate).
   *
   * A flight, or a go, waits until the foreground has faded out
   * (_holdFlight): until then nothing in the scene changes, not the camera,
   * the target, the date, the settings nor the layers.
   *
   * @param {object} [opts]
   * @param {?string} [opts.link] A fragment to open, without its '#'
   * @param {?object} [opts.fly] Where to fly (_flyTo's)
   * @param {?Function} [opts.go] A travel by the app's own go (the
   *   search's Go to a star), once the foreground is out
   * @param {boolean} [opts.write] Otherwise, write the view to the
   *   address bar now, as a new history entry, so Back returns to the
   *   homepage (what follows a search's Look at writes its own)
   * @param {boolean} [opts.cut] Under black rather than a flight (the
   *   changelog tour, for reduced motion)
   * @returns {boolean} Whether it was showing
   */
  leaveHome({link = null, fly = null, go = null, write = true, cut = false} = {}) {
    if (!this.homeShown) {
      return false
    }
    this.homeShown = false
    this._homeReturning = false
    this.tour.stop()
    // Whether the foreground is on screen, to fade out before anything moves.
    const shown = this.homePhase === 'in'
    if (this.homePhase !== 'hidden') {
      this._setHomePhase('out')
    }
    this._cut = null
    const unmount = {at: HOME_UNMOUNT_MS, run: () => this._setHomePhase('hidden')}
    const pl = link ? decodePermalink(link) : null
    if (link && !pl) {
      // A path alone: the app's go there.
      go = () => this._navigate(link)
    }
    if (!this._reveal.started) {
      // Left before the scene was in: straight there, and the first load's
      // reveal shows it all.
      this._homeCost(false)
      this._homeSteps = new Choreography([unmount])
      if (pl) {
        this._holdLinkSettings(pl)
        this._navigate(link)
      } else if (fly) {
        const jump = fly.jump ?? fly.arrive
        fly.before?.()
        jump()
      } else {
        go?.()
      }
      return true
    }
    // The reveal's own overlay steps aren't this leave's: a card clicked
    // just after it began would bring them in under the fade.
    this._revealOverlays = false
    if (pl || fly || go) {
      // The overlays and the chrome come in once it's there (_endFlight).
      this._homeSteps = new Choreography([unmount])
      if (shown) {
        // The foreground fades out first; then the flight (_frameFlight).
        // If its date needs the dark, the scene goes down with the
        // foreground, in one fade, rather than dipping after it.
        this._holdFlight({dark: !cut && this._needsDark(pl ? this._linkDest(pl, link) : fly)})
      } else {
        this._homeCost(false)
      }
      if (pl) {
        this._flyToLink(link, {cut, settings: true})
      } else if (fly) {
        this._flyTo(fly)
      } else if (!this._deferFlight(() => this._launchGo(go))) {
        this._launchGo(go)
      }
      return true
    }
    this._homeCost(false)
    this._homeSteps = new Choreography([unmount, ...this._overlaySteps(0)])
    if (write) {
      const fragment = this.permalink()
      if (fragment) {
        this._writeLink(fragment)
      }
    }
    return true
  }


  /**
   * Whether a flight from the homepage needs the dark for its date (its
   * plan 'dip': near a body in the view all the way), decided at the click,
   * so the scene goes down with the foreground then (_holdFlight).  Not if
   * its end isn't known yet (a frame not loaded): then the flight decides,
   * and dips on its own if it must.
   *
   * @param {?object} dest A flight's (_flyTo), or null
   * @returns {boolean}
   */
  _needsDark(dest) {
    if (typeof dest?.timeMs !== 'number') {
      return false
    }
    return this._timePlan(dest, dest.timeMs - this.time.simTime) === 'dip'
  }


  /**
   * A link's flight's end, if its frame is a body already in the scene:
   * for planning at the click, before the link is resolved and loaded.
   *
   * @param {object} pl The decoded link
   * @param {string} link
   * @returns {?object} _linkFlight's, or null
   */
  _linkDest(pl, link) {
    const ref = parseTargetPath(pl.from ?? pathFromFragment(link))
    if (ref?.kind !== 'bodies') {
      return null
    }
    // The last part, or the one before it for a place.
    for (const part of ref.parts.slice(-2).reverse()) {
      const name = sceneName(part)
      if (this.scene.objects[name]?.props?.radius?.scalar) {
        return this._linkFlight(pl, {kind: 'body', name}, null)
      }
    }
    return null
  }


  /**
   * A link's scene settings, as opening it would set them, held for the
   * arrival's reveal; the HUD stays as it is, for a visitor arriving from
   * the homepage.
   *
   * @param {object} pl The decoded link
   */
  _holdLinkSettings(pl) {
    this.scene.initSettings({...pl.settings, v: this.scene.getSetting('v')}, {hold: true})
  }


  /**
   * Fly to a link's view from where the camera is (a homepage card, Forward
   * to one): its frame resolved and loaded, the camera flies to where the
   * link has it, and the link's own restore (_arrive) ends it, so the view
   * is the link's exactly, as a reload of it would be.  A path alone goes
   * by the app's go; a view from a star's frame cuts to it under black.
   *
   * @param {string} link A fragment, without its '#'
   * @param {object} [opts]
   * @param {boolean} [opts.cut] Cut to the view under black instead of
   *   flying (the changelog tour, for reduced motion)
   * @param {boolean} [opts.settings] Hold the link's scene settings for
   *   the arrival's reveal first (_holdLinkSettings)
   */
  _flyToLink(link, {cut = false, settings = false} = {}) {
    if (this._deferFlight(() => this._flyToLink(link, {cut, settings}))) {
      return
    }
    const pl = decodePermalink(link)
    if (pl && settings) {
      this._holdLinkSettings(pl)
    }
    const ref = parseTargetPath(pathFromFragment(link))
    if (!pl || !ref) {
      this._navigate(link)
      return
    }
    // A later flight, a stop or Back while this one's frame loads drops it.
    const token = {}
    this._flightToken = token
    // Not found: the live scene where the camera is.
    const onErr = () => {
      if (this._flightToken === token) {
        this._flightToken = null
        this._afterFlight()
      }
    }
    this._resolveRef(ref, (resolved) => {
      const framePath = pl.from ?? REF_FRAME[resolved.kind](resolved)
      this._loadFrame(framePath, (frame) => {
        if (this._flightToken !== token) {
          return
        }
        this._flightToken = null
        const body = frame.kind === 'body' ? this.scene.objects[frame.name] : null
        if (cut || !body?.props?.radius?.scalar) {
          this._cutTo(() => this._arrive(pl, frame, resolved))
          return
        }
        this._flyTo(this._linkFlight(pl, frame, resolved))
      }, onErr)
    }, onErr)
  }


  /**
   * Where a link's view is, as a flight's end (_flyTo): the camera in its
   * frame body's, at the link's place, orientation, field and date; the
   * link's restore on arriving.
   *
   * @param {object} pl The decoded link
   * @param {{kind: string, name: string}} frame Its body
   * @param {object} resolved Its target (_resolveRef)
   * @returns {object}
   */
  _linkFlight(pl, frame, resolved) {
    const body = this.scene.objects[frame.name]
    const r = body.props.radius.scalar
    const quaternion = new THREE.Quaternion(pl.quat.x, pl.quat.y, pl.quat.z, pl.quat.w).normalize()
    const landed = Boolean(pl.settings?.L)
    const bodyFixed = latLngAltToBodyFixed(pl.lat, pl.lng, pl.alt, r)
    const node = landed ? body : body.orbitPosition
    return {
      frame: frame.name,
      node,
      // Landed, the camera is the body's (Scene.land); else its orbit's,
      // where the body turns under it (_restoreView).
      localPosition: landed ? () => bodyFixed : () => latLngAltToLocal(pl.lat, pl.lng, pl.alt, r,
          body.getWorldQuaternion(new THREE.Quaternion()), node.getWorldQuaternion(new THREE.Quaternion())),
      localQuaternion: () => quaternion,
      fov: pl.fov,
      timeMs: fromJulianDay(pl.d2000 + J2000_JD),
      // The exposure follows the body in, where it's what the view is of.
      approach: !landed && pl.alt < APPROACH_MAX_RADII * r,
      arrive: () => this._arrive(pl, frame, resolved),
    }
  }


  /**
   * Fly from where the camera is to a view (flight.js): the camera hangs
   * on the view's body's frame, keeping its world pose (Scene.goTo, its
   * tween dropped), and each frame (_frameFlight) is put where the path
   * says, until it's there and the view's own arrival (`arrive`) sets
   * the rest.  Then the overlays and the chrome come in (REVEAL_AT).
   *
   * The date, if the view has one, changes by timePlan (_timePlan): at the
   * start if nothing near in the view would show it, eased along the way if
   * it's short (a time-lapse), else at once mid-flight where it shows
   * nothing (_dateUnseen), or, near a body in view the whole way, in the
   * dark: the homepage's fade's (_holdFlight), else a short dip to black.
   *
   * @param {object} dest
   * @param {string} dest.frame The body the view is about
   * @param {object} dest.node The node the camera ends hung on: the body's
   *   orbit (`orbitPosition`), or the body itself, landed
   * @param {Function} dest.localPosition The camera's position on `node`,
   *   now (a Vector3)
   * @param {Function} dest.localQuaternion Its orientation on `node`, now
   * @param {number} dest.fov
   * @param {?number} [dest.timeMs] The view's date
   * @param {boolean} [dest.approach] The exposure follows the body in
   *   (ThreeUi.approach)
   * @param {Function} dest.arrive Sets the view exactly, once there
   * @param {?Function} [dest.jump] Goes there at once, without the
   *   flight (before the scene is in); `arrive` if none
   * @param {?Function} [dest.before] Run as it starts: the scene settings
   *   the view's reveal shows (tonight's)
   */
  _flyTo(dest) {
    if (this._deferFlight(() => this._flyTo(dest))) {
      return
    }
    // Already dark (_holdFlight): the date is set there, no dip of its own.
    const dark = this._launchDark
    this._launchDark = false
    this._cancelFlight()
    dest.before?.()
    this._flightToken = null
    this.ui.scene.updateMatrixWorld()
    const deltaMs = typeof dest.timeMs === 'number' ? dest.timeMs - this.time.simTime : 0
    const plan = this._timePlan(dest, deltaMs)
    const flight = {dest, plan, tween: flightTween(), path: null, startMs: null, durationMs: 0, t0: this.time.simTime}
    this._flight = flight
    // Nothing else moves the camera meanwhile (the tween is the app's
    // marker of a travel: following waits, the link isn't written).
    Shared.targets.tween = flight.tween
    Shared.targets.tweenNextFn = null
    if (plan === 'dip' && !dark) {
      // Its first frame starts the dip's clock (_frameFlight).
      this.ui.dimCanvas(CUT_FADE_MS)
      flight.dipUntil = null
      return
    }
    this._beginFlight(flight)
    if (dark && plan !== 'dip') {
      this.ui.showCanvas(SCENE_FADE_MS)
    }
  }


  /**
   * Start a flight (_flyTo): set the date if it's set at the start, hang
   * the camera on the view's frame, and lay out the path.
   *
   * @param {object} flight
   */
  _beginFlight(flight) {
    const {dest, plan} = flight
    if (plan === 'start' || plan === 'dip') {
      this._setSimTime(dest.timeMs)
    }
    flight.t0 = this.time.simTime
    // The app's go to the view's body, its tween dropped: the world rebased
    // and the camera hung on the body's orbit, where it was.
    this._quietly(() => {
      this.scene.setTarget(dest.frame, {look: false})
      this.scene.goTo()
    })
    Shared.targets.tween = flight.tween
    Shared.targets.tweenNextFn = null
    const camera = this.ui.camera
    const body = this.scene.objects[dest.frame]
    const end = this._flightEnd(dest)
    const center = this._flightCenter(body)
    flight.path = new FlightPath({position: camera.position, quaternion: camera.quaternion, fov: camera.fov},
        body.props.radius.scalar, this._flightUp())
    const {alt0, alt1, angle} = flight.path.measure(end, center)
    flight.durationMs = flightDuration(alt0, alt1, angle)
    if (dest.approach) {
      const arrival = camera.platform.localToWorld(end.position.clone())
      this.ui.approach?.(body, arrival, flight.tween)
    }
    if (plan === 'dip') {
      this.ui.showCanvas(SCENE_FADE_MS)
    }
  }


  /**
   * A flight's frame: the date if it eases, then the camera where the
   * path says, and on arriving, the view's own arrival, then the overlays
   * and the chrome.  Ended by anything else taking the camera (another
   * tween, a link restored).
   *
   * @param {number} nowMs
   */
  _frameFlight(nowMs) {
    if (this._flightHold) {
      this._frameHold(nowMs)
      return
    }
    const flight = this._flight
    if (!flight) {
      return
    }
    if (Shared.targets.tween !== flight.tween) {
      this._endFlight({arrived: false})
      return
    }
    if (this._news?.paused) {
      // The changelog tour is paused: the flight's clock stands still.
      const held = this._flightLastMs === null ? 0 : nowMs - this._flightLastMs
      this._flightLastMs = nowMs
      flight.startMs = flight.startMs === null ? null : flight.startMs + held
      flight.dipUntil = flight.dipUntil ? flight.dipUntil + held : flight.dipUntil
      return
    }
    this._flightLastMs = null
    if (!flight.path) {
      flight.dipUntil ??= nowMs + CUT_FADE_MS
      if (nowMs < flight.dipUntil) {
        return
      }
      this._beginFlight(flight)
    }
    flight.startMs ??= nowMs
    // Eased in: its first second or so a gentle start (flight.js).
    const u = flightProgress(nowMs - flight.startMs, flight.durationMs)
    const travel = ease('inOut', u)
    flight.tween.progress = travel
    if (flight.plan === 'unseen' && flight.dated) {
      // Held at the view's date once set (the clock would otherwise run on).
      this._setSimTime(flight.dest.timeMs)
    } else if (flight.plan !== 'none' && flight.plan !== 'unseen') {
      // Eased to the view's date, or held at it once set (the clock would
      // otherwise run on, and the view's restore set it back on arriving).
      this._setSimTime(flight.t0 + ((flight.dest.timeMs - flight.t0) * travel))
    }
    const body = this.scene.objects[flight.dest.frame]
    const center = this._flightCenter(body)
    const end = this._flightEnd(flight.dest)
    const pose = flight.path.pose(u, end, center)
    const camera = this.ui.camera
    // How far the view turns this frame (_dateUnseen).
    const turnDeg = camera.quaternion.angleTo(pose.quaternion) * 180 / Math.PI
    camera.position.copy(pose.position)
    camera.quaternion.copy(pose.quaternion)
    if (Math.abs(camera.fov - pose.fov) > 1e-9) {
      this.ui.setFov(pose.fov)
    }
    if (flight.plan === 'unseen' && !flight.dated && u < 1) {
      this._dateUnseen(flight, u, end, center, nowMs, turnDeg)
    }
    if (u >= 1) {
      this._endFlight({arrived: true})
    }
  }


  /**
   * A flight's date set mid-flight ('unseen'), on the first frame where it
   * shows nothing (_jumpCheck): no body near in the view, before or after,
   * and nothing in the view shifting across it.  The camera rides the end
   * body's frame, so the body's move along its orbit takes the camera with
   * it (what's out of the view, or far off, shifts), and the end turns with
   * the body: the path is re-anchored there (FlightPath.reanchor), so the
   * camera, placed this frame, stays put, and still arrives exactly on the
   * view.  A frame where it would show is put back as it was.  By
   * UNSEEN_LATE_U with no such frame (the plan's prediction missed), it's
   * set anyway.
   *
   * @param {object} flight
   * @param {number} u The share of the way this frame
   * @param {object} end The end this frame, before the date
   * @param {THREE.Vector3} center
   * @param {number} nowMs
   * @param {number} turnDeg How far the view turned this frame
   */
  _dateUnseen(flight, u, end, center, nowMs, turnDeg) {
    const late = u >= UNSEEN_LATE_U
    const view = this._cameraView()
    if (!late && !(this._nearestShownRadii(view) >= NEAR_RADII)) {
      return
    }
    const body = this.scene.objects[flight.dest.frame]
    const was = this.time.simTime
    const before = this._bodyPlaces()
    this._setSimTime(flight.dest.timeMs)
    const after = this._bodyPlaces()
    const check = this._jumpCheck(view, before, after, body, Math.max(JUMP_SHIFT_MAX_DEG, turnDeg))
    // The last tried, for the evidence of where it went.
    flight.tried = {u, ...check}
    if (!late && !check.ok) {
      this._setSimTime(was)
      return
    }
    flight.path.reanchor(u, end, this._flightEnd(flight.dest), center)
    flight.dated = {u, ms: nowMs - flight.startMs, late, ...check}
  }


  /**
   * @returns {Map<object, THREE.Vector3>} Each body's place in the world now
   *   (not the Milky Way, which the camera is always inside)
   */
  _bodyPlaces() {
    const places = new Map()
    for (const obj of Object.values(this.scene.objects)) {
      if (obj?.props?.radius?.scalar > 0 && obj.props.type !== 'galaxy' && typeof obj.getWorldPosition === 'function') {
        places.set(obj, obj.getWorldPosition(new THREE.Vector3()))
      }
    }
    return places
  }


  /**
   * The bodies' places at another date, the scene put back to the clock's
   * at once: nothing is drawn between, and the clock isn't touched.
   *
   * @param {number} ms
   * @returns {Map<object, THREE.Vector3>} _bodyPlaces's
   */
  _bodyPlacesAt(ms) {
    const scene = this.ui.scene
    this.animation.animateAtJD(scene, toJulianDay(ms))
    scene.updateMatrixWorld()
    const places = this._bodyPlaces()
    this.animation.animateAtJD(scene, this.time.simTimeJulianDay())
    scene.updateMatrixWorld()
    return places
  }


  /**
   * Whether a change of date at a view would show: the camera rides `ridden`
   * (the flight's end body), so across it the camera moves as that body
   * does, and each other body moves against it.  It shows if a body near
   * (NEAR_RADII) is in the view before or after, or one in the view, however
   * far, moves across it by more than `allowDeg` (a planet's point, a moon:
   * the Moon beside Earth moves by a week of its orbit), which is the view's
   * own turn that frame, when it turns more than a pixel or two: amid the
   * whole field sweeping by, a point's smaller step doesn't show.
   *
   * @param {object} view A pose in the world, before (_cameraView's)
   * @param {Map<object, THREE.Vector3>} before _bodyPlaces at the old date
   * @param {Map<object, THREE.Vector3>} after And at the new
   * @param {object} ridden
   * @param {number} [allowDeg]
   * @returns {{ok: boolean, radii: number, shiftDeg: number, shiftBody: ?string, allowDeg: number}}
   *   `radii` the nearest in the view, either side
   */
  _jumpCheck(view, before, after, ridden, allowDeg = JUMP_SHIFT_MAX_DEG) {
    const move = after.get(ridden).clone().sub(before.get(ridden))
    const viewAfter = {...view, position: view.position.clone().add(move)}
    let radii = Infinity
    let shiftDeg = 0
    let shiftBody = null
    for (const [obj, was] of before) {
      const now = after.get(obj)
      const r = obj.props.radius.scalar
      const inBefore = this._inViewAt(was, r, view)
      const inAfter = this._inViewAt(now, r, viewAfter)
      if (!inBefore && !inAfter) {
        continue
      }
      radii = Math.min(radii, inBefore ? view.position.distanceTo(was) / r : Infinity,
          inAfter ? viewAfter.position.distanceTo(now) / r : Infinity)
      if (obj !== ridden) {
        const deg = was.clone().sub(view.position).angleTo(now.clone().sub(viewAfter.position)) * 180 / Math.PI
        if (deg > shiftDeg) {
          shiftDeg = deg
          shiftBody = obj.props.name
        }
      }
    }
    return {ok: radii >= NEAR_RADII && shiftDeg <= allowDeg, radii, shiftDeg, shiftBody, allowDeg}
  }


  /**
   * The end of a flight: arrived, the view's own arrival sets it exactly
   * (a link's restore, a landing); stopped (Esc, a click on the scene) or
   * taken over, the camera stays where it is.  Either way the overlays and
   * the chrome come in.
   *
   * @param {object} opts
   * @param {boolean} opts.arrived
   */
  _endFlight({arrived}) {
    const flight = this._flight
    this._flight = null
    if (!flight) {
      return
    }
    flight.tween.done = true
    if (!flight.path) {
      // Stopped in its dip, before it started.
      this.ui.showCanvas(SCENE_FADE_MS)
    }
    if (Shared.targets.tween === flight.tween) {
      Shared.targets.tween = null
    }
    if (arrived) {
      // The exposure as the approach left it, for the meter to go on from.
      this.ui.settleArrival?.()
      flight.dest.arrive()
    }
    this._afterFlight()
  }


  /**
   * Once a flight is over: the overlays and the chrome come in as on a
   * first load (REVEAL_AT), and the link is written.
   */
  _afterFlight({write = true} = {}) {
    this._showLaunchDark()
    const steps = this._overlaySteps(0)
    if (this.homePhase === 'out') {
      steps.push({at: HOME_UNMOUNT_MS, run: () => this._setHomePhase('hidden')})
    }
    this._homeSteps = new Choreography(steps)
    if (write) {
      this._schedulePermalinkUpdate()
    }
  }


  /**
   * A travel by the app's own go, leaving the homepage (the search's Go to
   * a star, a path alone): the go, and the overlays and the chrome come in
   * as it travels.  The go writes its own link.
   *
   * @param {Function} go
   */
  _launchGo(go) {
    go()
    this._afterFlight({write: false})
  }


  /** The scene back from a hold's dark that no flight took up (_holdFlight). */
  _showLaunchDark() {
    if (this._launchDark) {
      this._launchDark = false
      this.ui.showCanvas(SCENE_FADE_MS)
    }
  }


  /**
   * Hold a flight from the homepage until its foreground has faded out
   * (HOME_FLIGHT_HOLD_MS): what leaving asks for (_flyToLink, _flyTo, a
   * go) waits in the hold (_deferFlight), the last asked for winning, and
   * nothing in the scene changes meanwhile: the camera stays where the
   * tour left it, and the target, the date, the settings and the layers
   * as they were.  Its marker in `Shared.targets.tween` is a travel's, so
   * following waits and the link isn't written; something else taking the
   * camera meanwhile (a link restored, a key's go) ends it, as it would a
   * flight (_frameHold).  Esc or a click stops it (stopFlight), Back
   * drops it (_cancelFlight).
   *
   * With `dark` (the flight's date needs the dark: timePlan's 'dip') the
   * scene fades down with the foreground, and the flight sets its date in
   * that dark and fades the scene up as it starts (_flyTo): one dark beat,
   * not the foreground's fade, the scene, and then a dip.
   *
   * @param {object} [opts]
   * @param {boolean} [opts.dark]
   */
  _holdFlight({dark = false} = {}) {
    this._cancelFlight()
    const hold = {token: {}, tween: flightTween(), at: null, run: null, dark}
    this._flightHold = hold
    if (dark) {
      this.ui.dimCanvas(HOME_FADE_MS)
    }
    this._flightToken = hold.token
    Shared.targets.tween = hold.tween
    Shared.targets.tweenNextFn = null
  }


  /**
   * @param {Function} run A flight's start
   * @returns {boolean} Whether it waits in the hold (_holdFlight), in place
   *   of what waited there; if not, the caller starts it now
   */
  _deferFlight(run) {
    if (!this._flightHold) {
      return false
    }
    this._flightHold.run = run
    return true
  }


  /**
   * A frame of the hold (_holdFlight): once the foreground is out, the
   * flight starts.
   *
   * @param {number} nowMs
   */
  _frameHold(nowMs) {
    const hold = this._flightHold
    if (Shared.targets.tween !== hold.tween) {
      // Taken over: the live scene from where that leaves it.
      this._dropHold()
      this._homeCost(false)
      this._afterFlight()
      return
    }
    hold.at ??= nowMs + HOME_FLIGHT_HOLD_MS
    if (nowMs < hold.at) {
      return
    }
    this._dropHold({show: false})
    this._homeCost(false)
    this._launchDark = hold.dark
    if (hold.run) {
      hold.run()
    } else {
      this._afterFlight()
    }
  }


  /**
   * End the hold (_holdFlight), if there is one, without starting it.
   *
   * @param {object} [opts]
   * @param {boolean} [opts.show] The scene back up, if the hold took it dark
   * @returns {?object} The hold
   */
  _dropHold({show = true} = {}) {
    const hold = this._flightHold
    this._flightHold = null
    if (hold) {
      if (hold.dark && show) {
        this.ui.showCanvas(SCENE_FADE_MS)
      }
      hold.tween.done = true
      if (Shared.targets.tween === hold.tween) {
        Shared.targets.tween = null
      }
      if (this._flightToken === hold.token) {
        this._flightToken = null
      }
    }
    return hold
  }


  /**
   * Stop a flight where it is (Esc, a click, drag or wheel on the scene):
   * the live scene from there, its link written in place of the one the
   * flight was to.
   *
   * @returns {boolean} Whether one was under way
   */
  stopFlight() {
    if (!this._flight && !this._flightToken) {
      return false
    }
    if (this._dropHold()) {
      // Still waiting for the homepage's fade: nothing had moved.
      this._homeCost(false)
    }
    this._flightToken = null
    if (this._flight) {
      this._endFlight({arrived: false})
    } else {
      // Its frame still loading, or the fade not over: it never started.
      this._afterFlight()
    }
    return true
  }


  /** Drop a flight, nothing more (Back to the homepage, another flight). */
  _cancelFlight() {
    this._dropHold()
    this._showLaunchDark()
    this._flightToken = null
    const flight = this._flight
    this._flight = null
    if (flight) {
      flight.tween.done = true
      if (Shared.targets.tween === flight.tween) {
        Shared.targets.tween = null
      }
      if (!flight.path) {
        // In its dip to black.
        this.ui.showCanvas(SCENE_FADE_MS)
      }
    }
  }


  /**
   * @param {object} dest A flight's (_flyTo)
   * @returns {{position: THREE.Vector3, quaternion: THREE.Quaternion, fov: number}}
   *   Its end, now, on the camera's platform
   */
  _flightEnd(dest) {
    const platform = this.ui.camera.platform
    dest.node.updateWorldMatrix(true, false)
    platform.updateWorldMatrix(true, false)
    const world = dest.node.localToWorld(dest.localPosition().clone())
    const nodeQuat = dest.node.getWorldQuaternion(new THREE.Quaternion())
    const platformQuat = platform.getWorldQuaternion(new THREE.Quaternion())
    return {
      position: platform.worldToLocal(world),
      quaternion: platformQuat.invert().multiply(nodeQuat).multiply(dest.localQuaternion()),
      fov: dest.fov,
    }
  }


  /**
   * @param {object} body
   * @returns {THREE.Vector3} Its centre on the camera's platform
   */
  _flightCenter(body) {
    return this.ui.camera.platform.worldToLocal(body.getWorldPosition(new THREE.Vector3()))
  }


  /** @returns {THREE.Vector3} The ecliptic's north on the camera's platform */
  _flightUp() {
    const q = this.ui.camera.platform.getWorldQuaternion(new THREE.Quaternion()).invert()
    return new THREE.Vector3(0, 1, 0).applyQuaternion(q)
  }


  /**
   * Whether a change of date would show (timePlan): it turns a body near
   * the camera, moves its terminator, or the Sun across the sky of a camera
   * riding a planet's orbit, but only one in the view.  Out of it, nothing
   * on screen changes but bodies far off (a pixel or so), so the date can
   * be set at once.  The view is the field's cone (to its corners), widened
   * by the body's own angular radius.
   *
   * @param {object} [view] A pose in the world (default the camera's)
   * @param {THREE.Vector3} view.position
   * @param {THREE.Quaternion} view.quaternion
   * @param {number} view.fov Degrees, vertical
   * @returns {number} The camera's distance from the nearest body in the
   *   view (the Sun, a planet, a moon), in its radii; Infinity if none
   */
  _nearestShownRadii(view = this._cameraView()) {
    let nearest = Infinity
    for (const [obj, at] of this._bodyPlaces()) {
      const r = obj.props.radius.scalar
      if (this._inViewAt(at, r, view)) {
        nearest = Math.min(nearest, view.position.distanceTo(at) / r)
      }
    }
    return nearest
  }


  /** @returns {{position: THREE.Vector3, quaternion: THREE.Quaternion, fov: number}} The camera's, in the world */
  _cameraView() {
    const camera = this.ui.camera
    return {
      position: camera.getWorldPosition(new THREE.Vector3()),
      quaternion: camera.getWorldQuaternion(new THREE.Quaternion()),
      fov: camera.fov,
    }
  }


  /**
   * @param {THREE.Vector3} at A body's place in the world
   * @param {number} r Its radius
   * @param {object} view As _nearestShownRadii's
   * @returns {boolean} Whether any of it is in the view's field (the cone to
   *   its corners)
   */
  _inViewAt(at, r, view) {
    const halfV = (view.fov * Math.PI / 180) / 2
    const halfDiag = Math.atan(Math.tan(halfV) * Math.hypot(1, this.ui.camera.aspect || 1))
    const to = at.clone().sub(view.position)
    const d = to.length()
    const look = new THREE.Vector3(0, 0, -1).applyQuaternion(view.quaternion)
    return d <= r || look.angleTo(to) <= halfDiag + Math.asin(Math.min(r / d, 1))
  }


  /**
   * Whether a flight from where the camera is to `dest` has a frame where
   * its date can be set unseen (timePlan's 'unseen', _jumpCheck): its path
   * laid out in the world, as _beginFlight will in the body's frame, tried
   * at a hundred points against the bodies at both dates (the scene set to
   * the view's date and back, in this call).  The bodies move by a few
   * seconds' worth meanwhile, nothing at this scale.
   *
   * @param {object} dest A flight's (_flyTo), with its `timeMs`
   * @returns {boolean}
   */
  _unseenAhead(dest) {
    const body = this.scene.objects[dest.frame]
    const r = body?.props?.radius?.scalar
    if (!r) {
      return false
    }
    this.ui.scene.updateMatrixWorld()
    const path = new FlightPath(this._cameraView(), r, new THREE.Vector3(0, 1, 0))
    const end = {
      position: dest.node.localToWorld(dest.localPosition().clone()),
      quaternion: dest.node.getWorldQuaternion(new THREE.Quaternion()).multiply(dest.localQuaternion()),
      fov: dest.fov,
    }
    const center = body.getWorldPosition(new THREE.Vector3())
    const before = this._bodyPlaces()
    const after = this._bodyPlacesAt(dest.timeMs)
    const {alt0, alt1, angle} = path.measure(end, center)
    // A frame's share of the way at the path's own pace (after the ease-in).
    const du = FRAME_MS / flightDuration(alt0, alt1, angle)
    for (let i = 1; i < 100 && i / 100 < UNSEEN_LATE_U; i++) {
      const pose = path.pose(i / 100, end, center)
      const turnDeg = pose.quaternion.angleTo(path.pose((i / 100) - du, end, center).quaternion) * 180 / Math.PI
      if (this._jumpCheck(pose, before, after, body, Math.max(JUMP_SHIFT_MAX_DEG, turnDeg)).ok) {
        return true
      }
    }
    return false
  }


  /**
   * @param {object} dest A flight's (_flyTo)
   * @param {number} deltaMs Its change of date
   * @returns {string} timePlan's, for a flight from the camera's view now
   */
  _timePlan(dest, deltaMs) {
    const radii = this._nearestShownRadii()
    // Only a long change near a body in view asks whether the flight passes
    // anywhere unseen.
    const long = deltaMs && radii < NEAR_RADII && timePlan(deltaMs, radii) === 'dip'
    return timePlan(deltaMs, radii, {unseen: Boolean(long) && this._unseenAhead(dest)})
  }


  /**
   * Set the date and put the bodies there now, not next frame, so what's
   * placed against them this frame (a flight's end) is where they are.
   *
   * @param {number} ms
   */
  _setSimTime(ms) {
    this.time.setTime(ms)
    this.animation.animateAtJD(this.ui.scene, this.time.simTimeJulianDay())
    this.ui.scene.updateMatrixWorld()
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
    // Dark already from a hold, or going: it comes up once there (_frameCut).
    this._launchDark = false
    this.ui.dimCanvas(CUT_FADE_MS)
    this._homeSteps = new Choreography([...steps, {at: CUT_FADE_MS, run: () => {
      this._cut = {arrivals: this._arrivals, since: performance.now()}
      go()
    }}])
  }


  /**
   * The Sun from Earth, for tonight.js and the tour's plan: the app's own
   * ephemeris (VSOP87C's Earth turned round), or Meeus's low-precision Sun
   * before it loads (they agree to 0.02°).  A plan made in that gap is not
   * remade when the series arrives: the two differ by less than the plan's
   * aim can show (nightSide.test.js), and the tour plans again each time
   * round.
   *
   * @returns {function(number): {x: number, y: number, z: number}} At a
   *   Julian Day, ecliptic of date
   */
  _sunAt() {
    return this.animation.vsopReady() ? (jd) => {
      const e = this.animation.vsopAt(jd).earth
      return {x: -e.x, y: -e.y, z: -e.z}
    } : lowPrecisionSun
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
    const when = tonightTime(where.lat, where.lng, Date.now(), this._sunAt())
    const dest = {
      ...this._tonightFlight(where, when),
      // The app's defaults for the overlays and labels; the HUD as it is.
      // Set as the flight starts, after the homepage's fade.
      before: () => this.scene.initSettings({...decodeSettings(undefined), v: this.scene.getSetting('v')}, {hold: true}),
    }
    if (!this.leaveHome({fly: dest})) {
      this._flyTo(dest)
    }
    return {where, when}
  }


  /**
   * Tonight's sky as a flight's end (_flyTo): on the ground there, facing
   * up toward the equator, at its date; the landing on arriving.
   *
   * @param {{lat: number, lng: number}} where
   * @param {{ms: number, kind: string}} when
   * @returns {object}
   */
  _tonightFlight(where, when) {
    const earth = this.scene.objects.earth
    const position = latLngAltToBodyFixed(where.lat, where.lng, DEFAULT_LAND_ALT_M, earth.props.radius.scalar)
    const quaternion = skyward(position, where.lat, TONIGHT_ELEVATION_DEG, new THREE.Quaternion())
    return {
      frame: 'earth',
      node: earth,
      localPosition: () => position,
      localQuaternion: () => quaternion,
      fov: TONIGHT_FOV_DEG,
      timeMs: when.ms,
      arrive: () => {
        this._landTonight(where, when)
        this._announce(this._noticeListeners, this._pendingNotice)
        this._pendingNotice = null
      },
    }
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
    // Said once it's there.
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
   * Back returns, then a flight to its view, ended by the app's restore of
   * it (_flyToLink), without a page load.  Another card while a flight is
   * under way flies on to it from where the camera is, in the first's
   * place in the history.
   *
   * @param {string} link A fragment, without its '#'
   */
  openLink(link) {
    const href = permalinkHref(link, document.baseURI, location.search)
    if (this.homeShown) {
      history.pushState(null, '', href)
      this.leaveHome({link})
      return
    }
    const pl = decodePermalink(link)
    if (pl && (this._flight || this._flightToken)) {
      history.replaceState(null, '', href)
      this._flyToLink(link, {settings: true})
      return
    }
    location.hash = link
  }


  /**
   * The search's Go (SearchBar, js/search/commitEntry.js).  On the
   * homepage, a flight there from the tour's view: to a body, where `g`
   * would arrive, facing it; to a place, over it, then the app's landing.
   * A star or a galaxy goes by the app's go.
   *
   * @param {object} entry A SearchEntry
   */
  goToResult(entry) {
    // From the homepage, or on from a flight from it (a second Enter).
    const flying = Boolean(this._flight || this._flightToken)
    const dest = this.homeShown || flying ? this._resultFlight(entry) : null
    if (dest) {
      if (!this.leaveHome({fly: dest})) {
        this._flyTo(dest)
      }
      return
    }
    // A star or a galaxy: the app's go, once the homepage has faded out.
    const go = () => goToEntry(entry, this)
    if (!this.leaveHome({go}) && !this._deferFlight(() => this._launchGo(go))) {
      go()
    }
  }


  /**
   * @param {object} entry A SearchEntry
   * @returns {?object} A flight's end (_flyTo) for a body or a place;
   *   null for anything else
   */
  _resultFlight(entry) {
    const place = entry?.kind === 'place' ? entry.payload : null
    const name = place ? place.body : entry?.payload?.name
    const body = name ? this.scene.objects[name] : null
    const r = body?.props?.radius?.scalar
    if (!r || entry.kind === 'star' || entry.payload?.galaxy || (!place && !body.orbitPosition)) {
      return null
    }
    const dist = this.scene.arrivalDistance(body)
    const jump = () => goToEntry(entry, this)
    if (place) {
      // Its body's catalogue, for the labels it lands among (#258).
      body.places?.ensureLoaded()
      // Over the place, facing down to it, then the landing from there.
      const over = latLngAltToBodyFixed(place.lat, place.lng, dist - r, r)
      const north = Math.abs(place.lat) > POLAR_LAT_DEG ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
      const facing = new THREE.Quaternion().setFromRotationMatrix(
          new THREE.Matrix4().lookAt(over, new THREE.Vector3(), north))
      return {
        frame: name,
        node: body,
        localPosition: () => over,
        localQuaternion: () => facing,
        fov: this.ui.camera.fov,
        approach: true,
        arrive: () => this.scene.land(name, place.lat, place.lng, place.alt, {target: placeTarget(entry)}),
        jump,
      }
    }
    // Where `g` arrives (Scene.goTo): from the body toward where the camera
    // was when the flight began, its arrival distance out, facing it.
    let end = null
    const endPose = () => {
      if (!end) {
        const node = body.orbitPosition
        const center = node.worldToLocal(body.getWorldPosition(new THREE.Vector3()))
        const eye = node.worldToLocal(this.ui.camera.getWorldPosition(new THREE.Vector3()))
        const dir = eye.sub(center).normalize()
        const position = center.clone().addScaledVector(dir, dist)
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(node.getWorldQuaternion(new THREE.Quaternion()).invert())
        end = {position, quaternion: new THREE.Quaternion().setFromRotationMatrix(
            new THREE.Matrix4().lookAt(position, center, up))}
      }
      return end
    }
    return {
      frame: name,
      node: body.orbitPosition,
      localPosition: () => endPose().position,
      localQuaternion: () => endPose().quaternion,
      fov: this.ui.camera.fov,
      approach: true,
      arrive: () => this._quietly(() => this.scene.setTarget(name, {look: false})),
      jump,
    }
  }


  /**
   * The changelog (changelog.js; DESIGN.md "What's new"), fetched once for
   * the homepage's What's new and the changelog tour.
   *
   * @returns {Promise<Array<object>>} Its entries, newest first; rejects if
   *   the file can't be read (asked for again next time)
   */
  loadNews() {
    this._newsEntries ??= loadChangelog().catch((e) => {
      this._newsEntries = null
      throw e
    })
    return this._newsEntries
  }


  /**
   * Play the changelog tour (newsTour.js): the featured entries (or all, as
   * What's new's filter has it) that have a
   * permalink, newest first, each flown to as a homepage card is, with its
   * headline and sentence as a caption while it is held.  Nothing else is on
   * screen: the homepage fades out as for a card, the chrome stays hidden
   * until the tour ends (Esc, a click on the scene, or the last stop), and
   * the address bar isn't written while it plays.
   *
   * @param {object} [opts]
   * @param {?string} [opts.from] An entry's id or a date to begin at
   * @param {number} [opts.count] At most this many stops
   * @param {object} [opts.filter] What's new's filter, which the tour
   *   follows (changelog.js `visibleEntries`); the visitor's stored one if
   *   not given
   * @returns {Promise<boolean>} Whether there was anything to play
   */
  async startNewsTour({from = null, count = Infinity, filter = readFilter()} = {}) {
    let entries
    try {
      entries = await this.loadNews()
    } catch (e) {
      console.warn('What\'s new:', e)
      return false
    }
    const stops = tourStops(entries, {from, count, filter})
    if (!stops.length) {
      return false
    }
    this._abandonNewsTour()
    this._news = new NewsTour({
      go: (entry) => this._newsGo(entry),
      arrived: () => this._newsArrived(),
      onChange: (state) => this._setNewsTour(state),
      onEnd: (finished) => this._onNewsEnd(finished),
    })
    return this._news.start(stops)
  }


  /**
   * A page opened on a link to the changelog tour (`#;news:tour`): the
   * tour plays from the reveal, and if it can't (no changelog), the
   * homepage shows as at the bare URL.
   */
  _startNewsFromLink() {
    this.startNewsTour(this._newsStart).then((started) => {
      if (!started && this.homeShown) {
        this._newsStart = null
        this._setHomePhase('in')
      }
    })
  }


  /**
   * The tour's flight to a stop: as a card's (leaveHome from the homepage,
   * else a flight from where the camera is), or a cut under black for
   * reduced motion.
   *
   * @param {object} entry A changelog entry with a permalink
   */
  _newsGo(entry) {
    this._newsMark = this._arrivals
    if (this._cut) {
      // Skipped past a cut that was waiting to show.
      this._cut = null
      this.ui.showCanvas(SCENE_FADE_MS)
    }
    const link = entry.permalink
    const cut = prefersReducedMotion()
    if (this.homeShown) {
      this.leaveHome({link, cut})
      return
    }
    this._flyToLink(link, {cut, settings: true})
  }


  /** @returns {boolean} The camera has arrived at the stop _newsGo began */
  _newsArrived() {
    return this._arrivals > this._newsMark && !this._flight && !this._flightToken && !this._cut &&
      Shared.targets.tween === null
  }


  /**
   * The tour is over: it ran out of stops, or was stopped (Esc, a click on
   * the scene).  The live scene from where the camera is, the chrome in,
   * its link written (after the homepage's entry, so Back returns).
   *
   * @param {boolean} _finished
   */
  _onNewsEnd(_finished) {
    this._news = null
    this._setNewsTour(null)
    if (this._flight || this._flightToken) {
      this.stopFlight()
    } else {
      this._afterFlight()
    }
  }


  /**
   * End the changelog tour from outside (its controls, Esc).
   *
   * @returns {boolean} Whether one was playing
   */
  stopNewsTour() {
    if (!this._news) {
      return false
    }
    this._news.stop()
    return true
  }


  /**
   * Drop the changelog tour without ending the view it leaves: something
   * else has the scene (Back to the homepage, another link).
   *
   * @param {object} [opts]
   * @param {boolean} [opts.reveal] The chrome comes in, as the tour's end
   *   brings it
   */
  _abandonNewsTour({reveal = false} = {}) {
    const news = this._news
    if (!news) {
      return
    }
    this._news = null
    news.abandon()
    if (reveal) {
      this._chromeRevealed = true
      this._setNav(this.scene.getSetting('v'))
    }
  }


  /**
   * The tour's controls (ui/NewsTour.jsx).
   *
   * @param {string} action 'next', 'previous', 'pause' or 'stop'
   */
  newsTourControl(action) {
    switch (action) {
      case 'next': this._news?.next(); break
      case 'previous': this._news?.previous(); break
      case 'pause': this._news?.togglePause(); break
      case 'stop': this.stopNewsTour(); break
      default: break
    }
  }


  /**
   * The tour's keys, while it plays: Esc stops it, Space pauses, the arrows
   * skip.  Others are held back from the app (a `g` or an `a` would take
   * the scene or its overlays from a presentation); Tab, function keys and
   * browser shortcuts are left alone, and so is a focused control's own
   * Enter and Space.
   *
   * @param {KeyboardEvent} e
   */
  _onNewsKey(e) {
    const news = this._news
    if (!news || e.ctrlKey || e.metaKey || e.altKey || e.key === 'Tab' || (/^F\d+$/).test(e.key)) {
      return
    }
    const onControl = Boolean(e.target?.closest?.('.news-controls'))
    if (e.key === 'Escape') {
      this.stopNewsTour()
    } else if (onControl && (e.key === 'Enter' || e.key === ' ')) {
      return
    } else if (e.key === ' ') {
      news.togglePause()
    } else if (e.key === 'ArrowRight') {
      news.next()
    } else if (e.key === 'ArrowLeft') {
      news.previous()
    }
    e.preventDefault?.()
    e.stopImmediatePropagation?.()
  }


  /**
   * The tour's state for its caption and controls (ui/NewsTour.jsx).
   *
   * @param {?object} state NewsTour.state; null when it isn't playing
   */
  _setNewsTour(state) {
    this.useStore.getState().setNewsTour?.(state)
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
    this._abandonNewsTour()
    this._cancelFlight()
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
      this._homeReturning = {since: null}
    }}])
  }


  /**
   * @returns {boolean} The homepage's tour has drawn some frames and its
   *   exposure is near the meter's goal: what it shows first is metered
   */
  _homeSettled() {
    return this.tour.frames >= HOME_SETTLE_FRAMES &&
      (this.ui.meterReadings ?? 0) - this._homeMeterMark >= HOME_SETTLE_READINGS &&
      this.ui.exposureSettled(HOME_SETTLE_STOPS)
  }


  /**
   * Back to the homepage, under black: once the tour has drawn some frames
   * (the meter stopped down for the Sun, not left open for a starfield),
   * the scene fades in and the tour plays.
   */
  _frameHomeReturn(nowMs) {
    if (!this._homeReturning) {
      return
    }
    this._homeReturning.since ??= nowMs
    if (!this._homeSettled() && nowMs - this._homeReturning.since < HOME_READY_TIMEOUT_MS) {
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
        // The changelog tour shows nothing but the scene and its captions;
        // the chrome comes in when it ends (_onNewsEnd).
        if (this._news) {
          return
        }
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
      // Their catalogue, if the view hasn't fetched it yet (#258).
      this.scene.loadGalaxies()
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
    // Nor does the changelog tour's: each stop is the entry's own link.
    if (Shared.targets.tween !== null || this.homeShown || this._news) {
      return
    }
    clearTimeout(this._permalinkTimer)
    this._permalinkTimer = setTimeout(() => {
      // A tween started since (a goTo targets first): its end reschedules.
      if (Shared.targets.tween !== null || this.homeShown || this._news) {
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
    // The clock when it isn't running at real time (the `time:` token), the
    // info panel's lists as they were left (`info:`), the orbital elements
    // lit on the bodies' orbits (`orbits:`), then the drawer and the apps.
    const tokens = {
      time: encodeTimeToken(this.time.isPaused, this.time.timeScale),
      info: encodeInfoToken(this.controlPanel.uiState),
      orbits: encodeOrbitsToken(this.scene.getOrbitElements(), this.scene.getOrbitFade()),
      periodic: encodePeriodicToken(this.scene.getPeriodic(), this.scene.getPeriodicFrame()),
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
// Earth's path: the frame a satellite's link is in.
const EARTH_PATH = 'sun/earth'
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


/**
 * A flight's marker in `Shared.targets.tween` (Celestiary._flyTo): the app's
 * sign that the camera is travelling (following waits, the link isn't
 * written, ThreeUi.approach follows its progress).  Celestiary steps the
 * flight itself, on the frame clock, so its update only says whether it's
 * still going.
 *
 * @returns {object}
 */
function flightTween() {
  const tween = {travels: true, done: false, progress: 0}
  tween.update = () => !tween.done
  tween.travelProgress = () => tween.progress
  return tween
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
  // In Earth's frame (Satellites.md).
  satellite: () => EARTH_PATH,
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
