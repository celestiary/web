import {Group, Matrix4, PerspectiveCamera, Scene, Vector3} from 'three'
import Satellites from '../scene/satellites/Satellites.js'
import {bodyFixedToEcef, equatorToEcef} from './frames.js'
import {DEFAULT_SUBSCRIPTION, SCHEMES, compileSubscription, dishAnchor, naifAnchor, satelliteAnchor, siteAnchor,
  spacecraftAnchor} from './anchors.js'
import {gmstRad} from '../scene/celestialFrame.js'
import {latLngAltToBodyFixed} from '../coords.js'
import {loadNetwork} from '../scene/networks/loadNetworks.js'
import {loadSatelliteRecords} from '../scene/satellites/loadSatellites.js'
import {unixMsToJd} from '../scene/satellites/sgp4.js'


// Layer mode's scene (design/LayerMode.md): celestiary's satellites and the
// space networks (scene/networks/Networks.md), with no Scene or ThreeUi, in
// ECEF under a host's camera and clock.  Everything hangs from `root`, in
// Earth's equator frame of date as in the app, and `root`'s matrix turns
// that to ECEF by GMST at the host's time (frames.js).  Orbits are in true
// ECEF; what's tied to the ground (the DSN's dishes) goes on the host's
// Earth (`view.earth`, portal RFC 0001 §6.3), so it sits on the host's
// surface.  No labels: the layer publishes anchors and the host names what
// it wants.  Pure three, no DOM, so the tests drive it in bun.


/** The satellites' snapshot (loadSatellites.js'). */
export {SATELLITES_URL} from '../scene/satellites/loadSatellites.js'
/** How far out the layer draws, m: the DSN's beams reach the Voyagers. */
export const EXTENT_M = {orbits: 5e7, beams: 3e13}
const EARTH_RADIUS_M = 6378137
// What's drawn first: the satellites, Starlink, Iridium, the DSN.
const DRAW_ORDER = ['satellites', 'S', 'I', 'D']


/** */
export default class OrbitsLayer {
  /**
   * @param {object} [opts]
   * @param {Function} [opts.fetchFn]
   * @param {Function} [opts.nowMs] the wall clock (the DSN's polling)
   */
  constructor({fetchFn = (...a) => globalThis.fetch(...a), nowMs = () => Date.now()} = {}) {
    this.fetchFn = fetchFn
    this.nowMs = nowMs
    this.scene = new Scene
    this.scene.matrixWorldAutoUpdate = true
    this.root = new Group
    this.root.name = 'layer root (equator frame of date)'
    this.root.matrixAutoUpdate = false
    this.scene.add(this.root)
    this.camera = new PerspectiveCamera
    this.camera.matrixAutoUpdate = false
    this.satellites = null
    this.networks = {}
    this.jd = NaN
    this.gmst = 0
    this.timeMs = NaN
    this.viewId = null
    // The host's Earth (view.earth): a sphere of this radius, latitude and
    // longitude put on it as spherical (deck's, MapLibre's).  WGS84's
    // equatorial radius until a view says.
    this.surfaceRadius = EARTH_RADIUS_M
    this.patterns = DEFAULT_SUBSCRIPTION
    this._sub = compileSubscription(DEFAULT_SUBSCRIPTION)
    // NORAD id → index, a constellation's records each.
    this._byId = new WeakMap
    this._viewInv = new Matrix4
    this._rootInv = new Matrix4
    // Called with a reason when what's drawn changes without a new view
    // (the DSN's feed): the page asks its host for a frame.
    this.onInvalidate = null
  }


  /**
   * Load what to draw: the satellites, and networks by overlay key.
   *
   * @param {object} [what]
   * @param {boolean} [what.satellites]
   * @param {Array<string>} [what.networks] of 'S', 'I', 'D'
   * @returns {Promise<Array<string>>} what failed to load, by name
   */
  async load({satellites = true, networks = ['S', 'I', 'D']} = {}) {
    const failed = []
    const jobs = []
    if (satellites) {
      // Iridium is drawn by its network here, when that's on: not twice.
      // Starlink only by its network, as before: the population's 11,000
      // points (and their file) aren't the layer's.
      const skip = new Set(['starlink', ...(networks.includes('I') ? ['iridium'] : [])])
      jobs.push(this._loadSatellites(skip).catch((err) => failed.push(`satellites: ${err.message ?? err}`)))
    }
    for (const key of networks) {
      jobs.push(loadNetwork(key, {camera: this.camera, labels: false}, this.fetchFn)
          .then(({network}) => {
            this.networks[key] = network
            this._attach(network, key)
            if (key === 'D') {
              network.setSurfaceRadius(this.surfaceRadius)
              network.onFeed = () => this.onInvalidate?.('dsn feed')
            }
          })
          .catch((err) => failed.push(`${key}: ${err.message ?? err}`)))
    }
    await Promise.all(jobs)
    return failed
  }


  /**
   * Hang what loaded from the root in a fixed order, whichever loaded
   * first: the renderer doesn't sort (layer.js), so the order is the draw
   * order, and Starlink's dots over Iridium's additive links (or not)
   * otherwise changed with the fetches' timing.
   *
   * @param {object} obj
   * @param {string} key 'satellites', or a network's key
   */
  _attach(obj, key) {
    obj.userData.layerKey = key
    this.root.add(obj)
    const rank = (o) => DRAW_ORDER.indexOf(o.userData.layerKey)
    this.root.children.sort((a, b) => rank(a) - rank(b))
  }


  /**
   * Earth's satellites (a population, population/Population.js), from the
   * snapshot's rows alone, with no names: the layer publishes anchors, and
   * the host names what it wants.
   *
   * @param {Set<string>} skip groups left out
   * @returns {Promise<void>}
   */
  async _loadSatellites(skip) {
    const {records, header} = await loadSatelliteRecords(this.fetchFn, {skip})
    this.satellites = new Satellites(records, {body: 'earth', groups: header.groups, camera: this.camera})
    this.satellites.setLabelBudget(0, true)
    this._attach(this.satellites, 'satellites')
  }


  /**
   * The host's view (`layer:view`'s `view`, portal-netgl 0.4.0's
   * NetGLLayerView): the camera, the projection, the time, the Earth.
   *
   * @param {object} view
   * @param {Array<number>} view.viewMatrix ECEF m → eye m, column-major 16
   * @param {Array<number>} view.projectionMatrix eye → clip, column-major 16
   * @param {number} view.timeMs Unix ms, UTC
   * @param {{model: string, radius: number}} [view.earth] the host's Earth
   * @param {*} [viewId] the message's
   */
  applyView({viewMatrix, projectionMatrix, timeMs, earth}, viewId = null) {
    this.viewId = viewId
    if (earth?.model === 'sphere' && earth.radius > 0 && earth.radius !== this.surfaceRadius) {
      this.surfaceRadius = earth.radius
      this.networks.D?.setSurfaceRadius(earth.radius)
    }
    this._viewInv.fromArray(viewMatrix).invert()
    this.camera.matrix.copy(this._viewInv)
    // matrixAutoUpdate is off: three recomposes matrixWorld only when told.
    this.camera.matrixWorldNeedsUpdate = true
    this.camera.projectionMatrix.fromArray(projectionMatrix)
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert()
    this.setTime(timeMs)
  }


  /**
   * Move everything to a time: Earth's turn (GMST) and each object's update.
   *
   * @param {number} timeMs Unix ms, UTC
   */
  setTime(timeMs) {
    if (!Number.isFinite(timeMs)) {
      return
    }
    this.timeMs = timeMs
    this.jd = unixMsToJd(timeMs)
    this.gmst = gmstRad(this.jd)
    equatorToEcef(this.gmst, this.root.matrix)
    this.root.matrixWorldNeedsUpdate = true
    this.scene.updateMatrixWorld()
    this.camera.updateMatrixWorld()
    this.satellites?.update(this.jd)
    for (const network of Object.values(this.networks)) {
      network.update(this.jd)
    }
  }


  /**
   * @param {object} renderer a three WebGLRenderer on the guest's context
   */
  render(renderer) {
    renderer.render(this.scene, this.camera)
  }


  /** @param {Array<string>} patterns the host's `layer:anchors-subscribe` */
  subscribe(patterns) {
    this.patterns = Array.isArray(patterns) ? patterns : []
    this._sub = compileSubscription(this.patterns)
  }


  /** @returns {boolean} whether anything is subscribed */
  get subscribed() {
    return this.patterns.length > 0
  }


  /**
   * The subscribed anchors at the last time set (portal RFC 0001 §8.1):
   * `p` in ECEF metres where the layer draws it; for what's on the ground,
   * on the host's Earth, with `geo` its own WGS84 latitude, longitude and
   * height.  Only the subscribed schemes are walked, and exact ids are
   * looked up: `dsn:*` alone never touches the ~11,000 satellites.
   *
   * @returns {Array<{id: string, kind: string, name: string, p: Array<number>}>}
   */
  anchors() {
    if (!this.subscribed) {
      return []
    }
    const sub = this._sub
    const out = new Map
    const v = new Vector3
    const ecef = (eq) => {
      v.copy(eq).applyMatrix4(this.root.matrix)
      return [v.x, v.y, v.z]
    }
    const sources = this._satelliteSources()
    const satAnchor = (src, i, at) => {
      const rec = src.records[i]
      return {id: satelliteAnchor(rec.id), kind: src.kind, name: rec.name, p: ecef(at)}
    }
    const norad = SCHEMES.satellite
    if (sub.whole(norad)) {
      for (const src of sources) {
        for (let i = 0; i < src.records.length; i++) {
          if (src.exact(i, v)) {
            const a = satAnchor(src, i, v)
            out.set(a.id, a)
          }
        }
      }
    } else if (sub.exact.has(norad)) {
      for (const id of sub.exact.get(norad)) {
        const num = Number(id.slice(norad.length + 1))
        for (const src of sources) {
          const i = src.indexOf(num)
          if (i !== undefined && src.exact(i, v)) {
            out.set(id, satAnchor(src, i, v))
          }
        }
      }
    }
    const dsn = this._dsnAnchors((scheme) => sub.wantsScheme(scheme) || sub.near.some((q) => q.match.wantsScheme(scheme)))
    for (const a of dsn) {
      if (sub.wants(a.id) || a.aliases?.some((alias) => sub.wants(alias))) {
        out.set(a.id, a)
      }
    }
    for (const q of sub.near) {
      for (const a of this._nearest(q, sources, dsn, satAnchor)) {
        out.set(a.id, a)
      }
    }
    return [...out.values()]
  }


  /**
   * Who has satellites to anchor, by the same interface: the population,
   * Starlink, Iridium.
   *
   * @returns {Array<{kind: string, records: Array<object>, indexOf: Function, exact: Function, cheap: Function}>}
   */
  _satelliteSources() {
    const jd = this.jd
    const out = []
    const pop = this.satellites
    if (pop) {
      out.push({kind: 'satellite', records: pop.records, indexOf: (id) => pop.byId.get(id),
        exact: (i, at) => pop.positionAt(pop.records[i], jd, at),
        // Where this frame drew it (Population.js update), for ranking.
        cheap: (i, at) => {
          const {position, aShow} = pop.points.geometry.attributes
          if (!(aShow.getX(i) > 0)) {
            return false
          }
          at.fromBufferAttribute(position, i)
          return true
        }})
    }
    for (const [kind, sats] of [['starlink', this.networks.S], ['iridium', this.networks.I?.sats]]) {
      if (!sats) {
        continue
      }
      if (!this._byId.has(sats.records)) {
        this._byId.set(sats.records, new Map(sats.records.map((rec, i) => [rec.id, i])))
      }
      const index = this._byId.get(sats.records)
      const at = (i, p) => Boolean(sats.positionOf(i, p))
      out.push({kind, records: sats.records, indexOf: (id) => index.get(id), exact: at, cheap: at})
    }
    return out
  }


  /**
   * The DSN's anchors, of the schemes asked for: its complexes and dishes
   * on the host's Earth, and the spacecraft at its links' far ends.
   *
   * @param {function(string): boolean} wanted by scheme
   * @returns {Array<object>}
   */
  _dsnAnchors(wanted) {
    const dsn = this.networks.D
    const out = []
    if (!dsn) {
      return out
    }
    if (wanted(SCHEMES.dish)) {
      for (const site of dsn.config.sites) {
        out.push({id: siteAnchor(site.name), kind: 'dsn-site', name: site.friendlyName, geo: [site.lat, site.lng, site.alt ?? 0],
          p: bodyFixedToEcef(latLngAltToBodyFixed(site.lat, site.lng, site.alt ?? 0, this.surfaceRadius))})
      }
      for (const dish of dsn.dishes) {
        out.push({id: dishAnchor(dish.name), kind: 'dsn-dish', name: dish.friendlyName, geo: [dish.lat, dish.lng, dish.alt],
          p: bodyFixedToEcef(dish.bodyFixed)})
      }
    }
    if ((wanted(SCHEMES.spacecraft) || wanted(SCHEMES.naif)) && dsn.liveAt(this.jd)) {
      const seen = new Set
      for (const link of dsn.links) {
        const id = spacecraftAnchor(link.spacecraft)
        if (link.end && !seen.has(id)) {
          seen.add(id)
          const naif = naifAnchor(link.naifId)
          const v = link.end.clone().applyMatrix4(this.root.matrix)
          out.push({id, kind: 'spacecraft', name: link.name, p: [v.x, v.y, v.z], ...(naif ? {aliases: [naif]} : {})})
        }
      }
    }
    return out
  }


  /**
   * A `near` query's anchors (anchors.js compileSubscription): the n
   * nearest its point of those its pattern matches, by where they're drawn.
   *
   * @param {{p: Array<number>, n: number, match: object}} q
   * @param {Array<object>} sources _satelliteSources
   * @param {Array<object>} dsn _dsnAnchors
   * @param {Function} satAnchor
   * @returns {Array<object>}
   */
  _nearest(q, sources, dsn, satAnchor) {
    // The best n so far, nearest first: [d², make]
    const best = []
    const offer = (d2, make) => {
      if (best.length === q.n && d2 >= best[best.length - 1][0]) {
        return
      }
      let k = best.length
      while (k > 0 && best[k - 1][0] > d2) {
        k--
      }
      best.splice(k, 0, [d2, make])
      if (best.length > q.n) {
        best.pop()
      }
    }
    const d2 = (x, y, z, [px, py, pz]) => ((x - px) ** 2) + ((y - py) ** 2) + ((z - pz) ** 2)
    const norad = SCHEMES.satellite
    if (q.match.wantsScheme(norad)) {
      const whole = q.match.whole(norad)
      const v = new Vector3
      // The point in the satellites' frame (root's turn is a rotation, so
      // distances are the same there), rather than each one to ECEF.
      const at = new Vector3(...q.p).applyMatrix4(this._rootInv.copy(this.root.matrix).invert()).toArray()
      for (const src of sources) {
        for (let i = 0; i < src.records.length; i++) {
          if ((whole || q.match.wants(satelliteAnchor(src.records[i].id))) && src.cheap(i, v)) {
            offer(d2(v.x, v.y, v.z, at), () => (src.exact(i, v) ? satAnchor(src, i, v) : null))
          }
        }
      }
    }
    for (const a of dsn) {
      if (q.match.wants(a.id) || a.aliases?.some((alias) => q.match.wants(alias))) {
        offer(d2(...a.p, q.p), () => a)
      }
    }
    return best.map(([, make]) => make()).filter(Boolean)
  }


  /** Free the GPU buffers. */
  dispose() {
    this.satellites?.removeFromParent()
    for (const network of Object.values(this.networks)) {
      network.dispose?.()
    }
  }
}
