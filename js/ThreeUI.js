import {
  LinearSRGBColorSpace,
  NeutralToneMapping,
  Object3D,
  Quaternion,
  PerspectiveCamera,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three'
import * as TWEEN from '@tweenjs/tween.js'
import {TrackballControls} from 'three/examples/jsm/controls/TrackballControls.js'
import Fullscreen from '@pablo-mayrgundter/fullscreen.js/fullscreen.js'
import {INITIAL_FOV, SMALLEST_SIZE_METER, STARS_RADIUS_METER, SUN_RADIUS_METER, targets} from './shared.js'
import {named} from './utils.js'
import {asymptoticZoomDist, dynamicNear} from './zoom.js'


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
    this.scene = new Scene
    this.animationCb = animationCb || null
    this.width = this.threeContainer.offsetWidth
    this.height = this.threeContainer.offsetHeight
    const aspect = this.width / this.height
    this.camera = new PerspectiveCamera(INITIAL_FOV, aspect, 1e-1, 1e3) // Scene's near&far set by Celestiary
    this.camera.platform = named(new Object3D, 'CameraPlatform')
    this.camera.platform.add(this.camera)

    this.renderer = renderer ||
      this.initRenderer(this.threeContainer, backgroundColor || 0x000000)
    this.initControls(this.camera)
    this.fs = new Fullscreen(this.container, () => this.onResize())
    window.addEventListener('resize', () => {
      if (this.fs.isFullscreen()) {
        this.onResize()
      }
    })
    this.onResize()
    this.scene.add(this.camera.platform)
    window.scene = this.scene
    window.camera = this.camera
    // Adapted from https://threejs.org/docs/#api/en/core/Raycaster
    this.clickCbs = []
    this.mouse = new Vector2
    this.clicked = false
    this.useStore = undefined // TODO(pablo): passed into and set in Scene
    this._zoomEye = new Vector3() // pre-allocated for asymptotic zoom correction

    // VR
    // TODO: clean up VR Button container or find better one from three.js.
    /*
      this.renderer.xr.enabled = true;
      const {vrButtonContainer, controller, controllerGrip} = initVR(this.renderer);
      this.container.appendChild(vrButtonContainer);
      this.scene.add(controllerGrip);
    */

    this._arrowKeys = {up: false, down: false, left: false, right: false}
    this._savedCamQuat = new Quaternion() // preserved across controls.update()
    this._orbitAxis = new Vector3()       // pre-allocated for orbit drag
    this._orbitRot = new Quaternion()     // pre-allocated for orbit drag
    this._initArrowKeys()
    this._initMouseDrag()

    this.renderer.setAnimationLoop((time) => {
      this.renderLoop(time)
    })
  }


  /** Sets camera near and far to deimos and local star cluster. */
  configLargeScene() {
    this.camera.near = SMALLEST_SIZE_METER
    this.camera.far = STARS_RADIUS_METER * 2
    this.camera.updateProjectionMatrix()

    // This is a bit of a hack.  Starting the camera away from center so there's
    // less obvious jumping around, e.g. seeing inside of sun.
    this.camera.position.z = SUN_RADIUS_METER * 1e3
  }


  /** */
  addClickCb(clickCb) {
    this.clickCbs.push(clickCb)
  }


  /** @returns {WebGLRenderer} */
  initRenderer(container, backgroundColor) {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('webgl2')
    container.appendChild(canvas)
    const renderer = new WebGLRenderer({canvas: canvas, context: ctx, antialias: true})
    // No idea about this.. just like the way it looks.
    // renderer.toneMapping = AgXToneMapping
    // renderer.toneMapping = ACESFilmicToneMapping
    // renderer.toneMapping = LinearToneMapping
    renderer.toneMapping = NeutralToneMapping
    // renderer.toneMapping = NoToneMapping
    // renderer.toneMapping = ReinhardToneMapping
    // renderer.toneMapping = CustomToneMapping
    // ShaderChunk.tonemapping_pars_fragment = ShaderChunk.tonemapping_pars_fragment.replace(
    //   'vec3 CustomToneMapping( vec3 color ) { return color; }',
    //   CUSTOM_TONE_FRAG_GLSL
    // )
    renderer.toneMappingExposure = 3e-16
    renderer.outputColorSpace = LinearSRGBColorSpace
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


  /** */
  initControls(camera) {
    const controls = new TrackballControls(camera, this.threeContainer)
    // Rotation speed is changed in scene.js depending on target
    // type: faster for sun, slow for planets.
    controls.noZoom = false
    controls.noPan = true   // we own all mouse drag (plain = free look, option = orbit)
    controls.noRotate = true // we own all rotation
    controls.staticMoving = true
    controls.dynamicDampingFactor = 0.3
    // controls.rotateSpeed = 1
    controls.zoomSpeed = 1e1
    controls.target = camera.platform.position
    this.controls = controls
  }


  /** */
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


  /** */
  setFov(fov) {
    this.camera.fov = fov
    this.camera.updateProjectionMatrix()
    if (this.camera.onChange) {
      this.camera.onChange(this.camera)
    }
  }


  /** */
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


  /** */
  resetFov() {
    this.setFov(INITIAL_FOV)
  }


  /** */
  setAnimation(animationCb) {
    this.animationCb = animationCb
  }


  /** */
  renderLoop(time) {
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
    const distBefore = this.camera.position.distanceTo(this.controls.target)
    this._savedCamQuat.copy(this.camera.quaternion)
    this.controls.update()
    // Parenting tracks the target; suppress the lookAt that controls.update()
    // applies so arrow keys, mouse drag, and tweens own orientation.
    this.camera.quaternion.copy(this._savedCamQuat)
    this._applyAsymptoticZoom(distBefore)
    if (this.animationCb) {
      this.animationCb(this.scene, this)
    }
    // Order matters: tween then arrow keys then render, so arrow keys always win
    if (targets.tween !== null) {
      targets.tween.update()
    }
    this._applyCameraArrowKeys()
    this.renderer.render(this.scene, this.camera)
  }


  /** Register keydown/keyup listeners to track held arrow keys. */
  _initArrowKeys() {
    const map = {ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right'}
    window.addEventListener('keydown', (e) => {
      if (map[e.key] !== undefined) {
        this._arrowKeys[map[e.key]] = true
        e.preventDefault() // prevent page scroll
      }
    })
    window.addEventListener('keyup', (e) => {
      if (map[e.key] !== undefined) {
        this._arrowKeys[map[e.key]] = false
      }
    })
  }


  /**
   * Plain drag     → pitch/yaw camera around its local axes.
   * Option+drag    → orbit: rotate camera.position around the platform origin,
   *                  then lookAt the planet center. Fully manual so successive
   *                  drags accumulate without TrackballControls state resets.
   */
  _initMouseDrag() {
    let lastX = 0
    let lastY = 0

    this.threeContainer.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      lastX = e.clientX
      lastY = e.clientY
      if (e.altKey) e.preventDefault() // suppress browser Alt menu
    })

    window.addEventListener('mousemove', (e) => {
      if (!e.buttons) return
      const dx = e.clientX - lastX
      const dy = e.clientY - lastY
      lastX = e.clientX
      lastY = e.clientY
      const speed = 0.005 // radians per pixel

      if (e.altKey) {
        // Orbit: rotate camera as a rigid body around the platform origin
        // (planet center). Apply each rotation to both position AND quaternion
        // so the view direction stays consistent with the new orbital position.
        // Horizontal → around platform-local Y
        this._orbitAxis.set(0, 1, 0)
        this._orbitRot.setFromAxisAngle(this._orbitAxis, -dx * speed)
        this.camera.position.applyQuaternion(this._orbitRot)
        this.camera.quaternion.premultiply(this._orbitRot)
        // Vertical → around camera's current right axis
        this._orbitAxis.set(1, 0, 0).applyQuaternion(this.camera.quaternion)
        this._orbitRot.setFromAxisAngle(this._orbitAxis, -dy * speed)
        this.camera.position.applyQuaternion(this._orbitRot)
        this.camera.quaternion.premultiply(this._orbitRot)
      } else {
        // Free look: pitch/yaw camera around its own local axes.
        this.camera.rotateY(-dx * speed)
        this.camera.rotateX(-dy * speed)
      }
    })
  }


  /**
   * Rotate camera around its local axes based on held arrow keys.
   * Up/down pitch the nose; left/right roll.
   * The quaternion persists because we save/restore it around controls.update().
   * Speed: ~34 deg/sec at 60 fps.
   */
  _applyCameraArrowKeys() {
    if (targets.track) {
      return // tracking owns orientation; arrow keys would fight it
    }
    const k = this._arrowKeys
    if (!k.up && !k.down && !k.left && !k.right) {
      return
    }
    const speed = 0.01 // radians per frame
    if (k.up) this.camera.rotateX(speed)
    if (k.down) this.camera.rotateX(-speed)
    if (k.left) this.camera.rotateZ(speed)
    if (k.right) this.camera.rotateZ(-speed)
  }


  /**
   * Remaps zoom from linear-distance space to altitude space so the camera
   * asymptotically approaches the surface rather than passing through it.
   *
   * Linear zoom: new_dist = old_dist * factor  (passes through surface)
   * Altitude zoom: new_alt = old_alt * factor  (altitude → 0 but never negative)
   *
   * Uses targets.obj (always current) rather than targets.cur (only set by goTo).
   *
   * @param {number} distBefore Camera distance from controls target before update
   */
  _applyAsymptoticZoom(distBefore) {
    const targetObj = targets.obj
    if (!targetObj || !targetObj.props || !targetObj.props.radius) {
      return
    }
    const surfaceR = targetObj.props.radius.scalar
    const distAfter = this.camera.position.distanceTo(this.controls.target)
    const altAfter = Math.max(0, distAfter - surfaceR)

    const newNear = dynamicNear(altAfter)
    if (newNear !== this.camera.near) {
      this.camera.near = newNear
      this.camera.updateProjectionMatrix()
    }

    const distDesired = asymptoticZoomDist(distBefore, distAfter, surfaceR)
    if (distDesired === distAfter) {
      return // no zoom this frame
    }
    this._zoomEye.subVectors(this.camera.position, this.controls.target)
    if (this._zoomEye.length() > 0) {
      this._zoomEye.setLength(distDesired)
      this.camera.position.copy(this.controls.target).add(this._zoomEye)
    }
  }
}
