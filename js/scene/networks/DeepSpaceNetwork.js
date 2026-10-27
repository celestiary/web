import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  NormalBlending,
  Points,
  ShaderMaterial,
  Vector3,
} from 'three'
import SpriteSheet from '../SpriteSheet.js'
import {fadeObject} from '../fade.js'
import {gmstRad} from '../celestialFrame.js'
import {latLngAltToBodyFixed} from '../../coords.js'
import {sceneReferred} from '../hdr.js'
import {unixMsToJd} from '../satellites/sgp4.js'
import {DSN_NOW_URL, POLL_MS, bodyFixedToEquator, dsnLinks, parseDsnXml, topocentricDirection} from './dsn.js'
import {newWideLines, setWideLineSegments} from '../wideLines.js'


// NASA's Deep Space Network (Networks.md, "DSN"): its three complexes'
// dishes on the turning Earth, and DSN Now's live links from each dish to
// its spacecraft, drawn out along the dish's pointing to the range the feed
// gives.  Hung from Earth's planetTilt: the dishes are turned there by GMST
// each frame, as Animation turns Earth, and a link's far end is fixed in
// that frame where the feed put it, at the feed's time, so it stays on the
// spacecraft while Earth turns under it.  Polled every POLL_MS while shown
// and the page is visible, from the animation loop (so never while the
// tab is hidden), and quiet when the feed can't be had.


const KM = 1e3
const EARTH_RADIUS_M = 6378137
// Links are drawn while the clock is this near the feed's time, days: DSN
// Now says what the dishes are doing now, not at another date.
export const LIVE_WINDOW_DAYS = 1 / 24
// A link whose range the feed doesn't give is drawn this far, metres, in
// dashes that fade: its direction, not where the spacecraft is.
export const UNKNOWN_RANGE_M = 2e9
const DASHES = 8
// The complexes' names show nearer than this to Earth's centre, m (the
// satellites' names' distance).
const SITE_LABEL_DIST = 2e8
// A spacecraft's name shows while its end is at least this far from
// Earth's centre, as a share of the camera's distance (about 3°).
const LABEL_MIN_APART = 0.05
const DASH_FILL = 0.6
// Backing off after a failed poll: doubled each time, up to this, ms.
const MAX_BACKOFF_MS = 5 * 60e3
const UP_COLOR = 0xffa040
const DOWN_COLOR = 0x50d8ff
const DISH_COLOR = 0xffffff
const SITE_LABEL_COLOR = '#e8f4ff'
const SC_LABEL_COLOR = '#a8ecff'
const DOWN_WIDTH_PX = 3
const UP_WIDTH_PX = 1.5
const DISH_SIZE_PX = 5
const MAX_SEGMENTS = 512
const noRaycast = () => undefined
const Y_AXIS = new Vector3(0, 1, 0)
const tmp = new Vector3
const tmpDir = new Vector3
const tmpCam = new Vector3
const tmpEarth = new Vector3


/** */
export default class DeepSpaceNetwork extends Group {
  /**
   * @param {object} config public/data/earth/networks/dsn.json
   * @param {object} [opts]
   * @param {?number} [opts.layer] the overlay layer
   * @param {Function} [opts.Sheet] the label sheet's class (a test's stub)
   * @param {Function} [opts.fetchFn] fetch, for the feed
   * @param {Function} [opts.nowMs] the wall clock, for the polling
   * @param {?object} [opts.camera] the view's, for the names by distance
   * @param {boolean} [opts.labels] the complexes' and spacecraft's names
   *   (false in layer mode, design/LayerMode.md)
   */
  constructor(config, {layer = null, Sheet = SpriteSheet, fetchFn = (...a) => globalThis.fetch(...a), nowMs = () => Date.now(),
    camera = null, labels = true} = {}) {
    super()
    this.name = 'dsn'
    this.config = config
    this.camera = camera
    this.labelsOn = labels
    this.layer = layer
    this.Sheet = Sheet
    this.fetchFn = fetchFn
    this.nowMs = nowMs
    // The overlay's fade uniform, for labels made after the group joined it.
    this.fadeUniform = null
    // Every dish, at its complex: config.xml gives the complexes' latitude
    // and longitude, not each dish's (Networks.md).
    this.dishes = config.sites.flatMap((site) => site.dishes.map((d) => ({
      ...d, site: site.name, lat: site.lat, lng: site.lng, alt: site.alt ?? 0,
      bodyFixed: latLngAltToBodyFixed(site.lat, site.lng, site.alt ?? 0, EARTH_RADIUS_M),
      // Where it is in this frame now (update).
      equator: new Vector3,
    })))
    this.dishByName = new Map(this.dishes.map((d) => [d.name, d]))
    // The sphere the dishes are on (setSurfaceRadius).
    this.surfaceRadius = EARTH_RADIUS_M
    // What turns with Earth: the dishes and the complexes' names, at their
    // latitudes and longitudes (coords.js), as places are.
    this.earthFixed = new Group
    this.earthFixed.name = 'dsn earth-fixed'
    this.add(this.earthFixed)
    this.dishPoints = this._newDishPoints()
    this.earthFixed.add(this.dishPoints)
    this.siteLabels = labels ? this._newSiteLabels(config.sites) : new Group
    this.earthFixed.add(this.siteLabels)
    this.downBeams = this._newBeams('dsn downlinks', DOWN_WIDTH_PX)
    // The uplinks over the downlinks, opaque: a link with both reads as an
    // orange core in a blue beam, not their sum.
    this.upBeams = this._newBeams('dsn uplinks', UP_WIDTH_PX, NormalBlending)
    this._seg = {
      down: {start: new Float64Array(MAX_SEGMENTS * 3), end: new Float64Array(MAX_SEGMENTS * 3), color: new Float32Array(MAX_SEGMENTS * 3)},
      up: {start: new Float64Array(MAX_SEGMENTS * 3), end: new Float64Array(MAX_SEGMENTS * 3), color: new Float32Array(MAX_SEGMENTS * 3)},
    }
    // The spacecraft's names, by code, at the links' far ends.
    this.scLabels = new Map
    // The feed: its links, each with its far end in this frame (`end`, m)
    // or its direction (`dir`) where the range isn't known.
    this.links = []
    this.feedMs = NaN
    this.status = {polls: 0, ok: 0, failures: 0, lastError: null, lastFeedMs: NaN}
    // Called when a feed changes what's drawn (layer mode asks its host for
    // a frame: design/LayerMode.md, `layer:invalidate`).
    this.onFeed = null
    this._lastXml = null
    this._nextPollMs = 0
    this._pending = null
    this.jd = NaN
    this.preAnimCb = (time, jd) => this.update(jd)
  }


  /**
   * Turn the dishes to the date, lay the links from them, and poll the
   * feed when it's due.
   *
   * @param {number} jd Julian Day (UTC)
   */
  update(jd) {
    this.jd = jd
    if (!this.visible) {
      return
    }
    this.maybePoll()
    const gmst = gmstRad(jd)
    this.earthFixed.setRotationFromAxisAngle(Y_AXIS, gmst)
    for (const d of this.dishes) {
      const {x, y, z} = d.bodyFixed
      bodyFixedToEquator(x, y, z, gmst, d.equator)
    }
    this._layLinks(jd)
  }


  /**
   * Put the dishes on a sphere of this radius: a host's Earth (layer mode's
   * `view.earth`, design/LayerMode.md), so they sit on its surface (deck's
   * globe is 6,370,972 m, not WGS84's 6,378,137).  The latitude and
   * longitude go on it as spherical ones, as the host's do.  Links take it
   * from the next feed.  Not the complexes' names: layer mode has none.
   *
   * @param {number} radius m
   */
  setSurfaceRadius(radius) {
    if (!(radius > 0) || radius === this.surfaceRadius) {
      return
    }
    this.surfaceRadius = radius
    const pos = this.dishPoints.geometry.attributes.position
    this.dishes.forEach((d, i) => {
      d.bodyFixed = latLngAltToBodyFixed(d.lat, d.lng, d.alt, radius)
      pos.setXYZ(i, d.bodyFixed.x, d.bodyFixed.y, d.bodyFixed.z)
    })
    pos.needsUpdate = true
  }


  /**
   * @param {number} jd
   * @returns {boolean} whether the feed's links are drawn at jd: it's near
   *   the feed's time
   */
  liveAt(jd) {
    return Number.isFinite(this.feedMs) && Math.abs(jd - unixMsToJd(this.feedMs)) <= LIVE_WINDOW_DAYS
  }


  /**
   * Take a feed: its links, with their far ends fixed in this frame at its
   * time.
   *
   * @param {string} xml DSN Now's dsn.xml
   */
  setFeed(xml) {
    // The same feed again (the CDN's copy): nothing changes.
    if (xml === this._lastXml) {
      return
    }
    this._lastXml = xml
    const feed = parseDsnXml(xml)
    const links = dsnLinks(feed, this.config)
    const times = feed.stations.map((s) => s.timeMs).filter(Number.isFinite)
    this.feedMs = times.length ? Math.max(...times) : this.nowMs()
    this.links = []
    for (const link of links) {
      const dish = this.dishByName.get(link.dish)
      if (!dish) {
        continue
      }
      const gmst = gmstRad(unixMsToJd(Number.isFinite(link.timeMs) ? link.timeMs : this.feedMs))
      topocentricDirection(dish.lat, dish.lng, link.azimuth, link.elevation, tmpDir)
      const known = link.rangeKm !== null
      const dir = bodyFixedToEquator(tmpDir.x, tmpDir.y, tmpDir.z, gmst, new Vector3)
      let end = null
      if (known) {
        const {x, y, z} = dish.bodyFixed
        const r = link.rangeKm * KM
        end = bodyFixedToEquator(x + (tmpDir.x * r), y + (tmpDir.y * r), z + (tmpDir.z * r), gmst, new Vector3)
      }
      this.links.push({...link, dir, end})
    }
    this._syncLabels()
    this.onFeed?.()
  }


  /** Ask for the feed, if it's due, shown and the page is visible. */
  maybePoll() {
    const now = this.nowMs()
    if (this._pending || now < this._nextPollMs || !this.visible || globalThis.document?.hidden ||
        globalThis.navigator?.onLine === false) {
      return
    }
    this.status.polls++
    // The feed's CDN keeps a copy an hour; the query asks for this 5 s's.
    const url = `${DSN_NOW_URL}?r=${Math.floor(now / POLL_MS)}`
    this._pending = Promise.resolve()
        .then(() => this.fetchFn(url))
        .then((rsp) => {
          if (!rsp.ok) {
            throw new Error(`${rsp.status}`)
          }
          return rsp.text()
        })
        .then((xml) => {
          this.setFeed(xml)
          this.status.ok++
          this.status.failures = 0
          this.status.lastFeedMs = this.feedMs
        })
        .catch((err) => {
          // Offline, or the feed down: quiet, and asked again later.
          this.status.failures++
          this.status.lastError = String(err?.message ?? err)
        })
        .finally(() => {
          const wait = this.status.failures ? Math.min(POLL_MS * (2 ** this.status.failures), MAX_BACKOFF_MS) : POLL_MS
          this._nextPollMs = now + wait
          this._pending = null
        })
  }


  /** @param {number} jd */
  _layLinks(jd) {
    const live = this.liveAt(jd)
    const counts = {down: 0, up: 0}
    const c = new Color
    const add = (kind, s, e, color, gain) => {
      if (counts[kind] >= MAX_SEGMENTS) {
        return
      }
      const seg = this._seg[kind]
      const k = 3 * counts[kind]
      seg.start.set([s.x, s.y, s.z], k)
      seg.end.set([e.x, e.y, e.z], k)
      c.setHex(color).multiplyScalar(gain).toArray(seg.color, k)
      counts[kind]++
    }
    const a = new Vector3
    const b = new Vector3
    for (const link of live ? this.links : []) {
      const from = this.dishByName.get(link.dish)?.equator
      if (!from) {
        continue
      }
      const kinds = [link.down && ['down', DOWN_COLOR], link.up && ['up', UP_COLOR]].filter(Boolean)
      for (const [kind, color] of kinds) {
        if (link.end) {
          add(kind, from, link.end, color, 1)
        } else {
          // Dashes along the pointing, fading out: the direction only.
          for (let d = 0; d < DASHES; d++) {
            a.copy(link.dir).multiplyScalar(UNKNOWN_RANGE_M * d / DASHES).add(from)
            b.copy(link.dir).multiplyScalar(UNKNOWN_RANGE_M * (d + DASH_FILL) / DASHES).add(from)
            add(kind, a, b, color, 1 - (d / DASHES))
          }
        }
      }
    }
    setWideLineSegments(this.downBeams, this._seg.down, counts.down)
    setWideLineSegments(this.upBeams, this._seg.up, counts.up)
    // The spacecraft's names, at the far ends.
    const ends = new Map
    for (const link of live ? this.links : []) {
      const from = this.dishByName.get(link.dish)?.equator
      if (!ends.has(link.spacecraft) && from) {
        ends.set(link.spacecraft, link.end ?? tmp.copy(link.dir).multiplyScalar(UNKNOWN_RANGE_M).add(from).clone())
      }
    }
    // By the camera's distance: the complexes' names close in, and a
    // spacecraft's only while its end is apart from Earth on the screen
    // (from far out, the Moon's and the dashes' ends are on Earth).
    const d = this.camera ? this.camera.getWorldPosition(tmpCam).distanceTo(this.getWorldPosition(tmpEarth)) : 0
    this.siteLabels.visible = d < SITE_LABEL_DIST
    for (const [code, label] of this.scLabels) {
      const at = ends.get(code)
      label.visible = Boolean(at) && at.length() > LABEL_MIN_APART * d
      if (at) {
        label.position.copy(at)
      }
    }
  }


  /** Make a label for each spacecraft in the feed, drop the rest. */
  _syncLabels() {
    const want = new Map(this.links.map((l) => [l.spacecraft, l.name]))
    for (const [code, label] of this.scLabels) {
      if (!want.has(code)) {
        this.scLabels.delete(code)
        label.removeFromParent()
        label.geometry?.dispose?.()
        label.material?.uniforms?.map?.value?.dispose?.()
        label.material?.dispose?.()
        label.userData.ownSheet?.canvas?.remove?.()
      }
    }
    for (const [code, name] of want) {
      if (!this.scLabels.has(code)) {
        if (!this.labelsOn) {
          continue
        }
        const label = this._newLabel(name, SC_LABEL_COLOR)
        label.visible = false
        this.scLabels.set(code, label)
        this.add(label)
      }
    }
  }


  /**
   * The complexes' names, on Earth's surface as the places' are (Places.js:
   * the far side's not drawn, no depth test), each a click to target its
   * place and a double click to go there (labelPick.js).
   *
   * @param {Array<object>} sites
   * @returns {object} the sheet's sprites
   */
  _newSiteLabels(sites) {
    const sheet = new this.Sheet(sites.length, sites.map((s) => s.friendlyName), undefined, [0, 0], false, true)
    for (const site of sites) {
      const {x, y, z} = latLngAltToBodyFixed(site.lat, site.lng, site.alt ?? 0, EARTH_RADIUS_M)
      sheet.add(x, y, z, site.friendlyName, SITE_LABEL_COLOR)
    }
    const sprites = sheet.compile()
    sprites.name = 'dsn complexes'
    sprites.frustumCulled = false
    sprites.raycast = noRaycast
    if (this.layer !== null) {
      sprites.layers.set(this.layer)
    }
    sprites.userData.labelTargets = sites.map((s) => ({kind: 'place', body: 'earth', name: s.friendlyName, lat: s.lat, lng: s.lng}))
    sprites.userData.declutter = true
    sprites.userData.labelRank = sites.map(() => 1)
    sprites.userData.ownSheet = sheet
    return sprites
  }


  /**
   * @param {string} text
   * @param {string} color
   * @returns {object} a one-label sheet's sprites
   */
  _newLabel(text, color) {
    const sheet = new this.Sheet(1, text)
    sheet.add(0, 0, 0, text, color)
    const sprites = sheet.compile()
    sprites.name = `dsn label ${text}`
    sprites.frustumCulled = false
    sprites.raycast = noRaycast
    if (this.layer !== null) {
      sprites.layers.set(this.layer)
    }
    sprites.userData.declutter = true
    sprites.userData.labelRank = [0]
    sprites.userData.ownSheet = sheet
    if (this.fadeUniform) {
      fadeObject(sprites, this.fadeUniform)
    }
    return sprites
  }


  /**
   * @param {string} name
   * @param {number} width px
   * @param {number} [blending] three's
   * @returns {object} a wideLines mesh, none drawn yet
   */
  _newBeams(name, width, blending = AdditiveBlending) {
    const zeros = new Float64Array(MAX_SEGMENTS * 3)
    const mesh = newWideLines({start: zeros, end: zeros, color: new Float32Array(MAX_SEGMENTS * 3)}, {name})
    mesh.geometry.instanceCount = 0
    mesh.material.blending = blending
    mesh.material.uniforms.uWidthFirst.value = mesh.material.uniforms.uWidthLast.value = width
    if (this.layer !== null) {
      mesh.layers.set(this.layer)
    }
    this.add(mesh)
    return mesh
  }


  /** @returns {Points} a point at each dish */
  _newDishPoints() {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(this.dishes.flatMap((d) => d.bodyFixed.toArray()), 3))
    const color = new Color(DISH_COLOR)
    const material = sceneReferred(new ShaderMaterial({
      uniforms: {uSize: {value: DISH_SIZE_PX}, uPixelRatio: {value: 1}, uColor: {value: color}},
      vertexShader: `
        uniform float uSize;
        uniform float uPixelRatio;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          // Not drawn on Earth's far side: the surface's normal, the
          // position from Earth's centre (this frame's origin), turned
          // away from the eye.  No depth test, as the places' labels: the
          // ground under a dish is at its depth.
          if (dot(mat3(modelViewMatrix) * position, mv.xyz) > 0.0) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          }
          gl_PointSize = uSize * uPixelRatio;
        }`,
      // A ring: a dish, not a satellite's dot.  Symmetric (SwiftShader's
      // flipped gl_PointCoord, AGENTS.md).
      fragmentShader: `
        uniform vec3 uColor;
        void main() {
          float r = length(gl_PointCoord - 0.5) * 2.0;
          float a = smoothstep(0.35, 0.55, r) * (1.0 - smoothstep(0.8, 1.0, r));
          if (a <= 0.0) discard;
          gl_FragColor = vec4(uColor, a);
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, depthTest: false, toneMapped: false,
    }))
    const points = new Points(geometry, material)
    points.name = 'dsn dishes'
    points.frustumCulled = false
    points.raycast = noRaycast
    if (this.layer !== null) {
      points.layers.set(this.layer)
    }
    points.onBeforeRender = (renderer) => {
      material.uniforms.uPixelRatio.value = renderer.getPixelRatio()
    }
    return points
  }


  /** Free the GPU buffers and labels. */
  dispose() {
    this.removeFromParent()
    this.traverse((node) => {
      node.geometry?.dispose?.()
      node.material?.dispose?.()
    })
  }
}
