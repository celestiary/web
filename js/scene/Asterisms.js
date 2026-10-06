import {Color, Object3D} from 'three'
import AsterismsCatalog from './AsterismsCatalog.js'
import {assertDefined} from '../assert.js'
import {labelTextColor, overlay} from '../shared.js'
import {newWideLines} from './wideLines.js'
import {rteCameraLocal} from './rte.js'
import SpriteSheet from './SpriteSheet.js'


// Drawn as the human expansion lines are (wideLines.js): antialiased
// screen-space quads, RTE, cut in front of the camera, w divided through.
// As 1 px GL lines at w ~1e17 m they flickered from Earth's surface while
// time ran (the view turning with Earth), where the wide lines didn't.
export const ASTERISM_WIDTH_PX = 1.5
export const ASTERISM_OPACITY = 0.8


/** */
export default class Asterisms extends Object3D {
  /**
   * @param {Function} useStore Accessor to zustand store for shared application state
   * @param {object} stars
   * @param {Function} cb
   */
  constructor(ui, stars, cb) {
    super()
    assertDefined(ui, stars)
    this.useStore = ui.useStore
    this.name = 'Asterisms'
    this.stars = stars
    this._ends = []
    // Each asterism's name and where to put it, for its label: {name, position}
    this._centroids = []
    this.catalog = new AsterismsCatalog(stars.catalog)
    this.catalog.load(() => {
      this.catalog.byName.forEach((astr, name) => this.show(name))
      this._compile()
      if (cb) {
        // Used by About for catalog stats
        this.useStore.setState({asterismsCatalog: this.catalog})
        cb(this)
      }
    })
  }


  /**
   * @param {string} astrName
   * @param {Function} filterFn
   */
  show(astrName, filterFn) {
    if (!filterFn) {
      filterFn = (stars, hipId, name) => {
        if (this.stars.catalog.namesByHip.get(hipId).length >= 2) {
          if (!name.match(/\w{2,3} [\w\d]{3,4}/)) {
            return true
          }
        }
        return false
      }
    }
    const asterism = this.catalog.byName.get(astrName)
    if (!asterism) {
      throw new Error('Unknown asterism: ', astrName)
    }
    const paths = asterism.paths
    const members = new Map()
    paths.forEach((pathNames, pathNdx) => {
      let prevStar = null
      for (let i = 0; i < pathNames.length; i++) {
        // eslint-disable-next-line no-unused-vars
        const [origName, name, hipId] = this.stars.catalog.reifyName(pathNames[i])
        const star = this.stars.catalog.starByHip.get(hipId)
        if (!star) {
          // TODO: fixup missing star names.
          // console.warn(`Cannot find star, hipId(${hipId})`, name);
          // window.catalog = this.stars.catalog;
          // console.log('added catalog to window.catalog', this.stars);
          continue
        }
        // Probably just show them in Stars, and don't trigger here.
        // if (filterFn(this.stars, hipId, name)) {
        //  this.stars.showStarName(star, name);
        // }
        members.set(hipId, star)
        if (prevStar) {
          try {
            this._pushEndpoint(prevStar.x, prevStar.y, prevStar.z)
            this._pushEndpoint(star.x, star.y, star.z)
          } catch (e) {
            console.error(`origName: ${origName}, hipId: ${hipId}: ${e}`)
            continue
          }
        }
        prevStar = star
      }
    })
    const position = centroid([...members.values()])
    if (position) {
      this._centroids.push({name: astrName, position})
    }
  }


  /** Push one segment endpoint (metres, catalogue frame) into the accumulator. */
  _pushEndpoint(x, y, z) {
    this._ends.push(x, y, z)
  }


  /**
   * Pack all accumulated segments into one set of wide lines (wideLines.js),
   * then clear the accumulator.
   */
  _compile() {
    const n = this._ends.length / 6
    const start = new Float64Array(n * 3)
    const end = new Float64Array(n * 3)
    const color = new Float32Array(n * 3)
    const rgb = new Color(labelTextColor).toArray()
    for (let k = 0; k < n; k++) {
      for (let c = 0; c < 3; c++) {
        start[(3 * k) + c] = this._ends[(6 * k) + c]
        end[(3 * k) + c] = this._ends[(6 * k) + 3 + c]
      }
      color.set(rgb, 3 * k)
    }
    // On the overlay layer (shared.js overlay): out of the meter's frame.
    const lines = overlay(newWideLines({start, end, color}, {name: 'AsterismLines'}))
    const u = lines.material.uniforms
    u.uWidthFirst.value = u.uWidthLast.value = ASTERISM_WIDTH_PX
    u.uOpacity.value = ASTERISM_OPACITY
    this.add(lines)
    this._ends = null
    this._compileLabels()
  }


  /**
   * One label per asterism, its name at the centroid of its stars: what a
   * click on the asterism hits (labelPick.js: a click targets it, a double
   * click turns to face it).  Shown with the lines.  RTE and on the overlay
   * layer, as the star labels are, in the catalogue frame.
   */
  _compileLabels() {
    const named = this._centroids
    if (named.length === 0) {
      return
    }
    const longest = named.reduce((a, c) => (c.name.length > a.length ? c.name : a), '')
    const sheet = new SpriteSheet(named.length, longest, undefined, [0, 0], true)
    for (const {name, position} of named) {
      sheet.add(position.x, position.y, position.z, name, labelTextColor)
    }
    const points = overlay(sheet.compile())
    points.name = 'AsterismLabels'
    points.userData.labelTargets = named.map(({name, position}) => ({kind: 'asterism', name, position}))
    points.onBeforeRender = (renderer, scene, camera) => {
      const u = points.material.uniforms
      rteCameraLocal(points, camera, u.uCamPosWorldHigh.value, u.uCamPosWorldLow.value)
    }
    this.add(points)
  }


  /**
   * @param {object} record
   * @param {object} catalog
   */
  reify(record, catalog) {
    const paths = record.paths
    for (let i = 0; i < paths.length; i++) {
      const path = paths[i]
      for (let n = 0; n < path.length; n++) {
        // eslint-disable-next-line no-unused-vars
        const [origName, name, hipId] = this.stars.catalog.reifyName(path[n])
        if (hipId) {
          path[n] = name
        }
      }
    }
  }
}


/**
 * Where to put an asterism's name: the mean direction of its stars from the
 * Sun, at their mean distance.  (The mean of the positions themselves
 * sits wherever its nearest stars drag it.)
 *
 * @param {Array<{x: number, y: number, z: number}>} stars Catalogue frame, metres
 * @returns {?{x: number, y: number, z: number}} Null for none
 */
export function centroid(stars) {
  let ux = 0
  let uy = 0
  let uz = 0
  let dist = 0
  let n = 0
  let mx = 0
  let my = 0
  let mz = 0
  for (const {x, y, z} of stars) {
    const r = Math.hypot(x, y, z)
    if (!(r > 0)) {
      continue
    }
    ux += x / r
    uy += y / r
    uz += z / r
    dist += r
    mx += x
    my += y
    mz += z
    n++
  }
  if (n === 0) {
    return null
  }
  const len = Math.hypot(ux, uy, uz)
  if (len < 1e-9) {
    return {x: mx / n, y: my / n, z: mz / n}
  }
  const k = (dist / n) / len
  return {x: ux * k, y: uy * k, z: uz * k}
}
