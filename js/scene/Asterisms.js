import {Color, Object3D} from 'three'
import AsterismsCatalog from './AsterismsCatalog.js'
import {assertDefined} from '../assert.js'
import {labelTextColor, overlay} from '../shared.js'
import {newWideLines} from './wideLines.js'


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
