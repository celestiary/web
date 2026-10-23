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


// A population of objects round a body, drawn (js/scene/population/Population.md):
// a point each, on the overlay layer in the orbits group (`o`), coloured by
// group; names for as many as the label budget allows, ranked; groups
// switched on and off; and a node for each object that is targeted or
// ridden, which the camera can hang from.  Hung from the body's planetTilt
// (+Y its pole), moved each frame from the Julian Day animated (preAnimCb).
//
// What it is a population of comes from the data: its body, its groups'
// labels and colours, its records.  Where a record is at a date is the
// subclass's (positionAt): Earth's satellites by SGP4 (satellites/
// Satellites.js); others by their own ephemerides.  The info panel's
// controls and the link's `pop:` token use only what's here, so any
// population gets them.


const POINT_SIZE_PX = 3.5
const OTHER_COLOR = '#c8c8c8'
// How far from an object a go arrives, metres, until a model (#25) says
// otherwise (`node.arrivalDistance`): far enough to see it against its body.
export const ARRIVAL_DIST = 300e3
// Label ranks (labelDeclutter.js): above places (1 to 4), below bodies (1000+).
const RANK_TOP = 6
const RANK_SPAN = 0.99
const noRaycast = () => undefined
const tmpV = new Vector3
const tmpCam = new Vector3


/**
 * @typedef {object} PopulationRecord
 * @property {number} id unique within the population
 * @property {string} name the catalogue's
 * @property {string} group a key of the population's groups
 * @property {string} [label] what to call it, if not its name
 * @property {Array<string>} [aliases] other names the search finds it by
 * @property {boolean} [known] one of the best known: named first
 */


/**
 * @typedef {object} PopulationGroup
 * @property {string} label for the panel, e.g. 'Starlink (a sample)'
 * @property {string} [kind] what one of it is, e.g. 'Starlink'
 * @property {string} [color] CSS hex, e.g. '#7fd0ff'
 */


/** */
export default class Population extends Group {
  /**
   * @param {Array<PopulationRecord>} records
   * @param {object} opts
   * @param {string} opts.body the body it's round, whose planetTilt it hangs from
   * @param {{[key: string]: PopulationGroup}} [opts.groups] by key, in the
   *   order the panel lists them; a record's group not here is shown grey
   * @param {string} [opts.title] what the panel calls it, e.g. 'Satellites'
   * @param {number} [opts.showDist] the points show nearer than this to the body's centre, m
   * @param {number} [opts.labelDist] the names show nearer than this, m (the target's wherever the points do)
   * @param {number} [opts.layer] the overlay layer, for the points and names
   * @param {Function} [opts.Sheet] the label sheet's class (a test's stub)
   * @param {object} [opts.camera] the view's, for what to show by distance
   */
  constructor(records, {body, groups = {}, title = 'Objects', showDist = Infinity, labelDist = Infinity,
    layer = null, Sheet = SpriteSheet, camera = null} = {}) {
    super()
    this.name = `${body} population`
    this.body = body
    this.title = title
    this.records = records
    this.byId = new Map(records.map((r, i) => [r.id, i]))
    this.groupInfo = groups
    this.showDist = showDist
    this.labelDist = labelDist
    this.layer = layer
    this.Sheet = Sheet
    this.camera = camera
    // The groups switched off (all on to start).
    this.hiddenGroups = new Set
    // How many names show at once, ranked (setLabelBudget): to start, the
    // best known.
    this.defaultLabelBudget = records.filter((r) => r.known).length
    this.labelBudget = this.defaultLabelBudget
    this._rankOrder = this._ranked()
    // What's drawn, the group that joins `o`: the points and the names.
    this.marks = new Group
    this.marks.name = `${body} population marks`
    this.add(this.marks)
    this.points = this._newPoints()
    this.marks.add(this.points)
    // The nodes made for targets, by id.
    this.nodes = new Map
    this._targetId = null
    // The names: one sheet for the budget's, rebuilt when who's in it changes,
    // and one for the target's.
    this.nameSheet = null
    this._nameIds = []
    this._nameKey = ''
    this.targetLabel = null
    this.jd = NaN
    this.drawnCount = 0
    // Called when the group switches or the label budget change (Scene: the link).
    this.onChange = null
    this.preAnimCb = (time, jd) => this.update(jd)
  }


  /**
   * Where a record is at a date, in the body's equator frame (under its
   * planetTilt), metres.  The subclass's.
   *
   * @param {PopulationRecord} rec
   * @param {number} jd Julian Day (UTC)
   * @param {Vector3} out
   * @returns {boolean} whether it has a position then; where it hasn't, out
   *   is left as it was
   */
  positionAt(rec, jd, out) {
    return false
  }


  /**
   * @param {number} id
   * @returns {?PopulationRecord}
   */
  record(id) {
    const i = this.byId.get(Number(id))
    return i === undefined ? null : this.records[i]
  }


  /**
   * @param {PopulationRecord} rec
   * @returns {string} what to call it
   */
  displayName(rec) {
    return rec.label ?? rec.name
  }


  /**
   * The groups, for the panel: each with its count and whether it's shown,
   * in the data's order, then any a record names that the data doesn't.
   *
   * @returns {Array<{key: string, label: string, kind: string, color: string, count: number, shown: boolean}>}
   */
  groups() {
    const counts = new Map(Object.keys(this.groupInfo).map((k) => [k, 0]))
    for (const r of this.records) {
      counts.set(r.group, (counts.get(r.group) ?? 0) + 1)
    }
    return [...counts].filter(([, n]) => n > 0).map(([key, count]) => {
      const g = this.groupInfo[key] ?? {}
      return {key, label: g.label ?? key, kind: g.kind ?? key, color: g.color ?? OTHER_COLOR, count,
        shown: !this.hiddenGroups.has(key)}
    })
  }


  /**
   * @param {string} key
   * @returns {boolean}
   */
  isGroupShown(key) {
    return !this.hiddenGroups.has(key)
  }


  /**
   * Show or hide a group: its points and its names.  A hidden group's
   * target keeps its own name.
   *
   * @param {string} key
   * @param {boolean} on
   * @param {boolean} [quiet] don't call onChange (a link being restored)
   */
  setGroupShown(key, on, quiet = false) {
    if (on === this.isGroupShown(key)) {
      return
    }
    if (on) {
      this.hiddenGroups.delete(key)
    } else {
      this.hiddenGroups.add(key)
    }
    this.labelBudget = Math.min(this.labelBudget, this.maxLabels())
    if (!quiet) {
      this.onChange?.()
    }
  }


  /** @returns {number} the most names the budget can ask for: all in the shown groups */
  maxLabels() {
    let n = 0
    for (const r of this.records) {
      n += this.hiddenGroups.has(r.group) ? 0 : 1
    }
    return n
  }


  /**
   * @param {number} n how many names to show at once, the highest ranked
   *   (the best known, then the groups in the data's order)
   * @param {boolean} [quiet] don't call onChange
   */
  setLabelBudget(n, quiet = false) {
    const v = Math.max(0, Math.min(Math.round(Number(n) || 0), this.maxLabels()))
    if (v === this.labelBudget) {
      return
    }
    this.labelBudget = v
    if (!quiet) {
      this.onChange?.()
    }
  }


  /**
   * The node an object's target is at, made on first use: what the camera
   * hangs from when it goes to or rides the object, and where a model (#25)
   * would hang.  Moved each frame with the points.
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
      node.name = `${this.body} object ${rec.id}`
      node.isSatelliteNode = true
      node.satellite = rec
      node.body = this.body
      // The camera's distance on arrival; a model sets its own.
      node.arrivalDistance = ARRIVAL_DIST
      this.nodes.set(rec.id, node)
      this.add(node)
      if (Number.isFinite(this.jd)) {
        this.positionAt(rec, this.jd, node.position)
      }
    }
    return node
  }


  /**
   * Name this object too, whatever the budget and its group: the target's
   * name, made in the next frame.
   *
   * @param {?number} id
   */
  setTarget(id) {
    this._targetId = id === null || id === undefined ? null : Number(id)
  }


  /**
   * @param {number} id
   * @param {number} jd Julian Day (UTC)
   * @returns {boolean} whether it has a position at jd
   */
  drawnAt(id, jd) {
    const rec = this.record(id)
    return Boolean(rec && this.positionAt(rec, jd, tmpV))
  }


  /**
   * Move every object to the date: the points of the shown groups while
   * they're shown, and the targets' nodes always (the camera may ride one
   * with `o` off); then the names.
   *
   * @param {number} jd Julian Day (UTC)
   */
  update(jd) {
    this.jd = jd
    for (const [id, node] of this.nodes) {
      this.positionAt(this.records[this.byId.get(id)], jd, node.position)
    }
    const near = this.camera ? this._showFor(this.camera) : {points: true, names: true}
    this.points.visible = near.points
    if (!this.marks.visible || !near.points) {
      this._syncTargetLabel(jd)
      return
    }
    const pos = this.points.geometry.attributes.position
    const show = this.points.geometry.attributes.aShow
    let drawn = 0
    for (let i = 0; i < this.records.length; i++) {
      const rec = this.records[i]
      const on = !this.hiddenGroups.has(rec.group) && this.positionAt(rec, jd, tmpV)
      if (on) {
        pos.setXYZ(i, tmpV.x, tmpV.y, tmpV.z)
        drawn++
      }
      show.setX(i, on ? 1 : 0)
    }
    this.drawnCount = drawn
    pos.needsUpdate = true
    show.needsUpdate = true
    this._syncNames(near.names)
    this._syncTargetLabel(jd)
  }


  /**
   * @param {object} camera
   * @returns {{points: boolean, names: boolean}} what shows from the
   *   camera's distance to the body's centre
   */
  _showFor(camera) {
    const d = camera.getWorldPosition(tmpCam).distanceTo(this.getWorldPosition(tmpV))
    return {points: d < this.showDist, names: d < this.labelDist}
  }


  /** @returns {Array<number>} record indices, the best known first, then by group in the data's order */
  _ranked() {
    const order = Object.keys(this.groupInfo)
    const groupRank = (g) => {
      const i = order.indexOf(g)
      return i < 0 ? order.length : i
    }
    return this.records.map((r, i) => i).sort((a, b) => {
      const ra = this.records[a]
      const rb = this.records[b]
      return (Number(Boolean(rb.known)) - Number(Boolean(ra.known))) ||
        (groupRank(ra.group) - groupRank(rb.group)) || (a - b)
    })
  }


  /**
   * The budget's names: the highest ranked drawn objects, the target aside
   * (it has its own), on one sheet, rebuilt when who's on it changes, and
   * laid on their objects each frame.
   *
   * @param {boolean} near whether names show from here
   */
  _syncNames(near) {
    const show = this.points.geometry.attributes.aShow
    const pos = this.points.geometry.attributes.position
    const ids = []
    for (const i of this._rankOrder) {
      if (ids.length >= this.labelBudget) {
        break
      }
      if (show.getX(i) > 0.5 && this.records[i].id !== this._targetId) {
        ids.push(i)
      }
    }
    const key = ids.join(',')
    if (key !== this._nameKey) {
      this._nameKey = key
      this._nameIds = ids
      this._dropSheet(this.nameSheet)
      this.nameSheet = ids.length > 0 ? this._newNameSheet(ids) : null
    }
    const sprites = this.nameSheet
    if (!sprites) {
      return
    }
    sprites.visible = near
    const sheet = sprites.userData.ownSheet
    const attr = sheet.positionAttribute
    ids.forEach((i, k) => {
      const x = pos.getX(i)
      const y = pos.getY(i)
      const z = pos.getZ(i)
      sheet.positions[3 * k] = x
      sheet.positions[(3 * k) + 1] = y
      sheet.positions[(3 * k) + 2] = z
      attr?.setXYZ(k, x, y, z)
    })
    if (attr) {
      attr.needsUpdate = true
    }
  }


  /**
   * The target's name, on its own sheet: shown wherever the points are, its
   * group shown or not.
   *
   * @param {number} jd
   */
  _syncTargetLabel(jd) {
    const id = this._targetId
    if (this.targetLabel && this.targetLabel.userData.id !== id) {
      this._dropSheet(this.targetLabel)
      this.targetLabel = null
    }
    const rec = id === null ? null : this.record(id)
    if (!rec) {
      return
    }
    if (!this.targetLabel) {
      this.targetLabel = this._newNameSheet([this.byId.get(id)])
      this.targetLabel.userData.id = id
    }
    const placed = this.positionAt(rec, jd, this.targetLabel.position)
    this.targetLabel.visible = placed && this.points.visible
  }


  /**
   * @param {Array<number>} indices records', ranked
   * @returns {object} a sheet's sprites, one name an index, on the marks
   */
  _newNameSheet(indices) {
    const recs = indices.map((i) => this.records[i])
    const texts = recs.map((r) => this.displayName(r))
    const sheet = new this.Sheet(texts.length, texts)
    recs.forEach((r, k) => {
      sheet.add(0, 0, 0, texts[k], this.groupInfo[r.group]?.color ?? OTHER_COLOR)
    })
    const sprites = sheet.compile()
    sprites.name = `${this.body} population names`
    sprites.frustumCulled = false
    sprites.raycast = noRaycast
    if (this.layer !== null) {
      sprites.layers.set(this.layer)
    }
    // A click targets one, a double click goes (labelPick.js); where two
    // touch, the higher ranked wins (labelDeclutter.js).
    sprites.userData.labelTargets = recs.map((r) => this.targetOf(r))
    sprites.userData.declutter = true
    sprites.userData.labelRank = recs.map((r, k) => RANK_TOP - (RANK_SPAN * k / Math.max(recs.length, 1)))
    sprites.userData.ownSheet = sheet
    this.marks.add(sprites)
    return sprites
  }


  /**
   * @param {PopulationRecord} rec
   * @returns {{kind: 'satellite', id: number, name: string, body: string}}
   *   the object as a target (Scene.setTarget)
   */
  targetOf(rec) {
    return {kind: 'satellite', id: rec.id, name: this.displayName(rec), body: this.body}
  }


  /** @param {?object} sprites a sheet's, to take out and free */
  _dropSheet(sprites) {
    if (!sprites) {
      return
    }
    sprites.removeFromParent()
    sprites.geometry?.dispose?.()
    sprites.material?.uniforms?.map?.value?.dispose?.()
    sprites.material?.dispose?.()
    sprites.userData.ownSheet?.canvas?.remove?.()
  }


  /** @returns {Points} */
  _newPoints() {
    const n = this.records.length
    const colors = new Float32Array(n * 3)
    const c = new Color
    this.records.forEach((r, i) => {
      c.set(this.groupInfo[r.group]?.color ?? OTHER_COLOR).toArray(colors, i * 3)
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
          // Off the screen: not drawn (a hidden group, no position).
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
    points.name = `${this.body} population points`
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
}
