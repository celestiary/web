import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Object3D,
  Points,
  ShaderMaterial,
  Vector3,
} from 'three'
import SpriteSheet from '../SpriteSheet.js'
import {sceneReferred} from '../hdr.js'
import {SATELLITES_LOAD_DIST, displayName, satelliteTarget} from './names.js'
import {temePosition, temeToEquator} from './sgp4.js'


// Earth's satellites, drawn (Satellites.md): a point each, on the overlay
// layer in the orbits group (`o`), the stations named, and a node for each
// satellite that is targeted or ridden, which the camera can hang from.
// Hung from Earth's planetTilt (+Y the pole, +X the equinox of date), so a
// position is SGP4's TEME taken to that frame (sgp4.js temeToEquator), and
// moved each frame from the Julian Day animated (preAnimCb).


/** The snapshot's groups (tools/satellites/fetch.mjs): colour, and whether named. */
export const GROUPS = {
  stations: {color: 0xfff2c0, named: true, text: 'space stations'},
  science: {color: 0xffd0a0, named: true, text: 'science'},
  gnss: {color: 0x9fe09f, named: false, text: 'navigation (GPS, GLONASS, Galileo, BeiDou)'},
  starlink: {color: 0x7fd0ff, named: false, text: 'Starlink (a sample)'},
  geo: {color: 0xd0d0d0, named: false, text: 'geostationary (a sample)'},
  molniya: {color: 0xff9f9f, named: false, text: 'Molniya orbits'},
  weather: {color: 0xfff07f, named: false, text: 'weather (sun-synchronous and geostationary)'},
}
const OTHER = {color: 0xc8c8c8, named: false}

const POINT_SIZE_PX = 3.5
// Past this far from Earth's centre the points are a smudge round its own
// point: not drawn.
const MAX_SHOW_DIST = SATELLITES_LOAD_DIST
// The station names show nearer than this.
const MAX_LABEL_DIST = 2e8
// How far from a satellite a go arrives, metres, until a model (#25) says
// otherwise (`node.arrivalDistance`): far enough to see it against Earth.
export const ARRIVAL_DIST = 300e3
const noRaycast = () => undefined
const tmpV = new Vector3
const tmpCam = new Vector3


/** */
export default class Satellites extends Group {
  /**
   * @param {Array<import('./sgp4.js').SatRecord>} records parseCatalog's
   * @param {object} [opts]
   * @param {number} [opts.layer] the overlay layer, for the points and labels
   * @param {Function} [opts.Sheet] the label sheet's class (a test's stub)
   * @param {object} [opts.camera] the view's, for what to show by distance
   */
  constructor(records, {layer = null, Sheet = SpriteSheet, camera = null} = {}) {
    super()
    this.name = 'satellites'
    this.records = records
    this.byId = new Map(records.map((r, i) => [r.id, i]))
    this.layer = layer
    this.Sheet = Sheet
    this.camera = camera
    // What's drawn, the group that joins `o`: the points and the names.
    this.marks = new Group
    this.marks.name = 'satellite marks'
    this.add(this.marks)
    this.points = this._newPoints()
    this.marks.add(this.points)
    // The nodes made for targets, by id, and the names, by id.
    this.nodes = new Map
    this.labels = new Map
    this._wantLabels = new Set(records.filter((r) => (GROUPS[r.group] ?? OTHER).named).map((r) => r.id))
    this._targetId = null
    this.jd = NaN
    this.drawnCount = 0
    this.preAnimCb = (time, jd) => this.update(jd)
  }


  /**
   * @param {number} id NORAD number
   * @returns {?import('./sgp4.js').SatRecord}
   */
  record(id) {
    const i = this.byId.get(Number(id))
    return i === undefined ? null : this.records[i]
  }


  /**
   * The node a satellite's target is at, made on first use: what the camera
   * hangs from when it goes to or rides the satellite, and where a model
   * (#25) would hang.  Moved each frame with the points.
   *
   * @param {number} id
   * @returns {?Object3D}
   */
  node(id) {
    const rec = this.record(id)
    if (!rec) {
      return null
    }
    let node = this.nodes.get(rec.id)
    if (!node) {
      node = new Object3D
      node.name = `satellite ${rec.id}`
      node.isSatelliteNode = true
      node.satellite = rec
      // The camera's distance on arrival; a model sets its own.
      node.arrivalDistance = ARRIVAL_DIST
      this.nodes.set(rec.id, node)
      this.add(node)
      if (Number.isFinite(this.jd)) {
        this._place(rec, node.position, this.jd)
      }
    }
    return node
  }


  /**
   * Name this satellite too (and stop naming the one before, unless it's a
   * station): the target's name, made in the next frame.
   *
   * @param {?number} id
   */
  setTarget(id) {
    this._targetId = id === null || id === undefined ? null : Number(id)
  }


  /**
   * @param {number} id
   * @param {number} jd Julian Day (UTC)
   * @returns {boolean} whether it's drawn at jd (within its elements' window)
   */
  drawnAt(id, jd) {
    const rec = this.record(id)
    return Boolean(rec && temePosition(rec, jd))
  }


  /**
   * Move every satellite to the date: the points while they're shown, and
   * the targets' nodes always (the camera may ride one with `o` off).
   *
   * @param {number} jd Julian Day (UTC)
   */
  update(jd) {
    this.jd = jd
    for (const [id, node] of this.nodes) {
      this._place(this.records[this.byId.get(id)], node.position, jd)
    }
    if (this.camera) {
      this.showFor(this.camera)
    }
    if (!this.marks.visible || !this.points.visible) {
      return
    }
    const pos = this.points.geometry.attributes.position
    const show = this.points.geometry.attributes.aShow
    let drawn = 0
    for (let i = 0; i < this.records.length; i++) {
      const p = temePosition(this.records[i], jd)
      if (p) {
        temeToEquator(p, tmpV)
        pos.setXYZ(i, tmpV.x, tmpV.y, tmpV.z)
        drawn++
      }
      show.setX(i, p ? 1 : 0)
    }
    this.drawnCount = drawn
    pos.needsUpdate = true
    show.needsUpdate = true
    this._syncLabels(jd)
  }


  /**
   * @param {object} rec
   * @param {Vector3} out
   * @param {number} jd
   * @returns {boolean} whether it has a position at jd; where it hasn't,
   *   out is left where it was
   */
  _place(rec, out, jd) {
    const p = rec && temePosition(rec, jd)
    if (p) {
      temeToEquator(p, out)
    }
    return Boolean(p)
  }


  /** @returns {Points} */
  _newPoints() {
    const n = this.records.length
    const colors = new Float32Array(n * 3)
    const c = new Color
    this.records.forEach((r, i) => {
      c.setHex((GROUPS[r.group] ?? OTHER).color).toArray(colors, i * 3)
    })
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(n * 3), 3))
    geometry.setAttribute('aColor', new Float32BufferAttribute(colors, 3))
    geometry.setAttribute('aShow', new Float32BufferAttribute(new Float32Array(n), 1))
    const material = sceneReferred(new ShaderMaterial({
      uniforms: {uSize: {value: POINT_SIZE_PX}, uPixelRatio: {value: 1}},
      vertexShader: `
        uniform float uSize;
        uniform float uPixelRatio;
        attribute vec3 aColor;
        attribute float aShow;
        varying vec3 vColor;
        void main() {
          vColor = aColor;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          // Off the screen, not drawn, outside its window.
          if (aShow < 0.5) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          }
          gl_PointSize = uSize * uPixelRatio;
        }`,
      // A round dot, soft at its edge: symmetric, so SwiftShader's flipped
      // gl_PointCoord (AGENTS.md) doesn't show.
      fragmentShader: `
        varying vec3 vColor;
        void main() {
          float r = length(gl_PointCoord - 0.5) * 2.0;
          float a = 1.0 - smoothstep(0.6, 1.0, r);
          if (a <= 0.0) discard;
          gl_FragColor = vec4(vColor, a);
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, toneMapped: false,
    }))
    const points = new Points(geometry, material)
    points.name = 'satellite points'
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


  /**
   * Show the points and names by the camera's distance from Earth: hidden
   * past MAX_SHOW_DIST, names only within MAX_LABEL_DIST (the target's
   * wherever the points are).  Each frame, from update: cheap.
   *
   * @param {object} camera
   */
  showFor(camera) {
    const d = camera.getWorldPosition(tmpCam).distanceTo(this.getWorldPosition(tmpV))
    this.points.visible = d < MAX_SHOW_DIST
    const named = d < MAX_LABEL_DIST
    for (const [id, label] of this.labels) {
      label.visible = label.userData.placed && (named || id === this._targetId)
    }
  }


  /**
   * Make the names wanted (the named groups' and the target's) and drop the
   * rest, and lay them on their satellites.  In the animation loop, as the
   * sheets draw to a canvas.
   *
   * @param {number} jd
   */
  _syncLabels(jd) {
    for (const [id, label] of this.labels) {
      if (!this._wantLabels.has(id) && id !== this._targetId) {
        this._dropLabel(id, label)
      }
    }
    const want = this._targetId === null ? this._wantLabels : new Set([...this._wantLabels, this._targetId])
    for (const id of want) {
      const rec = this.record(id)
      if (!rec) {
        continue
      }
      let label = this.labels.get(id)
      if (!label) {
        label = this._newLabel(rec)
        this.labels.set(id, label)
        this.marks.add(label)
      }
      label.userData.placed = this._place(rec, label.position, jd)
      label.visible &&= label.userData.placed
    }
  }


  /**
   * @param {object} rec
   * @returns {object} a one-label sheet's sprites
   */
  _newLabel(rec) {
    const text = displayName(rec)
    const sheet = new this.Sheet(1, text)
    sheet.add(0, 0, 0, text, `#${new Color((GROUPS[rec.group] ?? OTHER).color).getHexString()}`)
    const sprites = sheet.compile()
    sprites.name = `satellite label ${rec.id}`
    sprites.frustumCulled = false
    sprites.raycast = noRaycast
    if (this.layer !== null) {
      sprites.layers.set(this.layer)
    }
    // A click targets it, a double click goes (labelPick.js).
    sprites.userData.labelTargets = [satelliteTarget(rec)]
    sprites.userData.declutter = true
    sprites.userData.labelRank = [rec.group === 'stations' ? 1 : 0]
    sprites.userData.ownSheet = sheet
    sprites.visible = false
    return sprites
  }


  /**
   * @param {number} id
   * @param {object} label
   */
  _dropLabel(id, label) {
    this.labels.delete(id)
    label.removeFromParent()
    label.geometry?.dispose?.()
    label.material?.uniforms?.map?.value?.dispose?.()
    label.material?.dispose?.()
    label.userData.ownSheet?.canvas?.remove?.()
  }
}
