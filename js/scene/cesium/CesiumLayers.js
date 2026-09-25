import {
  AlwaysStencilFunc,
  DoubleSide,
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
import {CESIUM_BODIES, LAYER_NEAR_RADII, ionToken, isCesiumBody} from './bodies.js'
import {cameraToEcefView, cesiumFov, sphericalLatLngAlt, sunLightDirectionEcef} from './frames.js'


/**
 * Optional Cesium rendering of nearby bodies ("data view").  See CESIUM.md.
 *
 * Per frame, ThreeUi calls:
 *   beforeRender()  pick the active body; hide/show celestiary's surface
 *   composite()     after the scene renders into _sceneRT: stencil the
 *                   body's silhouette, then render Cesium synchronously into
 *                   the same target through a same-page NetGL link
 *   isActiveFor(node)  so the atmosphere post-pass can stand down
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
    this._shellScale = new Matrix4()
    this._camPos = new Vector3()
    this._bodyPos = new Vector3()
    this._sunPos = new Vector3()
  }


  /**
   * Choose the active body for this frame and publish the nearby
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
    const wanted = near && store?.bodyLayers?.[near] === 'cesium' ? near : null
    if (wanted && !this.bodies[wanted]) {
      this._load(wanted)
    }
    const ready = wanted && this.bodies[wanted].status === 'ready'
    const node = ready ? target : null
    if (node !== this.activeNode) {
      this._restore()
      this.activeName = ready ? wanted : null
      this.activeNode = node
      if (this.credits) {
        this.credits.style.display = node ? 'block' : 'none'
      }
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
  }


  /**
   * @param {object} node A body's rotating node
   * @returns {boolean} Whether a Cesium layer is standing in for it now
   */
  isActiveFor(node) {
    return node !== null && node === this.activeNode
  }


  /**
   * @param {object} target
   * @returns {string|null}
   */
  _nearBody(target) {
    const name = target?.props?.name
    if (!name || !isCesiumBody(name)) {
      return null
    }
    const radius = target.props.radius.scalar
    target.getWorldPosition(this._bodyPos)
    this.ui.camera.getWorldPosition(this._camPos)
    return this._camPos.distanceTo(this._bodyPos) < LAYER_NEAR_RADII * radius ? name : null
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
      token ?
        {terrain: Cesium.Terrain.fromWorldTerrain()} : // + ion's default imagery
        {baseLayer: Cesium.ImageryLayer.fromProviderAsync(
            Cesium.TileMapServiceImageryProvider.fromUrl(Cesium.buildModuleUrl('Assets/Textures/NaturalEarthII')))}
    widget = new Cesium.CesiumWidget(container, {
      contextOptions: guest.contextOptions,
      useDefaultRenderLoop: false,
      showRenderLoopErrors: false,
      creditContainer: this.credits,
      scene3DOnly: true,
      skyBox: false,
      msaaSamples: 1,
      ...surface,
    })
    if (config.ionTileset) {
      Cesium.Cesium3DTileset.fromIonAssetId(config.ionTileset)
          .then((tileset) => widget.scene.primitives.add(tileset))
          .catch((err) => this._fail(name, err))
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

    return {Cesium, widget, link, guest, container, ellipsoid}
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
    this.bodies[name] = {status: 'error'}
    this._publishStatus(name, 'error')
    // Drop back to celestiary's rendering; the control shows the error.
    this.ui.useStore?.getState().setBodyLayer?.(name, 'default')
    if (this.activeName === name) {
      this._restore()
      this.activeName = null
      this.activeNode = null
    }
  }
}


const STENCIL_REF = 1
// The lazily-added near shape of a Planet (Planet.nearShape).
const SURFACE_GROUP_NAME = 'planet surface and guides'
