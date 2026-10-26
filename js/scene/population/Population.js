import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Frustum,
  Group,
  Matrix4,
  Object3D,
  Points,
  ShaderMaterial,
  Vector3,
} from 'three'
import SpriteSheet from '../SpriteSheet.js'
import {sceneReferred} from '../hdr.js'
import {labelFont, labelLook, prominence, viewRange} from '../labelStyle.js'
import {behindSphere} from '../labelPick.js'


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
// What a name shown last frame adds to its rank, so it keeps its place
// against the hidden (labelDeclutter.js, `declutterHold`): above every
// hidden name's, still below bodies'.
const HOLD_RANK = 1
// More objects shown than this and those on near-circular orbits are
// moved along a circle between exact positions, which are worked out in
// turns, REFRESH_PER_FRAME a frame: Starlink whole is eleven thousand, and
// SGP4 takes about 2 µs each.
const DIRECT_MAX = 2000
const REFRESH_PER_FRAME = 2500
// aShow for a record another drawer draws (setGroupDrawer): it counts as
// drawn, and its position is set only when it's named.  1 is drawn here, 0
// not at all.
const SHOW_ELSEWHERE = 2
// How far along the circle an object is carried, days, before its exact
// position is worked out again: J2's turn of the plane, a few degrees a day
// in low orbit, is a few km in an hour.
const CARRY_MAX_DAYS = 1 / 24
// Under this, an orbit is near enough a circle to be carried along one.
const CIRCULAR_E = 0.01
const SEC_PER_DAY = 86400
// How far apart the default stateAt takes its two positions, s.
const STATE_STEP_S = 60
// How long a name takes to fade in or out, ms.
export const NAME_FADE_MS = 200
// The longest step a fade takes, ms: a tab come back from the background
// finishes its fades rather than jumping a long way.
const FADE_STEP_MAX_MS = 100
const noRaycast = () => undefined
const tmpV = new Vector3
const tmpW = new Vector3
const tmpCam = new Vector3
const tmpEye = new Vector3
const tmpMat = new Matrix4
const tmpFrustum = new Frustum
const ORIGIN = new Vector3
// How far a view range moves toward this frame's each frame, of the way:
// a name coming into view or leaving it eases the others' looks over a
// few frames rather than jolting them.
const RANGE_EASE = 0.25


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
 * @property {number} [count] how many of it show to start, the first in the
 *   data's order: the panel gives it a slider, from none to all
 * @property {string} [orderedBy] what that order is, e.g. 'serial number'
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
   * @param {?import('../labelStyle.js').LabelStyle} [opts.labelStyle] the
   *   names' size and brightness by their distance from the camera, and
   *   which wins where two touch (null: all alike, by the budget's order)
   */
  constructor(records, {body, groups = {}, title = 'Objects', showDist = Infinity, labelDist = Infinity,
    layer = null, Sheet = SpriteSheet, camera = null, labelStyle = null} = {}) {
    super()
    this.name = `${body} population`
    this.body = body
    this.title = title
    this.records = records
    this.byId = new Map(records.map((r, i) => [r.id, i]))
    this.groupInfo = groups
    this.showDist = showDist
    this.labelDist = labelDist
    // The body's radius, in metres (Scene sets it when it hangs the
    // population): names behind the body take no room in the declutter.
    this.bodyRadius = 0
    this.layer = layer
    this.Sheet = Sheet
    this.camera = camera
    this.labelStyle = labelStyle
    // A view-ranged style's near and far, eased frame to frame (_styleNames).
    this._labelRange = null
    // The groups switched off (all on to start).
    this.hiddenGroups = new Set
    // Each record's place in its group, in the data's order; and how many of
    // a counted group show (`count`), the first.
    this._groupIndex = new Int32Array(records.length)
    this._groupSize = new Map
    records.forEach((r, i) => {
      const k = this._groupSize.get(r.group) ?? 0
      this._groupIndex[i] = k
      this._groupSize.set(r.group, k + 1)
    })
    this.groupLimits = new Map
    // A group's points left to another drawer while it draws them (a space
    // network's overlay: setGroupDrawer), by key.
    this.drawers = new Map
    this._elsewhere = new Map
    this._shownCount = null
    for (const [key, g] of Object.entries(groups)) {
      if (Number.isFinite(g.count)) {
        this.groupLimits.set(key, this.defaultGroupCount(key))
      }
    }
    // Each record's last exact position and the circle it's carried along
    // meanwhile, when many are shown (_carried): [p, q, ω, jd] with p, q a
    // radius and the one a quarter turn on, ω rad/s.
    this._carry = null
    this._carryCursor = 0
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
    // the target among them when it's in the budget; and one for the target's
    // name only when it isn't (or the budget's are too far to show).
    this.nameSheet = null
    this._nameIds = []
    this._nameKey = ''
    this.targetLabel = null
    this._fadeAt = NaN
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
   * @returns {Array<{key: string, label: string, kind: string, color: string, count: number, shown: boolean,
   *   limit?: number, orderedBy?: ?string}>} `limit`, for a counted group,
   *   how many of its `count` show
   */
  groups() {
    const counts = new Map(Object.keys(this.groupInfo).map((k) => [k, 0]))
    for (const r of this.records) {
      counts.set(r.group, (counts.get(r.group) ?? 0) + 1)
    }
    return [...counts].filter(([, n]) => n > 0).map(([key, count]) => {
      const g = this.groupInfo[key] ?? {}
      const out = {key, label: g.label ?? key, kind: g.kind ?? key, color: g.color ?? OTHER_COLOR, count,
        shown: !this.hiddenGroups.has(key)}
      if (this.groupLimits.has(key)) {
        Object.assign(out, {limit: this.groupLimits.get(key), orderedBy: g.orderedBy ?? null})
      }
      return out
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
   * @param {string} key
   * @returns {?number} the count a counted group starts at (its `count`,
   *   within its size), or null for a group shown whole
   */
  defaultGroupCount(key) {
    const n = this.groupInfo[key]?.count
    return Number.isFinite(n) ? Math.max(0, Math.min(n, this._groupSize.get(key) ?? 0)) : null
  }


  /**
   * @param {string} key
   * @returns {number} how many of the group show, the first in the data's
   *   order (all for a group without a count)
   */
  groupCount(key) {
    return this.groupLimits.get(key) ?? this._groupSize.get(key) ?? 0
  }


  /**
   * Show the first n of a counted group (the panel's slider for it).
   *
   * @param {string} key
   * @param {number} n
   * @param {boolean} [quiet] don't call onChange
   */
  setGroupCount(key, n, quiet = false) {
    if (!this.groupLimits.has(key)) {
      return
    }
    const v = Math.max(0, Math.min(Math.round(Number(n) || 0), this._groupSize.get(key) ?? 0))
    if (v === this.groupLimits.get(key)) {
      return
    }
    this.groupLimits.set(key, v)
    this._shownCount = null
    this.labelBudget = Math.min(this.labelBudget, this.maxLabels())
    if (!quiet) {
      this.onChange?.()
    }
  }


  /**
   * @param {number} i a record's index
   * @returns {boolean} whether its group is shown and it's within the
   *   group's count
   */
  _isOn(i) {
    const g = this.records[i].group
    return !this.hiddenGroups.has(g) && this._groupIndex[i] < (this.groupLimits.get(g) ?? Infinity)
  }


  /**
   * Leave a group's points to another drawer while it draws them: Earth's
   * Starlink and Iridium to their networks' overlays (Networks.md, one copy,
   * one drawing).  While `drawer.drawing`, the group's points aren't drawn
   * or propagated here: a record counts as drawn while the drawer draws it
   * (`isShown`), and the names the budget gives the group are put where its
   * dots are (`positionAtJd`), the only positions asked of it; the targets'
   * nodes stay exact.  Otherwise, as any group.  The drawer is a space
   * network's Constellation (networks/Constellation.js).
   *
   * @param {string} key
   * @param {?{drawing: boolean, indexOf: Function, isShown: Function, positionAtJd: Function}} drawer
   *   null for none
   */
  setGroupDrawer(key, drawer) {
    if (!drawer) {
      this.drawers.delete(key)
      return
    }
    // Each record's index in the drawer, once (-1: not its, or another group).
    const index = new Int32Array(this.records.length).fill(-1)
    this.records.forEach((r, i) => {
      if (r.group === key) {
        index[i] = drawer.indexOf(r.id)
      }
    })
    this.drawers.set(key, {drawer, index})
  }


  /** @returns {Map<string, object>} the drawers drawing now, with their indices, by group */
  _drawingElsewhere() {
    const out = new Map
    for (const [key, entry] of this.drawers) {
      if (entry.drawer.drawing) {
        out.set(key, entry)
      }
    }
    return out
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
    this._shownCount = null
    this.labelBudget = Math.min(this.labelBudget, this.maxLabels())
    if (!quiet) {
      this.onChange?.()
    }
  }


  /** @returns {number} the most names the budget can ask for: all shown (in the shown groups, within their counts) */
  maxLabels() {
    if (this._shownCount === null || this._shownCount === undefined) {
      let n = 0
      for (let i = 0; i < this.records.length; i++) {
        n += this._isOn(i) ? 1 : 0
      }
      this._shownCount = n
    }
    return this._shownCount
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
      this._syncTargetLabel(jd, false)
      this._stepFades()
      return
    }
    const pos = this.points.geometry.attributes.position
    const show = this.points.geometry.attributes.aShow
    let drawn = 0
    const many = this.maxLabels() > DIRECT_MAX
    let budget = REFRESH_PER_FRAME
    const elsewhere = this._drawingElsewhere()
    this._elsewhere = elsewhere
    for (let i = 0; i < this.records.length; i++) {
      const rec = this.records[i]
      let on = this._isOn(i)
      const entry = elsewhere.get(rec.group)
      if (entry) {
        // Its dot is the drawer's: not drawn here, and placed only if it's
        // named (_syncNames).
        const j = entry.index[i]
        show.setX(i, on && j >= 0 && entry.drawer.isShown(j) ? SHOW_ELSEWHERE : 0)
        continue
      }
      if (on && many && this._circular(rec)) {
        // Not shown until its first exact position: those over the
        // frame's budget come in over the next frames.
        let fresh = this._carried(i, jd)
        if (!fresh && budget > 0) {
          budget--
          this._refresh(i, jd)
          fresh = true
        }
        on = fresh && this._carryTo(i, jd, tmpV)
      } else {
        on = on && this.positionAt(rec, jd, tmpV)
      }
      if (on) {
        pos.setXYZ(i, tmpV.x, tmpV.y, tmpV.z)
        drawn++
      }
      show.setX(i, on ? 1 : 0)
    }
    this.drawnCount = drawn
    if (many) {
      this._refreshInTurn(jd, budget, elsewhere)
    }
    pos.needsUpdate = true
    show.needsUpdate = true
    this._syncNames(near.names)
    this._syncTargetLabel(jd, near.names && this._nameIds.includes(this.byId.get(this._targetId)))
    this._stepFades()
  }


  /** Ease the names' opacity toward whether the declutter shows them (SpriteSheet.setFade). */
  _stepFades() {
    const now = performance.now()
    const dt = Number.isFinite(this._fadeAt) ? Math.min(now - this._fadeAt, FADE_STEP_MAX_MS) : 0
    this._fadeAt = now
    this.nameSheet?.userData.ownSheet.stepFade?.(dt)
    this.targetLabel?.userData.ownSheet.stepFade?.(dt)
  }


  /**
   * Where a record is and how fast it's going, for carrying it along its
   * orbit between exact positions (many shown).  By default from positionAt
   * a minute apart: the velocity along the circle through the two, so the
   * turn is right however coarse a Julian Day's last digits are.  A
   * subclass with the velocity to hand gives it.
   *
   * @param {PopulationRecord} rec
   * @param {number} jd
   * @param {Vector3} outP metres
   * @param {Vector3} outV metres a second
   * @returns {boolean} whether it has a position then
   */
  stateAt(rec, jd, outP, outV) {
    if (!this.positionAt(rec, jd + (STATE_STEP_S / SEC_PER_DAY), outV) || !this.positionAt(rec, jd, outP)) {
      return false
    }
    // outV, the later position, to the velocity: a quarter turn on from p
    // in the plane of the two, times the rate it turned.
    const angle = Math.atan2(tmpCam.crossVectors(outP, outV).length(), outP.dot(outV))
    tmpCam.normalize().cross(outP)
    outV.copy(tmpCam).multiplyScalar(angle / STATE_STEP_S)
    return true
  }


  /**
   * @param {PopulationRecord} rec
   * @returns {boolean} whether its orbit is near enough a circle to carry
   *   it along one between exact positions (its `eccentricity`; one without
   *   is worked out exactly every frame)
   */
  _circular(rec) {
    return (rec.eccentricity ?? 1) < CIRCULAR_E
  }


  /**
   * @param {number} i
   * @param {number} jd
   * @returns {boolean} whether record i's last exact position is near
   *   enough in time to carry it from
   */
  _carried(i, jd) {
    const c = this._carry
    return Boolean(c) && Math.abs(jd - c[(8 * i) + 7]) <= CARRY_MAX_DAYS
  }


  /**
   * Work out record i's exact position and its circle.
   *
   * @param {number} i
   * @param {number} jd
   */
  _refresh(i, jd) {
    this._carry ??= new Float64Array(8 * this.records.length).fill(NaN)
    const c = this._carry
    const o = 8 * i
    c[o + 7] = jd
    if (!this.stateAt(this.records[i], jd, tmpV, tmpW)) {
      c[o + 6] = NaN
      return
    }
    // The orbit's pole, k = p × v / |p × v|; q = k × p, a quarter turn on;
    // ω = |p × v| / |p|².
    const p = tmpV
    const hx = (p.y * tmpW.z) - (p.z * tmpW.y)
    const hy = (p.z * tmpW.x) - (p.x * tmpW.z)
    const hz = (p.x * tmpW.y) - (p.y * tmpW.x)
    const h = Math.hypot(hx, hy, hz)
    const r2 = p.lengthSq()
    c[o] = p.x
    c[o + 1] = p.y
    c[o + 2] = p.z
    c[o + 3] = ((hy * p.z) - (hz * p.y)) / h
    c[o + 4] = ((hz * p.x) - (hx * p.z)) / h
    c[o + 5] = ((hx * p.y) - (hy * p.x)) / h
    c[o + 6] = h / r2
  }


  /**
   * @param {number} i
   * @param {number} jd
   * @param {Vector3} out record i carried along its circle to jd
   * @returns {boolean} whether it has a position
   */
  _carryTo(i, jd, out) {
    const c = this._carry
    const o = 8 * i
    const w = c?.[o + 6]
    if (!Number.isFinite(w)) {
      return false
    }
    const a = w * (jd - c[o + 7]) * SEC_PER_DAY
    const cos = Math.cos(a)
    const sin = Math.sin(a)
    out.set((c[o] * cos) + (c[o + 3] * sin), (c[o + 1] * cos) + (c[o + 4] * sin), (c[o + 2] * cos) + (c[o + 5] * sin))
    return true
  }


  /**
   * Work out the next shown records' exact positions, in turn round the
   * population, with what's left of the frame's budget.
   *
   * @param {number} jd
   * @param {number} budget
   * @param {Map<string, object>} [elsewhere] groups drawn by another drawer, not refreshed here
   */
  _refreshInTurn(jd, budget, elsewhere = new Map) {
    const n = this.records.length
    for (let k = 0; k < n && budget > 0; k++) {
      const i = this._carryCursor
      this._carryCursor = (i + 1) % n
      if (this._isOn(i) && !elsewhere.has(this.records[i].group) && this._circular(this.records[i])) {
        this._refresh(i, jd)
        budget--
      }
    }
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
   * The budget's names: the highest ranked drawn objects, the target among
   * them if it's one, on one sheet, rebuilt when who's on it changes (each
   * name that stays keeping whether it's shown, so none flashes), and laid
   * on their objects each frame.
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
      if (show.getX(i) > 0.5) {
        ids.push(i)
      }
    }
    // A name on another drawer's dot goes where that dot is.
    for (const i of ids) {
      if (show.getX(i) > 1.5) {
        const entry = this._elsewhere.get(this.records[i].group)
        if (entry?.drawer.positionAtJd(entry.index[i], this.jd, tmpV)) {
          pos.setXYZ(i, tmpV.x, tmpV.y, tmpV.z)
        }
      }
    }
    const key = ids.join(',')
    if (key !== this._nameKey) {
      const was = this.nameSheet
      const wasIds = this._nameIds
      this._nameKey = key
      this._nameIds = ids
      this.nameSheet = ids.length > 0 ? this._newNameSheet(ids, was, wasIds) : null
      this._dropSheet(was)
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
    if (near) {
      this._styleNames(sprites, ids)
    }
  }


  /**
   * Each name's size and brightness by its distance from the camera (the
   * population's labelStyle), and its rank with them: where two touch, the
   * nearer wins.  The target's at its largest and brightest.  A view-ranged
   * style maps from the nearest of the names in view to the farthest
   * (`viewRange`), eased over a few frames.
   *
   * @param {object} sprites a name sheet's
   * @param {Array<number>} ids its records' indices
   * @param {boolean} [ranged] whether these names set the view range (the
   *   budget's do; the target's own label takes it as it is)
   */
  _styleNames(sprites, ids, ranged = true) {
    const style = this.labelStyle
    const sheet = sprites.userData.ownSheet
    if (!style || !this.camera || !sheet.setStyle) {
      return
    }
    // The camera in the sheet's frame, which is the population's.
    this.camera.getWorldPosition(tmpEye)
    sprites.worldToLocal(tmpEye)
    const dist = ids.map((i, k) => tmpEye.distanceTo(tmpV.fromArray(sheet.positions, 3 * k)))
    let range = this._labelRange ?? {near: style.near, far: style.far}
    if (ranged && style.range === 'view') {
      const goal = viewRange(this._inView(sprites, sheet, dist), style)
      range = this._labelRange ? {
        near: range.near + ((goal.near - range.near) * RANGE_EASE),
        far: range.far + ((goal.far - range.far) * RANGE_EASE),
      } : goal
      this._labelRange = range
    }
    const mapped = {...style, ...range}
    const ranks = sprites.userData.labelRank
    ids.forEach((i, k) => {
      const p = this.records[i].id === this._targetId ? 1 : prominence(dist[k], mapped)
      const {scale, brightness} = labelLook(p, style)
      sheet.setStyle(k, scale, brightness)
      ranks[k] = RANK_TOP - RANK_SPAN + (RANK_SPAN * p)
    })
  }


  /**
   * @param {object} sprites a name sheet's
   * @param {object} sheet its SpriteSheet
   * @param {Array<number>} dist each name's distance from the camera
   * @returns {Array<number>} the distances of the names in view: in the
   *   camera's frustum, and not behind the body
   */
  _inView(sprites, sheet, dist) {
    const cam = this.camera
    cam.updateMatrixWorld?.()
    tmpFrustum.setFromProjectionMatrix(tmpMat.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse))
    const out = []
    for (let k = 0; k < dist.length; k++) {
      tmpV.fromArray(sheet.positions, 3 * k)
      if (this.bodyRadius > 0 && behindSphere(tmpV.x, tmpV.y, tmpV.z, ORIGIN, this.bodyRadius, tmpEye)) {
        continue
      }
      if (tmpFrustum.containsPoint(sprites.localToWorld(tmpV))) {
        out.push(dist[k])
      }
    }
    return out
  }


  /**
   * The target's name, on its own sheet when the budget's sheet doesn't show
   * it: shown wherever the points are, its group shown or not.  Where the
   * budget's sheet names it, that's its one name, and this is dropped.
   *
   * @param {number} jd
   * @param {boolean} named whether the budget's sheet shows its name
   */
  _syncTargetLabel(jd, named) {
    const id = named ? null : this._targetId
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
    // At its largest and brightest, whatever its distance.
    this._styleNames(this.targetLabel, [this.byId.get(id)], false)
  }


  /**
   * @param {Array<number>} indices records', ranked
   * @param {?object} [was] the sheet it replaces, whose names that stay keep
   *   whether they're shown; the rest start hidden and fade in when the
   *   declutter shows them
   * @param {Array<number>} [wasIds] the indices of `was`
   * @returns {object} a sheet's sprites, one name an index, on the marks
   */
  _newNameSheet(indices, was = null, wasIds = []) {
    const recs = indices.map((i) => this.records[i])
    const texts = recs.map((r) => this.displayName(r))
    // A styled population's names drawn at their largest, made smaller per name.
    const style = this.labelStyle
    const sheet = style ?
      new this.Sheet(texts.length, texts, labelFont(style), [0, 0], false, false, {scalable: true}) :
      new this.Sheet(texts.length, texts)
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
    // Not depth-tested, or a name beside the limb loses the part of it over
    // the body: one behind the body is hidden by the declutter instead
    // (labelOccluder below).
    if (sprites.material) {
      sprites.material.depthTest = false
    }
    // A click targets one, a double click goes (labelPick.js); where two
    // touch, the higher ranked wins (labelDeclutter.js).
    sprites.userData.labelTargets = recs.map((r) => this.targetOf(r))
    sprites.userData.declutter = true
    sprites.userData.labelRank = recs.map((r, k) => RANK_TOP - (RANK_SPAN * k / Math.max(recs.length, 1)))
    // Shown names keep their place; those behind the body take none.
    sprites.userData.declutterHold = HOLD_RANK
    sprites.userData.labelOccluder = this
    sprites.userData.ownSheet = sheet
    if (sheet.setFade) {
      sheet.setFade(NAME_FADE_MS)
      const old = was?.userData.ownSheet
      const oldAt = new Map(wasIds.map((i, k) => [i, k]))
      indices.forEach((i, k) => {
        const j = oldAt.get(i)
        sheet.shown[k] = j === undefined ? 0 : old.shown[j]
        sheet.shownAttribute?.setX(k, j === undefined ? 0 : (old.shownAttribute?.getX(j) ?? old.shown[j]))
      })
    }
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
          // Off the screen: not drawn (a hidden group, no position, or
          // another drawer's dot: SHOW_ELSEWHERE).
          if (aShow < 0.5 || aShow > 1.5) {
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
