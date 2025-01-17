import {
  NeutralToneMapping,
  Object3D,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PointLight,
  SRGBColorSpace,
  Scene,
  Vector2,
  WebGLRenderer,
} from 'three'
import {TrackballControls} from 'three/examples/jsm/controls/TrackballControls.js'
import Fullscreen from '@pablo-mayrgundter/fullscreen.js/fullscreen.js'
import {INITIAL_FOV, METERS_PER_LIGHTYEAR} from './shared.js'
import {named} from './utils.js'


/** */
export default class ThreeUi {
  /** */
  constructor(container, animationCb, backgroundColor, renderer) {
    if (typeof container === 'string') {
      this.container = document.getElementById(container)
    } else if (typeof container === 'object') {
      this.container = container
    } else {
      throw new Error(`Given container must be DOM ID or element: ${container}`)
    }
    this.threeContainer = document.createElement('div')
    this.threeContainer.style.width = this.container.offsetWidth
    this.threeContainer.style.height = this.container.offsetHeight
    this.container.appendChild(this.threeContainer)

    this.animationCb = animationCb || null
    this.renderer = renderer ||
      this.initRenderer(this.threeContainer, backgroundColor || 0x000000)
    this.width = this.threeContainer.offsetWidth
    this.height = this.threeContainer.offsetHeight
    const aspect = this.width / this.height
    this.camera = new PerspectiveCamera(INITIAL_FOV, aspect, 1e-1, 1e3) // Scene's near&far set by Celestiary
    this.camera.platform = named(new Object3D, 'CameraPlatform')
    this.camera.platform.add(this.camera)
    this.initControls(this.camera)
    this.fs = new Fullscreen(this.container, () => {
      this.onResize()
    })
    window.addEventListener('resize', () => {
      if (this.fs.isFullscreen()) {
        this.onResize()
      }
    })
    this.onResize()
    this.scene = new Scene
    this.scene.add(this.camera.platform)
    window.scene = this.scene
    window.camera = this.camera
    // Adapted from https://threejs.org/docs/#api/en/core/Raycaster
    this.clickCbs = []
    this.mouse = new Vector2
    this.clicked = false
    this.useStore = undefined // TODO(pablo): passed into and set in Scene

    // VR
    // TODO: clean up VR Button container or find better one from three.js.
    /*
      this.renderer.xr.enabled = true;
      const {vrButtonContainer, controller, controllerGrip} = initVR(this.renderer);
      this.container.appendChild(vrButtonContainer);
      this.scene.add(controllerGrip);
    */

    this.renderer.setAnimationLoop(() => {
      this.renderLoop()
    })
  }


  /** Sets camera near and far to deimos and local star cluster. */
  configLargeScene() {
    this.camera.near = 1e6 // Deimos
    this.camera.far = METERS_PER_LIGHTYEAR * 2e4 // Celestia catalog max
    this.camera.updateProjectionMatrix()
  }


  /**
   */
  addClickCb(clickCb) {
    this.clickCbs.push(clickCb)
  }


  /**
   * @returns {WebGLRenderer}
   */
  initRenderer(container, backgroundColor) {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('webgl2')
    container.appendChild(canvas)
    const renderer = new WebGLRenderer({canvas: canvas, context: ctx, antialias: true})
    // No idea about this.. just like the way it looks.
    // renderer.toneMapping = AgXToneMapping
    // renderer.toneMapping = ACESFilmicToneMapping
    // renderer.toneMapping = LinearToneMapping
    renderer.toneMapping = NeutralToneMapping // Tuned to balance brightness of inner and outer planets
    // renderer.toneMapping = NoToneMapping
    // renderer.toneMapping = ReinhardToneMapping
    renderer.toneMappingExposure = 3e-5
    renderer.outputEncoding = SRGBColorSpace
    this.width = this.container.offsetWidth
    this.height = this.container.offsetHeight
    renderer.setClearColor(backgroundColor, 1)
    renderer.setSize(this.width, this.height)
    renderer.sortObjects = true
    renderer.autoClear = true
    // Shadows
    // renderer.shadowMap.enabled = true
    // renderer.shadowMap.type = PCFSoftShadowMap
    return renderer
  }


  /**
   */
  initControls(camera) {
    const controls = new TrackballControls(camera, this.threeContainer)
    // Rotation speed is changed in scene.js depending on target
    // type: faster for sun, slow for planets.
    controls.noZoom = false
    controls.noPan = false
    controls.staticMoving = true
    controls.dynamicDampingFactor = 0.3
    // controls.rotateSpeed = 1
    controls.zoomSpeed = 1e1
    window.controls = controls
    controls.target = camera.platform.position
    this.controls = controls
  }


  /**
   */
  onResize() {
    // https://threejsfundamentals.org/threejs/lessons/threejs-responsive.html
    let width; let height
    if (this.fs.isFullscreen()) {
      width = window.innerWidth
      height = window.innerHeight
    } else {
      width = this.container.offsetWidth
      height = this.container.offsetHeight
    }
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height)
    this.controls.handleResize()
  }


  /**
   */
  setFov(fov) {
    this.camera.fov = fov
    this.camera.updateProjectionMatrix()
    if (this.camera.onChange) {
      this.camera.onChange(this.camera)
    }
  }


  /**
   */
  multFov(factor) {
    // TODO(pablo): narrowing very far leads to overflow in the float
    // values, such that zooming out cannot return exactly to 45
    // degrees.
    const newFov = this.camera.fov * factor
    if (newFov >= 180) {
      return
    }
    this.setFov(newFov)
  }


  /**
   */
  resetFov() {
    this.setFov(INITIAL_FOV)
  }


  /**
   */
  setAnimation(animationCb) {
    this.animationCb = animationCb
  }


  /**
   */
  renderLoop() {
    this.camera.updateMatrixWorld()
    if (this.clicked) {
      for (const i in this.clickCbs) {
        if (Object.prototype.hasOwnProperty.call(this.clickCbs, i)) {
          const clickCb = this.clickCbs[i]
          clickCb(this.mouse)
        }
      }
      this.clicked = false
    }

    this.controls.update()
    if (this.animationCb) {
      this.animationCb(this.scene, this)
    }
    this.renderer.render(this.scene, this.camera)
  }
}
