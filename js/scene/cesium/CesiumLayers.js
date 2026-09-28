import {
  AlwaysDepth,
  AlwaysStencilFunc,
  DoubleSide,
  EqualStencilFunc,
  KeepStencilOp,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  ReplaceStencilOp,
  Scene,
  SphereGeometry,
  Vector3,
} from 'three'
import {toRad} from '../../shared.js'
import {bodyLayer} from '../../store/LayersSlice.js'
import {CESIUM_BODIES, ionToken, isCesiumBody} from './bodies.js'
import {cameraToEcefView, cesiumFov, sphericalLatLngAlt, sunLightDirectionEcef} from './frames.js'


/**
 * Optional Cesium rendering of nearby bodies ("data view").  See CESIUM.md.
 *
 * Per frame, ThreeUi calls:
 *   beforeRender()  pick the active body; hide/show celestiary's surface
 *   composite()     after the scene renders into _sceneRT: stencil the
 *                   body's silhouette, then render Cesium synchronously into
 *                   the same target through a same-page NetGL link
 *   drawsAtmosphereFor(node)  so the atmosphere post-pass can stand down
 *
 * Cesium and portal-netgl are dynamically imported the first time a body's
 * Cesium layer is chosen.
 */
export default class CesiumLayers {
  /** @param {object} ui ThreeUi */
  constructor(ui) {
    this.ui = ui
    // Per body name: {status: 'loading'|'ready'|'error', ...}
    this.bodies = {}
    this.activeName = null
    this.activeNode = null
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

    // Depth of the body's ground sphere, written into the pixels Cesium
    // drew, for celestiary's atmosphere pass when it runs over a Cesium
    // layer (Mars).  Cesium clears _sceneRT's depth; without this the pass
    // would take the Cesium surface for background (see _writeGroundDepth).
    this.groundScene = new Scene()
    this.ground = new Mesh(new SphereGeometry(1, 128, 96), new MeshBasicMaterial({
      colorWrite: false,
      depthWrite: true,
      depthTest: true,
      depthFunc: AlwaysDepth,
      // Stencil test only: EQUAL 1 and keep.
      stencilWrite: true,
      stencilWriteMask: 0,
      stencilRef: STENCIL_REF,
      stencilFunc: EqualStencilFunc,
      stencilZPass: KeepStencilOp,
      stencilFail: KeepStencilOp,
      stencilZFail: KeepStencilOp,
    }))
    this.ground.matrixAutoUpdate = false
    this.ground.frustumCulled = false
    this.groundScene.add(this.ground)
    this._shellScale = new Matrix4()
    this._camPos = new Vector3()
    this._bodyPos = new Vector3()
    this._sunPos = new Vector3()
  }


  /**
   * Choose the active body for this frame and publish the in-range
   * Cesium-capable body for the layers control.
   *
   * @param {object} target targets.obj — the selected body's rotating node
   */
  beforeRender(target) {
    const near = this._nearBody(target)
    const store = this.ui.useStore?.getState()
    if (store?.setLayerBody && store.layerBody !== near) {
      store.setLayerBody(near)
    }
    const wanted = near && bodyLayer(store?.bodyLayers, near) === 'cesium' ? near : null
    if (wanted && !this.bodies[wanted]) {
      this._load(wanted)
    }
    const ready = wanted && this.bodies[wanted].status === 'ready'
    const node = ready ? target : null
    if (node !== this.activeNode) {
      this._restore()
      this.activeName = ready ? wanted : null
      this.activeNode = node
      this._showCredits()
    }
    if (node) {
      this._hideSurface(node)
    }
  }


  /**
   * Composite the active body's Cesium rendering into the currently bound
   * render target (_sceneRT), which holds celestiary's colour, depth and
   * stencil for this frame.
   */
  composite() {
    if (!this.activeNode) {
      return
    }
    const body = this.bodies[this.activeName]
    const {renderer, camera} = this.ui
    const node = this.activeNode

    // 1. Stencil = 1 wherever the body's (atmosphere-sized) ellipsoid is
    // visible past celestiary's own geometry.
    const {radii: [rx, ry, rz], shellScale: s} = CESIUM_BODIES[this.activeName]
    // ECEF (x, y, z) radii → body frame (x, z, y); see frames.js.
    this.shell.matrix.copy(node.matrixWorld).multiply(this._shellScale.makeScale(rx * s, rz * s, ry * s))
    this.shell.matrixWorldNeedsUpdate = true
    const autoClear = renderer.autoClear
    renderer.autoClear = false
    renderer.render(this.shellScene, camera)
    renderer.autoClear = autoClear

    // 2. Cesium, from celestiary's camera, into the stencilled pixels.
    this._setCesiumView(body, node)
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
      this._fail(this.activeName, err)
    }
    renderer.resetState()

    // 3. Celestiary draws this body's atmosphere: give its pass the ground.
    if (!CESIUM_BODIES[this.activeName].atmosphere && node.props.atmosphere) {
      this._writeGroundDepth(node)
    }
  }


  /**
   * @param {object} node A body's rotating node
   * @returns {boolean} Whether a Cesium layer stands in for the body now
   *   and draws its atmosphere, so celestiary's atmosphere pass stands down
   */
  drawsAtmosphereFor(node) {
    return node !== null && node === this.activeNode && CESIUM_BODIES[this.activeName].atmosphere
  }


  /**
   * Celestiary's atmosphere pass reads _sceneRT's depth to tell ground from
   * sky: inside the atmosphere, a pixel whose ray meets the ground sphere
   * but whose depth reads as background is taken for a gap in the surface
   * mesh and hazed over completely.  Cesium's frame clears that depth, so
   * rewrite it where Cesium drew (stencil = 1) with the depth of the
   * body's ground sphere, the same sphere the pass integrates against.
   * Pixels in the stencil but off the sphere (above the limb) keep
   * whatever Cesium left; their rays miss the ground, so the pass treats
   * them as sky either way.
   *
   * @param {object} node
   */
  _writeGroundDepth(node) {
    const {renderer, camera} = this.ui
    const r = node.props.radius.scalar
    this.ground.matrix.copy(node.matrixWorld).multiply(this._shellScale.makeScale(r, r, r))
    this.ground.matrixWorldNeedsUpdate = true
    // resetState() after Cesium's frame also unbinds three's render target.
    renderer.setRenderTarget(this.ui._sceneRT)
    const autoClear = renderer.autoClear
    renderer.autoClear = false
    renderer.render(this.groundScene, camera)
    renderer.autoClear = autoClear
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


  /** Show the active body's Cesium credits, and no other body's. */
  _showCredits() {
    if (!this.credits) {
      return
    }
    this.credits.style.display = this.activeNode ? 'block' : 'none'
    for (const [name, body] of Object.entries(this.bodies)) {
      if (body.credits) {
        body.credits.style.display = name === this.activeName ? 'block' : 'none'
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
  _setCesiumView(body, node) {
    const {Cesium, widget, ellipsoid} = body
    const {camera} = this.ui
    const view = cameraToEcefView(camera.matrixWorld, node.matrixWorld)
    // Same latitude, longitude and altitude on Cesium's ellipsoid as on
    // celestiary's sphere (see frames.sphericalLatLngAlt).
    const {lat, lng, alt} = sphericalLatLngAlt(view.position, node.props.radius.scalar)
    const cesiumCamera = widget.scene.camera
    cesiumCamera.setView({
      destination: Cesium.Cartesian3.fromRadians(lng, lat, alt, ellipsoid),
      orientation: {
        direction: new Cesium.Cartesian3(...view.direction),
        up: new Cesium.Cartesian3(...view.up),
      },
    })
    // Cesium's default far plane (5e8 m) would clip the body from beyond
    // ~80 Earth radii; the layer is in range out to the mesh range.
    const {radii, shellScale} = CESIUM_BODIES[this.activeName]
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
    if (this.activeName === name) {
      this._restore()
      this.activeName = null
      this.activeNode = null
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
