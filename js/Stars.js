import {
  AdditiveBlending,
  Group,
  LOD,
  Points,
  PointsMaterial,
  ShaderMaterial,
  Vector3,
} from 'three'
import Loader from './Loader.js'
import Object from './object.js'
import PickLabels from './PickLabels.js'
import SpriteSheet from './SpriteSheet.js'
import StarsBufferGeometry from './StarsBufferGeometry.js'
import StarsCatalog, {FAVES} from './StarsCatalog.js'
import {assertDefined} from './assert.js'
import * as Material from './material.js'
import {FAR_OBJ, STARS_RADIUS_METER, SUN_RADIUS_METER} from './shared.js'
import {named} from './utils.js'


// > 10k is too much for my old laptop.
const MAX_LABELS = 10000

/** */
export default class Stars extends Object {
  /**
   * @param {object} props
   * @param {Function} ui Accessor to zustand store for shared application state
   * @param {object} [catalog]
   * @param {Function} [onLoadCb]
   * @param {boolean} [showLabels]
   */
  constructor(props, ui, catalog, onLoadCb, showLabels = false) {
    super('Stars', props)
    assertDefined(ui, ui.useStore)
    this.ui = ui
    this.labelsGroup = named(new Group, 'LabelsGroup')
    this.labelsGroup.renderOrder = 0
    this.onLoadCb = onLoadCb
    this.faves = FAVES
    this.labelLOD = named(new LOD, 'LabelsLOD')
    this.labelLOD.visible = showLabels
    this.labelLOD.addLevel(this.labelsGroup, 1)
    this.labelLOD.addLevel(FAR_OBJ, STARS_RADIUS_METER)
    this.add(this.labelLOD)
    this.geom = null

    // Used by guide/Asterisms.jsx to center camera.
    this.labelCenterPosByName = {}

    if (catalog instanceof StarsCatalog) {
      if (!catalog.starByHip) {
        throw new Error('Invalid stars catalog')
      }
      this.catalog = catalog
      this.show()
      if (showLabels) {
        this.showLabels()
      }
    } else {
      this.catalog = new StarsCatalog()
      this.catalog.load(() => {
        this.show()
        this.showLabels()
      })
    }

    // used by About for catalog stats
    this.ui.useStore.setState({starsCatalog: this.catalog})
  }


  /** */
  show() {
    this.geom = new StarsBufferGeometry(this.catalog)
    const starImage = Material.pathTexture('star_glow', '.png')
    const starsMaterial = new ShaderMaterial({
      uniforms: {
        texSampler: {value: starImage},
        CAMERA_FOV_DEGREES: {value: this.ui.camera.fov},
        // Tuned for 0xFF max on a close-up star.
        // CAMERA_EXPOSURE: {value: 3e16 * 3.7e-38},
        STAR_MAGNIFY: {value: 8}, // to fit Star/sun
        // This is tuned for Star zoom e.g. on Sun to have
        // surface just meet the glow in the png image.
        // STAR_MAGNIFY_2: {value: 2e4}, // 2e4, 2e9
        // CAMERA_EXPOSURE: {value: 3e16 * 3.7e-38},
        STAR_MAGNIFY_2: {value: 1/SUN_RADIUS_METER * 1e1},
        CAMERA_EXPOSURE: {value: 1},
        MIN_BRIGHT: {value: 1},
        MAX_BRIGHT: {value: 2e16}, // half-float max
        MIN_STAR_SIZE_PX: {value: 3},
        MAX_STAR_SIZE_PX: {value: 512},
      },
      vertexShader: '/shaders/stars.vert',
      fragmentShader: '/shaders/stars.frag',
      blending: AdditiveBlending,
      depthTest: true,
      depthWrite: false,
      transparent: true,
    })
    this.ui.camera.onChange = (camera) => {
      starsMaterial.uniforms.CAMERA_FOV_DEGREES.value = camera.fov
    }
    const me = this
    new Loader().loadShaders(starsMaterial, () => {
      const starPoints = named(new Points(this.geom, starsMaterial), 'StarsPoints')
      starPoints.sortParticles = true
      starPoints.renderOrder = 0
      this.add(starPoints)
      new PickLabels(me.ui, me)
      if (this.onLoadCb) {
        this.onLoadCb()
      }
    })
  }


  /** */
  showLabels(level = 2) {
    const toShow = []
    this.addFaves(toShow)
    this.catalog.starByHip.forEach((star, hipId) => {
      if (this.faves.get(hipId)) {
        return
      }
      const names = this.catalog.namesByHip.get(hipId)
      if (names && names.length > level) {
        toShow.push([star, names[0]])
      } else if (star.absMag < -5) {
        toShow.push([star, `HIP ${hipId}`])
      }
      if (toShow.length >= MAX_LABELS) {
        console.warn(`Stars#showLabels: hit max count of ${MAX_LABELS}`)
      }
    })
    this.starLabelSpriteSheet = new SpriteSheet(toShow.length, 'Rigel Kentaurus B')
    for (let i = 0; i < toShow.length; i++) {
      const [star, name] = toShow[i]
      this.showStarName(star, name)
    }
    this.labelsGroup.add(this.starLabelSpriteSheet.compile())
  }


  /** */
  showStarName(star, name) {
    const sPos = new Vector3(star.x, star.y, star.z)
    this.starLabelSpriteSheet.add(star.x, star.y, star.z, name)
    this.labelCenterPosByName[name] = sPos
  }


  /** */
  addFaves(toShow) {
    this.faves.forEach((name, hipId) => {
      const star = this.catalog.starByHip.get(hipId)
      if (star === undefined) {
        throw new Error(`Undefined star for hipId(${hipId})`)
      }
      toShow.push([star, name])
    })
  }
}
