import {
  AlwaysStencilFunc,
  DepthStencilFormat,
  DepthTexture,
  DoubleSide,
  Frustum,
  KeepStencilOp,
  LessEqualDepth,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  ReplaceStencilOp,
  Scene,
  Sphere,
  SphereGeometry,
  UnsignedInt248Type,
  Vector3,
  WebGLRenderTarget,
} from 'three'
import {toRad} from '../../shared.js'
import {bodyLayer} from '../../store/LayersSlice.js'
import {CESIUM_BODIES, ionToken, isCesiumBody} from './bodies.js'
import {cameraToEcefView, cesiumFov, ellipsoidCameraPosition, sunLightDirectionEcef} from './frames.js'


/**
 * Cesium rendering of Earth, the Moon and Mars.  See CESIUM.md.
 *
 * Per frame, ThreeUi calls:
 *   beforeRender()  pick the active bodies (every Cesium body in range, on
 *                   screen and set to its Cesium layer, not only the
 *                   target); hide/show celestiary's surfaces
 *   composite()     after the scene renders into _sceneRT, per active body,
 *                   far to near: stencil the body's silhouette, then render
 *                   Cesium synchronously into the same target through a
 *                   same-page NetGL link
 *   drawsAtmosphereFor(node)  so the atmosphere post-pass can stand down
 *
 * Cesium and portal-netgl are dynamically imported the first time a body's
 * Cesium layer comes into view.
 */
export default class CesiumLayers {
  /** @param {object} ui ThreeUi */
  constructor(ui) {
    this.ui = ui
    // Per body name: {status: 'loading'|'ready'|'error', ...}
    this.bodies = {}
    // This frame's active bodies, far to near: [{name, node}]
    this.active = []
    this._activeKey = ''
    // Celestiary objects hidden while a Cesium layer shows: Map<Object3D, wasVisible>
    this.hidden = new Map()
    this.credits = null

    this.shellScene = new Scene()
    this.shell = new Mesh(new SphereGeometry(1, 128, 96), new MeshBasicMaterial({
      // Inside the atmosphere shell only back faces are in view, and they
      // must still stencil the whole screen.
      side: DoubleSide,
      colorWrite: false,
      depthWrite: false,
      depthTest: true,
      stencilWrite: true,
      stencilRef: STENCIL_REF,
      stencilFunc: AlwaysStencilFunc,
      stencilZPass: ReplaceStencilOp,
      stencilFail: KeepStencilOp,
      stencilZFail: KeepStencilOp,
    }))
    this.shell.matrixAutoUpdate = false
    this.shell.frustumCulled = false
    this.shellScene.add(this.shell)

    // Depth of each Cesium body's ground sphere, for celestiary's
    // atmosphere pass (see _writeGroundDepths).
    this.groundScene = new Scene()
    this.ground = new Mesh(new SphereGeometry(1, 128, 96), new MeshBasicMaterial({
      colorWrite: false,
      depthWrite: true,
      depthTest: true,
      depthFunc: LessEqualDepth,
    }))
    this.ground.matrixAutoUpdate = false
    this.ground.frustumCulled = false
    this.groundScene.add(this.ground)
    this._shellScale = new Matrix4()
    this._camPos = new Vector3()
    this._bodyPos = new Vector3()
    this._sunPos = new Vector3()
    this._frustum = new Frustum()
    this._sphere = new Sphere()
    this._viewProj = new Matrix4()
    // Celestiary's depth, saved before the Cesium frames clear it.
    this._depthSave = null
  }


  /**
   * Choose this frame's active bodies, and publish the target, if it's a
   * Cesium-capable body in range, for the layers control.
   *
   * @param {object} target targets.obj — the selected body's rotating node
   */
  beforeRender(target) {
    const near = this._nearBody(target)
    const store = this.ui.useStore?.getState()
    if (store?.setLayerBody && store.layerBody !== near) {
      store.setLayerBody(near)
    }
    const active = []
    for (const name of Object.keys(CESIUM_BODIES)) {
      const node = this.ui.sceneManager?.objects?.[name]
      if (!node || !isCesiumBody(name) || bodyLayer(store?.bodyLayers, name) !== 'cesium') {
        continue
      }
      const distance = this._visibleAt(name, node)
      if (distance === null) {
        continue
      }
      if (!this.bodies[name]) {
        this._load(name)
      }
      if (this.bodies[name].status === 'ready') {
        active.push({name, node, distance})
      }
    }
    active.sort((a, b) => b.distance - a.distance)
    const key = active.map((a) => a.name).join()
    if (key !== this._activeKey) {
      this._restore()
      this.active = active
      this._activeKey = key
      this._showCredits()
    } else {
      this.active = active
    }
    for (const {node} of active) {
      this._hideSurface(node)
    }
  }


  /**
   * Composite the active bodies' Cesium renderings into _sceneRT, which
   * holds celestiary's colour, depth and stencil for this frame.
   *
   * Each Cesium frame clears _sceneRT's whole depth buffer, so celestiary's
   * depth is saved first and restored after each one: a later body's
   * stencil shell is still occluded by celestiary's objects, and so is the
   * atmosphere pass's ray (Phobos in front of Mars).  Far to near: a
   * body's own pixels hold no depth, so a nearer body drawn later lands in
   * front of it.  Last, each body's ground sphere depth.
   */
  composite() {
    const {renderer} = this.ui
    const sceneRT = this.ui._sceneRT
    const drawn = this.active.filter(({name}) => this.bodies[name]?.status === 'ready')
    if (drawn.length === 0) {
      return
    }
    const depthSave = this._depthSaveFor(sceneRT)
    this._blitDepth(sceneRT, depthSave)
    for (const [i, {name, node}] of drawn.entries()) {
      if (this.bodies[name]?.status !== 'ready') {
        continue
      }
      // resetState() also unbinds three's render target; and the last
      // body's stencil must not admit this one.
      renderer.setRenderTarget(sceneRT)
      if (i > 0) {
        renderer.clear(false, false, true)
      }
      this._compositeBody(name, node)
      this._blitDepth(depthSave, sceneRT)
    }
    this._writeGroundDepths(drawn)
  }


  /**
   * @param {string} name
   * @param {object} node
   */
  _compositeBody(name, node) {
    const body = this.bodies[name]
    const {renderer, camera} = this.ui

    // 1. Stencil = 1 wherever the body's (atmosphere-sized) ellipsoid is
    // visible past celestiary's own geometry.
    const {radii: [rx, ry, rz], shellScale: s} = CESIUM_BODIES[name]
    // ECEF (x, y, z) radii → body frame (x, z, y); see frames.js.
    this.shell.matrix.copy(node.matrixWorld).multiply(this._shellScale.makeScale(rx * s, rz * s, ry * s))
    this.shell.matrixWorldNeedsUpdate = true
    const autoClear = renderer.autoClear
    renderer.autoClear = false
    renderer.render(this.shellScene, camera)
    renderer.autoClear = autoClear

    // 2. Cesium, from celestiary's camera, into the stencilled pixels.
    this._setCesiumView(name, body, node)
    // Ellipsoid.default is global and read lazily all over Cesium; with more
    // than one body's widget in the page, it must be this body's while it
    // renders.
    body.Cesium.Ellipsoid.default = body.ellipsoid
    try {
      body.link.frame(() => {
        body.widget.resize()
        body.widget.render()
      })
    } catch (err) {
      this._fail(name, err)
    }
    renderer.resetState()
  }


  /**
   * @param {object} node A body's rotating node
   * @returns {boolean} Whether a Cesium layer stands in for the body now
   *   and draws its atmosphere, so celestiary's atmosphere pass stands down
   */
  drawsAtmosphereFor(node) {
    return node !== null && this.active.some((a) => a.node === node && CESIUM_BODIES[a.name].atmosphere)
  }


  /**
   * Celestiary's atmosphere pass reads _sceneRT's depth: how far each ray
   * travels through the atmosphere, and, inside it, ground from sky (a ray
   * that meets the ground sphere but reads as background is taken for a
   * gap in the surface mesh and hazed over).  A Cesium body's pixels hold
   * celestiary's depth with the body's own surface hidden: background.  So
   * write each body's ground sphere, the sphere the pass integrates
   * against, depth-tested: whatever celestiary drew in front of it (Phobos)
   * keeps its depth.
   *
   * @param {Array<{node: object}>} drawn
   */
  _writeGroundDepths(drawn) {
    const {renderer, camera} = this.ui
    renderer.setRenderTarget(this.ui._sceneRT)
    const autoClear = renderer.autoClear
    renderer.autoClear = false
    for (const {node} of drawn) {
      const r = node.props.radius.scalar
      this.ground.matrix.copy(node.matrixWorld).multiply(this._shellScale.makeScale(r, r, r))
      this.ground.matrixWorldNeedsUpdate = true
      renderer.render(this.groundScene, camera)
    }
    renderer.autoClear = autoClear
  }


  /**
   * @param {object} sceneRT
   * @returns {object} A depth-stencil render target the size of sceneRT
   */
  _depthSaveFor(sceneRT) {
    if (!this._depthSave) {
      const rt = new WebGLRenderTarget(sceneRT.width, sceneRT.height, {stencilBuffer: true})
      rt.depthTexture = new DepthTexture()
      rt.depthTexture.format = DepthStencilFormat
      rt.depthTexture.type = UnsignedInt248Type
      this._depthSave = rt
    }
    const rt = this._depthSave
    if (rt.width !== sceneRT.width || rt.height !== sceneRT.height) {
      rt.setSize(sceneRT.width, sceneRT.height)
    }
    this.ui.renderer.initRenderTarget(rt)
    return rt
  }


  /**
   * Copy depth between two same-size DEPTH24_STENCIL8 render targets.
   *
   * @param {object} from
   * @param {object} to
   */
  _blitDepth(from, to) {
    const {renderer} = this.ui
    const gl = renderer.getContext()
    // The blit honours the scissor test.
    renderer.resetState()
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, renderer.properties.get(from).__webglFramebuffer)
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, renderer.properties.get(to).__webglFramebuffer)
    gl.blitFramebuffer(0, 0, from.width, from.height, 0, 0, to.width, to.height, gl.DEPTH_BUFFER_BIT, gl.NEAREST)
    renderer.resetState()
  }


  /**
   * The Cesium layer is in range wherever celestiary would draw the body as
   * a mesh rather than a point (see meshRange).
   *
   * @param {object} target
   * @returns {string|null} The target's name, if in range of a Cesium layer
   */
  _nearBody(target) {
    const name = target?.props?.name
    if (!name || !isCesiumBody(name)) {
      return null
    }
    target.getWorldPosition(this._bodyPos)
    this.ui.camera.getWorldPosition(this._camPos)
    return this._camPos.distanceTo(this._bodyPos) < meshRange(target) ? name : null
  }


  /**
   * A Cesium body is drawn when it's in range (see _nearBody), in the
   * camera's view, and at least MIN_PIXEL_RADIUS across: smaller, Cesium
   * would draw nothing celestiary's own mesh doesn't.
   *
   * @param {string} name
   * @param {object} node
   * @returns {number|null} Camera distance to the body's centre, or null if
   *   it isn't drawn this frame
   */
  _visibleAt(name, node) {
    const {camera} = this.ui
    node.getWorldPosition(this._bodyPos)
    camera.getWorldPosition(this._camPos)
    const distance = this._camPos.distanceTo(this._bodyPos)
    if (distance >= meshRange(node)) {
      return null
    }
    const {radii, shellScale} = CESIUM_BODIES[name]
    const radius = shellScale * Math.max(...radii)
    if (distance > radius) {
      const halfFov = camera.fov * toRad / 2
      const pixels = Math.tan(Math.asin(radius / distance)) / Math.tan(halfFov) * this.ui.height / 2
      if (pixels < MIN_PIXEL_RADIUS) {
        return null
      }
    }
    this._viewProj.copy(camera.matrixWorld).invert().premultiply(camera.projectionMatrix)
    this._frustum.setFromProjectionMatrix(this._viewProj)
    return this._frustum.intersectsSphere(this._sphere.set(this._bodyPos, radius)) ? distance : null
  }


  /** @param {object} node */
  _hideSurface(node) {
    const surface = node.getObjectByName(SURFACE_GROUP_NAME)
    for (const obj of [surface, node.places]) {
      if (obj && !this.hidden.has(obj)) {
        this.hidden.set(obj, obj.visible)
      }
      if (obj) {
        obj.visible = false
      }
    }
  }


  /**
   * Show one active body's Cesium credits: the nearest's.  Every widget
   * carries the same ion logo and links, so showing each active body's
   * stacks near-duplicate rows (Earth and the Moon, say).
   */
  _showCredits() {
    if (!this.credits) {
      return
    }
    const shown = this.active.at(-1)?.name
    this.credits.style.display = shown ? 'block' : 'none'
    for (const [name, body] of Object.entries(this.bodies)) {
      if (body.credits) {
        body.credits.style.display = name === shown ? 'block' : 'none'
      }
    }
  }


  /** Put back everything _hideSurface hid. */
  _restore() {
    for (const [obj, visible] of this.hidden) {
      obj.visible = visible
    }
    this.hidden.clear()
  }


  /**
   * @param {object} body
   * @param {object} node
   */
  _setCesiumView(name, body, node) {
    const {Cesium, widget} = body
    const {camera} = this.ui
    const view = cameraToEcefView(camera.matrixWorld, node.matrixWorld)
    // On the same ray from the body's centre, at the same height over
    // Cesium's ellipsoid as over celestiary's sphere (see
    // frames.ellipsoidCameraPosition).
    const {radii, shellScale} = CESIUM_BODIES[name]
    const position = ellipsoidCameraPosition(view.position, node.props.radius.scalar, radii)
    // Set directly, not through camera.setView: setView converts direction
    // and up to heading, pitch and roll in the local east-north-up frame and
    // back, and near pitch −90° (looking at the body's centre, as on
    // arrival) that round trip turned the camera by several degrees.
    // Cesium's body then sat off celestiary's stencil and atmosphere, worst
    // off-centre on screen.  The camera's transform stays the identity.
    const cesiumCamera = widget.scene.camera
    const {Cartesian3} = Cesium
    Cartesian3.fromArray(position, 0, cesiumCamera.position)
    Cartesian3.fromArray(view.direction, 0, cesiumCamera.direction)
    Cartesian3.fromArray(view.up, 0, cesiumCamera.up)
    Cartesian3.cross(cesiumCamera.direction, cesiumCamera.up, cesiumCamera.right)
    // Cesium's default far plane (5e8 m) would clip the body from beyond
    // ~80 Earth radii; the layer is in range out to the mesh range.
    const bodyExtent = 2 * shellScale * Math.max(...radii)
    cesiumCamera.frustum.far = Math.max(DEFAULT_FAR, Math.hypot(...view.position) + bodyExtent)
    const canvas = widget.canvas
    cesiumCamera.frustum.fov = cesiumFov(camera.fov * toRad, canvas.clientWidth / Math.max(1, canvas.clientHeight))

    // Celestiary's Sun is at the world origin of its world group.
    this._sunPos.set(0, 0, 0)
    if (this.ui.scene?.getObjectByName) {
      const world = this.ui.scene.getObjectByName('WorldGroup')
      if (world) {
        world.getWorldPosition(this._sunPos)
      }
    }
    const dir = sunLightDirectionEcef(node.matrixWorld, this._sunPos)
    widget.scene.light.direction = new Cesium.Cartesian3(...dir)

    // Keep Cesium's canvas the size of celestiary's.
    const {width, height} = this.ui
    if (body.container.style.width !== `${width}px` || body.container.style.height !== `${height}px`) {
      body.container.style.width = `${width}px`
      body.container.style.height = `${height}px`
    }
  }


  /**
   * Load Cesium and set up the body's widget and NetGL link.
   *
   * @param {string} name
   */
  async _load(name) {
    this.bodies[name] = {status: 'loading'}
    this._publishStatus(name, 'loading')
    try {
      window.CESIUM_BASE_URL ??= new URL('cesium/', document.baseURI).href
      const [Cesium, netgl] = await Promise.all([
        import('cesium'),
        import('@pablo-mayrgundter/portal-netgl'),
      ])
      this.bodies[name] = {status: 'ready', ...this._createWidget(name, Cesium, netgl)}
      this._publishStatus(name, 'ready')
    } catch (err) {
      this._fail(name, err)
    }
  }


  /**
   * @param {string} name
   * @param {object} Cesium
   * @param {object} netgl
   * @returns {object}
   */
  _createWidget(name, Cesium, netgl) {
    const {renderer} = this.ui
    const config = CESIUM_BODIES[name]
    const token = ionToken()
    if (token) {
      Cesium.Ion.defaultAccessToken = token
    }

    const container = document.createElement('div')
    // Hidden but laid out: Cesium sizes its canvas from its container.
    Object.assign(container.style, {
      position: 'fixed', left: '0', top: '0', visibility: 'hidden', pointerEvents: 'none', zIndex: '-1',
      width: `${this.ui.width}px`, height: `${this.ui.height}px`,
    })
    document.body.appendChild(container)
    if (!this.credits) {
      this.credits = document.createElement('div')
      this.credits.id = 'cesium-credits'
      Object.assign(this.credits.style, {
        position: 'fixed', bottom: '0.5em', left: '50%', transform: 'translateX(-50%)',
        fontSize: '11px', color: '#aaa', display: 'none', zIndex: '10',
        // HTML chrome: 'v' hides it with the other panels (Celestiary
        // _toggleNav sets visibility; _showCredits owns display).
        visibility: this.ui.sceneManager?.getSetting?.('v') === false ? 'hidden' : '',
      })
      document.body.appendChild(this.credits)
    }
    // Each widget writes its own credits into its container, so every body
    // gets one; _showCredits shows the active body's.
    const credits = document.createElement('div')
    credits.style.display = 'none'
    this.credits.appendChild(credits)

    const sceneRT = this.ui._sceneRT
    let widget = null
    const link = netgl.makeNetGLImmediateLink({
      gl: renderer.getContext(),
      replay: {
        // Cesium's "screen" is celestiary's scene render target.
        screenFramebuffer: () => renderer.properties.get(sceneRT).__webglFramebuffer,
        remapScreenViewport: (x, y, w, h) => {
          const canvas = widget?.canvas
          if (!canvas?.width || !canvas?.height) {
            return null
          }
          const sx = sceneRT.width / canvas.width
          const sy = sceneRT.height / canvas.height
          return [Math.round(x * sx), Math.round(y * sy), Math.round(w * sx), Math.round(h * sy)]
        },
        screen: {stencil: {ref: STENCIL_REF}, blend: 'premultiplied-over', clear: 'depth-only'},
      },
      onError: (err) => console.warn('[cesium layer] replay error:', err),
    })
    const guest = netgl.makeNetGLCesiumGuest({transport: link.transport, webgl: {alpha: true}})

    const ellipsoid = Cesium.Ellipsoid[config.ellipsoid]
    Cesium.Ellipsoid.default = ellipsoid
    const surface = config.ionTileset ?
      // An ion 3D-tiles body (Moon, Mars): no globe, the tileset is the surface.
      {globe: false, baseLayer: false} :
      // The globe always starts on the offline Natural Earth II imagery and
      // the plain ellipsoid, so it draws whatever ion does (addIonEarth).
      {baseLayer: Cesium.ImageryLayer.fromProviderAsync(
          Cesium.TileMapServiceImageryProvider.fromUrl(Cesium.buildModuleUrl('Assets/Textures/NaturalEarthII')))}
    widget = new Cesium.CesiumWidget(container, {
      contextOptions: guest.contextOptions,
      useDefaultRenderLoop: false,
      showRenderLoopErrors: false,
      creditContainer: credits,
      scene3DOnly: true,
      skyBox: false,
      msaaSamples: 1,
      // OIT's composite pass makes every pixel that isn't background fully
      // opaque, including the sky atmosphere's faint ones, which then hid
      // celestiary's stars behind it.  Cesium's layers here draw nothing
      // translucent, so plain alpha blending loses nothing.
      orderIndependentTranslucency: false,
      ...surface,
    })
    if (config.ionTileset) {
      Cesium.Cesium3DTileset.fromIonAssetId(config.ionTileset, {
        // Celestiary's bodies turn under its camera, so Cesium's camera
        // moves every frame.  These two optimizations defer tile requests
        // until the camera stops, which here is never: off-centre tiles
        // stayed coarse until a zoom forced a reload.
        foveatedScreenSpaceError: false,
        cullRequestsWhileMoving: false,
        // Finer tiles than Cesium's default (16): sharper imagery and
        // terrain.
        maximumScreenSpaceError: TILE_SCREEN_SPACE_ERROR,
        customShader: sunlitShader(Cesium),
      })
          .then((tileset) => widget.scene.primitives.add(tileset))
          .catch((err) => this._fail(name, err))
    } else if (token) {
      addIonEarth(Cesium, widget)
    }
    guest.attach(widget.scene)
    // Cesium's widgets.css normally sizes its canvas to the container;
    // without it the canvas stays 300×150 and renders blocky.
    for (const el of [widget.canvas.parentElement, widget.canvas]) {
      Object.assign(el.style, {width: '100%', height: '100%', display: 'block'})
    }

    const scene = widget.scene
    // Everything but the globe and its atmosphere is celestiary's job.
    scene.backgroundColor = new Cesium.Color(0, 0, 0, 0)
    if (scene.sun) {
      scene.sun.show = false
    }
    if (scene.moon) {
      scene.moon.show = false
    }
    scene.screenSpaceCameraController.enableInputs = false
    // Lit by celestiary's Sun, not Cesium's ephemeris: the day/night line
    // then matches celestiary's whatever its sidereal phase.
    scene.light = new Cesium.DirectionalLight({direction: new Cesium.Cartesian3(1, 0, 0)})
    if (scene.globe) {
      scene.globe.enableLighting = true
    }
    scene.atmosphere.dynamicLighting = Cesium.DynamicAtmosphereLightingType.SCENE_LIGHT
    if (scene.skyAtmosphere) {
      scene.skyAtmosphere.show = config.atmosphere
    }
    scene.renderError.addEventListener((_scene, err) => this._fail(name, err))

    return {Cesium, widget, link, guest, container, ellipsoid, credits}
  }


  /**
   * @param {string} name
   * @param {string} status
   */
  _publishStatus(name, status) {
    this.ui.useStore?.getState().setLayerStatus?.(name, status)
  }


  /**
   * @param {string} name
   * @param {object} err
   */
  _fail(name, err) {
    if (this.bodies[name]?.status !== 'error') {
      console.error(`[cesium layer] ${name} failed; falling back to celestiary rendering`, err)
    }
    this.bodies[name]?.credits?.remove()
    this.bodies[name] = {status: 'error'}
    this._publishStatus(name, 'error')
    // Drop back to celestiary's rendering; the control shows the error.
    this.ui.useStore?.getState().setBodyLayer?.(name, 'default')
    if (this.active.some((a) => a.name === name)) {
      this._restore()
      this.active = this.active.filter((a) => a.name !== name)
      // Re-hides the remaining bodies' surfaces next frame.
      this._activeKey = null
      this._showCredits()
    }
  }
}


/**
 * Upgrade the Earth globe to ion's World Terrain and imagery, each only once
 * it has loaded.  If the token can't reach an asset (no network, or a token
 * scoped to other assets) the globe keeps its offline surface.  Handing
 * CesiumWidget `terrain: Terrain.fromWorldTerrain()` instead would unset the
 * globe's terrain until ion answered, and leave it unset on failure: an
 * empty globe.
 *
 * @param {object} Cesium
 * @param {object} widget
 */
function addIonEarth(Cesium, widget) {
  Cesium.createWorldTerrainAsync({requestVertexNormals: true, requestWaterMask: true})
      .then((terrain) => {
        if (!widget.isDestroyed()) {
          widget.scene.globe.terrainProvider = terrain
        }
      })
      .catch((err) => console.warn(
          '[cesium layer] ion World Terrain unavailable (is it in the token\'s assets?); using the ellipsoid', err))
  const imagery = Cesium.ImageryLayer.fromWorldImagery()
  imagery.errorEvent.addEventListener((err) => {
    console.warn('[cesium layer] ion imagery unavailable (is it in the token\'s assets?); using Natural Earth II', err)
    if (!widget.isDestroyed()) {
      widget.imageryLayers.remove(imagery)
    }
  })
  widget.imageryLayers.add(imagery)
}


/**
 * Lights an ion 3D-tiles surface (Moon, Mars) by celestiary's Sun.  The
 * tilesets come unlit, so without this the night side is as bright as the
 * day side.
 *
 * Lambert on the smooth sphere, which gives a clean terminator at any
 * distance.  Not on the terrain: the tilesets carry no normals, and
 * normals from the geometry (screen-space derivatives of position) are
 * flat per triangle.  The terrain meshes are much coarser than their
 * imagery, so lighting them outlined every triangle, from orbit down to
 * the surface, while the imagery already shows the craters' shading.
 *
 * @param {object} Cesium
 * @returns {object} Cesium.CustomShader
 */
function sunlitShader(Cesium) {
  const f = (x) => x.toFixed(3)
  return new Cesium.CustomShader({
    lightingModel: Cesium.LightingModel.UNLIT,
    fragmentShaderText: `
      void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
        vec3 up = czm_viewRotation * normalize(fsInput.attributes.positionWC);
        float lambert = max(dot(up, czm_lightDirectionEC), 0.0);
        material.diffuse *= ${f(SURFACE_AMBIENT)} + ${f(1 - SURFACE_AMBIENT)} * lambert;
      }`,
  })
}


const STENCIL_REF = 1
// Smallest on-screen radius, in pixels, at which a body is drawn by Cesium.
const MIN_PIXEL_RADIUS = 1
// Night-side floor for sunlitShader: dark, but not a hole in the sky.
const SURFACE_AMBIENT = 0.02
// ion tilesets' maximumScreenSpaceError, in pixels.
const TILE_SCREEN_SPACE_ERROR = 8
// Cesium's default PerspectiveFrustum far plane, metres.
const DEFAULT_FAR = 5e8
// Planet.newPlanet's LOD: the body's mesh, then a point, then nothing.
const PLANET_LOD_NAME = 'planet LOD'
// The lazily-added near shape of a Planet (Planet.nearShape).
const SURFACE_GROUP_NAME = 'planet surface and guides'


/**
 * How far out celestiary draws the body as a mesh rather than a point: the
 * distance at which its 'planet LOD' (Planet.newPlanet) swaps in the next
 * level.
 *
 * @param {object} node A body's rotating node
 * @returns {number} Metres from the body's centre; 0 if it has no such LOD
 */
export function meshRange(node) {
  const lod = node.parent
  if (!lod?.isLOD || lod.name !== PLANET_LOD_NAME || lod.levels[0]?.object !== node) {
    return 0
  }
  return lod.levels[1]?.distance ?? Infinity
}
