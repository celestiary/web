import {
  BufferAttribute,
  BufferGeometry,
  Color,
  LineSegments,
  Object3D,
  ShaderMaterial,
  Vector3,
} from 'three'
import AsterismsCatalog from './AsterismsCatalog.js'
import {assertDefined} from '../assert.js'
import {labelTextColor} from '../shared.js'


// RTE line shader — same Relative-To-Eye technique as stars.vert.
const asterismsVertexShader = `
  uniform vec3 uCamPosWorldHigh;
  uniform vec3 uCamPosWorldLow;
  attribute vec3 positionLow;
  void main() {
    vec3 highDiff = position - uCamPosWorldHigh;
    vec3 lowDiff  = positionLow - uCamPosWorldLow;
    gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * (highDiff + lowDiff), 1.0);
  }
`

const asterismsFragmentShader = `
  uniform vec3 uColor;
  void main() {
    gl_FragColor = vec4(uColor, 1.0);
  }
`


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
    this._posHigh = []
    this._posLow = []
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


  /** Push one segment endpoint into the high/low accumulators. */
  _pushEndpoint(x, y, z) {
    const hx = Math.fround(x); const hy = Math.fround(y); const hz = Math.fround(z)
    this._posHigh.push(hx, hy, hz)
    this._posLow.push(x - hx, y - hy, z - hz)
  }


  /**
   * Pack all accumulated segment endpoints into a single LineSegments with
   * an RTE ShaderMaterial, then clear the accumulators.
   */
  _compile() {
    const geom = new BufferGeometry()
    geom.setAttribute('position', new BufferAttribute(new Float32Array(this._posHigh), 3))
    geom.setAttribute('positionLow', new BufferAttribute(new Float32Array(this._posLow), 3))
    const mat = new ShaderMaterial({
      uniforms: {
        uCamPosWorldHigh: {value: new Vector3()},
        uCamPosWorldLow: {value: new Vector3()},
        uColor: {value: new Color(labelTextColor)},
      },
      vertexShader: asterismsVertexShader,
      fragmentShader: asterismsFragmentShader,
      toneMapped: false,
    })
    const rtePos = new Vector3()
    const lines = new LineSegments(geom, mat)
    lines.onBeforeRender = (renderer, scene, camera) => {
      camera.getWorldPosition(rtePos)
      const wg = scene.getObjectByName('WorldGroup')
      if (wg) {
        rtePos.sub(wg.position)
      }
      const hx = Math.fround(rtePos.x)
      const hy = Math.fround(rtePos.y)
      const hz = Math.fround(rtePos.z)
      mat.uniforms.uCamPosWorldHigh.value.set(hx, hy, hz)
      mat.uniforms.uCamPosWorldLow.value.set(rtePos.x - hx, rtePos.y - hy, rtePos.z - hz)
    }
    this.add(lines)
    this._posHigh = null
    this._posLow = null
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
