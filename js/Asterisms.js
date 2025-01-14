import {
  LineBasicMaterial,
  Object3D
} from 'three'
import AsterismsCatalog from './AsterismsCatalog.js'
import {assertDefined} from './assert.js'
import * as Shapes from './shapes.js'
import {STARS_SCALE, labelTextColor} from './shared.js'


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
    this.catalog = new AsterismsCatalog(stars.catalog)
    this.catalog.load(() => {
      this.catalog.byName.forEach((astr, name) => this.show(name))
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
            const line = Shapes.line(
              prevStar.x, prevStar.y, prevStar.z,
              star.x, star.y, star.z,
            )
            line.material = new LineBasicMaterial({color: labelTextColor, toneMapped: false})
            this.add(line)
          } catch (e) {
            console.error(`origName: ${origName}, hipId: ${hipId}: ${e}`)
            continue
          }
        }
        prevStar = star
      }
    })
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
