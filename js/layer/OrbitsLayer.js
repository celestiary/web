import {Group, Matrix4, PerspectiveCamera, Scene, Vector3} from 'three'
import Satellites from '../scene/satellites/Satellites.js'
import {bodyFixedToEcef, equatorToEcef} from './frames.js'
import {DEFAULT_SUBSCRIPTION, anchorMatcher, dishAnchor, naifAnchor, satelliteAnchor, siteAnchor, spacecraftAnchor} from './anchors.js'
import {gmstRad} from '../scene/celestialFrame.js'
import {latLngAltToBodyFixed} from '../coords.js'
import {loadNetwork} from '../scene/networks/loadNetworks.js'
import {parseCatalog, temePosition, temeToEquator, unixMsToJd} from '../scene/satellites/sgp4.js'


// Layer mode's scene (design/LayerMode.md): celestiary's satellites and the
// space networks (scene/networks/Networks.md), with no Scene or ThreeUi, in
// ECEF under a host's camera and clock.  Everything hangs from `root`, in
// Earth's equator frame of date as in the app, and `root`'s matrix turns
// that to ECEF by GMST at the host's time (frames.js).  Orbits are in true
// ECEF; what's tied to the ground (the DSN's dishes) goes on the host's
// Earth (`view.earth`, portal RFC 0001 §6.3), so it sits on the host's
// surface.  No labels: the layer publishes anchors and the host names what
// it wants.  Pure three, no DOM, so the tests drive it in bun.


/** The satellites' snapshot (as loadSatellites.js). */
export const SATELLITES_URL = 'data/satellites.json'
/** How far out the layer draws, m: the DSN's beams reach the Voyagers. */
export const EXTENT_M = {orbits: 5e7, beams: 3e13}
const EARTH_RADIUS_M = 6378137


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
    this._wanted = anchorMatcher(DEFAULT_SUBSCRIPTION)
    this._viewInv = new Matrix4
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
      jobs.push(this._loadSatellites().catch((err) => failed.push(`satellites: ${err.message ?? err}`)))
    }
    for (const key of networks) {
      jobs.push(loadNetwork(key, {camera: this.camera, labels: false}, this.fetchFn)
          .then(({network}) => {
            this.networks[key] = network
            this.root.add(network)
            if (key === 'D') {
              network.setSurfaceRadius(this.surfaceRadius)
            }
          })
          .catch((err) => failed.push(`${key}: ${err.message ?? err}`)))
    }
    await Promise.all(jobs)
    return failed
  }


  /** @returns {Promise<void>} */
  async _loadSatellites() {
    const rsp = await this.fetchFn(SATELLITES_URL)
    if (!rsp.ok) {
      throw new Error(`${rsp.status} for ${SATELLITES_URL}`)
    }
    const {rows} = await rsp.json()
    this.satellites = new Satellites(parseCatalog({rows}), {camera: this.camera, labels: false})
    this.root.add(this.satellites)
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
    this.patterns = patterns ?? []
    this._wanted = anchorMatcher(this.patterns)
  }


  /** @returns {boolean} whether anything is subscribed */
  get subscribed() {
    return this.patterns.length > 0
  }


  /**
   * The subscribed anchors at the last time set (portal RFC 0001 §8.1):
   * `p` in ECEF metres where the layer draws it; for what's on the ground,
   * on the host's Earth, with `geo` its own WGS84 latitude, longitude and
   * height.
   *
   * @returns {Array<{id: string, kind: string, name: string, p: Array<number>}>}
   */
  anchors() {
    const out = []
    if (!this.subscribed) {
      return out
    }
    const m = this.root.matrix
    const v = new Vector3
    const push = (id, kind, name, eq, extra = {}) => {
      v.copy(eq).applyMatrix4(m)
      out.push({id, kind, name, p: [v.x, v.y, v.z], ...extra})
    }
    const want = this._wanted
    if (this.satellites) {
      for (const rec of this.satellites.records) {
        const id = satelliteAnchor(rec.id)
        const p = want(id) && temePosition(rec, this.jd)
        if (p) {
          push(id, 'satellite', rec.name, temeToEquator(p, new Vector3))
        }
      }
    }
    for (const key of ['S', 'I']) {
      const sats = key === 'I' ? this.networks.I?.sats : this.networks.S
      if (!sats) {
        continue
      }
      sats.records.forEach((rec, i) => {
        const id = satelliteAnchor(rec.id)
        if (want(id) && sats.positionOf(i, new Vector3)) {
          push(id, key === 'I' ? 'iridium' : 'starlink', rec.name, sats.positionOf(i, new Vector3))
        }
      })
    }
    const dsn = this.networks.D
    if (dsn) {
      for (const site of dsn.config.sites) {
        const id = siteAnchor(site.name)
        if (want(id)) {
          out.push({id, kind: 'dsn-site', name: site.friendlyName, geo: [site.lat, site.lng, site.alt ?? 0],
            p: bodyFixedToEcef(latLngAltToBodyFixed(site.lat, site.lng, site.alt ?? 0, this.surfaceRadius))})
        }
      }
      for (const dish of dsn.dishes) {
        const id = dishAnchor(dish.name)
        if (want(id)) {
          out.push({id, kind: 'dsn-dish', name: dish.friendlyName, geo: [dish.lat, dish.lng, dish.alt],
            p: bodyFixedToEcef(dish.bodyFixed)})
        }
      }
      if (dsn.liveAt(this.jd)) {
        const seen = new Set
        for (const link of dsn.links) {
          const id = spacecraftAnchor(link.spacecraft)
          const naif = naifAnchor(link.naifId)
          if (link.end && (want(id) || (naif && want(naif))) && !seen.has(id)) {
            seen.add(id)
            push(id, 'spacecraft', link.name, link.end, naif ? {aliases: [naif]} : {})
          }
        }
      }
    }
    return out
  }


  /** Free the GPU buffers. */
  dispose() {
    this.satellites?.removeFromParent()
    for (const network of Object.values(this.networks)) {
      network.dispose?.()
    }
  }
}
