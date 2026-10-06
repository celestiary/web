import * as THREE from 'three'
import ARController from './ar/ARController'
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
import {decodeAppTokens, encodeAppTokens} from './store/appTokens'
import {goToEntry} from './search/commitEntry'
import {fetchPlaces} from './scene/Places'
import {parseTargetPath, resolvePlace, slug, targetFramePath, targetPath} from './targetPath'
import {elt} from './utils'


// Scene-annotation settings keys (see permalink.js SETTINGS_DEFAULTS).
// 'V' (Shift+v) toggles all of these together as a "presentation mode" —
// keys here are the lowercase per-overlay toggles ('a' asterisms, 'p'
// planet labels, etc.); the HTML chrome key 'v' is deliberately not in
// this list so users can hide overlays and chrome independently.
const SCENE_INFO_KEYS = ['a', 'l', 'p', 'o', 'e', 'c', 'g', 'x']


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
      if (Shared.targets.track) {
        this.scene.lookAtTarget()
      }
    }
    this.ui = new ThreeUi(canvasContainer, animCb)
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
    // 'v' (nav panels) is a Celestiary-level toggle — register the applier
    // so Scene.applySettings can drive it on permalink restore.
    this.scene.registerSettingApplier('v', () => this._toggleNav())
    this.loader = new Loader()
    this.controlPanel = new ControlPanel(navElt, this.loader)
    this.firstTime = true
    this._permalinkTimer = null
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
    this.onLoad = (name, obj) => {
      reifyMeasures(obj)
      this.scene.add(obj)
      const waiters = this._bodyWaiters[name]
      if (waiters) {
        delete this._bodyWaiters[name]
        waiters.forEach((cb) => cb())
      }
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
      this.animation.animateAtJD(this.ui.scene, this.time.simTimeJulianDay())
      this.ui.scene.updateMatrixWorld()
      try {
        this._restoreView(pl, frame)
      } catch (e) {
        console.error('Permalink restore failed:', e)
      }
      this._resolveTarget(resolved, (target) => this.scene.setTarget(target, {look: false}))
    } else {
      this._goToResolved(resolved, frame)
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
    if (frame.kind === 'star') {
      // The platform at the star, the world rebased so it's at the origin
      // (Scene.goTo); its frame's axes are the scene's.
      this.scene.goTo(frame.star)
      this.ui.scene.updateMatrixWorld()
      const starWorldPos = this.scene.worldGroup.localToWorld(this.scene.starPosition(frame.star))
      const platformWorldQuat = camera.platform.getWorldQuaternion(new THREE.Quaternion())
      camera.position.copy(latLngAltToLocal(
          pl.lat, pl.lng, pl.alt, frame.star.radius, new THREE.Quaternion(), platformWorldQuat))
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
  }


  /**
   * A path alone: go to its target, as 'g' would.
   *
   * @param {object} resolved The target's path, resolved (_resolveRef)
   * @param {{kind: string, name?: string, star?: object}} frame
   */
  _goToResolved(resolved, frame) {
    if (resolved.kind === 'star') {
      this.scene.goTo(frame.star)
      return
    }
    if (resolved.kind === 'place') {
      this._resolveTarget(resolved, (place) => {
        this.scene.land(place.body, place.lat, place.lng, place.alt, {target: place})
      }, () => {
        // Not in the catalogue: go to its body.
        this.scene.setTarget(resolved.body)
        this.scene.goTo()
      })
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
      this._navigate((window.location.hash || '#').substring(1))
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
    k.map('[', () => this.ui.setLimitingMagnitude(this.ui.userLimitingMagnitude() - 0.5),
        'Fewer stars (limiting magnitude down 0.5)',
        undefined,
        'Info')
    k.map(']', () => this.ui.setLimitingMagnitude(this.ui.userLimitingMagnitude() + 0.5),
        'More stars (limiting magnitude up 0.5)',
        undefined,
        'Info')

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
    'Follow current node',
    undefined,
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
    'Track target node',
    undefined,
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
    const panels = [elt('nav-id'), elt('top-right'), elt('search-bar'), elt('widgets-drawer'), elt('widgets-dock')]
    panels.forEach((panel) => {
      if (panel) {
        panel.style.display = this.navVisible ? 'none' : ''
      }
    })
    // Cesium's credits overlay: its display is the Cesium layers' (shown
    // only while a layer is active), so 'v' hides it by visibility.
    const credits = elt('cesium-credits')
    if (credits) {
      credits.style.visibility = this.navVisible ? 'hidden' : ''
    }
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


  /**
   * Schedule a debounced permalink URL update 1 s after the camera settles,
   * a setting or the drawer changes, or the target changes.
   */
  _schedulePermalinkUpdate() {
    if (Shared.targets.tween !== null) {
      return
    }
    clearTimeout(this._permalinkTimer)
    this._permalinkTimer = setTimeout(() => {
      // A tween started since (a goTo targets first): its end reschedules.
      if (Shared.targets.tween !== null) {
        return
      }
      const fragment = this.permalink()
      if (fragment) {
        history.replaceState(null, '', `#${fragment}`)
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
    return encodePermalink(
        path, d2000, lat, lng, alt, cam.quaternion, cam.fov, settings,
        encodeAppTokens(this.useStore.getState().widgets), from)
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
        path: `hip:${star.hipId}`,
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
