import {
  DepthTexture,
  LinearSRGBColorSpace,
  NeutralToneMapping,
  Object3D,
  OrthographicCamera,
  Quaternion,
  PerspectiveCamera,
  Scene,
  UnsignedIntType,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three'
import {newAtmospherePass} from './scene/atmos/Atmosphere'
import {precomputeTransmittance, precomputeInScatter} from './scene/atmos/AtmospherePrecompute'
import {TrackballControls} from 'three/examples/jsm/controls/TrackballControls.js'
import {attachPointerDrag} from './dragControls'
import {resolveDragMode} from './dragMode'
import Fullscreen from '@pablo-mayrgundter/fullscreen.js/fullscreen.js'
import {GALAXY_RADIUS_METER, INITIAL_FOV, SMALLEST_SIZE_METER, SUN_RADIUS_METER, targets} from './shared.js'
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
    // Post-process atmosphere pass
    this._sceneRT = this._makeSceneRT()
    this._atmScene = new Scene()
    this._atmCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
    this._atmMesh = newAtmospherePass()
    this._atmScene.add(this._atmMesh)
    this._pWorldAtm = new Vector3()
    this._camWorldAtm = new Vector3()
    this._lastAtmPlanet = null
    this._transmittanceRT = null
    this._inScatterRT = null
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
    this.onCameraChange = null // set by Celestiary to schedule permalink updates
    this._initArrowKeys()
    attachPointerDrag(this.threeContainer, this.camera, {
      onChange: () => this.onCameraChange?.(),
      // useStore and Shared.targets are populated by Celestiary after
      // ThreeUI construction; both accessors run lazily at pointerdown.
      getDragMode: () => this.useStore?.getState().dragMode,
      getTarget: () => targets.obj,
      onClick: (e) => this._fireClickCbs(e),
    })

    this.renderer.setAnimationLoop((time) => {
      this.renderLoop(time)
    })
  }


  /** @returns {WebGLRenderTarget} with a depth texture */
  _makeSceneRT() {
    const rt = new WebGLRenderTarget(this.width, this.height)
    rt.depthTexture = new DepthTexture()
    rt.depthTexture.type = UnsignedIntType
    // Three.js only applies tone mapping when _currentRenderTarget is null
    // (screen) or isXRRenderTarget. Tag ours so PBR materials get tone-mapped
    // into [0,1] instead of writing raw HDR values that saturate to white.
    rt.isXRRenderTarget = true
    rt.texture.colorSpace = LinearSRGBColorSpace
    return rt
  }


  /** Sets camera near and far to deimos and local star cluster. */
  configLargeScene() {
    this.camera.near = SMALLEST_SIZE_METER
    // Far must comfortably enclose the procedural Milky Way (galaxy radius +
    // a healthy navigation buffer for viewing it from outside).  The galaxy
    // shader pins its z to the far plane so it never z-fights nearer geometry,
    // so the precision crush at this far/near ratio is harmless for it; the
    // depth-writing objects (planets, sun) are always orders of magnitude
    // closer where precision is fine.
    this.camera.far = GALAXY_RADIUS_METER * 6
    this.camera.updateProjectionMatrix()

    // This is a bit of a hack.  Starting the camera away from center so there's
    // less obvious jumping around, e.g. seeing inside of sun.
    this.camera.position.z = SUN_RADIUS_METER * 1e3
  }


  /** */
  addClickCb(clickCb) {
    this.clickCbs.push(clickCb)
  }


  /**
   * Dispatch a real click (no-drag pointerup) to every registered callback.
   * The original mouse-coords plumbing is dead; clickCbs receive the raw
   * pointer event so handlers can read clientX/clientY directly.
   *
   * @param {PointerEvent} e
   */
  _fireClickCbs(e) {
    for (const cb of this.clickCbs) {
      cb(e)
    }
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
    controls.noPan = true // we own all mouse drag (plain = free look, option = orbit)
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
    this._sceneRT.setSize(width, height)
    this.controls.handleResize()
  }


  /** */
  setFov(fov) {
    this.camera.fov = fov
    this.camera.updateProjectionMatrix()
    this.onCameraChange?.()
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
      if (!targets.tween.update()) {
        if (targets.tweenNextFn) {
          targets.tween = targets.tweenNextFn()
          targets.tweenNextFn = null
        } else {
          targets.tween = null
          this.onCameraChange?.()
        }
      }
    }
    this._applyCameraArrowKeys()
    this._publishEffectiveDragMode()
    // Render scene to RT, then composite atmosphere fullscreen pass to screen
    this.renderer.setRenderTarget(this._sceneRT)
    this.renderer.render(this.scene, this.camera)
    this.renderer.setRenderTarget(null)
    this._updateAtmUniforms()
    this.renderer.render(this._atmScene, this._atmCamera)
  }


  /**
   * Resolve the user's drag-mode intent to a concrete `'pan'` or
   * `'orbit'` for the current camera/target context and write it into
   * the store so the UI toggle can highlight whichever mode is active
   * right now — including when the user-facing `dragMode` is `'auto'`
   * and the resolution shifts as the camera moves (zoom, navigation).
   * Zustand's default Object.is selector check skips the re-render when
   * the value hasn't changed, so this is cheap to call every frame.
   */
  _publishEffectiveDragMode() {
    const state = this.useStore?.getState()
    if (!state?.setEffectiveDragMode) {
      return
    }
    const next = resolveDragMode(state.dragMode, this.camera.position.length(), targets.obj)
    if (next !== state.effectiveDragMode) {
      state.setEffectiveDragMode(next)
    }
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
   * Updates fullscreen atmosphere pass uniforms from the current scene target.
   * When no atmosphere target, sets uAtmosphereRadius = uGroundRadius so scatter
   * returns zero and the scene colour passes through unchanged.
   */
  _updateAtmUniforms() {
    const u = this._atmMesh.material.uniforms
    u.tDiffuse.value = this._sceneRT.texture
    u.tDepth.value = this._sceneRT.depthTexture
    u.uNear.value = this.camera.near
    u.uFar.value = this.camera.far
    u.uProjectionMatrixInverse.value.copy(this.camera.projectionMatrixInverse)

    const tObj = targets.obj
    // Determine which planet's atmosphere to render.
    // Fall back to _lastAtmPlanet when tObj has no atmosphere (e.g. Sun after 'u').
    // When tObj does have atmosphere, only switch to it if the camera is actually
    // near it — guards against selecting a distant moon with atmosphere (e.g. Titan)
    // while the camera is still orbiting the parent planet (Saturn).
    // Threshold: 20× atmosphere radius covers typical orbit distances.
    let atmTarget = this._lastAtmPlanet
    if (tObj?.props?.atmosphere) {
      const atmR = tObj.props.radius.scalar + tObj.props.atmosphere.height.scalar
      tObj.getWorldPosition(this._pWorldAtm)
      this.camera.getWorldPosition(this._camWorldAtm)
      if (!this._lastAtmPlanet || this._camWorldAtm.distanceTo(this._pWorldAtm) < atmR * 20) {
        atmTarget = tObj
      }
    }

    if (!atmTarget) {
      // No atmosphere ever seen — kill the pass via the shader's gate.  We
      // can't simply "push the planet far away" as a sentinel because the
      // in-shader rsi() squares |eyePos|, and any sentinel large enough to
      // miss the atmosphere would itself overflow float32.
      u.uAtmEnabled.value = 0.0
      return
    }
    const atmos = atmTarget.props.atmosphere
    const R = atmTarget.props.radius.scalar

    atmTarget.getWorldPosition(this._pWorldAtm)
    this.camera.getWorldPosition(this._camWorldAtm)
    // Skip the post-process when the camera is too far from the atmosphere
    // for the in-shader rsi() to remain numerically stable.  rsi squares
    // |eyePos| (and 2·dot(rayDir, eyePos)), so once |eyePos| approaches
    // sqrt(FLT_MAX) ≈ 1.8e19 m, b² overflows to +Inf for forward-aligned
    // rays while c is still finite — d becomes spuriously positive and rsi
    // returns bogus intersections instead of the correct "miss," painting
    // huge garbage halos over the screen.  At these distances the
    // atmosphere is far below sub-pixel anyway, so skipping is the right
    // call.  Use the shader gate rather than a sentinel uniform value, for
    // the same reason as the no-target branch above.
    const camDist = this._camWorldAtm.distanceTo(this._pWorldAtm)
    const FLT_SAFE_DIST = 1e15 // |eyePos|² stays below ~1e30, decades from FLT_MAX
    if (camDist > FLT_SAFE_DIST) {
      u.uAtmEnabled.value = 0.0
      return
    }
    u.uAtmEnabled.value = 1.0
    u.uPlanetCenter.value
        .copy(this._pWorldAtm)
        .applyMatrix4(this.camera.matrixWorldInverse)
    u.uSunDirection.value
        .copy(this._pWorldAtm).negate().normalize()
        .transformDirection(this.camera.matrixWorldInverse)

    u.uGroundRadius.value = R
    u.uAtmosphereRadius.value = R + atmos.height.scalar
    u.uSunIntensity.value = atmos.sunIntensity ?? 22
    u.uRayleigh.value.set(...atmos.rayleigh)
    u.uRayleighScaleHeight.value = atmos.rayleighScaleHeight.scalar
    u.uMieCoeff.value = atmos.mieCoeff
    u.uMieScaleHeight.value = atmos.mieScaleHeight.scalar
    u.uMiePolarity.value = atmos.miePolarity

    if (this._lastAtmPlanet !== atmTarget) {
      this._lastAtmPlanet = atmTarget
      if (this._transmittanceRT) {
        this._transmittanceRT.dispose()
      }
      if (this._inScatterRT) {
        this._inScatterRT.dispose()
      }
      this._transmittanceRT = precomputeTransmittance(this.renderer, atmos, R)
      this._inScatterRT = precomputeInScatter(this.renderer, atmos, R, this._transmittanceRT)
      u.tTransmittance.value = this._transmittanceRT.texture
      u.uUseTransmittanceLUT.value = 1.0
      u.tInScatter.value = this._inScatterRT.texture
    }
    // Always re-enable after returning from a no-atmosphere target.
    u.uUseInScatterLUT.value = this._inScatterRT ? 1.0 : 0.0
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
    if (k.up) {
      this.camera.rotateX(speed)
    }
    if (k.down) {
      this.camera.rotateX(-speed)
    }
    if (k.left) {
      this.camera.rotateZ(speed)
    }
    if (k.right) {
      this.camera.rotateZ(-speed)
    }
    this.onCameraChange?.()
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
    this.onCameraChange?.()
  }
}
