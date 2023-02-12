import * as THREE from 'three'
import AsterismsCatalog from './AsterismsCatalog.js'
import * as Shapes from './shapes.js'
import {STARS_SCALE, labelTextColor} from './shared.js'


/** */
export default class Asterisms extends THREE.Object3D {
  /**
   * @param {object} stars
   * @param {Function} cb
   */
  constructor(stars, cb) {
    super()
    this.name = 'Asterisms'
    this.stars = stars
    this.catalog = new AsterismsCatalog(stars.catalog)
    this.catalog.load(() => {
      this.catalog.byName.forEach((astr, name) => this.show(name))
      if (cb) {
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
                STARS_SCALE * prevStar.x, STARS_SCALE * prevStar.y, STARS_SCALE * prevStar.z,
                STARS_SCALE * star.x, STARS_SCALE * star.y, STARS_SCALE * star.z)
            line.material = new THREE.LineBasicMaterial({color: labelTextColor})
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
