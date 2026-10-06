import {
  CustomToneMapping,
  DepthStencilFormat,
  DepthTexture,
  FloatType,
  HalfFloatType,
  LinearSRGBColorSpace,
  NeutralToneMapping,
  Object3D,
  OrthographicCamera,
  Quaternion,
  PerspectiveCamera,
  Scene,
  UnsignedByteType,
  UnsignedInt248Type,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three'
import {newAtmospherePass} from './scene/atmos/Atmosphere'
import {
  mieParams, precomputeInScatter, precomputeInScatterMs, precomputeMultiScatter, precomputeTransmittance,
} from './scene/atmos/AtmospherePrecompute'
import CesiumLayers from './scene/cesium/CesiumLayers'
import {
  METER_EVERY_FRAMES, METER_TAU_DOWN_SECONDS, METER_TAU_UP_SECONDS, easeExposure, exposureAt, exposureRelative,
  LIMITING_MAGNITUDE, SUN_DISC_RADIANCE, frameCanBeEmpty, galaxyGain, illuminanceRatio, limitingMagnitude,
  luminousDiscGain, meanLogLuminance, meteredGain, skyExposure, starClipZ, starGainForLimit, starSprite, sunlitBodyCap,
  sunlitBodyGain,
} from './scene/exposure.js'
import {extendedGain} from './scene/eye.js'
import {STORE_SCALE} from './scene/galaxyModel.js'
import {absoluteUniforms, hdrSupported, installExposureOnlyToneMapping, sceneReferredUniform} from './scene/hdr.js'
import {AIRGLOW_COLOR, airglowOf, zodiacalScale} from './scene/nightSky.js'
import Stats from 'three/examples/jsm/libs/stats.module.js'
import TouchSafeTrackballControls from './TouchSafeTrackballControls.js'
import {attachPointerDrag} from './dragControls'
import {resolveDragMode} from './dragMode'
import Fullscreen from '@pablo-mayrgundter/fullscreen.js/fullscreen.js'
import {
  ASTRO_UNIT_METER, CLOUD_LAYER, GALAXY_RADIUS_METER, INITIAL_FOV, OVERLAY_LAYER, SMALLEST_SIZE_METER,
  SUN_RADIUS_METER, targets,
} from './shared.js'
import {named} from './utils.js'
import {GROUND_CLEARANCE_M, asymptoticZoomDist, dynamicNear, groundRadius, homeBody, rotateScale} from './zoom.js'


/** */
// The metering target's size, pixels a side (_meter).
const METER_SIZE = 32
// How far from a body, in its radii, its airglow is drawn (_updateAtmUniforms).
const AIRGLOW_MAX_RADII = 20


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
    // One HDR pipeline (js/scene/HDR.md): the scene renders into a linear,
    // half-float _sceneRT in exposure units (tone-mapped by exposure only),
    // and the atmosphere pass tone-maps once, with PBR Neutral, last.
    // Without float render targets, the old LDR order.
    this.hdr = hdrSupported(this.renderer)
    if (this.hdr) {
      installExposureOnlyToneMapping()
      this.renderer.toneMapping = CustomToneMapping
    }
    // Post-process atmosphere pass
    this._sceneRT = this._makeSceneRT()
    this._atmScene = new Scene()
    this._atmCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
    this._atmMesh = newAtmospherePass()
    this._atmMesh.material.uniforms.uHdr.value = this.hdr ? 1 : 0
    this._atmScene.add(this._atmMesh)
    this._pWorldAtm = new Vector3()
    this._camWorldAtm = new Vector3()
    this._lastAtmPlanet = null
    // Target-keyed exposure (_updateExposure).
    this._exposureGoal = exposureAt(ASTRO_UNIT_METER)
    this._lastExposureMs = null
    // The metered gain over it (_meter), its goal, and the gain the frame
    // renders with (_updateExposure).
    this._meterGain = 1
    this._meterGainGoal = 1
    this._renderedGain = 1
    this._frame = 0
    this._exposureBodyPos = new Vector3()
    this._exposureSunPos = new Vector3()
    this._transmittanceRT = null
    this._inScatterRT = null
    // Optional Cesium rendering of nearby bodies; see CESIUM.md.
    this.layers = new CesiumLayers(this)
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
    this.dblClickCbs = []
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

    // three's Stats panel (FPS / MS / MB): built on first toggle, so startup
    // and the tests never touch the DOM for it.  See togglePerfPanel.
    this._stats = null
    this._perfVisible = false

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
      getOrbitScale: () => this.orbitScale(),
      onClick: (e) => this._fireClickCbs(e),
      onDblClick: (e) => this._fireDblClickCbs(e),
    })

    this.renderer.setAnimationLoop((time) => {
      this.renderLoop(time)
    })
  }


  /**
   * @returns {WebGLRenderTarget} with a depth-stencil texture.  The atmosphere
   * pass samples its depth; Cesium layers (CESIUM.md) copy it.
   * DEPTH24_STENCIL8: the same 24-bit depth the previous DEPTH_COMPONENT24
   * texture had.  Colour: half-float, linear, in exposure units (HDR.md), or
   * 8-bit display values in the LDR fallback.
   */
  _makeSceneRT() {
    const rt = new WebGLRenderTarget(this.width, this.height, {
      stencilBuffer: true,
      type: this.hdr ? HalfFloatType : UnsignedByteType,
    })
    rt.depthTexture = new DepthTexture()
    rt.depthTexture.format = DepthStencilFormat
    rt.depthTexture.type = UnsignedInt248Type
    // Three.js only applies tone mapping when _currentRenderTarget is null
    // (screen) or isXRRenderTarget.  Tag ours so lit materials get the scene
    // pass's tone mapping: exposure only (HDR), or PBR Neutral into [0, 1]
    // (LDR fallback).
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


  /** */
  addDblClickCb(cb) {
    this.dblClickCbs.push(cb)
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


  /** @param {PointerEvent} e */
  _fireDblClickCbs(e) {
    for (const cb of this.dblClickCbs) {
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
    // As for a body 1 AU from the Sun until one is targeted; see
    // _updateExposure.
    renderer.toneMappingExposure = exposureAt(ASTRO_UNIT_METER)
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
    // TrackballControls, its touch bookkeeping fixed (TouchSafeTrackballControls).
    const controls = new TouchSafeTrackballControls(camera, this.threeContainer)
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
    // The container's size, which its owner keeps (Celestiary._layout: the
    // window less the widgets dock and sheet).  Not the window's, even when
    // the container started out filling it, or the canvas runs under them.
    const width = this.container.offsetWidth
    const height = this.container.offsetHeight
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
    // Timing runs only while the panel is showing.  Visibility flips from
    // key events, never mid-frame, so begin() and end() always pair.
    const stats = this._perfVisible ? this._stats : null
    stats?.begin()
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
    // After everything that moves the camera (controls, tweens, keys).
    this._keepAboveGround()
    // AR mode (when active) owns camera.quaternion absolutely.  Run last so
    // anything else's writes are overwritten.  Set by Celestiary.enterAR
    // through this.arController; null when AR is inactive (the common case).
    if (this.arController && this.arController.isActive()) {
      this.arController.updateFrame()
    }
    this._publishEffectiveDragMode()
    // Render scene to RT, then composite atmosphere fullscreen pass to screen.
    // An active Cesium layer hides the body's own surface before the scene
    // render and composites Cesium's globe into the RT after it.
    this._updateExposure()
    this.layers.beforeRender(targets.obj)
    this.renderer.setRenderTarget(this._sceneRT)
    // Display-referred materials (stars, lines, labels) write the values the
    // final tone map gives back unchanged (hdr.js sceneReferred).
    sceneReferredUniform.value = this.hdr ? 1 : 0
    this.renderer.render(this.scene, this.camera)
    this.layers.composite()
    this._drawClouds()
    this.renderer.setRenderTarget(null)
    this._updateNightSky()
    this._updateAtmUniforms()
    this.renderer.render(this._atmScene, this._atmCamera)
    this._meter()
    // Labels last, over the atmosphere: the scene again, overlay layer
    // only, depth-tested against the scene depth the atmosphere pass wrote.
    // After the tone map, so as display values.
    sceneReferredUniform.value = 0
    const autoClear = this.renderer.autoClear
    this.renderer.autoClear = false
    this.camera.layers.set(OVERLAY_LAYER)
    this.renderer.render(this.scene, this.camera)
    this.camera.layers.set(0)
    this.renderer.autoClear = autoClear
    stats?.end()
  }


  /**
   * Earth's cloud shell (CLOUD_LAYER), into the scene buffer after the
   * Cesium composite, so over both sides of the swap, and before the
   * atmosphere pass, which hazes it with the ground under it (Planet.md,
   * "Clouds").  Depth-tested against the scene's depth, which by now holds
   * the ground (celestiary's sphere, or Cesium's ground sphere or terrain).
   */
  _drawClouds() {
    const autoClear = this.renderer.autoClear
    this.renderer.autoClear = false
    this.renderer.setRenderTarget(this._sceneRT)
    this.camera.layers.set(CLOUD_LAYER)
    this.renderer.render(this.scene, this.camera)
    this.camera.layers.set(0)
    this.renderer.autoClear = autoClear
  }


  /** @returns {boolean} whether the performance panel is showing. */
  isPerfPanelVisible() {
    return this._perfVisible
  }


  /**
   * Show or hide three's Stats panel (FPS, MS, MB; click it to cycle).  The
   * element is created on the first show and then only hidden, so it costs
   * nothing until asked for.  It sits bottom-right above the fullscreen
   * control, the corner the HUD leaves free (the info list can run long
   * down the left), over the canvas; only its own 80x48 box takes pointer
   * events.
   *
   * @returns {boolean} whether the panel is now showing.
   */
  togglePerfPanel() {
    this._perfVisible = !this._perfVisible
    if (this._perfVisible && !this._stats) {
      this._stats = new Stats
      const style = this._stats.dom.style
      style.top = 'auto'
      style.left = 'auto'
      style.bottom = '3.5em'
      style.right = '0.5em'
      style.zIndex = '1000'
      this._stats.dom.id = 'perf-panel'
      document.body.appendChild(this._stats.dom)
    }
    if (this._stats) {
      this._stats.dom.style.display = this._perfVisible ? 'block' : 'none'
    }
    return this._perfVisible
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
   * Adapt the tone-mapping exposure to the targeted body, so its sunlit
   * side shows at its albedo (exposure.js), easing between targets.  The
   * target is what the camera looks at, so looking at a far planet from
   * near another makes it the exposure target.  The Sun and other stars
   * keep the last body's exposure.
   */
  _updateExposure() {
    const target = targets.obj
    if (target?.props?.radius && target.props.type !== 'star') {
      this._worldGroup ??= this.scene.getObjectByName('WorldGroup') ?? null
      target.getWorldPosition(this._exposureBodyPos)
      if (this._worldGroup) {
        this._worldGroup.getWorldPosition(this._exposureSunPos)
      } else {
        this._exposureSunPos.set(0, 0, 0)
      }
      const distance = this._exposureBodyPos.distanceTo(this._exposureSunPos)
      if (distance > 0) {
        this._exposureGoal = exposureAt(distance)
      }
    }
    const now = performance.now()
    const dt = this._lastExposureMs === null ? Infinity : (now - this._lastExposureMs) / 1000
    this._lastExposureMs = now
    // The metered gain over the keyed exposure (_meter), eased in log
    // space with its own, slower time constant: the eye adapting to a dark
    // scene.
    this._meterGain = easeExposure(this._meterGain, this._meterGainGoal, dt,
        this._meterGainGoal < this._meterGain ? METER_TAU_DOWN_SECONDS : METER_TAU_UP_SECONDS)
    this.renderer.toneMappingExposure =
      easeExposure(this.renderer.toneMappingExposure, this._exposureGoal * this._meterGain, dt)
    // The gain this frame renders with, over the target-keyed exposure:
    // the eased exposure's, not the meter's goal nor _meterGain, which the
    // exposure's own easing trails.  Pre-exposure (HDR.md): everything of
    // absolute brightness (the stars, the Milky Way, the Sun's disc and
    // glow) is multiplied by it before the buffer, through
    // uExposureRelative (hdr.js absoluteUniforms), as a lit surface is by
    // toneMappingExposure, and the meter divides its readback by it.
    this._renderedGain = this.renderer.toneMappingExposure / this._exposureGoal
    absoluteUniforms.uExposureRelative.value = exposureRelative(this.renderer.toneMappingExposure)
    absoluteUniforms.uViewportHeight.value = this.height
    absoluteUniforms.uFovDegrees.value = this.camera.fov
  }


  /**
   * A gain on every star's light over the physical value (HDR.md,
   * "Physical stars"): 2 shows a magnitude more, 0.5 one less.  Not in the
   * settings or the permalink yet (those hold switches).
   *
   * @param {number} gain
   */
  setStarGain(gain) {
    absoluteUniforms.uStarGain.value = gain > 0 ? gain : 1
  }


  /**
   * The star field's limiting magnitude at a dark site, as the user sets
   * it (HDR.md, "Physical stars"): LIMITING_MAGNITUDE (6.5, the naked
   * eye's) at the physical star gain, a magnitude more for 2.5× the light.
   * Celestiary's `[` and `]` keys step it by 0.5, as Celestia's do.
   *
   * @param {number} magnitude
   */
  setLimitingMagnitude(magnitude) {
    this.setStarGain(starGainForLimit(Number.isFinite(magnitude) ? magnitude : LIMITING_MAGNITUDE))
  }


  /** @returns {number} The limiting magnitude the user set (setLimitingMagnitude) */
  userLimitingMagnitude() {
    return LIMITING_MAGNITUDE + (2.5 * Math.log10(absoluteUniforms.uStarGain.value))
  }


  /** @returns {number} The limiting magnitude at the current exposure and star gain */
  limitingMagnitude() {
    return limitingMagnitude(absoluteUniforms.uExposureRelative.value, absoluteUniforms.uStarGain.value)
  }


  /**
   * The renderer's exposure relative to a body's keyed one: 1 when it is
   * the exposure target at its own exposure, and whatever the metered gain
   * and the easing between targets make it otherwise.  What a Cesium
   * layer's frame, lit at the body's own irradiance, is scaled by to reach
   * the HDR buffer's units (CesiumLayers), as the sky is (uSkyExposure).
   *
   * @param {object} node The body's node
   * @returns {number}
   */
  exposureOf(node) {
    this._worldGroup ??= this.scene.getObjectByName('WorldGroup') ?? null
    node.getWorldPosition(this._exposureBodyPos)
    if (this._worldGroup) {
      this._worldGroup.getWorldPosition(this._exposureSunPos)
    } else {
      this._exposureSunPos.set(0, 0, 0)
    }
    const distance = this._exposureBodyPos.distanceTo(this._exposureSunPos)
    return distance > 0 ? skyExposure(distance, this.renderer.toneMappingExposure) : 1
  }


  /**
   * Metered exposure (HDR.md): every METER_EVERY_FRAMES frames, the
   * atmosphere pass renders its linear composite (sky and scene, in
   * exposure units, before the tone map) into a 32×32 float target, whose
   * mean log luminance asks for a gain over the target-keyed exposure
   * (exposure.js meteredGain): 1 for a sunlit target, more for twilight,
   * the night side and deep space, less for the Sun's disc.  The gain asked
   * for is the scene's, whatever exposure the frame was rendered at, so
   * there is no loop to oscillate; _updateExposure eases toward it.
   *
   * The LDR fallback has no float target: its composite is display values
   * (the scene pass tone-mapped them), read into bytes.  In the dark, where
   * the gain matters, Neutral's toe is near linear, so the gain asked for
   * is close; in the bright it's under-read, and the gain stays at 1.
   */
  _meter() {
    if ((this._frame++ % METER_EVERY_FRAMES) !== 0) {
      return
    }
    const u = this._atmMesh.material.uniforms
    if (u.uDebug.value !== 0) {
      return
    }
    this._meterRT ??= new WebGLRenderTarget(METER_SIZE, METER_SIZE,
        {type: this.hdr ? FloatType : UnsignedByteType, depthBuffer: false})
    this._meterPixels ??= new (this.hdr ? Float32Array : Uint8Array)(METER_SIZE * METER_SIZE * 4)
    u.uDebug.value = 7
    this.renderer.setRenderTarget(this._meterRT)
    this.renderer.render(this._atmScene, this._atmCamera)
    this.renderer.setRenderTarget(null)
    u.uDebug.value = 0
    this.renderer.readRenderTargetPixels(this._meterRT, 0, 0, METER_SIZE, METER_SIZE, this._meterPixels)
    // The buffer holds the frame as exposed (pre-exposure, _updateExposure):
    // the reading over the gain it was rendered with is the scene's at the
    // keyed exposure, whatever the gain's goal or easing now.
    const renderedOverKeyed = this._renderedGain
    const metered = meanLogLuminance(this._meterPixels, METER_SIZE * METER_SIZE)
    // The dark end is absolute, over Earth's keyed exposure (meteredGain).
    // A frame of zeros means "nothing drawn yet" only while the scene
    // loads (frameCanBeEmpty): once loaded, black is dark.
    // A sunlit body in the frame anchors the gain, continuously in its
    // share of the field (sunlitBodyGain); the hard cap is logged (starsDebug).
    const halfFov = this.camera.fov * Math.PI / 360
    this._sunlit = this._sunlitBodies()
    this._meterCap = sunlitBodyCap(this._sunlit, this._exposureGoal, halfFov)
    const keyedOverEarth = this._exposureGoal / exposureAt(ASTRO_UNIT_METER)
    const metered0 = sunlitBodyGain(meteredGain(metered, renderedOverKeyed, this._frameCanBeEmpty(), keyedOverEarth),
        this._sunlit, this._exposureGoal, halfFov)
    // A resolved self-luminous disc (the Sun's) brings the gain to what
    // shows its surface, blended in as it grows (luminousDiscGain).
    this._luminous = this._luminousDiscs()
    const gain1 = luminousDiscGain(metered0, this._luminous, keyedOverEarth, this.renderer.getPixelRatio())
    // The galaxy from outside: exposed as a photograph of it (galaxyGain).
    this._galaxyWeight = this._galaxyOutsideWeight()
    const gain = galaxyGain(gain1, metered, renderedOverKeyed, this._galaxyWeight, keyedOverEarth)
    // What was read, at the keyed exposure, for probing (HDR.md).
    this._meterLast = {
      mean: Math.exp(metered.meanLog) / renderedOverKeyed,
      highlight: metered.highlight / renderedOverKeyed,
      blown: metered.blown / renderedOverKeyed,
      max: metered.max / renderedOverKeyed,
      litHighlight: metered.litHighlight / renderedOverKeyed,
      litFraction: metered.litFraction,
      galaxyWeight: this._galaxyWeight,
      gain,
    }
    if (Number.isFinite(gain)) {
      this._meterGainGoal = gain
    }
  }


  /**
   * How far outside the galaxy the camera is, for the meter's galaxy
   * anchor (exposure.js galaxyGain): the Milky Way's own measure
   * (MilkyWay.js, galaxyModel.js outsideWeight), 0 while it's hidden or
   * not yet baked.
   *
   * @returns {number}
   */
  _galaxyOutsideWeight() {
    return this._galaxyShown()?.userData.galaxy.outsideWeight ?? 0
  }


  /**
   * @returns {object|null} The Milky Way's mesh, when it is baked and
   *   shown (its own and every parent's visibility: the `U` toggle, AR)
   */
  _galaxyShown() {
    this._milkyWay ??= this.scene.getObjectByName('MilkyWay') ?? null
    const mw = this._milkyWay
    const state = mw?.userData?.galaxy
    if (!mw || !state?.ready || !mw.visible || !mw.material?.visible) {
      return null
    }
    for (let p = mw.parent; p; p = p.parent) {
      if (!p.visible) {
        return null
      }
    }
    return mw
  }


  /**
   * The night sky's own light, for the atmosphere pass (HDR.md, "The night
   * sky's own light"; nightSky.js, eye.js): the galaxy's march while it's
   * shown; the zodiacal light's geometry, the Sun's direction and the
   * ecliptic's pole from the camera in view space, and its scale at the
   * camera's distance from the Sun; and the eye's response to extended
   * light at this exposure, its gain and whether the frame is an eye's or
   * a photograph's (the galaxy from outside, exposure.js galaxyGain).  The
   * airglow is the atmosphere's (_updateAtmUniforms).  After
   * _updateExposure, whose exposure it reads.
   */
  _updateNightSky() {
    const u = this._atmMesh.material.uniforms
    // The galaxy's own draw only runs its march where this pass draws its
    // light (MilkyWay.js); the LDR fallback's draw composites it.
    this._milkyWay ??= this.scene.getObjectByName('MilkyWay') ?? null
    if (this._milkyWay) {
      this._milkyWay.material.colorWrite = !this.hdr
    }
    const target = this.hdr ? this._galaxyShown()?.userData.galaxy.target?.value : null
    u.uGalaxy.value = target?.texture ?? null
    u.uGalaxyScale.value = target ? 1 / STORE_SCALE : 0
    this._worldGroup ??= this.scene.getObjectByName('WorldGroup') ?? null
    this._nightVectors ??= [new Vector3(), new Vector3(), new Vector3(), new Vector3()]
    const [sun, cam, pole, helio] = this._nightVectors
    if (this._worldGroup) {
      this._worldGroup.getWorldPosition(sun)
      // The scene's frame is the ecliptic of date, its +Y the ecliptic's
      // north pole (celestialFrame.js).
      pole.set(0, 1, 0).transformDirection(this._worldGroup.matrixWorld)
    } else {
      sun.set(0, 0, 0)
      pole.set(0, 1, 0)
    }
    this.camera.getWorldPosition(cam)
    helio.copy(cam).sub(sun)
    const r = helio.length()
    // Only round the app's Sun (the world group's origin): the guide's pages
    // put their one star at the origin with no solar system round it.
    u.uZodiacalScale.value = this.hdr && this._worldGroup && r > 0 ?
      zodiacalScale(r / ASTRO_UNIT_METER, helio.dot(pole) / ASTRO_UNIT_METER) : 0
    if (r > 0) {
      u.uZodiacalSun.value.copy(helio).negate().transformDirection(this.camera.matrixWorldInverse)
    }
    u.uZodiacalPole.value.copy(pole).transformDirection(this.camera.matrixWorldInverse)
    const outside = this._galaxyOutsideWeight()
    u.uExtendedGain.value = extendedGain(absoluteUniforms.uExposureRelative.value, outside)
    u.uEyeMode.value = 1 - outside
  }


  /**
   * Whether a black frame can be the scene still loading (exposure.js
   * frameCanBeEmpty): the star catalogue not yet drawn, or the exposure
   * target's surface not yet in (Planet.surfaceReady).  Deciding it from
   * the meter's pixels missed a star field (its points are sparse and
   * faint at the keyed exposure, and a GPU may flush them to zero) and
   * held the gain at 1: no stars, and nothing in the console.
   *
   * @returns {boolean}
   */
  _frameCanBeEmpty() {
    this._starsPoints ??= this.scene.getObjectByName('StarsPoints') ?? null
    const target = targets.obj
    return frameCanBeEmpty(this.hdr, Boolean(this._starsPoints), !target || target.surfaceReady?.() !== false)
  }


  /**
   * The planets and moons in the frame, for the meter's sunlit-body anchor
   * (exposure.js sunlitBodyGain, and sunlitBodyCap for starsDebug): each
   * one's angular radius, lit fraction (from its phase angle), keyed
   * exposure at its distance from the Sun, Bond albedo, disc diameter in
   * pixels and share of the frame's pixels.  A body whose centre projects
   * within the frame plus its own radius counts; one not drawn (its LOD,
   * or hidden) doesn't.
   *
   * @returns {Array<{angularRadius: number, litFraction: number, keyedExposure: number, albedo: number,
   *   diameterPx: number, frameFraction: number}>}
   */
  _sunlitBodies() {
    const objects = this.sceneManager?.objects
    if (!objects) {
      return []
    }
    this._worldGroup ??= this.scene.getObjectByName('WorldGroup') ?? null
    this._sunlitVectors ??= [new Vector3(), new Vector3(), new Vector3(), new Vector3()]
    const [sun, cam, body, ndc] = this._sunlitVectors
    if (this._worldGroup) {
      this._worldGroup.getWorldPosition(sun)
    } else {
      sun.set(0, 0, 0)
    }
    this.camera.getWorldPosition(cam)
    const bodies = []
    for (const name of Object.keys(objects)) {
      const o = objects[name]
      const type = o?.props?.type
      if ((type !== 'planet' && type !== 'moon') || !o.props.radius || !o.visible || name.endsWith('.orbitPosition')) {
        continue
      }
      o.getWorldPosition(body)
      const distance = body.distanceTo(cam)
      const radius = o.props.radius.scalar
      if (!(distance > radius)) {
        continue
      }
      const angularRadius = Math.asin(radius / distance)
      ndc.copy(body).project(this.camera)
      const marginY = angularRadius / (this.camera.fov * Math.PI / 360)
      const marginX = marginY / Math.max(this.camera.aspect, 1e-6)
      if (!(ndc.z < 1 && ndc.z > -1 && Math.abs(ndc.x) < 1 + marginX && Math.abs(ndc.y) < 1 + marginY)) {
        continue
      }
      const toSun = sun.clone().sub(body)
      const toCam = cam.clone().sub(body)
      const cosPhase = toSun.lengthSq() > 0 ? toSun.normalize().dot(toCam.normalize()) : 1
      const pxRad = (this.camera.fov * Math.PI / 180) / Math.max(this.height, 1)
      const diameterPx = 2 * angularRadius / pxRad
      bodies.push({
        angularRadius,
        litFraction: (1 + cosPhase) / 2,
        keyedExposure: exposureAt(Math.max(body.distanceTo(sun), 1)),
        albedo: o.props.albedo,
        diameterPx,
        frameFraction: (Math.PI * ((diameterPx / 2) ** 2)) / Math.max(this.width * this.height, 1),
      })
    }
    return bodies
  }


  /**
   * Bisects what hides one star on the machine at hand (the user's M2 lost
   * Alnilam at some views; no render here did): renders the frame and
   * reads the star's pixel, then again with each candidate group hidden
   * in turn (the asterism and expansion lines, the Milky Way, the galaxy,
   * labels, the Sun and planets with their sprites and shells), and
   * restores them.  Logs the star's projection, its sprite by the
   * shader's law (starSprite), its clip z by float32 (starClipZ), and the
   * pixel's luma per configuration: a configuration that brings the star
   * back names the occluder; none, and the loss is in the star draw
   * itself on that GPU.  `c.ui.starProbe('Alnilam')` in the console.
   *
   * @param {string} name A star's name in the catalogue
   * @returns {object} What it logs
   */
  starProbe(name) {
    const points = this._starsPoints ?? this.scene.getObjectByName('StarsPoints') ?? null
    const catalog = this.useStore?.getState?.()?.starsCatalog
    const hip = catalog?.hipByName?.get(name)
    if (!points || hip === undefined) {
      console.log('starProbe: no star', name)
      return null
    }
    const g = points.geometry
    const index = Array.from(g.idsByNdx).indexOf(hip)
    const hi = g.getAttribute('position').array
    const lo = g.getAttribute('positionLow').array
    const lumens = g.getAttribute('lumens').array[index]
    points.updateMatrixWorld(true)
    const world = new Vector3(hi[index * 3] + lo[index * 3], hi[(index * 3) + 1] + lo[(index * 3) + 1],
        hi[(index * 3) + 2] + lo[(index * 3) + 2]).applyMatrix4(points.matrixWorld)
    const cam = this.camera.getWorldPosition(new Vector3())
    const distance = world.distanceTo(cam)
    const ndc = world.clone().project(this.camera)
    const px = Math.round((ndc.x + 1) / 2 * this.width)
    const py = Math.round((1 - ndc.y) / 2 * this.height)
    const sun1au = 3.0e28 / (4 * Math.PI * (1.495978707e11 ** 2))
    const ratio = lumens / (4 * Math.PI * distance * distance) / sun1au
    const gl = this.renderer.getContext()
    const one = new Uint8Array(4)
    // The brightest pixel within 2 px of the projection, and within 16 px
    // (a point drawn off its projection shows there and not here).
    const readLuma = (reach = 2) => {
      this.renderLoop(performance.now())
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      let best = 0
      let at = null
      for (let dy = -reach; dy <= reach; dy++) {
        for (let dx = -reach; dx <= reach; dx++) {
          const x = px + dx
          const y = gl.drawingBufferHeight - 1 - (py + dy)
          if (x < 0 || y < 0 || x >= gl.drawingBufferWidth || y >= gl.drawingBufferHeight) {
            continue
          }
          gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one)
          const l = (0.2126 * one[0]) + (0.7152 * one[1]) + (0.0722 * one[2])
          if (l > best) {
            best = l
            at = [dx, dy]
          }
        }
      }
      return reach > 2 ? {luma: +best.toFixed(1), at} : +best.toFixed(1)
    }
    const groups = {
      asterisms: (o) => o.name === 'AsterismLines',
      expansion: (o) => /Colonization|Expansion/i.test(o.name) && o.isMesh,
      milkyWay: (o) => /MilkyWay/i.test(o.name) && (o.isPoints || o.isMesh),
      galaxy: (o) => /^Galaxy/i.test(o.name) && (o.isPoints || o.isMesh),
      labels: (o) => (o.isSprite || o.isMesh) && /label/i.test(o.name),
      sunAndPlanets: (o) => (o.isMesh || o.isPoints || o.isSprite) && o.name !== 'StarsPoints' &&
        !/AsterismLines|MilkyWay|^Galaxy|label/i.test(o.name) && o.props === undefined && this._underBody(o),
    }
    const luma = {asIs: readLuma(), within16px: readLuma(16)}
    for (const [key, test] of Object.entries(groups)) {
      const hidden = []
      this.scene.traverse((o) => {
        if (o !== points && o.visible && test(o)) {
          o.visible = false
          hidden.push(o)
        }
      })
      luma[key] = hidden.length ? readLuma() : null
      hidden.forEach((o) => (o.visible = true))
      luma[`${key}Hidden`] = hidden.length
    }
    const radius = g.getAttribute('radius').array[index]
    const sprite = starSprite(ratio, absoluteUniforms.uExposureRelative.value,
        {fovDegrees: this.camera.fov, heightPx: this.height, starGain: absoluteUniforms.uStarGain.value})
    // Clip w: the distance along the view axis.
    const viewZ = -world.clone().applyMatrix4(this.camera.matrixWorldInverse).z
    const clipZ = starClipZ(viewZ, this.camera.near, this.camera.far)
    const out = {
      name, hip, index, distanceLy: distance / 9.461e15, px, py, ndc: [ndc.x, ndc.y, ndc.z],
      attributes: {lumens, radius, finite: Number.isFinite(lumens) && Number.isFinite(radius)},
      sprite, clipZ, meterGain: this._meterGain, luma,
    }
    // One line, so a console screenshot carries it all.
    const f = (v) => (typeof v === 'number' ? +v.toPrecision(4) : v)
    const flat = [`star ${name} hip ${hip} ${f(distance / 9.461e15)} ly at px ${px},${py}`,
      `ndc ${ndc.x.toFixed(4)},${ndc.y.toFixed(4)},${ndc.z.toFixed(8)}`,
      `lumens ${f(lumens)} radius ${f(radius)}`,
      `sprite size ${f(sprite.sizePx)} sigma ${f(sprite.sigma)} peak ${f(sprite.peak)} flat ${sprite.flat} capped ${sprite.glareCapped}`,
      `clip w ${f(clipZ.w)} w²Inf ${clipZ.wSquaredOverflows} onFarPlane ${clipZ.onFarPlane} ulpsInside ${f(clipZ.ulpsInside)}`,
      `gain ${f(this._meterGain)}`,
      `luma ${Object.entries(luma).map(([k, v]) => `${k}=${typeof v === 'object' && v ? `${v.luma}@${v.at}` : v}`).join(' ')}`]
    console.log(`starProbe: ${flat.join(' | ')}`)
    console.log('starProbe', out)
    return out
  }


  /**
   * @param {object} o A scene node
   * @returns {boolean} Whether it hangs under a planet, moon or star object
   */
  _underBody(o) {
    for (let p = o.parent; p; p = p.parent) {
      if (p.props?.type === 'planet' || p.props?.type === 'moon' || p.props?.type === 'star') {
        return true
      }
    }
    return false
  }


  /**
   * The self-luminous discs in the frame, for the meter (exposure.js
   * luminousDiscGain): each star object (the Sun) whose mesh is in the
   * frame, with its disc's diameter in pixels and its surface radiance at
   * Earth's keyed exposure: the Sun's times the star's surface brightness over
   * the Sun's (Star.js discRadianceRelSun).
   *
   * @returns {Array<{diameterPx: number, radianceAtEarthKeyed: number}>}
   */
  _luminousDiscs() {
    const objects = this.sceneManager?.objects
    if (!objects) {
      return []
    }
    this._sunlitVectors ??= [new Vector3(), new Vector3(), new Vector3(), new Vector3()]
    const [, cam, body, ndc] = this._sunlitVectors
    this.camera.getWorldPosition(cam)
    const pxRad = (this.camera.fov * Math.PI / 180) / Math.max(this.height, 1)
    const discs = []
    for (const name of Object.keys(objects)) {
      const o = objects[name]
      if (o?.props?.type !== 'star' || !o.props.radius || !o.visible || name.endsWith('.orbitPosition')) {
        continue
      }
      o.getWorldPosition(body)
      const distance = body.distanceTo(cam)
      const radius = o.props.radius.scalar
      if (!(distance > radius)) {
        continue
      }
      const angularRadius = Math.asin(radius / distance)
      ndc.copy(body).project(this.camera)
      const marginY = angularRadius / (this.camera.fov * Math.PI / 360)
      const marginX = marginY / Math.max(this.camera.aspect, 1e-6)
      if (!(ndc.z < 1 && ndc.z > -1 && Math.abs(ndc.x) < 1 + marginX && Math.abs(ndc.y) < 1 + marginY)) {
        continue
      }
      discs.push({diameterPx: 2 * angularRadius / pxRad, radianceAtEarthKeyed: SUN_DISC_RADIANCE * (o.discRadianceRelSun ?? 1)})
    }
    return discs
  }


  /**
   * The star field's state, for checking a build on a machine at hand
   * (`c.ui.starsDebug()` in the console; HDR.md "Physical stars"): the
   * exposure and the metered gain with the meter's last reading, the
   * limiting magnitude, the GPU's point-size range and fragment precision,
   * whether the star program compiled, and a few stars' sprites by the
   * shader's law (exposure.js starSprite) at this exposure.
   *
   * @returns {object} What it logs
   */
  starsDebug() {
    const gl = this.renderer.getContext()
    const points = this._starsPoints ?? this.scene.getObjectByName('StarsPoints') ?? null
    const program = points ? this.renderer.properties.get(points.material)?.currentProgram : null
    const gain = absoluteUniforms.uExposureRelative.value
    const starGain = absoluteUniforms.uStarGain.value
    const opts = {fovDegrees: this.camera.fov, heightPx: this.height, starGain}
    const stars = {}
    for (const [name, magnitude] of [['Sirius', -1.46], ['Vega', 0.03], ['mag 3', 3], ['mag 6', 6], ['mag 6.5', 6.5]]) {
      stars[name] = starSprite(illuminanceRatio(magnitude), gain, opts)
    }
    const highp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)
    const out = {
      size: [this.width, this.height],
      pixelRatio: this.renderer.getPixelRatio(),
      hdr: this.hdr,
      exposure: this.renderer.toneMappingExposure,
      keyedExposure: this._exposureGoal,
      meterGain: this._meterGain,
      meterGainGoal: this._meterGainGoal,
      renderedGain: this._renderedGain,
      meterLast: this._meterLast ?? null,
      meterCap: this._meterCap ?? Infinity,
      galaxyOutsideWeight: this._galaxyOutsideWeight(),
      // The night sky's light and the eye's response to it (HDR.md, "The
      // eye and extended light").
      nightSky: (({uExtendedGain, uEyeMode, uZodiacalScale, uGalaxyScale, uAirglow}) => ({
        extendedGain: uExtendedGain.value, eyeMode: uEyeMode.value, zodiacalScale: uZodiacalScale.value,
        galaxy: uGalaxyScale.value > 0, airglowZenith: uAirglow.value.z,
      }))(this._atmMesh.material.uniforms),
      sunlitBodies: this._sunlitBodies(),
      luminousDiscs: this._luminousDiscs(),
      frameCanBeEmpty: this._frameCanBeEmpty(),
      exposureRelative: gain,
      starGain,
      limitingMagnitude: limitingMagnitude(gain, starGain),
      pointSizeRange: Array.from(gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)),
      fragmentHighp: highp ? {rangeMin: highp.rangeMin, rangeMax: highp.rangeMax, precision: highp.precision} : null,
      starsDrawn: Boolean(points),
      program: program ? (program.diagnostics ?? 'compiled') : 'none',
      maxStarSizePx: points?.material.uniforms.MAX_STAR_SIZE_PX.value,
      stars,
    }
    console.log('stars', out)
    return out
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

    if (this._arMode) {
      // AR mode: skip the atmosphere altogether so daytime sky doesn't
      // paint over the stars and asterism overlay.  Set by Scene.enterAR
      // and cleared by Scene.exitAR.  Stage 2 (camera passthrough) will
      // re-enable the atmosphere with premultiplied-alpha blending.
      u.uAtmEnabled.value = 0.0
      return
    }

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
    // A Cesium layer standing in for this body may draw its own atmosphere
    // (Earth; CESIUM.md), all of it once it's taken over, fading in as it
    // does.  Over Cesium's Mars the pass runs.
    const cesiumShare = this.layers.atmosphereShare(atmTarget)
    // Nor over a body with no surface drawn yet: its colour map is loading
    // (Planet.surfaceReady) and no Cesium layer stands in.  The haze over
    // nothing read as a blue disc before the surface appeared.
    const noSurface = atmTarget.surfaceReady?.() === false && !this.layers.isActive(atmTarget)
    if (cesiumShare >= 1 || noSurface) {
      u.uAtmEnabled.value = 0.0
      return
    }
    u.uAtmStrength.value = 1 - cesiumShare
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
    // The body's airglow (nightSky.js airglowOf): its layer's radii, its
    // zenith light at Earth's keyed exposure, and 1 / its thickness.  Only
    // within AIRGLOW_MAX_RADII of it: the layer's chord is a difference of
    // squares of the eye's distance in float32, noise from much farther (a
    // speck of it at Earth's place, from 1 AU), where the layer is under a
    // pixel anyway.
    const glow = airglowOf(atmos)
    if (glow && camDist < AIRGLOW_MAX_RADII * R) {
      const rIn = R + glow.height - (glow.thickness / 2)
      u.uAirglow.value.set(rIn, rIn + glow.thickness, glow.zenithValue, 1 / glow.thickness)
      u.uAirglowColor.value.set(...AIRGLOW_COLOR)
    } else {
      u.uAirglow.value.set(0, 0, 0, 0)
    }
    u.uPlanetCenter.value
        .copy(this._pWorldAtm)
        .applyMatrix4(this.camera.matrixWorldInverse)
    u.uSunDirection.value
        .copy(this._pWorldAtm).negate().normalize()
        .transformDirection(this.camera.matrixWorldInverse)

    u.uGroundRadius.value = R
    u.uAtmosphereRadius.value = R + atmos.height.scalar
    u.uSunIntensity.value = atmos.sunIntensity ?? 22
    // The sky in exposure units: its planet's sunlight at the renderer's
    // exposure (HDR.md).  The Sun is at the world group's origin.
    this._worldGroup ??= this.scene.getObjectByName('WorldGroup') ?? null
    if (this._worldGroup) {
      this._worldGroup.getWorldPosition(this._exposureSunPos)
    } else {
      this._exposureSunPos.set(0, 0, 0)
    }
    const sunDist = this._pWorldAtm.distanceTo(this._exposureSunPos)
    u.uSkyExposure.value = sunDist > 0 ? skyExposure(sunDist, this.renderer.toneMappingExposure) : 1
    u.uRayleigh.value.set(...atmos.rayleigh)
    u.uRayleighScaleHeight.value = atmos.rayleighScaleHeight.scalar
    u.uMieCoeff.value = atmos.mieCoeff
    u.uMieScaleHeight.value = atmos.mieScaleHeight.scalar
    const mie = mieParams(atmos)
    u.uMiePolarity.value.copy(mie.polarity)
    u.uMieBackPolarity.value = mie.backPolarity
    u.uMieForwardWeight.value = mie.forwardWeight
    u.uMieAlbedo.value.copy(mie.albedo)

    if (this._lastAtmPlanet !== atmTarget) {
      this._lastAtmPlanet = atmTarget
      for (const rt of [this._transmittanceRT, this._inScatterRT, this._multiScatterRT, this._inScatterMsRT]) {
        rt?.dispose()
      }
      this._transmittanceRT = precomputeTransmittance(this.renderer, atmos, R)
      this._inScatterRT = precomputeInScatter(this.renderer, atmos, R, this._transmittanceRT)
      // The light scattered more than once (composition.md): from the
      // transmittance, with the body's albedo for the ground's share.
      this._multiScatterRT = precomputeMultiScatter(
          this.renderer, atmos, R, this._transmittanceRT, atmTarget.props.albedo ?? 0)
      this._inScatterMsRT = precomputeInScatterMs(
          this.renderer, atmos, R, this._transmittanceRT, this._multiScatterRT)
      u.tTransmittance.value = this._transmittanceRT.texture
      u.uUseTransmittanceLUT.value = 1.0
      u.tInScatter.value = this._inScatterRT.texture
      u.tMultiScatter.value = this._multiScatterRT.texture
      u.tInScatterMs.value = this._inScatterMsRT.texture
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
   * About the body the camera is at (homeBody), not the one it looks at:
   * with the Moon targeted from Earth's surface, the Moon's radius around
   * Earth's centre made zoom steps kilometres long and the near plane
   * hundreds of km, clipping Earth's sky.
   *
   * @param {number} distBefore Camera distance from controls target before update
   */
  _applyAsymptoticZoom(distBefore) {
    const targetObj = this._homeBody()
    if (!targetObj || !targetObj.props || !targetObj.props.radius) {
      return
    }
    // The ground, not the sphere: Cesium's terrain rises kilometres over
    // celestiary's sphere (Olympus Mons ~21 km), and zooming towards the
    // sphere went into it.
    const surfaceR = groundRadius(targetObj.props.radius.scalar, this.layers.groundHeight(targetObj))
    const distAfter = this.camera.position.distanceTo(this.controls.target)
    const distDesired = asymptoticZoomDist(distBefore, distAfter, surfaceR + GROUND_CLEARANCE_M)
    if (distDesired !== distAfter) {
      this._zoomEye.subVectors(this.camera.position, this.controls.target)
      if (this._zoomEye.length() > 0) {
        this._zoomEye.setLength(distDesired)
        this.camera.position.copy(this.controls.target).add(this._zoomEye)
      }
      this.onCameraChange?.()
    }

    // From where the camera ends up: from the linear step before the remap,
    // one frame's near plane was sized for an altitude the zoom never
    // reached (a zoom out from the ground: ~0.25 radii, near ~160 km).
    const newNear = dynamicNear(Math.max(0, distDesired - surfaceR))
    if (newNear !== this.camera.near) {
      this.camera.near = newNear
      this.camera.updateProjectionMatrix()
    }
  }

  /**
   * Orbit-drag speed as a fraction of full, from the camera's altitude over
   * the ground of the body it is at (zoom.js rotateScale).  1 when that body
   * has no radius (a star).
   *
   * @returns {number}
   */
  orbitScale() {
    const body = this._homeBody()
    const radius = body?.props?.radius?.scalar
    if (!radius) {
      return 1
    }
    const ground = groundRadius(radius, this.layers.groundHeight(body))
    return rotateScale(this.camera.position.distanceTo(this.controls.target) - ground, radius)
  }

  /** @returns {object|null} The body the camera is at (zoom.js homeBody) */
  _homeBody() {
    // At a catalogue star (Scene.goTo(star)) its drawn disc, so the zoom
    // approaches its surface and stops there, as at a planet; it was the
    // last body targeted, and its radius the floor (the Sun's kept the
    // camera 6 radii from Proxima, and a planet's let it into Betelgeuse).
    const scene = this.sceneManager
    if (scene?._starTarget && scene._catalogueStar && this.camera.platform.parent?.name === 'StarAnchor') {
      return scene._catalogueStar
    }
    return homeBody(this.camera.platform.parent, targets.cur, targets.obj)
  }


  /**
   * Never below the ground: whatever moved the camera this frame (a pan
   * along the surface, a landing tween, arrow keys), lift it back to
   * GROUND_CLEARANCE_M over the ground under it, radially from the target's
   * centre.  Over Cesium terrain the camera rides over hills and mountains;
   * over celestiary's sphere it stays just over the sphere.  Not while the
   * terrain's height under the camera is still to come from a Cesium layer
   * (CesiumLayers.groundPending): a permalink restored below the sphere
   * (Valles Marineris, the Dead Sea) was lifted to the sphere before the
   * tiles were in, and stayed there, hundreds of metres over the ground.
   */
  _keepAboveGround() {
    const targetObj = this._homeBody()
    if (!targetObj?.props?.radius || (this.arController && this.arController.isActive())) {
      return
    }
    const groundHeight = this.layers.groundHeight(targetObj)
    if (groundHeight === null && this.layers.groundPending(targetObj)) {
      return
    }
    const floor = groundRadius(targetObj.props.radius.scalar, groundHeight) + GROUND_CLEARANCE_M
    this._zoomEye.subVectors(this.camera.position, this.controls.target)
    const dist = this._zoomEye.length()
    if (dist > 0 && dist < floor) {
      this._zoomEye.setLength(floor)
      this.camera.position.copy(this.controls.target).add(this._zoomEye)
      this.onCameraChange?.()
    }
  }
}
