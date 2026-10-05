import {
  AdditiveBlending,
  Group,
  LOD,
  Points,
  ShaderMaterial,
  Vector3,
} from 'three'
import Loader from '../Loader.js'
import Object from './object.js'
import PickLabels from './PickLabels.js'
import SpriteSheet from './SpriteSheet.js'
import StarsBufferGeometry from './StarsBufferGeometry.js'
import StarsCatalog, {FAVES} from './StarsCatalog.js'
import {assertDefined} from '../assert.js'
import {FAR_OBJ, STARS_RADIUS_METER} from '../shared.js'
import {named} from '../utils.js'
import {absoluteUniforms} from './hdr.js'
import {rteCameraLocal} from './rte.js'


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
    // Catalog readiness signalling.  The catalog object is mutated in place
    // during async load, so subscribing to starsCatalog identity in the
    // store doesn't fire a change event — we maintain our own callback list
    // that's drained once load completes.  Anyone needing a populated
    // catalog (asterisms, search, etc) calls onCatalogReady(cb) and gets
    // either an immediate dispatch (if already loaded) or a deferred one.
    this._catalogReady = false
    this._catalogReadyCbs = []

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
      this.ui.useStore.setState({starsCatalog: this.catalog})
      this._markCatalogReady()
    } else {
      this.catalog = new StarsCatalog()
      // Expose the (empty) catalog immediately so About / search wiring can
      // hold the reference; re-publish after load completes so subscribers
      // that gate on numStars > 0 (SearchIndex's StarsProvider registration)
      // see the transition.
      this.ui.useStore.setState({starsCatalog: this.catalog})
      this.catalog.load(() => {
        this.show()
        this.showLabels()
        this.ui.useStore.setState({starsCatalog: this.catalog})
        this._markCatalogReady()
      })
    }
  }


  /**
   * Register a callback to fire once the stars catalog has finished
   * loading.  If already loaded, fires synchronously.  Used by
   * Scene.toggleAsterisms to avoid building an empty asterism geometry
   * (would happen on a permalink load that races the catalog fetch).
   *
   * @param {Function} cb
   */
  onCatalogReady(cb) {
    if (this._catalogReady) {
      cb()
      return
    }
    this._catalogReadyCbs.push(cb)
  }


  /** Internal: drain the readiness callback queue. */
  _markCatalogReady() {
    this._catalogReady = true
    const cbs = this._catalogReadyCbs
    this._catalogReadyCbs = []
    for (const cb of cbs) {
      cb()
    }
  }


  /** */
  show() {
    this.geom = new StarsBufferGeometry(this.catalog)
    // Physical brightness, in exposure units (shaders/stars.vert; HDR.md):
    // the exposure, viewport, field of view and the user's star gain are
    // the shared absoluteUniforms, which ThreeUi sets each frame.  The
    // sprite is an analytic Gaussian (stars.frag), not a texture.
    const starsMaterial = new ShaderMaterial({
      uniforms: {
        ...absoluteUniforms,
        // A star's quad: as large as the visible star (stars.vert), from
        // the eye's patch in pixels (1 px here, 4 on a 1080 px screen) to
        // 96 px for the Sun from the outer planets.
        MIN_STAR_SIZE_PX: {value: 1},
        MAX_STAR_SIZE_PX: {value: 96},
        // RTE uniforms: camera position in star catalog coords, split high/low
        uCamPosWorldHigh: {value: new Vector3()},
        uCamPosWorldLow: {value: new Vector3()},
      },
      vertexShader: 'shaders/stars.vert',
      fragmentShader: 'shaders/stars.frag',
      blending: AdditiveBlending,
      depthTest: true,
      depthWrite: false,
      transparent: true,
      toneMapped: false,
    })
    const me = this
    new Loader().loadShaders(starsMaterial, () => {
      const starPoints = named(new Points(this.geom, starsMaterial), 'StarsPoints')
      starPoints.sortParticles = true
      starPoints.renderOrder = 0
      // RTE: update camera-position uniforms every frame so the high/low split
      // tracks the current camera position in star catalog coordinates (this
      // object's local frame: under the StellarFrame, J2000; see rte.js).
      const camHigh = starsMaterial.uniforms.uCamPosWorldHigh.value
      const camLow = starsMaterial.uniforms.uCamPosWorldLow.value
      starPoints.onBeforeRender = (renderer, scene, camera) => {
        rteCameraLocal(starPoints, camera, camHigh, camLow)
        // Catalog labels sit inside a LOD wrapper; their onBeforeRender is not
        // guaranteed to fire every frame after a WorldGroup rebase.  Update from
        // here instead — starPoints is a direct child of Stars and always renders.
        // The labels are in the same frame (the LOD and its group are unrotated).
        const lm = this.starLabelSpriteSheet?.sprites?.material
        if (lm) {
          lm.uniforms.uCamPosWorldHigh.value.copy(camHigh)
          lm.uniforms.uCamPosWorldLow.value.copy(camLow)
        }
      }
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
    const maxLabel = 'Rigel Kentaurus B'
    this.starLabelSpriteSheet = new SpriteSheet(toShow.length, maxLabel, undefined, [0, 0], true)
    for (let i = 0; i < toShow.length; i++) {
      const [star, name] = toShow[i]
      this.showStarName(star, name)
    }
    const labelPoints = this.starLabelSpriteSheet.compile()
    // A double click or tap on one goes to its star (labelPick.js).
    labelPoints.userData.labelTargets = toShow.map(([star, name]) => ({kind: 'star', star, name}))
    this.labelsGroup.add(labelPoints)
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
