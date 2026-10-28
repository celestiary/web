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
import Galaxies, {galaxiesInView} from './Galaxies.js'
import LagrangeMarks from './LagrangeMarks.js'
import RegimeMarks from './RegimeMarks.js'
import newGrids from './Grids.js'
import newMilkyWay from './MilkyWay.js'
import OrbitDiagram from './orbitDiagram.js'
import {CODES, keyOfCode} from './orbitElements.js'
import {G, collinearDistances, hillRadius, massKg, synchronousOrbit} from './lagrange.js'
import {REGIMES, semiMajorAxisOf, sunSyncInclination} from './regimes.js'
import {FAMILIES, PERIODIC_DATA_URL, familyMember, familyOfCode, sampleMember, southern} from './periodicOrbits.js'
import {manifolds} from './manifolds.js'
import CraftTrack from './craft/CraftTrack.js'
import {appBodies} from './craft/bodies.js'
import {FLIGHT_CATALOG, flightOf} from './craft/catalog.js'
import {ORBIT_FADE_DEFAULT} from '../permalink.js'
import Planet from './Planet.js'
import SpriteSheet from './SpriteSheet.js'
import Spacecraft from './Spacecraft.js'
import Star from './Star.js'
import Stars from './Stars.js'
import StellarFrame from './StellarFrame.js'
import {Fade, FadeDriver, fadeObject} from './fade.js'
import {latLngAltToBodyFixed} from '../coords.js'
import {newCameraGoToTween, newCameraLandTween, newCameraLookTween} from '../camera.js'
import {faceKeepingRoll} from '../faceKeepingRoll.js'
import {rehangPlatform} from '../follow.js'
import {newGaiaPopulation} from './gaia/gaiaPopulation.js'
import {pickSurfaceLatLng} from './Picker.js'
import {SATELLITES_LOAD_DIST} from './satellites/names.js'
import {hitLabel, labelBoxes} from './labelPick.js'
import {labelTextColor} from '../shared.js'
import * as Shared from '../shared.js'
import * as Utils from '../utils.js'


const ELEMENT_CODE_SET = new Set(CODES)
// The synchronous orbits with names of their own (LagrangeMarks).
const SYNC_NAMES = {earth: 'geostationary orbit', mars: 'areostationary orbit'}


/**
 * @param {object} [body] a body's props
 * @param {object} [primary] its primary's
 * @returns {number} the body's share of the two's mass, m / (M + m), or 0
 *     without both masses
 */
function massRatio(body, primary) {
  const mass = (props) => Number(props?.mass?.scalar ?? props?.mass)
  const m = mass(body)
  const total = m + mass(primary)
  return m > 0 && total > 0 ? m / total : 0
}


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
// How soon a guest page's ground height must come to aim a landing again,
// ms (_reaimLanding): later, the approach is under way, and the ground floor
// lifts the camera instead.
const REAIM_MS = 500
// A go to a satellite arrives above it unless the line in already does:
// the cosine of the line from the vertical, at least.
const SAT_ARRIVAL_MIN_UP = 0.3


/**
 * The space networks (networks/Networks.md), each an overlay of its own:
 * `S` Starlink, `I` Iridium and its crosslinks, `D` NASA's Deep Space
 * Network and its live links.  Off by default, and loaded (their chunk
 * and data) the first time one is shown.
 */
export const NETWORK_KEYS = Object.freeze(['S', 'I', 'D'])
/**
 * The networks that draw a group of Earth's satellites, whole: while one's
 * overlay is drawn, the population leaves that group's points to it
 * (Population.setGroupDrawer; Networks.md, one copy, one drawing).
 */
export const NETWORK_GROUPS = Object.freeze({S: 'starlink', I: 'iridium'})


/**
 * The settings that are scene overlays, each faded in and out as a group
 * (scene/fade.js; DESIGN.md "Overlays & visibility groups"): orbits, planet
 * and place labels, star labels, asterisms, the three grids, galaxy labels,
 * the human expansion lines, the space networks.  The Milky Way (`U`) is
 * the sky's own light, not an overlay, and `C` draws nothing yet.
 */
export const OVERLAY_KEYS = Object.freeze(['o', 'p', 'l', 'a', 'e', 'c', 'g', 'G', 'x', ...NETWORK_KEYS])


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
    // Whether the first load's reveal has begun (Celestiary.frame): what
    // arrives from then on fades in rather than pops (Earth's first cloud
    // map, CloudMap.gain; the stars' tiles have Stars.revealed).
    this.revealed = false
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
      G: false, // galaxy labels (SPARC's), gated by magnitude: Galaxies.labelsVisible
      C: false, // globular-cluster labels: none yet (#228)
      x: true, // human expansion lines, once computed
      S: false, // Starlink (networks/Networks.md)
      I: false, // Iridium and its crosslinks
      D: false, // the Deep Space Network and its live links
      v: true, // nav panels / heads-up display (Celestiary-owned, see registerSettingApplier)
    }
    // Each overlay's fade (OVERLAY_KEYS), stepped once a frame by the
    // driver (Celestiary.frame): toggles fade rather than switch, and a
    // group is drawn only while it is shown (fade.js).
    this.overlays = new FadeDriver()
    this.fades = {}
    for (const key of OVERLAY_KEYS) {
      this.fades[key] = this.overlays.add(new Fade({
        on: this._settings[key],
        onShow: (shown) => this._showOverlay(key, shown),
        nodes: () => this._overlayNodes(key),
      }))
    }
    for (const key of ['e', 'c', 'g']) {
      this._joinOverlay(key, this._overlayNodes(key)[0])
    }
    // Custom appliers for settings keys that the Scene doesn't own directly
    // (Celestiary registers 'v' here).  applySettings dispatches to these
    // alongside the built-in toggle methods.
    this._customAppliers = {}
    // Set by Celestiary; called whenever any settings flag flips so the
    // permalink can be updated.
    this.onSettingsChange = null
    // The orbital elements lit on each body's orbit (showOrbitElements):
    // body name → Set of element codes (orbitElements.js ELEMENT_CODES),
    // in the link as the `orbits:` token; and the one a hover previews.
    this._orbitElements = new Map
    this._orbitPreview = null
    // The diagrams' opacity at the far side of their orbits (setOrbitFade).
    this._orbitFade = ORBIT_FADE_DEFAULT
    // The bodies whose orbit diagrams are showing.
    this._orbitDiagramBodies = new Set
    // The three-body orbits shown (periodicOrbits.js): a pair's secondary →
    // Set of family codes, in the link as the `periodic:` token; whether
    // they're drawn turning with the pair or fixed in space; and the
    // members made so far, by `secondary:family`.
    this._periodic = new Map
    this._periodicFrame = 'rotating'
    this._periodicMembers = new Map
    // Whether the shown families' invariant manifolds are drawn too
    // (manifolds.js), and the tubes made so far, by `secondary:family`.
    this._periodicManifolds = false
    this._manifoldTubes = new Map
    // The craft flown (craft/flights.js): link code → departure (JDE, TT),
    // in the link as the `craft:` token; their tracks as drawn, by code.
    // VSOP87C's function (Animation.vsopAt), for the Sun: set by Celestiary.
    this._craft = new Map
    this._craftTracks = new Map
    this.vsopAt = null
    // How the craft are made (craft/flights.js, and the integrator behind
    // it), loaded the first time one is flown: undefined before, the
    // promise while it loads, then its module.
    this._flights = undefined
    this.loadFlights = () => import('./craft/flights.js')
    // Whether vsopAt is VSOP87C itself yet (Animation.vsopReady): set by
    // Celestiary.  Absent, as in tests, it's taken as ready.
    this.vsopReady = null
    // The flights' data files (FLIGHT_CATALOG's `data`), by URL: 'loading', the
    // file, or null where it couldn't load; and the flights flown that
    // came out null (none from that date).
    this._craftData = new Map
    this._craftNone = new Set
    this.loadCraftData = (url) => fetch(url).then((rsp) => {
      if (!rsp.ok) {
        throw new Error(`${url}: ${rsp.status}`)
      }
      return rsp.json()
    })
    // JPL's catalogue members (public/data/periodicOrbits.json), loaded the
    // first time a family is shown: undefined before, 'loading', the file,
    // or null where it couldn't load (the app's own members then).
    this._periodicData = undefined
    this.loadPeriodicData = () => fetch(PERIODIC_DATA_URL).then((rsp) => {
      if (!rsp.ok) {
        throw new Error(`${PERIODIC_DATA_URL}: ${rsp.status}`)
      }
      return rsp.json()
    })
    // Set by Celestiary; called with ('track' | 'follow', on) when 't' or
    // 'f' (or a link) switches that mode, for the readout.
    this.onModeChange = null
    // Where following took the camera platform from (when 'f' rode a body
    // the camera wasn't at), so that turning it off puts the camera back in
    // its frame (syncFollow); null when it hasn't.
    this._followHome = null
    // The node the camera was riding when following was turned off, until
    // syncFollow has detached the camera from it.
    this._detachFrom = null
    // Populations round bodies (population/Population.md), by body: Earth's
    // satellites (satellites/Satellites.md), their chunk and snapshot
    // imported when something first needs them (loadSatellites), and any
    // other a loader adds (addPopulation).  Each hangs from its body's
    // planetTilt.
    this.populations = new Map
    this.importSatellites = () => import('./satellites/loadSatellites.js')
    // The space networks (networks/Networks.md), by overlay key: their
    // chunk and each one's data, imported when its overlay is first shown
    // (loadNetwork); Starlink and Iridium hung from Earth's planetTilt as
    // the satellites are, the DSN too (it turns its dishes with Earth).
    this.networks = {}
    this.networkData = {}
    this._networksPending = {}
    // In the satellites' chunk, not one of their own: a chunk of their own
    // changed which modules esbuild shares between which lazy chunks, and
    // split the first load's into two more requests (Networks.md, "What
    // loads when").
    this.importNetworks = () => import('./satellites/loadSatellites.js')
    // A link's population state for bodies whose population isn't in yet
    // (restorePopulations), and who to tell of one added (onPopulationAdded).
    this._pendingPopulations = new Map
    this._populationListeners = []
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
   * Special-case keys are merged in here rather than tracked in
   * `_settings`:
   *
   *   - `L` (landed) — sourced from `Shared.targets.landed` so any code
   *     path that pins or unpins the surface mode (Scene.land, Scene.goTo)
   *     drives this without going through a Scene toggle.
   *   - `T` (tracking) — sourced from `Shared.targets.track`
   *     (Scene.setTracking says so to the link).
   *   - `F` (following) — on while `Shared.targets.follow` holds a body
   *     (Scene.setFollowing says so to the link).
   *   - `A` (AR-fallback) — defaults false here; the permalink writer in
   *     Celestiary._schedulePermalinkUpdate overwrites it with the live
   *     ARController.isActive() value before encoding.  The default-false
   *     here ensures every key in SETTINGS_DEFAULTS has a slot, satisfying
   *     the round-trip contract for code that snapshots getSettings().
   *
   * @returns {object}
   */
  getSettings() {
    return {
      ...this._settings,
      L: Shared.targets.landed,
      A: false,
      T: Shared.targets.track,
      F: Boolean(Shared.targets.follow),
    }
  }


  /**
   * Set the settings a page opens with (a link's `s=`, or the defaults),
   * before anything is built: each overlay, the Milky Way and the stars'
   * asterisms are built shown or hidden as these say (overlayShown), so
   * what they hide is never drawn, not drawn and then turned off.  Nothing
   * is announced (onSettingsChange): this is the state the page starts in.
   *
   * @param {object} settings flat {key: bool} map (permalink.js SETTINGS_DEFAULTS)
   * @param {object} [opts]
   * @param {boolean} [opts.hold] Hold every overlay hidden, whatever its
   *   setting, until revealOverlays fades it in (the first load's
   *   choreography, Celestiary)
   */
  initSettings(settings, {hold = false} = {}) {
    for (const key of Object.keys(this._settings)) {
      if (typeof settings[key] === 'boolean') {
        this._settings[key] = settings[key]
      }
    }
    for (const key of OVERLAY_KEYS) {
      this.fades[key].set(hold ? false : this._settings[key], {instant: true})
    }
    this.ui.scene.traverse((obj) => {
      if (obj.name === 'MilkyWay') {
        obj.visible = this._settings.U
      }
    })
    if (this._settings.a) {
      this._buildAsterisms()
    }
    // The expansion app's switch mirrors 'x'.
    this.ui.useStore?.setState?.({isColonizationVisible: this._settings.x})
  }


  /**
   * Fade overlays held by initSettings in, those whose settings are on.
   *
   * @param {Array<string>} keys Of OVERLAY_KEYS
   */
  revealOverlays(keys) {
    for (const key of keys) {
      this.fades[key]?.set(this._settings[key])
    }
  }


  /**
   * Fade every overlay out, whatever its setting, until revealOverlays fades
   * it in again: back to the homepage (Celestiary.showHome).  The settings
   * are kept.
   */
  holdOverlays() {
    for (const key of OVERLAY_KEYS) {
      this.fades[key]?.set(false)
    }
  }


  /**
   * Whether an overlay group is drawn now: what a part of it built later
   * (a body loaded, the asterisms) starts as.
   *
   * @param {string} key Of OVERLAY_KEYS
   * @returns {boolean}
   */
  overlayShown(key) {
    return this.fades[key]?.shown ?? Boolean(this._settings[key])
  }


  /**
   * A node built into an overlay group: shown as the group is, and its
   * materials take the group's opacity (fade.js fadeObject).
   *
   * @param {string} key Of OVERLAY_KEYS
   * @param {?object} node
   */
  _joinOverlay(key, node) {
    if (!node) {
      return
    }
    node.visible = this.overlayShown(key)
    fadeObject(node, this.fades[key].uniform)
  }


  /**
   * @param {string} key Of OVERLAY_KEYS
   * @returns {Array<?object>} The group's nodes now (some may be null:
   *   not built yet)
   */
  _overlayNodes(key) {
    switch (key) {
      case 'o': {
        // The solar wind's streamlines are a diagram of the same kind
        // (sun/SolarWind.js), and so are the target's Lagrange points.
        const lagrange = [...this._lagrange?.values() ?? []].filter((m) => m.parent)
        const regimes = [...this._regimes?.values() ?? []].filter((m) => m.parent)
        return [...this._namedUnderSun('orbit'), this.objects['sun']?.sunLayers?.wind,
          ...lagrange, ...lagrange.map((m) => m.syncRing), ...regimes, ...[...this.populations.values()].map((p) => p.marks),
          ...this._craftTracks.values()]
      }
      case 'p': {
        // Bodies' names, and the places and lat/lng markers on them (the
        // 'p' group: togglePlanetLabels).
        const nodes = this._namedUnderSun('label LOD')
        for (const obj of Object.values(this.objects)) {
          nodes.push(obj?.places, obj?._tempMarker)
        }
        return nodes
      }
      case 'l': return [this.stars?.labelLOD]
      case 'a': return [this.asterisms]
      case 'e': return [this.grids?.equatorial]
      case 'c': return [this.grids?.ecliptic]
      case 'g': return [this.grids?.galactic]
      case 'G': return [this.galaxies?.labelPoints]
      case 'x': return [this.colonization]
      case 'S':
      case 'I':
      case 'D': return [this.networks[key]]
      default: return []
    }
  }


  /**
   * @param {string} name
   * @returns {Array<object>} The nodes of that name under the Sun
   */
  _namedUnderSun(name) {
    const nodes = []
    if (this.objects['sun']) {
      Utils.visitFilterProperty(this.objects['sun'], 'name', name, (node) => nodes.push(node))
    }
    return nodes
  }


  /**
   * An overlay group starts or stops being drawn (Fade's onShow): when a
   * fade in starts, and when a fade out ends.
   *
   * @param {string} key Of OVERLAY_KEYS
   * @param {boolean} shown
   */
  _showOverlay(key, shown) {
    if (key === 'G') {
      // Built when first shown, and gated by magnitude (Galaxies.js).
      this.galaxies?.setLabelsVisible(shown)
      return
    }
    if (key === 'o') {
      this.orbitsVisible = shown
    }
    // A network is loaded the first time it's shown.
    if (shown && NETWORK_KEYS.includes(key)) {
      this.loadNetwork(key)
    }
    for (const node of this._overlayNodes(key)) {
      if (node) {
        node.visible = shown
      }
    }
  }


  /**
   * Turn an overlay on or off: it fades (fade.js), and the link hears of it.
   *
   * @param {string} key Of OVERLAY_KEYS
   * @param {boolean} on
   * @returns {boolean} Whether that changed it
   */
  _setOverlay(key, on) {
    if (this._settings[key] === on) {
      return false
    }
    this._settings[key] = on
    this.fades[key].set(on)
    this.onSettingsChange?.()
    return true
  }


  /**
   * Drive each settings toggle to match the requested state, idempotently:
   * `V` (presentation mode), AR's enter and exit, a test.  Any key whose
   * target value already matches the current value is a no-op.  Overlays
   * fade.  (A page's first settings are initSettings', before the scene is
   * built.)
   *
   * @param {object} requested flat {key: bool} map
   */
  applySettings(requested) {
    const dispatch = {
      a: () => this.toggleAsterisms(),
      l: () => this.toggleStarLabels(),
      p: () => this.togglePlanetLabels(),
      o: () => this.toggleOrbits(),
      e: () => this.toggleGridEquatorial(),
      c: () => this.toggleGridEcliptic(),
      g: () => this.toggleGridGalactic(),
      U: () => this.toggleGalaxy(),
      G: () => this.toggleGalaxyLabels(),
      C: () => this.toggleGlobularLabels(),
      x: () => this.toggleColonization(),
      S: () => this.toggleNetwork('S'),
      I: () => this.toggleNetwork('I'),
      D: () => this.toggleNetwork('D'),
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
    // Its overlays (its orbit, name, places; the Sun's wind) take their
    // groups' state and fades.
    Utils.visitFilterProperty(obj3d, 'name', 'orbit', (node) => this._joinOverlay('o', node))
    Utils.visitFilterProperty(obj3d, 'name', 'label LOD', (node) => this._joinOverlay('p', node))
    this._joinOverlay('p', this.objects[name]?.places)
    if (name === 'sun') {
      this._joinOverlay('o', this.objects['sun']?.sunLayers?.wind)
    }
    if (name === 'earth') {
      this._watchForSatellites()
      this._hangNetworks()
    }
    this._hangPopulations()
    // A link's lit elements for a body that has only now loaded.
    if (this._orbitElements.has(name)) {
      this._syncOrbitDiagrams()
    }
    // A link's craft about a body that has only now loaded.
    if ([...this._craft.keys()].some((c) => flightOf(c).centre === name)) {
      this._syncCraft()
    }
    // The target's pairs and regimes, if this is one of their bodies.
    if (this._lagrange && Shared.targets.obj) {
      this._syncLagrange()
      this._syncRegimes()
    }
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
        // Gaia's stars past the catalogue's, in its frame (Gaia.md); none
        // in the tests' scene or with ?gaia=0.
        this.gaia = newGaiaPopulation(this.ui)
        if (this.gaia) {
          this.stars.add(this.gaia)
        }
        // The toggles that decide whether the target star's name is drawn
        // (TargetLabel.js), as shown and with what opacity, and a target
        // set before the stars were here.
        this.stars.labelSettings = () => ({
          l: this.fades.l.shown, p: this.fades.p.shown,
          lOpacity: this.fades.l.opacity, pOpacity: this.fades.p.opacity,
        })
        // Which names are wanted (Stars._syncLabels): those the limiting
        // magnitude reaches, and the target's.
        this.stars.labelState = () => ({
          limit: this.ui.limitingMagnitude?.() ?? Infinity,
          target: Shared.targets.label?.kind === 'star' ? Shared.targets.label.star : null,
        })
        this._joinOverlay('l', this.stars.labelLOD)
        this._labelTargetStar(Shared.targets.label)
        if (this._settings.a) {
          this._buildAsterisms()
        }
        this._markStarsReady()
        return this.stars
      case 'star': return new Star(props, this.objects, this.ui)
      case 'planet': return new Planet(this, props)
      case 'moon': return new Planet(this, props, true)
      case 'spacecraft': return new Spacecraft(this, props)
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


  /**
   * The orbital elements lit on a body's orbit (orbitDiagram.js), from the
   * info panel's orbit list: any of a body's six, on any number of bodies
   * at once, to compare (DESIGN.md "Orbital elements").  Animation lays
   * each showing diagram on its body's elements of the date every frame
   * (layOrbitDiagram).
   *
   * @param {string} body
   * @returns {Set<string>} its lit element codes (orbitElements.js ELEMENT_CODES)
   */
  orbitElementsOf(body) {
    return new Set(this._orbitElements.get(body) ?? [])
  }


  /** @returns {Map<string, Set<string>>} every body's lit element codes */
  getOrbitElements() {
    return new Map([...this._orbitElements].map(([body, codes]) => [body, new Set(codes)]))
  }


  /**
   * Light these of a body's elements, and only these; none puts its
   * diagram away.
   *
   * @param {string} body
   * @param {Array<string>|Set<string>} codes element codes; unknown ones are dropped
   */
  setOrbitElements(body, codes) {
    const valid = new Set([...codes].filter((c) => ELEMENT_CODE_SET.has(c)))
    if (valid.size > 0) {
      this._orbitElements.set(body, valid)
    } else {
      this._orbitElements.delete(body)
    }
    this._syncOrbitDiagrams()
    this.onSettingsChange?.()
  }


  /**
   * @param {string} body
   * @param {string} code
   */
  toggleOrbitElement(body, code) {
    const codes = this.orbitElementsOf(body)
    if (codes.has(code)) {
      codes.delete(code)
    } else {
      codes.add(code)
    }
    this.setOrbitElements(body, codes)
  }


  /** @returns {number} the diagrams' opacity at the far side of their orbits */
  getOrbitFade() {
    return this._orbitFade
  }


  /**
   * Fade every orbit diagram from its body to this opacity at the far side
   * of its orbit (orbitDiagram.js setFadeMin): 1 is no fade.
   *
   * @param {number} fade 0 to 1
   * @param {boolean} [quiet] Don't announce it (a link putting it back)
   */
  setOrbitFade(fade, quiet = false) {
    this._orbitFade = Math.min(Math.max(Number(fade) || 0, 0), 1)
    for (const node of Object.values(this.objects)) {
      node?.orbitDiagram?.setFadeMin(this._orbitFade)
    }
    if (!quiet) {
      this.onSettingsChange?.()
    }
  }


  /** Put every body's diagram away. */
  clearOrbitElements() {
    this._orbitElements.clear()
    this._syncOrbitDiagrams()
    this.onSettingsChange?.()
  }


  /**
   * Put a link's lit elements back (the `orbits:` token), in place of any.
   *
   * @param {Map<string, Set<string>>} elements
   */
  restoreOrbitElements(elements) {
    this._orbitElements.clear()
    for (const [body, codes] of elements) {
      const valid = [...codes].filter((c) => ELEMENT_CODE_SET.has(c))
      if (valid.length > 0) {
        this._orbitElements.set(body, new Set(valid))
      }
    }
    this._syncOrbitDiagrams()
  }


  /**
   * Light one more element while it's hovered, without keeping it.
   *
   * @param {?string} body
   * @param {?string} code null to end the preview
   */
  previewOrbitElement(body, code) {
    this._orbitPreview = body && code ? {body, code} : null
    this._syncOrbitDiagrams()
  }


  /**
   * Show each body's diagram with its lit elements and any preview, made
   * on first use beside its orbit line (in the primary's frame, on the
   * overlay layer, as the line is), and hide the rest.  Shown whatever `o`
   * says: they were asked for.
   */
  _syncOrbitDiagrams() {
    const lit = new Map([...this._orbitElements].map(([body, codes]) => [body, new Set(codes)]))
    const preview = this._orbitPreview
    if (preview) {
      lit.set(preview.body, (lit.get(preview.body) ?? new Set).add(preview.code))
    }
    for (const body of this._orbitDiagramBodies) {
      if (!lit.has(body)) {
        const diagram = this.objects[`${body}.orbitPosition`]?.orbitDiagram
        if (diagram) {
          diagram.visible = false
        }
        this._orbitDiagramBodies.delete(body)
      }
    }
    for (const [body, codes] of lit) {
      const node = this.objects[`${body}.orbitPosition`]
      if (!node) {
        // Not loaded yet: add() comes back here when it is.
        continue
      }
      if (!node.orbitDiagram) {
        const primary = this.objects[body]?.props?.parent
        node.orbitDiagram = new OrbitDiagram({layer: Shared.OVERLAY_LAYER, labels: {
          // The moons' elements are in their Laplace plane or equator, from
          // its node on the ICRF equator; the rest's in the ecliptic.
          direction: node.orbit?.referencePole ? 'reference direction (node on the ICRF equator)' :
            '♈︎ vernal equinox',
          // Earth's osculating elements are the Earth-Moon barycentre's.
          body: body === 'earth' ? 'Earth–Moon barycentre' : null,
          barycentre: `${Utils.capitalize(primary ?? '')}–${Utils.capitalize(body)} barycentre`,
        }})
        node.orbitDiagram.setMassRatio(massRatio(this.objects[body]?.props, this.objects[primary]?.props))
        node.orbitDiagram.setFadeMin(this._orbitFade)
        node.parent.add(node.orbitDiagram)
      }
      node.orbitDiagram.highlight([...codes].map((c) => keyOfCode(c, node.orbit)).filter(Boolean))
      node.orbitDiagram.visible = true
      this._orbitDiagramBodies.add(body)
    }
    // One name for a point two diagrams share: a primary's place on its own
    // orbit that is the barycentre with its moon (Earth's heliocentric
    // place, the Earth-Moon barycentre) is named by the moon's diagram.
    for (const body of this._orbitDiagramBodies) {
      const diagram = this.objects[`${body}.orbitPosition`]?.orbitDiagram
      const named = new Set([...this._orbitDiagramBodies]
          .filter((b) => this.objects[b]?.props?.parent === body)
          .map((b) => this.objects[`${b}.orbitPosition`]?.orbitDiagram?.litLabel('barycentre')))
      diagram?.hideLabel?.('body', named.has(diagram.litLabel('body')))
    }
  }


  /**
   * The pairs whose Lagrange points, Hill sphere and synchronous orbit the
   * target shows (Lagrange.md): its own with its primary, and its own with
   * its most massive moon.  The Earth: Sun-Earth and Earth-Moon; the Sun:
   * Sun-Jupiter; Tethys: Saturn-Tethys.
   *
   * @param {string} name a body's
   * @returns {Array<Array<string>>} [primary, secondary] pairs
   */
  lagrangePairsOf(name) {
    const props = this.objects[name]?.props
    if (!props) {
      return []
    }
    const pairs = []
    if (this.objects[props.parent]?.props?.mass && props.mass && props.orbit) {
      pairs.push([props.parent, name])
    }
    const mass = (b) => massKg(this.objects[b]?.props?.mass)
    const moon = (props.system ?? []).filter((b) => mass(b) > 0 && this.objects[b]?.props?.orbit)
        .sort((x, y) => mass(y) - mass(x))[0]
    if (moon && props.mass) {
      pairs.push([name, moon])
    }
    return pairs
  }


  /**
   * Show the target's pairs' marks (lagrangePairsOf), made on first use, and
   * take the rest out of the scene.  They're in the orbits group (`o`).
   */
  _syncLagrange() {
    this._lagrange ??= new Map
    const target = Shared.targets.obj?.props?.name
    const wanted = new Set((target ? this.lagrangePairsOf(target) : []).map((p) => p.join('-')))
    for (const [key, marks] of this._lagrange) {
      if (!wanted.has(key) && marks.parent) {
        marks.removeFromParent()
        marks.syncRing?.removeFromParent()
        delete this.objects[`${key.split('-')[1]}.orbitPosition`]?.lagrange
      }
    }
    for (const key of wanted) {
      const [primary, secondary] = key.split('-')
      const node = this.objects[`${secondary}.orbitPosition`]
      if (!node) {
        continue
      }
      let marks = this._lagrange.get(key)
      if (!marks) {
        marks = this._newLagrange(primary, secondary)
        this._lagrange.set(key, marks)
        this._joinOverlay('o', marks)
        this._joinOverlay('o', marks.syncRing)
      }
      if (!marks.parent) {
        // Shown as the group is now; it may have turned while they were out.
        marks.visible = this.overlayShown('o')
        node.parent.add(marks)
        if (marks.syncRing) {
          marks.syncRing.visible = marks.visible
          this.objects[`${secondary}.planetTilt`]?.add(marks.syncRing)
        }
        node.lagrange = marks
      }
    }
    this._syncPeriodic()
  }


  /**
   * The numbers of the space around a pair (lagrange.js): its mass ratio,
   * the secondary's Hill radius and synchronous orbit, and the collinear
   * points' distances from the secondary at its mean distance.
   *
   * @param {string} primary
   * @param {string} secondary
   * @returns {object} {name, secondary, mu, a, hill, sync, l1, l2}: metres
   */
  pairFacts(primary, secondary) {
    const props = this.objects[secondary].props
    const kg = (b) => massKg(this.objects[b]?.props?.mass)
    // The secondary with its moons (the Earth with the Moon, Pluto with
    // Charon): the three-body problem's second mass.
    const m = (props.system ?? []).reduce((sum, b) => sum + (kg(b) || 0), kg(secondary))
    const mu = m / (m + kg(primary))
    const a = Number(props.orbit.semiMajorAxis?.scalar ?? props.orbit.semiMajorAxis)
    const hill = hillRadius(a, props.orbit.eccentricity ?? 0, mu)
    const sync = synchronousOrbit({
      gm: G * kg(secondary),
      rotationSecs: Number(props.siderealRotationPeriod?.scalar ?? props.siderealRotationPeriod),
      radius: Number(props.radius?.scalar ?? props.radius), hill,
    })
    const {l1, l2} = collinearDistances(mu)
    // The bodies' radii in units of the separation, where the three-body
    // trajectories (manifolds.js) stop.
    const radius = (b) => Number(this.objects[b]?.props?.radius?.scalar ?? this.objects[b]?.props?.radius) || 0
    return {
      name: `${Utils.capitalize(primary)}–${Utils.capitalize(secondary)}`, secondary: Utils.capitalize(secondary),
      mu, a, hill, sync, l1: l1 * a, l2: l2 * a, syncName: SYNC_NAMES[secondary],
      radii: {primary: radius(primary) / a, secondary: radius(secondary) / a},
    }
  }


  /**
   * The space around a body for its info panel: its pair with its primary's
   * facts (pairFacts), or null for a body that orbits nothing with a mass.
   *
   * @param {string} name
   * @returns {?object}
   */
  spaceAround(name) {
    const pair = this.lagrangePairsOf(name).find((p) => p[1] === name)
    const regimes = this.regimesOf(name)
    if (!pair && !regimes) {
      return null
    }
    return {...(pair ? this.pairFacts(...pair) : {}), regimes}
  }


  /**
   * A body's orbital regimes (regimes.js), as the panel lists them.
   *
   * @param {string} name
   * @returns {?Array<string>} null for a body with none
   */
  regimesOf(name) {
    const body = REGIMES[name]
    if (!body) {
      return null
    }
    const km = (m) => `${Math.round(m / 1e3).toLocaleString('en-US')} km`
    const year = this._yearSecs(name)
    return [
      ...body.shells.map((s) => `${s.text}: ${km(s.from)} to ${km(s.to)} up`),
      ...body.spheres.map((s) => s.text),
      ...body.orbits.map((o) => {
        const i = o.sunSync ? sunSyncInclination(body, year, semiMajorAxisOf(body, o)) : null
        return i === null ? o.text : `${o.text}, inclined ${i.toFixed(1)}°`
      }),
      ...(body.notes ?? []),
    ]
  }


  /**
   * @param {string} name
   * @returns {number} its sidereal orbit period, seconds
   */
  _yearSecs(name) {
    const period = this.objects[name]?.props?.orbit?.siderealOrbitPeriod
    return Number(period?.scalar ?? period)
  }


  /**
   * Show the target's orbital regimes (regimes.js), made on first use under
   * its planetTilt, and take any other body's out of the scene.  They're in
   * the orbits group (`o`), as the Lagrange points are.
   */
  _syncRegimes() {
    this._regimes ??= new Map
    const target = Shared.targets.obj?.props?.name
    for (const [name, marks] of this._regimes) {
      if (name !== target && marks.parent) {
        marks.removeFromParent()
        delete this.objects[`${name}.orbitPosition`]?.regimes
      }
    }
    const tilt = this.objects[`${target}.planetTilt`]
    if (!REGIMES[target] || !tilt) {
      return
    }
    let marks = this._regimes.get(target)
    if (!marks) {
      // Cislunar space reaches out to the Earth-Moon L2.
      const radii = {}
      for (const moon of this.objects[target]?.props?.system ?? []) {
        if (this.objects[moon]?.props?.orbit && this.objects[target]?.props?.mass) {
          const f = this.pairFacts(target, moon)
          radii[moon] = f.a + f.l2
        }
      }
      marks = new RegimeMarks(REGIMES[target], {name: target, yearSecs: this._yearSecs(target), radii},
          Shared.OVERLAY_LAYER)
      this._regimes.set(target, marks)
      this._joinOverlay('o', marks)
    }
    if (!marks.parent) {
      marks.visible = this.overlayShown('o')
      tilt.add(marks)
      this.objects[`${target}.orbitPosition`].regimes = marks
    }
  }


  /**
   * Load Earth's satellites when the view could show them: the camera
   * within SATELLITES_LOAD_DIST of Earth with the orbits (`o`) shown, so
   * the homepage, whose overlays are held, doesn't fetch them.  A watcher
   * under Earth's planetTilt asks each frame until they've loaded.
   */
  _watchForSatellites() {
    const tilt = this.objects['earth.planetTilt']
    if (!tilt || this._satelliteWatch) {
      return
    }
    const watch = new Object3D
    this._satelliteWatch = watch
    watch.name = 'satellite watch'
    const at = new Vector3
    const cam = new Vector3
    watch.preAnimCb = () => {
      if (this.satellites || this._satellitesPending || !this.ui?.camera || !this.overlayShown('o')) {
        return
      }
      if (this.ui.camera.getWorldPosition(cam).distanceTo(tilt.getWorldPosition(at)) < SATELLITES_LOAD_DIST) {
        this.loadSatellites()
      }
    }
    tilt.add(watch)
  }


  /**
   * Earth's satellites, loaded once for the page (their chunk and the
   * snapshot), hung from Earth's planetTilt and joined to the orbits group:
   * what the view near Earth, a `sat:` link and the first search ask for.
   * A failure is logged and asked again by the next need.
   *
   * @returns {Promise<?object>} the Satellites, or null if they didn't load
   */
  loadSatellites() {
    if (this.satellites) {
      return Promise.resolve(this.satellites)
    }
    this._satellitesPending ??= this.importSatellites()
        .then((m) => m.loadSatellites({layer: Shared.OVERLAY_LAYER, camera: this.ui?.camera}))
        .then(({satellites, data}) => {
          this.satelliteData = data
          this.addPopulation(satellites)
          this._satelliteWatch?.removeFromParent()
          const waiters = this._satellitesWaiters ?? []
          this._satellitesWaiters = null
          waiters.forEach((cb) => cb(satellites))
          return satellites
        })
        .catch((err) => {
          console.warn('Satellites didn\'t load:', err)
          this._satellitesPending = null
          return null
        })
    return this._satellitesPending
  }


  /**
   * @param {function(object): void} cb Called with the Satellites once
   *   they're in.  Waiting doesn't load them: loadSatellites does.
   */
  onSatellitesReady(cb) {
    if (this.satellites) {
      cb(this.satellites)
    } else {
      (this._satellitesWaiters ??= []).push(cb)
    }
  }


  /**
   * A space network (networks/Networks.md), loaded once for the page: its
   * chunk and data, hung from Earth's planetTilt and joined to its overlay
   * group.  Asked for when its overlay is first shown.  A failure is logged
   * and asked again the next time it's shown.
   *
   * @param {string} key Of NETWORK_KEYS
   * @returns {Promise<?object>} the network's scene object, or null if it
   *   didn't load
   */
  loadNetwork(key) {
    if (this.networks[key]) {
      return Promise.resolve(this.networks[key])
    }
    this._networksPending[key] ??= this.importNetworks()
        .then((m) => m.loadNetwork(key, {layer: Shared.OVERLAY_LAYER, camera: this.ui?.camera}))
        .then(({network, data}) => {
          this.networks[key] = network
          this.networkData[key] = data
          // Labels it makes later take the group's fade too.
          network.fadeUniform = this.fades[key].uniform
          this._joinOverlay(key, network)
          this._hangNetworks()
          this._shareNetworks()
          return network
        })
        .catch((err) => {
          console.warn(`Network ${key} didn't load:`, err)
          this._networksPending[key] = null
          return null
        })
    return this._networksPending[key]
  }


  /** Hang the loaded networks from Earth's planetTilt, once it's here. */
  _hangNetworks() {
    const tilt = this.objects['earth.planetTilt']
    for (const network of Object.values(this.networks)) {
      if (tilt && network && network.parent !== tilt) {
        tilt.add(network)
      }
    }
  }


  /** @returns {?object} Earth's satellites (the CelesTrak loader's population), once in */
  get satellites() {
    return this.populations.get('earth') ?? null
  }


  /**
   * Add a population round a body (population/Population.js): hung from the
   * body's planetTilt (now, or when the body loads), in the orbits group,
   * with a link's state for it applied, its changes rewriting the link, and
   * onPopulationAdded's listeners told.  The one way a population comes
   * in: Earth's satellites (loadSatellites), and any other loader's.
   *
   * @param {object} population
   */
  addPopulation(population) {
    this.populations.set(population.body, population)
    this._joinOverlay('o', population.marks)
    population.onChange = () => this.onSettingsChange?.()
    const pending = this._pendingPopulations.get(population.body)
    if (pending) {
      this._pendingPopulations.delete(population.body)
      this._applyPopulationState(population, pending)
    }
    this._hangPopulations()
    this._shareNetworks()
    this._populationListeners.forEach((cb) => cb(population))
  }


  /**
   * Leave Earth's Starlink and Iridium points to their networks' overlays
   * while those are drawn (NETWORK_GROUPS), once both the population and
   * the network are in, whichever came first.
   */
  _shareNetworks() {
    const pop = this.populationOf('earth')
    for (const [key, group] of Object.entries(NETWORK_GROUPS)) {
      const network = this.networks[key]
      if (pop && network) {
        // Iridium's points are its Constellation, under its links.
        pop.setGroupDrawer(group, network.sats ?? network)
      }
    }
  }


  /**
   * @param {string} body
   * @returns {Promise<?object>} its population once it's in: Earth's
   *   satellites are loaded now if they aren't; another body's waits for
   *   its loader to add it
   */
  loadPopulation(body) {
    if (body === 'earth') {
      return this.loadSatellites()
    }
    const pop = this.populationOf(body)
    if (pop) {
      return Promise.resolve(pop)
    }
    return new Promise((resolve) => {
      const cb = (p) => {
        if (p.body === body) {
          this._populationListeners = this._populationListeners.filter((f) => f !== cb)
          resolve(p)
        }
      }
      this._populationListeners.push(cb)
    })
  }


  /**
   * Show or hide a space network (`S` Starlink, `I` Iridium, `D` the DSN):
   * loaded the first time it's shown.
   *
   * @param {string} key Of NETWORK_KEYS
   */
  toggleNetwork(key) {
    this._setOverlay(key, !this._settings[key])
  }


  /**
   * @param {function(object): void} cb Called with each population as it's
   *   added, and now with those already in
   */
  onPopulationAdded(cb) {
    this._populationListeners.push(cb)
    this.populations.forEach((p) => cb(p))
  }


  /**
   * @param {string} body
   * @returns {?object} its population, if one is in
   */
  populationOf(body) {
    return this.populations.get(body) ?? null
  }


  /** Hang each population from its body's planetTilt, once both are here. */
  _hangPopulations() {
    for (const [body, pop] of this.populations) {
      const tilt = this.objects[`${body}.planetTilt`]
      if (tilt && pop.parent !== tilt) {
        tilt.add(pop)
        // Its names behind the body take no room (labelDeclutter.js).
        pop.bodyRadius = Number(this.objects[body]?.props?.radius?.scalar) || 0
      }
    }
  }


  /**
   * Show or hide a group of a body's population (the info panel's switch).
   *
   * @param {string} body
   * @param {string} key the group's
   * @param {boolean} on
   */
  setPopulationGroup(body, key, on) {
    this.populationOf(body)?.setGroupShown(key, on)
  }


  /**
   * How many of a body's population's names show (the panel's slider).
   *
   * @param {string} body
   * @param {number} n
   */
  setPopulationLabels(body, n) {
    this.populationOf(body)?.setLabelBudget(n)
  }


  /**
   * How many of a counted group of a body's population show (the panel's
   * slider for the group).
   *
   * @param {string} body
   * @param {string} key the group's
   * @param {number} n
   */
  setPopulationCount(body, key, n) {
    this.populationOf(body)?.setGroupCount(key, n)
  }


  /**
   * @returns {Map<string, {shown: ?Set<string>, labels: ?number, counts: ?Map<string, number>}>} each
   *   population's state away from its defaults, for the link's `pop:`
   *   token: the groups shown, or null for all; the label budget, or null
   *   for its default.  Pending states (a link's, for a population not in
   *   yet) are kept as they were.
   */
  getPopulationState() {
    const out = new Map(this._pendingPopulations)
    for (const [body, pop] of this.populations) {
      const groups = pop.groups()
      const shown = groups.every((g) => g.shown) ? null : new Set(groups.filter((g) => g.shown).map((g) => g.key))
      const labels = pop.labelBudget === pop.defaultLabelBudget ? null : pop.labelBudget
      const moved = groups.filter((g) => g.limit !== undefined && g.limit !== pop.defaultGroupCount(g.key))
      const counts = moved.length > 0 ? new Map(moved.map((g) => [g.key, g.limit])) : null
      if (shown || labels !== null || counts) {
        out.set(body, {shown, labels, counts})
      }
    }
    return out
  }


  /**
   * Put the populations back as a link had them (`pop:`): now for those in,
   * when they're added for the rest.  Quiet: the link isn't rewritten.
   *
   * @param {Map<string, {shown: ?Set<string>, labels: ?number, counts: ?Map<string, number>}>} state
   */
  restorePopulations(state) {
    for (const [body, st] of state ?? []) {
      const pop = this.populationOf(body)
      if (pop) {
        this._applyPopulationState(pop, st)
      } else {
        this._pendingPopulations.set(body, st)
      }
    }
  }


  /**
   * @param {object} pop
   * @param {{shown: ?Set<string>, labels: ?number, counts?: ?Map<string, number>}} st
   */
  _applyPopulationState(pop, {shown, labels, counts}) {
    if (shown) {
      for (const g of pop.groups()) {
        pop.setGroupShown(g.key, shown.has(g.key), true)
      }
    }
    // The counts before the budget, which they bound.
    for (const [key, n] of counts ?? []) {
      pop.setGroupCount(key, n, true)
    }
    if (labels !== null && labels !== undefined) {
      pop.setLabelBudget(labels, true)
    }
  }


  /**
   * @param {object} t a satellite target ({kind: 'satellite', id, body})
   * @returns {?object} its node, if it has a position now: none outside its
   *   elements' window (sgp4.js inWindow)
   */
  _satelliteNode(t) {
    const sats = this.populationOf(t.body ?? 'earth')
    if (!sats || !sats.record(t.id)) {
      return null
    }
    const node = sats.node(t.id)
    return Number.isFinite(sats.jd) && !sats.drawnAt(t.id, sats.jd) ? null : node
  }


  /** @returns {Map<string, Set<string>>} the three-body orbits on, by secondary */
  getPeriodic() {
    return this._periodic
  }


  /** @returns {string} 'rotating' or 'inertial' */
  getPeriodicFrame() {
    return this._periodicFrame
  }


  /**
   * @param {string} secondary a pair's, e.g. 'moon' for the Earth-Moon pair
   * @returns {Set<string>} its families' codes on
   */
  periodicOf(secondary) {
    return this._periodic.get(secondary) ?? new Set
  }


  /**
   * Turn a three-body family on or off at a pair.
   *
   * @param {string} secondary
   * @param {string} code a family's link code (periodicOrbits.js FAMILIES)
   */
  togglePeriodic(secondary, code) {
    const codes = new Set(this.periodicOf(secondary))
    if (codes.has(code)) {
      codes.delete(code)
    } else if (familyOfCode(code)) {
      codes.add(code)
    }
    if (codes.size > 0) {
      this._periodic.set(secondary, codes)
    } else {
      this._periodic.delete(secondary)
    }
    this._syncPeriodic()
    this.onSettingsChange?.()
  }


  /**
   * @param {string} frame 'rotating' (with the pair) or 'inertial' (fixed in space)
   * @param {boolean} [quiet] don't tell the link (a restore)
   */
  setPeriodicFrame(frame, quiet = false) {
    this._periodicFrame = frame === 'inertial' ? 'inertial' : 'rotating'
    this._syncPeriodic()
    if (!quiet) {
      this.onSettingsChange?.()
    }
  }


  /** @returns {boolean} whether the families' manifolds are drawn */
  getPeriodicManifolds() {
    return this._periodicManifolds
  }


  /**
   * Draw the shown families' invariant manifolds, or not.
   *
   * @param {boolean} on
   * @param {boolean} [quiet] don't tell the link (a restore)
   */
  setPeriodicManifolds(on, quiet = false) {
    this._periodicManifolds = Boolean(on)
    this._syncPeriodic()
    if (!quiet) {
      this.onSettingsChange?.()
    }
  }


  /** @returns {Map<string, number>} the craft flown: code → departure, JDE */
  getCraft() {
    return this._craft
  }


  /**
   * Fly a craft (craft/flights.js), leaving at the start of the given day,
   * or take it away.
   *
   * @param {string} code a FLIGHT_CATALOG code
   * @param {number} jde now, TT: it leaves at 0h of this day
   */
  toggleCraft(code, jde) {
    if (this._craft.has(code)) {
      this._craft.delete(code)
    } else if (flightOf(code)) {
      this._craft.set(code, Math.floor(jde - 0.5) + 0.5)
    }
    this._syncCraft()
    this.onSettingsChange?.()
  }


  /**
   * A link's craft (decodeCraftToken).
   *
   * @param {Map<string, number>} craft code → departure, JDE
   */
  restoreCraft(craft) {
    this._craft = new Map(craft)
    this._syncCraft()
  }


  /**
   * The craft for a body's info panel: those flown about it, on or off,
   * with their facts when on.
   *
   * @param {string} name a body's
   * @returns {Array<{code: string, name: string, on: boolean, text: ?string}>}
   *     text the flight's facts, once it's flown
   */
  craftOf(name) {
    return Object.values(FLIGHT_CATALOG).filter((f) => f.shownAt.includes(name)).map((f) => {
      const facts = this._craftTracks.get(f.code)?.path.facts
      let text = facts ? this._flights.FLIGHTS[f.code].describe(facts) : null
      if (!text && this._craftNone.has(f.code)) {
        text = 'none designed from this date'
      }
      return {code: f.code, name: f.name, on: this._craft.has(f.code), text}
    })
  }


  /**
   * Draw the craft flown about their central bodies, each made once for its
   * departure, and take away the rest.
   */
  _syncCraft() {
    if (this._craft.size > 0 && !this._flightsReady()) {
      return
    }
    for (const [code, track] of this._craftTracks) {
      if (this._craft.get(code) !== track.day) {
        track.dispose()
        this._craftTracks.delete(code)
      }
    }
    for (const code of [...this._craftNone]) {
      if (!this._craft.has(code)) {
        this._craftNone.delete(code)
      }
    }
    let changed = false
    for (const [code, day] of this._craft) {
      const flight = {...FLIGHT_CATALOG[code], ...this._flights.FLIGHTS[code]}
      const centre = this.objects[`${flight.centre}.orbitPosition`]
      if (this._craftTracks.has(code) || this._craftNone.has(code) || !centre ||
          (flight.needsVsop && this.vsopReady && !this.vsopReady())) {
        continue
      }
      const data = flight.data ? this._craftDataOf(flight.data) : null
      if (flight.data && !data) {
        continue
      }
      const path = flight.make(day, appBodies(this.vsopAt), data)
      if (!path) {
        this._craftNone.add(code)
        changed = true
        continue
      }
      const track = new CraftTrack(flight, path, Shared.OVERLAY_LAYER)
      track.day = day
      this._joinOverlay('o', track)
      centre.add(track)
      this._craftTracks.set(code, track)
      changed = true
    }
    // Made later than asked (its data, or the ephemeris, came since): the
    // panel's rows again.
    if (changed) {
      this.onCraftChange?.()
    }
  }


  /**
   * A flight's data file, loaded the first time it's asked for; the craft
   * are synced again when it comes.
   *
   * @param {string} url
   * @returns {?object} the file, or null while it loads or where it couldn't
   */
  _craftDataOf(url) {
    if (!this._craftData.has(url)) {
      this._craftData.set(url, 'loading')
      this.loadCraftData(url).then((data) => {
        this._craftData.set(url, data)
      }, () => {
        this._craftData.set(url, null)
      }).then(() => this._syncCraft())
    }
    const data = this._craftData.get(url)
    return data === 'loading' ? null : data
  }


  /**
   * Whether flights.js is in; starts loading it the first time, and syncs
   * the craft again when it comes.
   *
   * @returns {boolean}
   */
  _flightsReady() {
    if (this._flights === undefined) {
      this._flights = this.loadFlights().then((module) => {
        this._flights = module
        this._syncCraft()
      })
    }
    return !(this._flights instanceof Promise)
  }


  /**
   * A link's three-body orbits (decodePeriodicToken), shown once their pairs
   * are the target's.
   *
   * @param {{families: Map<string, Set<string>>, frame: string, manifolds: boolean}} state
   */
  restorePeriodic({families, frame, manifolds: tubes = false}) {
    this._periodic = new Map(families)
    this._periodicManifolds = Boolean(tubes)
    this.setPeriodicFrame(frame, true)
  }


  /**
   * The target's pairs and their families, for the info panel.
   *
   * @param {string} name a body's
   * @returns {Array<{body: string, name: string, families: Array<object>}>}
   *     each pair by its secondary, and its families {code, name, on}
   */
  periodicPairsOf(name) {
    return this.lagrangePairsOf(name).map(([primary, secondary]) => ({
      body: secondary,
      name: `${Utils.capitalize(primary)}–${Utils.capitalize(secondary)}`,
      families: Object.values(FAMILIES).filter((f) => !f.only || f.only === secondary)
          .map((f) => ({code: f.code, name: f.name, on: this.periodicOf(secondary).has(f.code)})),
    }))
  }


  /**
   * Show the families on at the pairs that are showing (_syncLagrange), each
   * member made the first time it's asked for and kept, and take away the
   * rest.
   */
  _syncPeriodic() {
    if (this._periodic.size > 0 && !this._periodicDataReady()) {
      return
    }
    for (const [key, marks] of this._lagrange ?? []) {
      if (!marks.parent) {
        continue
      }
      const secondary = key.split('-')[1]
      const wanted = new Set([...this.periodicOf(secondary)].map(familyOfCode)
          .filter((f) => f && (!FAMILIES[f].only || FAMILIES[f].only === secondary)))
      for (const family of [...marks.families.keys()]) {
        if (!wanted.has(family)) {
          marks.setFamily(family, null)
        }
      }
      for (const family of wanted) {
        if (marks.families.has(family)) {
          continue
        }
        const samples = this._periodicSamples(secondary, marks.mu, family)
        const node = samples ? marks.setFamily(family, samples) : null
        if (node) {
          fadeObject(node, this.fades.o.uniform)
        }
      }
      for (const [family, shown] of marks.families) {
        const want = this._periodicManifolds && FAMILIES[family].manifolds
        if (want && !shown.manifolds) {
          const tubes = this._tubes(secondary, family, shown.samples, marks.radii)
          const node = tubes ? marks.setManifolds(family, tubes) : null
          if (node) {
            fadeObject(node, this.fades.o.uniform)
          }
        } else if (!want && shown.manifolds) {
          marks.setManifolds(family, null)
        }
      }
      marks.setFrame(this._periodicFrame)
    }
  }


  /**
   * @param {string} secondary
   * @param {number} mu
   * @param {string} family
   * @returns {?object} sampleMember's, made once
   */
  _periodicSamples(secondary, mu, family) {
    const key = `${secondary}:${family}`
    if (!this._periodicMembers.has(key)) {
      // JPL's member where its catalogue has the pair, in its mass ratio;
      // else the app's own.  Halos as their southern twin (southern).
      const system = this._periodicData?.systems?.[secondary]
      const jpl = system?.families?.[family]
      const m = jpl ? system.mu : mu
      let member = jpl ? {state: jpl.state, period: jpl.period} : familyMember(m, family)
      if (member && jpl && FAMILIES[family].halo) {
        member = southern(m, member)
      }
      const samples = member ? sampleMember(m, member) : null
      if (samples) {
        samples.source = jpl ? 'JPL' : 'computed'
        // For its manifolds (_tubes): the member as drawn, in its mass ratio.
        samples.member = member
        samples.mu = m
      }
      this._periodicMembers.set(key, samples)
    }
    return this._periodicMembers.get(key)
  }


  /**
   * A family's manifolds at a pair, made once from the member drawn.
   *
   * @param {string} secondary
   * @param {string} family
   * @param {object} samples _periodicSamples'
   * @param {object} [radii] pairFacts', where the trajectories stop
   * @returns {?object} manifolds.js manifolds'
   */
  _tubes(secondary, family, samples, radii) {
    const key = `${secondary}:${family}`
    if (!this._manifoldTubes.has(key)) {
      this._manifoldTubes.set(key, samples.member ? manifolds(samples.mu, samples.member, {radii}) : null)
    }
    return this._manifoldTubes.get(key)
  }


  /**
   * Whether JPL's catalogue members are in (or couldn't be had); starts
   * loading them the first time, and syncs again when they come.
   *
   * @returns {boolean}
   */
  _periodicDataReady() {
    if (this._periodicData === undefined) {
      this._periodicData = 'loading'
      this.loadPeriodicData().then((data) => {
        this._periodicData = data
      }, () => {
        this._periodicData = null
      }).then(() => this._syncPeriodic())
    }
    return this._periodicData !== 'loading'
  }


  /**
   * @param {string} primary
   * @param {string} secondary
   * @returns {LagrangeMarks}
   */
  _newLagrange(primary, secondary) {
    return new LagrangeMarks(this.pairFacts(primary, secondary), Shared.OVERLAY_LAYER)
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
   * - satellite: Earth is `obj`, the satellite `label` (satellites/names.js
   *   satelliteTarget)
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
    // A place's or a satellite's body is `obj`, the thing itself `label`.
    if (t.kind === 'body' || t.kind === 'place' || t.kind === 'satellite') {
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
      // A place: its body's catalogue too, for its labels (#258).
      if (t.kind === 'place') {
        obj.places?.ensureLoaded()
      }
    }
    Shared.targets.label = t.kind === 'body' ? null : t
    this._labelTargetStar(Shared.targets.label)
    // A satellite's name shows while it's the target (Population.setTarget).
    for (const pop of this.populations.values()) {
      pop.setTarget(t.kind === 'satellite' && (t.body ?? 'earth') === pop.body ? t.id : null)
    }
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
    this._syncLagrange()
    this._syncRegimes()
    this.onTargetChange?.(t)
  }


  /**
   * Have the stars name the target if it is a catalogue star, whatever its
   * magnitude (Stars.setTargetStar), or none if it isn't.  The Sun is the
   * scene's own and has its own label.
   *
   * @param {?object} label `Shared.targets.label`
   */
  _labelTargetStar(label) {
    const isStar = label?.kind === 'star' && label.star && label.star.hipId !== 0
    this.stars?.setTargetStar?.(isStar ? label.star : null, label?.name)
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
    if (target.kind === 'galaxy') {
      return {...target, id: target.galaxy.id, name: target.name ?? target.galaxy.name}
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
   *
   * 'c' squares the view to the ecliptic's up (`camera.lookAt`).  Tracking
   * passes `keepRoll`: the shortest turn that centres the target, so the
   * roll the user set holds (faceKeepingRoll.js).
   *
   * @param {{keepRoll?: boolean}} [opts]
   */
  lookAtTarget({keepRoll = false} = {}) {
    const face = (pos) => keepRoll ? faceKeepingRoll(this.ui.camera, pos) : this.ui.camera.lookAt(pos)
    const label = Shared.targets.label
    if (label) {
      const pos = this.labelPosition(label)
      if (pos) {
        face(pos)
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
    face(tPos)
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
      case 'galaxy':
        // In the catalogue's frame, as a star.
        return this.worldGroup.localToWorld(this.starPosition(label.galaxy, out))
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
      case 'satellite': {
        const node = this._satelliteNode(label)
        return node ? node.getWorldPosition(out) : null
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
   * A galaxy (Galaxies.js's record, `isGalaxy`) is gone to as a star is:
   * rebased to the world's origin at its centre, the camera on the star
   * anchor, arriving at its `viewDistance`, where it fills about 60% of a
   * 45° field.
   *
   * @param {object|null} star StarProps entry from StarsCatalog, a galaxy's
   *   record, or null for planet.
   * @param {string} [starName] The star's name, for the breadcrumb
   */
  goTo(star = null, starName = undefined) {
    const isPlanet = star === null
    const isGalaxy = Boolean(star?.isGalaxy)
    const obj = isPlanet ? Shared.targets.obj : null
    if (isPlanet && !obj) {
      console.error('Scene.goTo called with no target obj.')
      return
    }
    // A satellite targeted: the camera arrives at it, hung from its node,
    // in Earth's frame (Satellites.md, going and riding).  Outside its
    // elements' window it has no position, and the go is to Earth.
    const satTarget = isPlanet && Shared.targets.label?.kind === 'satellite' ? Shared.targets.label : null
    const sat = satTarget ? this._satelliteNode(satTarget) : null
    if (satTarget && !sat) {
      console.warn(`Scene.goTo: no position for ${satTarget.name} at this date; going to Earth`)
    }
    if (sat) {
      this.setTarget(satTarget, {look: false})
    } else if (isPlanet) {
      this.setTarget(obj.props?.name ?? obj.name, {look: false})
    } else if (isGalaxy) {
      this.setTarget({kind: 'galaxy', galaxy: star, name: starName}, {look: false})
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
      if (isGalaxy) {
        this.removeCatalogueStar()
      } else {
        this.showCatalogueStar(star)
      }
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
    const anchor = sat ?? (isPlanet ? obj.orbitPosition : this._getOrCreateStarAnchor())
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
      new Vector3().setFromMatrixPosition((sat ?? obj).matrixWorld) :
      new Vector3(0, 0, 0)

    if (isPlanet) {
      Shared.targets.cur = obj
    }
    // Arriving is riding: following is on for the body gone to (the camera
    // is on its orbit now), or off at a star, which has none.
    this._followArrival(sat ?? (isPlanet ? obj.orbitPosition ?? null : null))

    // Arrival pose: approach along camera→target line.
    const dir = camWorldPos.clone().sub(targetWorldPos)
    if (dir.lengthSq() > 0) {
      dir.normalize()
    } else {
      dir.set(0, 0, 1)
    }
    // A satellite from below its height (Earth's far side, or under it)
    // would leave the camera beneath it, facing away from Earth, or inside
    // Earth for one under 300 km up: arrive above it instead, Earth behind.
    if (sat) {
      const up = targetWorldPos.clone().sub(obj.getWorldPosition(new Vector3())).normalize()
      if (dir.dot(up) < SAT_ARRIVAL_MIN_UP) {
        dir.copy(up)
      }
    }
    const camDist = sat ? sat.arrivalDistance : isPlanet ? this.arrivalDistance(obj) :
      isGalaxy ? star.viewDistance : (star.radius * STEP_BACK)
    const arrivalWorld = targetWorldPos.clone().addScaledVector(dir, camDist)
    const arrivalLocal = this.ui.camera.platform.worldToLocal(arrivalWorld.clone())

    // Single unified tween that overlaps rotation and movement.
    Shared.targets.tween = newCameraGoToTween(this.ui.camera, targetWorldPos, arrivalLocal)
    Shared.targets.tweenNextFn = null
    // The exposure follows the destination on the way, and arrives at the
    // one its arrival pose asks for: one path for every planet and moon
    // (ThreeUi.approach; DESIGN.md, "Approach").
    // Not for a satellite: the approach is worked out for a camera facing
    // the body from about STEP_BACK radii, and from a satellite's 300 km it
    // took the low view for the night side (a gain of 4e6 where the meter
    // settled on 4, a white frame on arrival); the meter carries on from the
    // gain it has.  null clears an approach in progress.
    if (isPlanet) {
      this.ui.approach?.(sat ? null : obj, arrivalWorld, Shared.targets.tween)
    }

    // Arriving at a body, a drag turns round it: a pan chosen at the last
    // one doesn't carry over.  The mode is set here and by land, never by
    // altitude (an automatic switch as the camera neared the ground
    // surprised people, and zoom.js's rotateScale has since slowed the
    // orbit drag near the ground).  Also clear any prior 'landed' state —
    // orbit-style nav unpins the observer from the surface.
    if (isPlanet) {
      const state = this.ui.useStore?.getState?.()
      state?.setDragMode?.('orbit')
      state?.setLanded?.(false)
      Shared.targets.landed = false
    }
  }


  /**
   * @param {object} obj A planet, moon or the Sun (this.objects')
   * @returns {number} How far from its centre a go arrives, m: its own
   *   distance if it has one, else STEP_BACK radii
   */
  arrivalDistance(obj) {
    return obj.initialCameraDistance ?? (obj.props.radius.scalar * STEP_BACK)
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
    this._followArrival(bodyNode.orbitPosition ?? null)

    // Arrival local pose = body-fixed XYZ for (lat, lng, alt).  Platform is
    // identity at body origin, so platform-local == body-local.
    // Over the terrain there, when a Cesium layer knows it (from the tiles
    // loaded so far; ThreeUI keeps the camera over the ground as finer ones
    // arrive).  Not for a permalink restore: its altitude was measured over
    // the sphere, terrain included.
    const ground = opts.instant ? 0 : this.ui.layers?.groundHeightAt?.(bodyNode, lat, lng) ?? null
    const arrivalLocal = latLngAltToBodyFixed(lat, lng, alt + (ground ?? 0), r)

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
      if (ground === null) {
        this._reaimLanding(bodyNode, lat, lng, alt, r)
      }
    }

    // On the surface a drag looks around.  It stays that way on zooming
    // out, until the user switches it or goes to a body: the mode doesn't
    // follow altitude (goTo).  Mark landed for permalink + UI.
    const state = this.ui.useStore?.getState?.()
    state?.setDragMode?.('pan')
    state?.setLanded?.(true)
    Shared.targets.landed = true

    this.setTarget(opts.target ?? bodyName, {look: false})
  }


  /**
   * A Cesium layer on a guest page knows the terrain's height at a landing
   * place only by message (CesiumLayers.requestGroundHeight): land aims at
   * the sphere meanwhile, and this aims the landing again over the terrain
   * when the answer comes, if it's the same landing and it has barely begun
   * (REAIM_MS).  Later, the ground floor lifts the camera as it arrives
   * (ThreeUi._keepAboveGround), as with coarse tiles on the page.
   *
   * @param {object} bodyNode
   * @param {number} lat Degrees
   * @param {number} lng Degrees, east-positive
   * @param {number} alt Metres over the ground
   * @param {number} r The body's radius, metres
   */
  _reaimLanding(bodyNode, lat, lng, alt, r) {
    const asked = performance.now()
    const tween = Shared.targets.tween
    this.ui.layers?.requestGroundHeight?.(bodyNode, lat, lng)?.then((height) => {
      if (height === null || Shared.targets.tween !== tween || performance.now() - asked > REAIM_MS) {
        return
      }
      Shared.targets.tween = newCameraLandTween(this.ui.camera, latLngAltToBodyFixed(lat, lng, alt + height, r), r)
    })
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
    //      The lit limb, at the target-keyed exposure (exposure.js),
    //      clips to white.
    //   2. `'atmosphere'` — the Sun's additive `BackSide` halo shell
    //      from `newAtmosphere()`, which flashes when the camera aims
    //      at it.
    //   3. `'MilkyWay'` — the galaxy's integrated light (MilkyWay.md), a
    //      ray march re-run whenever the view moves, which at AR sensor
    //      jitter is every frame, for a band the dark-adapted exposure
    //      barely shows.  The real catalog stars + asterisms remain
    //      visible.
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


  /**
   * Draws a catalogue star's disc, as the Sun's is drawn, from its own
   * parameters (Star.js, starParams.js; js/scene/Stars.md), where the
   * catalogue puts it: in the stellarFrame, whose local frame the
   * catalogue's positions and its rotation axis are in.  One at a time:
   * the star travelled to, which replaces the last.  It doesn't light the
   * scene, and its disc is metered as the Sun's is (the scene's objects,
   * ThreeUI._luminousDiscs).  The Sun (HIP 0) is the scene's own.
   *
   * @param {object} star StarProps entry from StarsCatalog
   * @returns {?Star} The star's object, or null for the Sun or a star without a radius
   */
  showCatalogueStar(star) {
    if (!star || star.hipId === 0 || !(star.radius > 0)) {
      return null
    }
    if (this._catalogueStar?.props.hipId === star.hipId) {
      return this._catalogueStar
    }
    this.removeCatalogueStar()
    const name = this.stars?.catalog?.getNameOrId?.(star.hipId) ?? `HIP ${star.hipId}`
    const props = {...star, type: 'star', name, radius: {scalar: star.radius}}
    const obj = new Star(props, null, this.ui, {}, {light: false})
    obj.position.set(star.x, star.y, star.z)
    this.stellarFrame.add(obj)
    this._catalogueStarKey = `catalogue star ${star.hipId}`
    this.objects[this._catalogueStarKey] = obj
    this._catalogueStar = obj
    return obj
  }


  /** Removes the catalogue star showCatalogueStar drew, if any. */
  removeCatalogueStar() {
    if (!this._catalogueStar) {
      return
    }
    this._catalogueStar.removeFromParent()
    this._catalogueStar.traverse((o) => {
      o.geometry?.dispose?.()
      if (o.material && o.material !== this._catalogueStar.shaderMaterial) {
        o.material.dispose?.()
      }
    })
    this._catalogueStar.shaderMaterial?.dispose()
    delete this.objects[this._catalogueStarKey]
    this._catalogueStar = null
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
   * the new one.  The roll is the user's: tracking centres the target and
   * leaves the camera's roll as it was.
   */
  track() {
    this.setTracking(!Shared.targets.track)
  }


  /**
   * Turn tracking on or off, as 't' does, and say so to the link (the `T`
   * setting) and the readout.
   *
   * @param {boolean} on
   */
  setTracking(on) {
    if (Shared.targets.track === Boolean(on)) {
      return
    }
    Shared.targets.track = Boolean(on)
    this.onSettingsChange?.()
    this.onModeChange?.('track', Shared.targets.track)
  }


  /**
   * Toggle following ('f'): on, the camera rides the targeted body's orbit
   * as time runs and turns as it did; off, the camera leaves the body it
   * rides, which moves on without it (`setFollowing`, `syncFollow`).
   */
  follow() {
    this.setFollowing(!Shared.targets.follow)
  }


  /**
   * Turn following on or off, as 'f' does, and say so to the link (the `F`
   * setting) and the readout.
   *
   * Going to a body or landing on it (`goTo`, `land`) turns following on,
   * for that body: the camera is on its orbit.  So 'f' there turns it off,
   * and does it: the camera platform goes to the body's frame, the Sun's
   * for a planet, the planet's for a moon, with the camera where it is and
   * as it faces (`syncFollow`).  It can't at the Sun, which has no frame
   * above it (if another body is targeted, 'f' rides that one instead), or
   * landed, pinned to the surface: following stays on, and the readout
   * says why.
   *
   * On, `Shared.targets.follow` holds the targeted body's `orbitPosition`
   * (a target with none, a star or an asterism, leaves it off) and the
   * camera moves to it.  The body followed stays so when the target
   * changes: looking at another body doesn't change what is ridden.
   *
   * @param {boolean} on
   */
  setFollowing(on) {
    const was = Boolean(Shared.targets.follow)
    if (on) {
      Shared.targets.follow = this._followable()
      if (!Shared.targets.follow) {
        console.error(Shared.targets.obj ?
          'Target to follow has no orbitPosition property.' :
          'No target object to follow.')
      }
      this._detachFrom = null
    } else if (was) {
      const node = Shared.targets.follow
      const hung = this.ui.camera.platform.parent === node || Shared.targets.landed
      let why = null
      if (hung && Shared.targets.landed) {
        why = 'landed'
      } else if (hung && !this._followHome && !this._parentNode(node)) {
        why = 'root'
      }
      const next = this._followable()
      if (why === 'root' && next && next !== node) {
        // The Sun can't be left, but another body is targeted: ride that
        // one, from here (and off goes back here).
        Shared.targets.follow = next
        this.syncFollow()
        this.onModeChange?.('follow', true)
        return
      }
      if (why) {
        this.onModeChange?.('follow', true, why)
        return
      }
      Shared.targets.follow = null
      this._detachFrom = node
    }
    this.syncFollow()
    this._followChanged(was)
  }


  /**
   * Set following as a link had it, with the camera already in the link's
   * frame (`goTo`, `land`): on is that frame's body being followed, off is
   * leaving the camera where it is.  Neither moves it.
   *
   * @param {boolean} on
   */
  restoreFollowing(on) {
    const was = Boolean(Shared.targets.follow)
    const frame = this.ui.camera.platform.parent === this._starAnchor ? null : Shared.targets.cur
    Shared.targets.follow = on ? frame?.orbitPosition ?? null : null
    this._followHome = null
    this._detachFrom = null
    this._followChanged(was)
  }


  /**
   * Going or landing makes the body the camera is at the one it follows.
   *
   * @param {?object} node The body's `orbitPosition`, or null (a star)
   */
  _followArrival(node) {
    const was = Boolean(Shared.targets.follow)
    Shared.targets.follow = node
    this._followHome = null
    this._detachFrom = null
    this._followChanged(was)
  }


  /**
   * @returns {?object} The node that carries the target body along its
   *   orbit (its `orbitPosition`; a satellite's node), or null: no body,
   *   or a target that is not a body or a place on one (a star, an
   *   asterism), which does not move.
   */
  _followable() {
    const kind = Shared.targets.label?.kind
    if (kind === 'star' || kind === 'asterism') {
      return null
    }
    if (kind === 'satellite') {
      return this._satelliteNode(Shared.targets.label) ?? Shared.targets.obj?.orbitPosition ?? null
    }
    return Shared.targets.obj?.orbitPosition ?? null
  }


  /**
   * @param {object} node A body's `orbitPosition`
   * @returns {?object} The body it moves
   */
  _bodyOf(node) {
    // A satellite's node is in its body's frame: the body is the camera's.
    if (node?.isSatelliteNode) {
      return this.objects[node.body ?? 'earth'] ?? null
    }
    const cur = Shared.targets.cur
    if (cur?.orbitPosition === node) {
      return cur
    }
    return Object.values(this.objects).find((o) => o.orbitPosition === node) ?? null
  }


  /**
   * @param {object} node A body's `orbitPosition`
   * @returns {?object} The `orbitPosition` of the body it orbits (a
   *   planet's: the Sun's; a moon's: its planet's), or null for the Sun
   */
  _parentNode(node) {
    // Leaving a satellite leaves the camera with its body.
    if (node?.isSatelliteNode) {
      return this.objects[node.body ?? 'earth']?.orbitPosition ?? null
    }
    const parent = this.objects[this._bodyOf(node)?.props?.parent]
    return parent?.orbitPosition ?? null
  }


  /** @param {boolean} was Whether following was on before the change */
  _followChanged(was) {
    const now = Boolean(Shared.targets.follow)
    if (was !== now) {
      this.onSettingsChange?.()
      this.onModeChange?.('follow', now)
    }
  }


  /**
   * Move the camera platform for following, once a frame, after the
   * animation has moved the bodies (Celestiary's animation callback), and
   * at once when 'f' changes it.  Following hangs the camera platform on
   * the followed body's `orbitPosition`, the node that body's orbit moves,
   * keeping the camera where it is and as it faces (`rehangPlatform`), so
   * from then on the camera keeps its offset from the body and its
   * orientation is not touched: the user turns the view as they like
   * (DESIGN.md, "Follow").
   *
   * - On from a frame that isn't the followed body's (the Sun's, with
   *   Jupiter targeted): the platform moves to its node.
   * - Off: the platform leaves the node it was riding, for the frame it
   *   was taken from, or the frame of the body (the planet's primary), so
   *   the body moves on without the camera.
   * - When the followed body is the camera's frame already, which is where
   *   going to a body puts it, there is nothing to do.
   * - While a go or a landing travels (`tween.travels`), it waits: the
   *   tween writes positions in the platform's frame.  It carries on
   *   afterwards, from wherever the camera has got to.
   * - A landed camera is pinned to the surface, and one at a star has no
   *   body to ride: neither moves.
   *
   * Cheap when there is nothing to do: a few comparisons.
   */
  syncFollow() {
    if (Shared.targets.tween?.travels) {
      return
    }
    const platform = this.ui.camera.platform
    const want = Shared.targets.follow
    let home = this._followHome
    if (home && platform.parent !== home.anchor) {
      // Something else hung the platform (going, landing): its frame stands.
      home = this._followHome = null
    }
    if (!want) {
      const from = this._detachFrom
      if (from && !Shared.targets.landed && platform.parent === from) {
        this._detachFrom = null
        this._followHome = null
        const parent = home ? home.parent : this._parentNode(from)
        if (parent) {
          this._hangPlatform(parent, home ? home.cur : this._bodyOf(parent))
        }
      } else if (from && platform.parent !== from) {
        this._detachFrom = null
      }
      return
    }
    if (Shared.targets.landed || platform.parent === want || platform.parent === this._starAnchor) {
      return
    }
    if (!home) {
      home = this._followHome = {parent: platform.parent, cur: Shared.targets.cur, anchor: null}
    }
    this._hangPlatform(want, this._bodyOf(want))
    home.anchor = want
  }


  /**
   * @param {object} anchor The node to hang the camera platform on
   * @param {?object} cur The body that makes it the camera's frame
   *   (`Shared.targets.cur`)
   */
  _hangPlatform(anchor, cur) {
    if (this.ui.camera.platform.parent === anchor) {
      return
    }
    rehangPlatform(this.ui.camera.platform, this.ui.camera, anchor)
    Shared.targets.cur = cur
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
    // Nor a spacecraft's bounding sphere.
    if (cur.props.type === 'spacecraft') {
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
    // In the 'p' overlay group, so the global presentation toggle ('V') and
    // the per-overlay toggle ('p') both pick up the marker.
    this._joinOverlay('p', g)
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


  /** Show or hide the asterisms ('a'), built the first time they're on. */
  toggleAsterisms() {
    const on = !this._settings.a
    this._setOverlay('a', on)
    if (on) {
      this._buildAsterisms()
    }
  }


  /**
   * Build the asterisms, once the stars catalog has loaded: built against
   * an empty starByHip they'd have no lines.  Once: _asterismsPending
   * guards against a second build while the catalogue loads.  They join
   * the 'a' group as it is when they're done.
   */
  _buildAsterisms() {
    if (this.asterisms || this._asterismsPending || !this.stars) {
      return
    }
    this._asterismsPending = true
    this.stars.onCatalogReady(() => {
      const asterisms = new Asterisms(this.ui, this.stars, () => {
        this.stars.add(asterisms)
        this.asterisms = asterisms
        this._joinOverlay('a', asterisms)
        this._asterismsPending = false
        const cbs = this._asterismsReadyCbs ?? []
        this._asterismsReadyCbs = null
        cbs.forEach((cb) => cb(asterisms))
      })
    })
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
      this._joinOverlay('x', this.colonization)
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
    this._setOverlay('x', !this._settings.x)
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


  /** Orbits, and the solar wind's streamlines with them ('o'). */
  toggleOrbits() {
    this._setOverlay('o', !this._settings.o)
  }


  /**
   * Toggle planet/moon name labels AND surface place labels.  Both belong
   * to the 'p' overlay group: planet names live in their own LOD object
   * named 'label LOD'; surface places (cities, craters, landing sites)
   * live as a `places` property on the rotating planet Object3D, set in
   * Planet.newPlanet, and a double click's lat/lng marker as
   * `_tempMarker` (_overlayNodes).  One knob for "all planet-related
   * labels", which the global 'V' presentation toggle uses too.  See
   * DESIGN.md "Overlays & visibility groups".
   */
  togglePlanetLabels() {
    this._setOverlay('p', !this._settings.p)
  }


  /** Star names ('s', the `l` setting); the stars take it when they come. */
  toggleStarLabels() {
    this._setOverlay('l', !this._settings.l)
  }


  /** */
  toggleGridEquatorial() {
    this._setOverlay('e', !this._settings.e)
  }


  /** */
  toggleGridEcliptic() {
    this._setOverlay('c', !this._settings.c)
  }


  /** */
  toggleGridGalactic() {
    this._setOverlay('g', !this._settings.g)
  }


  /**
   * Toggle the Milky Way's integrated light (MilkyWay.md).  Found by name
   * traversal since the mesh is created inside `newGalaxy()` and not
   * pinned to a Scene field.  Default-hidden by `enterAR()`; the user can
   * flip this back on with the 'U' shortcut once in AR.
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
   * Toggle the galaxies' labels (`e`, as Celestia's; the `G` setting): each
   * SPARC galaxy's name, shown once it's within a magnitude of the limiting
   * magnitude or is the target (Galaxies.md, "Labels").
   */
  toggleGalaxyLabels() {
    this._setOverlay('G', !this._settings.G)
  }


  /**
   * Toggle the globular clusters' labels (`E`, Shift+E, as Celestia's; the
   * `C` setting).  There are no globular clusters yet (#228): the setting
   * is kept, and the link carries it, for when there are.
   */
  toggleGlobularLabels() {
    this._flipSetting('C')
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
    // The Milky Way's integrated light, from a published structural model
    // (MilkyWay.md), in the catalogue's frame with the Sun 8.15 kpc from
    // the centre.  Lives in worldGroup so star-navigation rebases shift it
    // along with everything else, keeping the universe coherent.
    const milkyWay = newMilkyWay()
    milkyWay.visible = this._settings.U
    this.stellarFrame.add(milkyWay)
    // SPARC's disc galaxies (Galaxies.md), in the catalogue's frame as the
    // stars are; their catalogue is fetched in a browser.
    this.galaxies = new Galaxies()
    // Its labels are the 'G' overlay group: built when first shown, with
    // the group's opacity.
    this.galaxies.labelFade = this.fades.G.uniform
    this.galaxies.setLabelsVisible(this.overlayShown('G'))
    // What gates a galaxy's label: the limit the stars are drawn to, and the target.
    this.galaxies.labelState = () => ({
      limit: this.ui.limitingMagnitude?.() ?? -Infinity,
      target: Shared.targets.label?.kind === 'galaxy' ? Shared.targets.label.galaxy : null,
    })
    this.stellarFrame.add(this.galaxies)
    this._galaxiesWaiters?.splice(0).forEach((cb) => this.galaxies.onReady(cb))
    // Their catalogue is fetched when something needs it (loadGalaxies), or
    // when the view could show one (#258): not on every first load.
    const camPos = new Vector3()
    const sunPos = new Vector3()
    this.galaxies.inView = () => {
      const limit = this.ui.limitingMagnitude?.() ?? -Infinity
      this.ui.camera.getWorldPosition(camPos)
      this.objects.sun?.getWorldPosition(sunPos)
      return galaxiesInView(limit, camPos.distanceTo(sunPos), this.galaxies.labelsVisible)
    }
    this._galaxiesWanted?.(this.galaxies.ensureLoaded())
    return group
  }


  /**
   * Fetch the galaxies' catalogue, once (Galaxies.ensureLoaded), for what
   * needs it whatever the view: a link to a galaxy, a search, the `e` key.
   * Before the Milky Way is built, as soon as it is.
   *
   * @returns {Promise<?Galaxies>} The galaxies, or null if they didn't load
   */
  loadGalaxies() {
    if (!this.galaxies) {
      this._galaxiesPending ??= new Promise((resolve) => {
        this._galaxiesWanted = resolve
      })
      return this._galaxiesPending
    }
    return this.galaxies.ensureLoaded()
  }


  /**
   * @param {function(Galaxies): void} cb Called once the galaxies' catalogue
   *   is in.  Waiting doesn't fetch it: loadGalaxies does.
   */
  onGalaxiesReady(cb) {
    if (this.galaxies) {
      this.galaxies.onReady(cb)
    } else {
      (this._galaxiesWaiters ??= []).push(cb)
    }
  }


  /**
   * The body-like stand-in for a galaxy the camera is at, for the zoom's
   * floor (ThreeUi._homeBody): a sphere of the galaxy's core radius, so
   * the zoom eases toward its centre and can go into its disc.
   *
   * @returns {?object}
   */
  galaxyHome() {
    const g = this._starTarget
    if (!g?.isGalaxy) {
      return null
    }
    if (this._galaxyHome?.galaxy !== g) {
      this._galaxyHome = {galaxy: g, props: {name: `galaxy:${g.id}`, radius: {scalar: g.radius}}}
    }
    return this._galaxyHome
  }
}
