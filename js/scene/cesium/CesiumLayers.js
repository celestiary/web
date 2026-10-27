import {
  AddEquation,
  AlwaysDepth,
  AlwaysStencilFunc,
  Color,
  CustomBlending,
  DepthStencilFormat,
  DepthTexture,
  DoubleSide,
  Frustum,
  KeepStencilOp,
  LessEqualDepth,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  OneFactor,
  OneMinusSrcAlphaFactor,
  OrthographicCamera,
  PlaneGeometry,
  ReplaceStencilOp,
  Scene,
  ShaderMaterial,
  Sphere,
  SphereGeometry,
  UnsignedInt248Type,
  Vector3,
  WebGLRenderTarget,
  ZeroFactor,
} from 'three'
import {DISPLAY_GAIN, FADE_LAYER, toRad} from '../../shared.js'
import {bodyLayer} from '../../store/LayersSlice.js'
import {CESIUM_BODIES, ionToken, isCesiumBody} from './bodies.js'
import CreditsReveal from './creditsReveal.js'
import {
  bodyToEcef,
  cameraToEcefView,
  cesiumFov,
  ellipsoidCameraPosition,
  NIGHT_LIGHT_EDGE,
  nightInView,
  sunLightDirectionEcef,
} from './frames.js'
import {newYorkOptions, newYorkRange, newYorkStatus} from './newYork.js'
import {groundInView, halfDiagonal, hiddenBehind, OCCLUDER_SCALE} from './visibility.js'
import {fovScale} from '../farPoint.js'
import {nightLightRadiance} from '../exposure.js'
import {HDR_MAX_VALUE, NEUTRAL_GLSL} from '../hdr.js'
import {DECODE_DISTANCE_GLSL, distanceScale} from './distance.js'
import {detailScale} from './detail.js'
import {LOG_DECODE_GLSL, earthshineFraction} from './encoding.js'
import {
  DEFAULT_FAR,
  absoluteUrl,
  applyView,
  createWidget,
  requestIon,
  sampleGround,
  terrainHeight,
  tilesReady,
  updateMonthlyImagery,
} from './cesiumBody.js'
import {latLngAltToBodyFixed} from '../../coords.js'
import {perf} from '../../perf/perf.js'
import {monthOfJulianDay} from '../monthly.js'
import {dataUrl} from '../../dataUrl.js'
import {sanitizeCredits} from '../../cesium-guest/credits.js'
import {guestOptions} from '../../cesium-guest/origins.js'


export {tilesReady}


/**
 * Cesium rendering of Earth, the Moon and Mars.  See CESIUM.md.
 *
 * Per frame, ThreeUi calls:
 *   beforeRender()  pick the active bodies (every Cesium body in range, on
 *                   screen and set to its Cesium layer, not only the
 *                   target); hide/show celestiary's surfaces
 *   composite()     after the scene renders into _sceneRT, per active body,
 *                   far to near: stencil the body's silhouette, render
 *                   Cesium synchronously into _cesiumRT through a same-page
 *                   NetGL link, and composite that into _sceneRT in its
 *                   units (HDR.md)
 *   atmosphereShare(node)  how much of the body's atmosphere Cesium
 *                   draws, so the atmosphere post-pass fades out and stands
 *                   down
 *
 * Cesium and portal-netgl are dynamically imported the first time a Cesium
 * body is targeted or comes into view.
 */
export default class CesiumLayers {
  /** @param {object} ui ThreeUi */
  constructor(ui) {
    this.ui = ui
    // Per body name: {status: 'loading'|'ready'|'error', ...}
    this.bodies = {}
    // This frame's active bodies, far to near: [{name, node}]
    this.active = []
    // In range and loaded, but Cesium's tiles for the view aren't in yet:
    // rendered unseen so they stream, while celestiary's surface still
    // shows.  [{name, node}]
    this.warming = []
    // The target whose Cesium bodies were last preloaded.
    this._preloadedFor = null
    // This frame's time, for the crossfades (performance.now, ms).
    this._now = 0
    // Whether the scene's lights have joined FADE_LAYER.
    this._lightsInFadeLayer = false
    this._activeKey = ''
    // Celestiary objects hidden while a Cesium layer shows: Map<Object3D, wasVisible>
    this.hidden = new Map()
    this.credits = null
    // While the homepage shows (Celestiary._homeCost): no body is wanted,
    // so celestiary draws its own and nothing of Cesium loads.
    this.suspended = false
    // Celestiary's simulation clock (Time), for monthly imagery; set by
    // Celestiary.  Without it, today's month.
    this.time = null
    // Slop New York at Manhattan, drawn by Earth's Cesium layer: the switch
    // (the store's newYorkOn, from the layers control, the permalink's
    // `layers:nyc` or ?nyc=1; newYork.js), and the city once loaded
    // ({status: 'loading'|'ready'|'error', city}; _updateNewYork).
    this.newYork = newYorkOptions(typeof location === 'undefined' ? '' : location.search)
    this._newYork = null
    // Cesium's draws run only in the replay, not on its shadow too: nothing
    // here reads Cesium's pixels (heights are CPU picks on loaded tiles, its
    // inputs are off), so the shadow needs its state, not its frame.
    // ?cesiumShadowDraws=1 draws on the shadow as before, to compare.
    this.shadowDraws = typeof location !== 'undefined' &&
      new URLSearchParams(location.search).get('cesiumShadowDraws') === '1'
    // ?cesium=iframe: Earth's Cesium on a page of its own, on another
    // origin, as a NetGL guest (design/CesiumGuest.md); ?cesiumGuest=<url>
    // picks the page.  Null for Cesium on this page, the default.
    const search = typeof location === 'undefined' ? '' : location.search
    this.guestPage = guestOptions(search)
    // How long a frame waits for a guest's frame of its view before it's
    // drawn with the last one in (?cesiumWait=ms; awaitingGuests).
    this.guestWaitMs = Number(new URLSearchParams(search).get('cesiumWait')) || GUEST_WAIT_MS
    this._viewId = 0
    // ?nyc=1 is put in the store on the first frame with one (it isn't set
    // yet when ThreeUi makes this): _syncNewYork.
    this._newYorkFromUrl = this.newYork.enabled
    // The city's range from Earth's camera, last frame (newYorkRange), null
    // while Earth's layer isn't drawn.
    this._newYorkRange = null

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
    // atmosphere pass (see _writeGroundDepths).  Tessellated as
    // celestiary's own planet mesh (Planet.js, 512 × 256): the pass hazes a
    // surface for its distance, and at 128 × 96 the faces sagged up to 2 km
    // inside the sphere, which from 37 km read 7% farther than celestiary's
    // own ground and hazed Cesium's Earth half again as much.
    this.groundScene = new Scene()
    this.ground = new Mesh(new SphereGeometry(1, 512, 256), new MeshBasicMaterial({
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
    this._viewDir = new Vector3()
    // The body whose credits show (_showCredits); undefined until the first.
    this._credited = undefined
    this._occluderPos = new Vector3()
    this._sunPos = new Vector3()
    this._earthPos = new Vector3()
    this._moonPos = new Vector3()
    this._toSun = new Vector3()
    this._toMoon = new Vector3()
    this._frustum = new Frustum()
    this._sphere = new Sphere()
    this._viewProj = new Matrix4()
    // Where Cesium's frames draw (see composite), and the pass that brings
    // each into _sceneRT.
    this._cesiumRT = null
    this.decodeScene = new Scene()
    this.decodeCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
    this.decode = new Mesh(new PlaneGeometry(2, 2), newDecodeMaterial())
    this.decode.frustumCulled = false
    this.decodeScene.add(this.decode)
    // The night lights' pass (_drawNightLights): added on top of the decode.
    this.lightsScene = new Scene()
    this.lights = new Mesh(new PlaneGeometry(2, 2), newLightsMaterial())
    this.lights.frustumCulled = false
    this.lightsScene.add(this.lights)
    this._lightsCenter = new Vector3()
    this._lightsSun = new Vector3()
    this._clearColor = new Color()
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
    this._now = performance.now()
    // ?perf=1's "Cesium layer" toggle off: no body is wanted, so
    // celestiary's own draw.
    const wanted = (name) => perf.runs('cesium') && this._wanted(name)
    this._preload(target, wanted)
    this._syncNewYork(store)
    if (this._newYork && !(wanted('earth') && this.bodies.earth?.status === 'ready' && this.newYork.enabled)) {
      this._freeNewYork()
    }
    const active = []
    const warming = []
    for (const name of Object.keys(CESIUM_BODIES)) {
      const node = this.ui.sceneManager?.objects?.[name]
      if (!node || !wanted(name)) {
        continue
      }
      const distance = this._visibleAt(name, node)
      if (distance === null) {
        continue
      }
      if (!this.bodies[name]) {
        this._load(name)
      }
      const body = this.bodies[name]
      if (body.status !== 'ready') {
        continue
      }
      // Swap celestiary's surface for Cesium's only once Cesium has tiles
      // to draw; until then the body is empty, or only its atmosphere.
      // Then crossfade (fadeOf).
      if (!body.shown && (body.remote ? body.frames > 0 && body.tilesLoaded : tilesReady(body))) {
        body.shown = true
        body.fadeStart = this._now
      }
      if (body.shown) {
        active.push({name, node, distance})
      } else {
        warming.push({name, node, distance})
      }
    }
    this.warming = warming
    active.sort((a, b) => b.distance - a.distance)
    const key = active.map((a) => a.name).join()
    if (key !== this._activeKey) {
      this._restore()
      this.active = active
      this._activeKey = key
    } else {
      this.active = active
    }
    this._publishNewYork(store)
    // The credits follow the ground in view: none while it's only sky.
    this._showCredits()
    for (const {node} of active) {
      this._hideSurface(node)
    }
    this._postGuestViews([...warming, ...active])
  }


  /**
   * Send this frame's view to each body drawn by a guest page, one view in
   * flight a body: the frame then waits for the guest's frame of it
   * (awaitingGuests).  A body whose last view is still out gets none, and
   * its last frame is drawn again.
   *
   * @param {Array<{name: string, node: object}>} drawn This frame's active and warming bodies
   */
  _postGuestViews(drawn) {
    const remote = drawn.filter(({name}) => this.bodies[name]?.remote && this.bodies[name].status === 'ready' &&
      this.bodies[name].waiting === null)
    if (remote.length === 0) {
      return
    }
    // The bodies' matrices as the render will have them.
    this.ui.scene?.updateMatrixWorld?.()
    for (const {name, node} of remote) {
      const body = this.bodies[name]
      const view = this._viewOf(name, node)
      const [width, height] = view.size
      if (body.iframe.style.width !== `${width}px` || body.iframe.style.height !== `${height}px`) {
        body.iframe.style.width = `${width}px`
        body.iframe.style.height = `${height}px`
      }
      body.heightM = view.heightM
      body.distanceScale = view.distanceScale
      body.size = view.size
      const viewId = ++this._viewId
      body.waiting = viewId
      body.posted = viewId
      body.postedAt = performance.now()
      body.holdUntil = body.postedAt + this.guestWaitMs
      body.receiver.post({type: 'cesium:view', viewId, view})
    }
  }


  /**
   * @returns {boolean} Whether this frame waits for a guest page's frame of
   *   its view (ThreeUi.renderLoop): one is in flight, and not for longer
   *   than guestWaitMs
   */
  awaitingGuests() {
    const now = performance.now()
    for (const body of Object.values(this.bodies)) {
      if (body.remote && body.waiting !== null && now < body.holdUntil) {
        return true
      }
    }
    return false
  }


  /**
   * Composite the active bodies' Cesium renderings into _sceneRT, which
   * holds celestiary's colour and depth for this frame.
   *
   * Each Cesium frame draws into _cesiumRT, cleared to transparent black,
   * not straight into _sceneRT: Cesium's colour reaches celestiary through
   * its own 8-bit buffers, so it comes encoded, and a pass decodes it into
   * _sceneRT's units (bodyGain; HDR.md).  _cesiumRT gets celestiary's depth
   * first, for the stencil shell's depth test (a body behind the Moon is
   * covered by it); Cesium's frame then clears that copy, and _sceneRT's
   * own depth stays celestiary's, for a later body's shell and for the
   * atmosphere pass's ray (Phobos in front of Mars).  Far to near: a body's
   * own pixels hold no depth, so a nearer body drawn later lands in front
   * of it.  Last, each body's ground sphere depth.
   */
  composite() {
    const {renderer} = this.ui
    const sceneRT = this.ui._sceneRT
    const ready = ({name}) => this.bodies[name]?.status === 'ready'
    const drawn = this.active.filter(ready)
    // Warming bodies first: they draw nothing (no stencil), and so can't
    // cover the shown ones.
    const passes = [...this.warming.filter(ready).map((w) => ({...w, unseen: true})), ...drawn]
    if (passes.length === 0) {
      return
    }
    const cesiumRT = this._cesiumTarget()
    for (const {name, node, unseen} of passes) {
      if (this.bodies[name]?.status !== 'ready') {
        continue
      }
      perf.begin('cesium.blit')
      this._blitDepth(sceneRT, cesiumRT)
      perf.end('cesium.blit')
      // resetState() also unbinds three's render target; and the last
      // body's stencil and colour must not carry over to this one.
      renderer.setRenderTarget(cesiumRT)
      renderer.getClearColor(this._clearColor)
      const clearAlpha = renderer.getClearAlpha()
      renderer.setClearColor(0x000000, 0)
      renderer.clear(true, false, true)
      renderer.setClearColor(this._clearColor, clearAlpha)
      this._compositeBody(name, node, unseen)
      if (!unseen && this.bodies[name]?.status === 'ready') {
        perf.begin('cesium.decode')
        this._decodeInto(sceneRT, cesiumRT, name, node)
        perf.end('cesium.decode')
        if (perf.begin('cesium.nightlights')) {
          this._drawNightLights(sceneRT, cesiumRT, name, node)
          perf.end('cesium.nightlights')
        }
      }
    }
    this._drawFadingSurfaces(drawn)
    // Not for a body whose terrain wrote its own depth (_decodeInto): where
    // its terrain sinks below the sphere (most of Mars, under its datum)
    // the sphere's depth, nearer, covered it, and the band between the
    // terrain's horizon and the sphere's, where Cesium draws nothing, read
    // as ground with the stars through it.  Left without depth, the pass
    // takes that band for a gap in the ground and draws it the horizon's
    // haze.
    perf.begin('cesium.ground')
    this._writeGroundDepths(drawn.filter(({name}) => !this._terrainDepth(name)))
    perf.end('cesium.ground')
  }


  /**
   * Bring one body's Cesium frame from _cesiumRT into _sceneRT,
   * premultiplied-over, in _sceneRT's units.
   *
   * @param {object} sceneRT
   * @param {object} cesiumRT
   * @param {string} name
   * @param {object} node The body's node
   */
  _decodeInto(sceneRT, cesiumRT, name, node) {
    const {renderer} = this.ui
    const u = this.decode.material.uniforms
    u.tCesium.value = cesiumRT.texture
    u.uHdr.value = this.ui.hdr === true ? 1 : 0
    // The frame is lit at the body's own irradiance: the body's gain takes
    // it to exposure units at the body's keyed exposure, and the renderer's
    // exposure over that (the metered gain, the easing between targets,
    // another body targeted; ThreeUi.exposureOf) to the buffer's, as
    // celestiary's own surface and the sky are.
    u.uGain.value = bodyGain(name) * (this.ui.exposureOf?.(node) ?? 1)
    // Not while celestiary's own surface is still drawn over it, fading
    // (_drawFadingSurfaces): the terrain's depth, nearer than the sphere,
    // would hide it.  Nor from high up (TERRAIN_DEPTH_MAX_HEIGHT_M): the
    // pass needs the terrain's distance for a ridge over the sphere's
    // horizon, seen from low, and from afar 8 bits are too coarse for it
    // (from orbit, past the encoding's limit, the terrain would read in
    // front of the atmosphere and go unhazed), where the sphere's depth
    // (_writeGroundDepths) is exact.
    this.decode.material.depthWrite = this._terrainDepth(name)
    u.uDistanceScale.value = this.bodies[name]?.distanceScale ?? 1
    // A tileset's shader writes its light log-encoded (sunlitShader).
    u.uLogEncoded.value = CESIUM_BODIES[name]?.ionTileset ? 1 : 0
    u.uProjection.value.copy(this.ui.camera.projectionMatrix)
    u.uProjectionInverse.value.copy(this.ui.camera.projectionMatrixInverse)
    renderer.setRenderTarget(sceneRT)
    const autoClear = renderer.autoClear
    renderer.autoClear = false
    renderer.render(this.decodeScene, this.decodeCamera)
    renderer.autoClear = autoClear
  }


  /**
   * Night lights, for a body with a `nightImagery` layer (Earth): a second
   * Cesium frame of the globe with only that layer on, unlit, added to
   * _sceneRT as emitted light.  CESIUM.md, "Night lights".
   *
   * Not through the day frame: Cesium multiplies a globe's imagery by its
   * lighting, which is 0 on the night side (and its night alpha only
   * chooses which imagery is blended in before that), and the frame's 8
   * bits hold the lit surface up to 1, where the lights are ~1e-5 of a
   * sunlit white.  The lights pass has the whole frame: the layer's stored
   * values, as celestiary's night texture is read, and the decode scales
   * them to exposure units (newLightsMaterial), where each pixel's
   * terminator band is computed as celestiary's surface does it.
   *
   * Runs in the stencil the day frame left in _cesiumRT (only its colour is
   * cleared), after the day decode, since that wrote the terrain's depth,
   * which the stencil shell's depth test would hit.  Skipped where it can't
   * show (_lightsShow).
   *
   * @param {object} sceneRT
   * @param {object} cesiumRT
   * @param {string} name
   * @param {object} node The body's node
   */
  _drawNightLights(sceneRT, cesiumRT, name, node) {
    const body = this.bodies[name]
    if (!this._lightsShow(body)) {
      return
    }
    const {renderer, camera} = this.ui
    const {Cesium, widget} = body
    const {globe} = widget.scene
    const layers = widget.imageryLayers
    // Only the night layer, unlit, on black: the others are skipped, not
    // hidden, so their tiles stay loaded for the day frame.
    const alphas = []
    for (let i = 0; i < layers.length; i++) {
      const layer = layers.get(i)
      alphas.push([layer, layer.alpha])
      layer.alpha = layer === body.night ? 1 : 0
    }
    const baseColor = globe.baseColor
    globe.baseColor = Cesium.Color.BLACK
    globe.enableLighting = false
    // The city black, not hidden: its buildings must hide the imagery's
    // lights on the ground under and behind them.  Hidden, the globe's
    // lights drew in the city's pixels (the day frame's stencil), Black
    // Marble's ~500 m texels seen through the buildings: blocky blue bands
    // on the facades at night's gain (CESIUM.md, "New York", the night's
    // bands).  Its own lights don't fit this frame yet (what's left).
    // `_newYorkLightsHidden` puts back the old way, for newYorkDebug's A/B.
    const city = name === 'earth' ? this._newYork?.city : null
    const hide = city && this._newYorkLightsHidden === true
    const cityShown = city?.renderer.show
    if (hide) {
      city.setShown(false)
    } else {
      city?.setOccluding?.(true)
    }
    renderer.setRenderTarget(cesiumRT)
    renderer.getClearColor(this._clearColor)
    const clearAlpha = renderer.getClearAlpha()
    renderer.setClearColor(0x000000, 0)
    renderer.clear(true, false, false)
    renderer.setClearColor(this._clearColor, clearAlpha)
    body.Cesium.Ellipsoid.default = body.ellipsoid
    try {
      body.link.frame(() => {
        body.widget.render()
      })
    } catch (err) {
      // The lights are an extra: without them the body's Cesium layer
      // stays, as the day frame already drew.
      console.warn(`[cesium layer] ${name} night lights pass failed; drawing no lights`, err)
      body.night = null
      return
    } finally {
      for (const [layer, alpha] of alphas) {
        layer.alpha = alpha
      }
      globe.baseColor = baseColor
      globe.enableLighting = true
      if (hide) {
        city.setShown(cityShown)
      } else {
        city?.setOccluding?.(false)
      }
    }
    renderer.resetState()

    // The decode: the body's sphere and the Sun in view space, for each
    // pixel's N·L.
    const u = this.lights.material.uniforms
    u.tCesium.value = cesiumRT.texture
    u.uHdr.value = this.ui.hdr === true ? 1 : 0
    u.uGain.value = nightLightRadiance() * renderer.toneMappingExposure
    u.uProjectionInverse.value.copy(camera.projectionMatrixInverse)
    node.getWorldPosition(this._lightsCenter)
    this._lightsSun.copy(this._sunPos).sub(this._lightsCenter).normalize()
        .transformDirection(camera.matrixWorldInverse)
    this._lightsCenter.applyMatrix4(camera.matrixWorldInverse)
    u.uCenter.value.copy(this._lightsCenter)
    u.uSun.value.copy(this._lightsSun)
    u.uRadius.value = node.props.radius.scalar
    renderer.setRenderTarget(sceneRT)
    const autoClear = renderer.autoClear
    renderer.autoClear = false
    renderer.render(this.lightsScene, this.decodeCamera)
    renderer.autoClear = autoClear
  }


  /**
   * Whether the night lights' frame can show this frame (CESIUM.md, "Night
   * lights", When).  Not where no ray in the frustum meets the night side
   * (frames.nightInView, from _setCesiumView): the pass would add nothing.
   * Nor where the brightest light it could add, a full-white texel fully on
   * the night side (nightLightRadiance × the exposure: the pass's own gain),
   * is under half a display step: the atmosphere pass only dims it (T ≤ 1)
   * and the tone map's slope is at most 1, so no pixel moves by more than
   * one level of 255 (by day the lights are 4.5e-5 of a sunlit white).
   * Except on the frames the meter samples (ThreeUi.isMeterFrame, every
   * METER_EVERY_FRAMES): it takes the log of each pixel, and a light far
   * under a display step is still far over its floor on black ground, so the
   * gain would follow the lights' skipping.  Those frames draw them, and the
   * meter reads what it always did.
   *
   * @param {object} body
   * @returns {boolean}
   */
  _lightsShow(body) {
    if (!body?.night || !body.nightInView) {
      return false
    }
    const brightest = nightLightRadiance() * this.ui.renderer.toneMappingExposure
    return !(brightest < LIGHTS_DISPLAY_STEP) || this._meterFrame()
  }


  /**
   * @returns {boolean} Whether ThreeUi's meter samples this frame
   *   (ThreeUi.isMeterFrame, the one place that says so; the asynchronous
   *   readback reads that frame's pixels a frame or more later, but they are
   *   this frame's).  True when that's unknown.
   */
  _meterFrame() {
    return typeof this.ui.isMeterFrame === 'function' ? this.ui.isMeterFrame() : true
  }


  /**
   * @param {string} name
   * @returns {boolean} Whether the body's terrain depth becomes
   *   celestiary's this frame (_decodeInto), in place of its ground
   *   sphere's (_writeGroundDepths)
   */
  _terrainDepth(name) {
    return this.fadeOf(name) >= 1 &&
      (this.bodies[name]?.heightM ?? Infinity) < TERRAIN_DEPTH_MAX_HEIGHT_M
  }


  /**
   * Crossfade: over a body's Cesium layer as it takes over, draw
   * celestiary's own surface again, fading from opaque to clear (fadeOf).
   * The surface is hidden for the scene render (_hideSurface), so it's
   * drawn here alone, on FADE_LAYER with the scene's lights.
   *
   * @param {Array<{name: string, node: object}>} drawn
   */
  _drawFadingSurfaces(drawn) {
    const fading = drawn.filter(({name}) => this.fadeOf(name) < 1)
    if (fading.length === 0) {
      return
    }
    const {renderer, camera, scene} = this.ui
    if (!this._lightsInFadeLayer) {
      scene.traverse((obj) => {
        if (obj.isLight) {
          obj.layers.enable(FADE_LAYER)
        }
      })
      this._lightsInFadeLayer = true
    }
    renderer.setRenderTarget(this.ui._sceneRT)
    const autoClear = renderer.autoClear
    renderer.autoClear = false
    for (const {name, node} of fading) {
      const surface = node.getObjectByName(SURFACE_GROUP_NAME)
      if (!surface) {
        continue
      }
      const opacity = 1 - this.fadeOf(name)
      const restore = []
      surface.traverse((obj) => {
        // Meshes only: the group's guides (an AxesHelper inside the
        // planet) are hidden by the opaque surface, but not the fading one.
        if (!obj.isMesh) {
          return
        }
        obj.layers.enable(FADE_LAYER)
        for (const m of [obj.material ?? []].flat()) {
          restore.push([m, m.transparent, m.opacity])
          m.transparent = true
          m.opacity *= opacity
        }
      })
      const visible = surface.visible
      surface.visible = true
      camera.layers.set(FADE_LAYER)
      renderer.render(scene, camera)
      camera.layers.set(0)
      surface.visible = visible
      for (const [m, transparent, o] of restore) {
        m.transparent = transparent
        m.opacity = o
      }
    }
    renderer.autoClear = autoClear
  }


  /**
   * @param {string} name
   * @param {object} node
   * @param {boolean} unseen Render Cesium's frame, so its tiles stream, but
   *   show none of it: without the stencil shell, no pixel admits it.
   */
  _compositeBody(name, node, unseen = false) {
    const body = this.bodies[name]
    const {renderer, camera} = this.ui

    // 1. Stencil = 1 wherever the body's (atmosphere-sized) ellipsoid is
    // visible past celestiary's own geometry.
    if (!unseen) {
      const {radii: [rx, ry, rz], shellScale: s} = CESIUM_BODIES[name]
      // ECEF (x, y, z) radii → body frame (x, z, y); see frames.js.
      this.shell.matrix.copy(node.matrixWorld).multiply(this._shellScale.makeScale(rx * s, rz * s, ry * s))
      this.shell.matrixWorldNeedsUpdate = true
      const autoClear = renderer.autoClear
      renderer.autoClear = false
      perf.begin('cesium.shell')
      renderer.render(this.shellScene, camera)
      perf.end('cesium.shell')
      renderer.autoClear = autoClear
    }

    // 2. Cesium, from celestiary's camera, into the stencilled pixels.
    if (body.remote) {
      // A guest page's frames, as they came: this frame's view's, or, if
      // it's still out, the last one again (the receiver's re-run).
      perf.begin('cesium.replay')
      body.receiver.drain()
      perf.end('cesium.replay')
      renderer.resetState()
      // In step: this frame drew the guest's frame of this frame's view.
      body.steps.drawn++
      if (body.receiver.drainedViews.at(-1) === body.posted) {
        body.steps.inStep++
      }
      return
    }
    this._setCesiumView(name, body, node)
    const sky = body.widget.scene.skyAtmosphere
    if (sky && CESIUM_BODIES[name].atmosphere) {
      // Crossfade Cesium's sky in (off the body's disc, where celestiary's
      // surface doesn't cover it): -1 is black, and so transparent.
      sky.brightnessShift = this.fadeOf(name) - 1
    }
    // Ellipsoid.default is global and read lazily all over Cesium; with more
    // than one body's widget in the page, it must be this body's while it
    // renders.
    body.Cesium.Ellipsoid.default = body.ellipsoid
    try {
      perf.begin('cesium.replay')
      body.link.frame(() => {
        body.widget.resize()
        body.widget.render()
      })
      perf.end('cesium.replay')
      body.frames = (body.frames ?? 0) + 1
    } catch (err) {
      this._fail(name, err)
    }
    renderer.resetState()
  }


  /**
   * @param {object} node A body's rotating node
   * @returns {number} How much of the body's atmosphere its Cesium layer
   *   draws, 0 to 1: 0 when it doesn't (celestiary's pass draws it all),
   *   rising to 1 over the crossfade as the layer takes over.
   */
  atmosphereShare(node) {
    const a = node === null ? null : this.active.find((x) => x.node === node)
    return a && CESIUM_BODIES[a.name].atmosphere ? this.fadeOf(a.name) : 0
  }


  /**
   * Height of the terrain under the camera over the body's sphere (which
   * matches its height over Cesium's ellipsoid: ellipsoidCameraPosition),
   * for zoom and the camera's ground floor.  Sampled every GROUND_SAMPLE_MS
   * while the camera is within GROUND_SAMPLE_BELOW_M of the surface.
   *
   * @param {object} node A body's rotating node
   * @returns {number|null} Metres, or null when no active layer knows it
   */
  groundHeight(node) {
    const a = this.active.find((x) => x.node === node)
    return a ? this.bodies[a.name]?.groundHeight ?? null : null
  }


  /**
   * Whether the terrain height under the camera is still to come: the
   * body's Cesium layer is wanted (isCesiumBody, and chosen) and hasn't
   * failed, and no height is known yet (the layer is loading, or loaded
   * but not active until its tiles for the view are in).  The camera's
   * ground floor (ThreeUI._keepAboveGround) waits for it instead of lifting
   * a camera restored below the sphere (a permalink from Valles Marineris,
   * or the Dead Sea) to the sphere, where it then stayed, hundreds of
   * metres over the ground, once the terrain came in.
   *
   * @param {object} node A body's rotating node
   * @returns {boolean}
   */
  groundPending(node) {
    const name = node?.props?.name
    if (!name || !this._wanted(name) || this.groundHeight(node) !== null) {
      return false
    }
    return this.bodies[name]?.status !== 'error'
  }


  /**
   * @param {string} name
   * @returns {boolean} Whether the body's Cesium layer is to be drawn: the
   *   layers aren't suspended (the homepage), the body has one on offer
   *   (isCesiumBody) and the user's choice for it, or the default, is
   *   Cesium
   */
  _wanted(name) {
    return !this.suspended && isCesiumBody(name) && bodyLayer(this.ui.useStore?.getState()?.bodyLayers, name) === 'cesium'
  }


  /**
   * Height of the terrain at a point, for landing there: over the body's
   * sphere, as groundHeight.  From the tiles loaded so far, which may be
   * coarse; the ground floor refines it as the camera arrives.
   *
   * @param {object} node A body's rotating node
   * @param {number} lat Degrees
   * @param {number} lng Degrees, east-positive
   * @returns {number|null} Metres, or null when no active layer knows it
   */
  groundHeightAt(node, lat, lng) {
    const a = this.active.find((x) => x.node === node)
    const body = a && this.bodies[a.name]
    if (!body?.widget) {
      return null
    }
    const surface = bodyToEcef(latLngAltToBodyFixed(lat, lng, 0, node.props.radius.scalar))
    const carto = body.ellipsoid.cartesianToCartographic(new body.Cesium.Cartesian3(...surface))
    return carto ? terrainHeight(body, a.name, carto) : null
  }


  /**
   * @param {object} body
   * @param {string} name
   */
  _sampleGround(body, name) {
    sampleGround(body, name, this._now)
  }


  /**
   * @param {object} node A body's rotating node
   * @returns {boolean} Whether a Cesium layer draws it this frame
   */
  isActive(node) {
    return this.active.some((a) => a.node === node)
  }


  /**
   * @param {string} name
   * @returns {number} How far the body's crossfade from celestiary's
   *   surface to Cesium's has got, 0 to 1 over FADE_MS from when its tiles
   *   were in; 1 if it had none.
   */
  fadeOf(name) {
    const start = this.bodies[name]?.fadeStart
    return start === undefined ? 1 : Math.min(1, (this._now - start) / FADE_MS)
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
   * @returns {object} _cesiumRT: where Cesium's frames draw, the size of
   *   _sceneRT, 8-bit colour (what Cesium hands over is 8-bit already) and
   *   a depth-stencil texture like _sceneRT's, for the depth copy
   */
  _cesiumTarget() {
    const sceneRT = this.ui._sceneRT
    if (!this._cesiumRT) {
      // Nearest: the decode reads each texel as it is.  Filtered, a pixel
      // just off the terrain's edge read a sliver of its alpha, a distance
      // of ~0, and drew black, nearest the camera.
      const rt = new WebGLRenderTarget(sceneRT.width, sceneRT.height,
          {stencilBuffer: true, minFilter: NearestFilter, magFilter: NearestFilter})
      rt.depthTexture = new DepthTexture()
      rt.depthTexture.format = DepthStencilFormat
      rt.depthTexture.type = UnsignedInt248Type
      this._cesiumRT = rt
    }
    const rt = this._cesiumRT
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
    const distance = this._camPos.distanceTo(this._bodyPos) * fovScale(this.ui.camera)
    return distance < meshRange(target) ? name : null
  }


  /**
   * A Cesium body is drawn when it can show (CESIUM.md, "Activation"): in
   * range (see _nearBody), at least MIN_PIXEL_RADIUS in radius (smaller,
   * Cesium would draw nothing celestiary's own mesh doesn't), not hidden
   * behind another Cesium body's ground (from Earth's surface looking down,
   * the Moon under the horizon was drawn, 21 draws and 11 full-screen passes
   * in its shadow context and the replay), and in the camera's frustum
   * (not off-screen, nor behind the camera).
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
    if (distance * fovScale(camera) >= meshRange(node)) {
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
    if (this._occluded(name, radius)) {
      return null
    }
    this._viewProj.copy(camera.matrixWorld).invert().premultiply(camera.projectionMatrix)
    this._frustum.setFromProjectionMatrix(this._viewProj)
    return this._frustum.intersectsSphere(this._sphere.set(this._bodyPos, radius)) ? distance : null
  }


  /**
   * @param {string} name A Cesium body, its node's world position in
   *   _bodyPos and the camera's in _camPos (_visibleAt)
   * @param {number} radius Its stencil shell's radius
   * @returns {boolean} Whether another Cesium body's ground hides all of it
   *   (visibility.hiddenBehind): the Moon under Earth's horizon, Earth
   *   behind the Moon from its far side
   */
  _occluded(name, radius) {
    for (const other of Object.keys(CESIUM_BODIES)) {
      const node = other === name ? null : this.ui.sceneManager?.objects?.[other]
      const sphere = node?.props?.radius?.scalar
      if (!sphere) {
        continue
      }
      const ground = OCCLUDER_SCALE * Math.min(sphere, ...CESIUM_BODIES[other].radii)
      node.getWorldPosition(this._occluderPos)
      if (hiddenBehind(this._camPos, this._bodyPos, radius, this._occluderPos, ground)) {
        return true
      }
    }
    return false
  }


  /**
   * Hide the body's celestiary surface group.  Not its places: the labels
   * draw in the overlay pass after the composite, with no depth test and a
   * back-hemisphere discard, so they sit over Cesium's globe and drop off
   * its far side (#172).
   *
   * @param {object} node
   */
  _hideSurface(node) {
    const surface = node.getObjectByName(SURFACE_GROUP_NAME)
    if (!surface) {
      return
    }
    if (!this.hidden.has(surface)) {
      this.hidden.set(surface, surface.visible)
    }
    surface.visible = false
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
    const shown = this._creditedBody()
    if (shown === this._credited) {
      return
    }
    this._credited = shown
    this.credits.style.display = shown ? 'block' : 'none'
    // In full as a body comes into view, then just the logo.
    this._creditsReveal?.show(shown ?? null)
    for (const [name, body] of Object.entries(this.bodies)) {
      if (body.credits) {
        body.credits.style.display = name === shown ? 'block' : 'none'
      }
    }
  }


  /**
   * @returns {?string} the body whose credits show: the nearest active one
   *     with some of its ground in the frame, or null when there's none, as
   *     from the ground looking up into the sky (CESIUM.md, "Credits stand
   *     back"): no ion data on screen, and no bright logo over the stars.
   */
  _creditedBody() {
    const {camera} = this.ui
    camera.getWorldPosition(this._camPos)
    camera.getWorldDirection(this._viewDir)
    const half = halfDiagonal(camera.fov, camera.aspect)
    for (let i = this.active.length - 1; i >= 0; i--) {
      const {name, node} = this.active[i]
      const ground = node.props?.radius?.scalar ?? Math.min(...CESIUM_BODIES[name].radii)
      node.getWorldPosition(this._bodyPos)
      if (groundInView(this._camPos, this._viewDir, half, this._bodyPos, ground)) {
        return name
      }
    }
    return null
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
    const view = this._viewOf(name, node)
    applyView(body, view)
    if (name === 'earth') {
      this._updateNewYork(body, view.position)
    }
    this._sampleGround(body, name)
    // Whether any of the night side is in the frame, for the lights' pass
    // (_lightsShow): out to Cesium's shell, where its pixels end.
    const {camera} = this.ui
    const {radii, shellScale} = CESIUM_BODIES[name]
    body.nightInView = body.night ?
      nightInView(this._lastEcefView, camera.fov * toRad, camera.aspect, view.sunDirection, node.props.radius.scalar,
          shellScale * Math.max(...radii)) :
      false
  }


  /**
   * A body's view this frame, as plain data for cesiumBody.applyView: here,
   * or posted to the Cesium guest page.
   *
   * @param {string} name
   * @param {object} node The body's rotating node
   * @returns {object} See cesiumBody.applyView
   */
  _viewOf(name, node) {
    const {camera, width, height} = this.ui
    const view = cameraToEcefView(camera.matrixWorld, node.matrixWorld)
    this._lastEcefView = view
    // On the same ray from the body's centre, at the same height over
    // Cesium's ellipsoid as over celestiary's sphere (see
    // frames.ellipsoidCameraPosition).
    const {radii, shellScale} = CESIUM_BODIES[name]
    const position = ellipsoidCameraPosition(view.position, node.props.radius.scalar, radii)
    // The scale of the distance this frame carries in alpha (distance.js).
    const heightM = Math.hypot(...view.position) - node.props.radius.scalar
    // Cesium's default far plane (5e8 m) would clip the body from beyond
    // ~80 Earth radii; the layer is in range out to the mesh range.
    const bodyExtent = 2 * shellScale * Math.max(...radii)
    const fovyRad = camera.fov * toRad
    // Celestiary's Sun is at the world origin of its world group.
    this._sunPos.set(0, 0, 0)
    if (this.ui.scene?.getObjectByName) {
      const world = this.ui.scene.getObjectByName('WorldGroup')
      if (world) {
        world.getWorldPosition(this._sunPos)
      }
    }
    return {
      name,
      position,
      direction: view.direction,
      up: view.up,
      far: Math.max(DEFAULT_FAR, Math.hypot(...view.position) + bodyExtent),
      fov: cesiumFov(fovyRad, width / Math.max(1, height)),
      size: [width, height],
      // No finer detail than for pixels of MIN_PIXEL_ANGLE (detail.js): at a
      // telescope's field, Cesium asked for sub-metre tiles kilometres off
      // and ran the page out of memory (#176).
      detail: detailScale(fovyRad, height),
      fovyRad,
      heightM,
      distanceScale: distanceScale(heightM),
      sunDirection: sunLightDirectionEcef(node.matrixWorld, this._sunPos),
      month: this._month(),
      earthshine: CESIUM_BODIES[name].earthshine ? this._earthshineOf(node) : null,
    }
  }


  /**
   * The Moon's earthshine for its tileset's shader (sunlitShader): Earth's
   * direction in the Moon's ECEF frame, and its light there as a fraction
   * of the Sun's (lunarPhotometry.js earthshineFraction), from Earth's phase seen
   * from the Moon.  Needs the Sun's position, which _viewOf sets first.
   *
   * @param {object} node The Moon's node
   * @returns {{level: number, direction: Array<number>}|null} The light's
   *   level, and Earth's direction (ECEF), or null without Earth
   */
  _earthshineOf(node) {
    const earth = this.ui.sceneManager?.objects?.earth
    if (!earth) {
      return null
    }
    earth.getWorldPosition(this._earthPos)
    this._moonPos.setFromMatrixPosition(node.matrixWorld)
    this._toSun.copy(this._sunPos).sub(this._earthPos)
    this._toMoon.copy(this._moonPos).sub(this._earthPos)
    const level = earthshineFraction(this._toSun.angleTo(this._toMoon), this._toMoon.length())
    // The light's direction from Earth is the Moon's direction to Earth,
    // negated: sunLightDirectionEcef gives the direction light travels.
    const travel = sunLightDirectionEcef(node.matrixWorld, this._earthPos)
    return {level, direction: [-travel[0], -travel[1], -travel[2]]}
  }


  /**
   * Start loading the target's Cesium bodies (preloadNames) when it
   * changes, before they're in range: Cesium's import and the widget then
   * aren't what the approach waits on.
   *
   * @param {object} target
   * @param {function(string): boolean} wanted
   */
  _preload(target, wanted) {
    if (target === this._preloadedFor) {
      return
    }
    this._preloadedFor = target
    for (const name of preloadNames(target)) {
      if (wanted(name) && !this.bodies[name]) {
        this._load(name)
      }
    }
  }


  /**
   * Load Cesium and set up the body's widget and NetGL link; or, with a
   * guest page (?cesium=iframe), Earth's iframe and receiver (_loadGuest).
   *
   * @param {string} name
   */
  async _load(name) {
    if (this.guestPage && name === 'earth') {
      await this._loadGuest(name)
      return
    }
    this.bodies[name] = {status: 'loading'}
    this._publishStatus(name, 'loading')
    try {
      window.CESIUM_BASE_URL ??= new URL('cesium/', document.baseURI).href
      const [Cesium, netgl] = await Promise.all([
        import('cesium'),
        // The three-free entry: what the layers use is all there.
        import('@pablo-mayrgundter/portal-netgl/core'),
      ])
      this.bodies[name] = Object.assign(this._createWidget(name, Cesium, netgl), {status: 'ready'})
      this._publishStatus(name, 'ready')
    } catch (err) {
      this._fail(name, err)
    }
  }


  /**
   * The body's Cesium on a page of its own (design/CesiumGuest.md): an
   * iframe on the guest page's origin, a NetGL receiver for its frames,
   * and its status by message.  Ready once the guest's handshake is in.
   *
   * @param {string} name
   */
  async _loadGuest(name) {
    this.bodies[name] = {status: 'loading'}
    this._publishStatus(name, 'loading')
    let netgl
    try {
      netgl = await import('@pablo-mayrgundter/portal-netgl/core')
    } catch (err) {
      this._fail(name, err)
      return
    }
    const page = new URL(this.guestPage)
    page.searchParams.set('body', name)
    page.searchParams.set('month', String(this._month()))
    page.searchParams.set('data', absoluteUrl(dataUrl('')))
    page.searchParams.set('host', location.origin)
    const iframe = document.createElement('iframe')
    // Laid out at the frame's size, but not seen: the guest's Cesium sizes
    // its canvas from its page (display: none would give it none).
    Object.assign(iframe.style, {
      position: 'fixed', left: '0', top: '0', border: '0', visibility: 'hidden', pointerEvents: 'none', zIndex: '-1',
      width: `${this.ui.width}px`, height: `${this.ui.height}px`,
    })
    iframe.src = page.href
    document.body.appendChild(iframe)
    const body = {
      status: 'loading', remote: true, name, iframe, frames: 0, tilesLoaded: false, groundHeight: null,
      waiting: null, posted: null, postedAt: 0, holdUntil: 0, size: null, credits: this._creditsFor(),
      // Frames drawn, those in step with their view, and the guest's
      // round trips (a view posted to its frame in), for design/CesiumGuest.md.
      steps: {drawn: 0, inStep: 0, trips: 0, tripMs: 0},
    }
    this.bodies[name] = body
    const own = () => this.bodies[name] === body
    const {renderer} = this.ui
    body.receiver = netgl.makeNetGLHostReceiver({
      gl: renderer.getContext(),
      // Pinned to the guest page's origin: the receiver may hand it a port.
      transport: netgl.iframeTransport(iframe, {origin: page.origin}),
      wire: 2,
      replay: this._replayConfig(() => body.size),
      onReady: () => {
        if (own() && body.status === 'loading') {
          body.status = 'ready'
          this._publishStatus(name, 'ready')
        }
      },
      onControl: (msg) => own() && this._onGuestMessage(name, body, msg),
      onError: (err) => console.warn('[cesium layer] replay error:', err),
    })
    body.receiver.onFrame((end) => {
      if (!own()) {
        return
      }
      body.frames++
      if (end.viewId === undefined || end.viewId === body.waiting) {
        body.steps.trips++
        body.steps.tripMs += performance.now() - body.postedAt
        body.waiting = null
        this.ui.resumeFrame?.()
      }
    })
  }


  /**
   * A guest page's own messages: its status after each frame, or its
   * failure.
   *
   * @param {string} name
   * @param {object} body
   * @param {object} msg
   */
  _onGuestMessage(name, body, msg) {
    if (msg?.type === 'cesium:status') {
      body.tilesLoaded = msg.tilesLoaded === true
      body.groundHeight = Number.isFinite(msg.groundHeight) ? msg.groundHeight : null
      if (msg.credits) {
        showCredits(body.credits, sanitizeCredits(msg.credits))
      }
    } else if (msg?.type === 'cesium:error') {
      this._fail(name, new Error(`the Cesium guest page failed: ${String(msg.message).slice(0, 300)}`))
    }
  }


  /**
   * How a body's Cesium frames replay into celestiary's context, from this
   * page's Cesium or a guest page's alike.
   *
   * @param {function(): ?Array<number>} canvasSize The guest canvas's
   *   drawing buffer [w, h], for mapping its viewport onto _cesiumRT
   * @returns {object} portal-netgl's replay config
   */
  _replayConfig(canvasSize) {
    const {renderer} = this.ui
    return {
      // Cesium's "screen" is _cesiumRT, which composite() then brings into
      // celestiary's scene render target.
      screenFramebuffer: () => renderer.properties.get(this._cesiumTarget()).__webglFramebuffer,
      remapScreenViewport: (x, y, w, h) => {
        const size = canvasSize()
        const target = this._cesiumRT
        if (!size?.[0] || !size?.[1] || !target) {
          return null
        }
        const sx = target.width / size[0]
        const sy = target.height / size[1]
        return [Math.round(x * sx), Math.round(y * sy), Math.round(w * sx), Math.round(h * sy)]
      },
      screen: {stencil: {ref: STENCIL_REF}, blend: 'premultiplied-over', clear: 'depth-only'},
    }
  }


  /**
   * A body's credits' element, under the one container they share; made
   * with the first.  _showCredits shows the active body's.
   *
   * @returns {HTMLElement}
   */
  _creditsFor() {
    if (!this.credits) {
      this.credits = document.createElement('div')
      this.credits.id = 'cesium-credits'
      Object.assign(this.credits.style, {
        // Above the widgets drawer's sheet, the info panel's and the dock (a phone's).
        position: 'fixed', bottom: 'calc(0.5em + var(--sheet-height, 0px) + var(--info-sheet-bottom, 0px) + var(--phone-dock-height, 0px))',
        left: '50%', transform: 'translateX(-50%)',
        fontSize: '11px', color: '#aaa', display: 'none', zIndex: '10',
        // HTML chrome: 'v' hides it with the other panels (Celestiary
        // _toggleNav sets visibility; _showCredits owns display).
        visibility: this.ui.sceneManager?.getSetting?.('v') === false ? 'hidden' : '',
      })
      document.body.appendChild(this.credits)
      this._creditsReveal = new CreditsReveal(this.credits)
    }
    const credits = document.createElement('div')
    credits.style.display = 'none'
    this.credits.appendChild(credits)
    return credits
  }


  /**
   * @param {string} name
   * @param {object} Cesium
   * @param {object} netgl
   * @returns {object}
   */
  _createWidget(name, Cesium, netgl) {
    const {renderer} = this.ui
    const container = document.createElement('div')
    // Hidden but laid out: Cesium sizes its canvas from its container.
    Object.assign(container.style, {
      position: 'fixed', left: '0', top: '0', visibility: 'hidden', pointerEvents: 'none', zIndex: '-1',
      width: `${this.ui.width}px`, height: `${this.ui.height}px`,
    })
    document.body.appendChild(container)
    const credits = this._creditsFor()

    let widget = null
    const link = netgl.makeNetGLImmediateLink({
      gl: renderer.getContext(),
      replay: this._replayConfig(() => (widget?.canvas ? [widget.canvas.width, widget.canvas.height] : null)),
      onError: (err) => console.warn('[cesium layer] replay error:', err),
    })
    const guest = netgl.makeNetGLCesiumGuest({transport: link.transport, webgl: {alpha: true}, shadowDraws: this.shadowDraws})
    const body = createWidget(Cesium, name, {
      container,
      contextOptions: guest.contextOptions,
      creditContainer: credits,
      month: this._month(),
      token: ionToken(),
      onError: (err) => this._fail(name, err),
    })
    widget = body.widget
    guest.attach(widget.scene)
    perf.attachCesium(name, link, guest)
    return Object.assign(body, {netgl, link, guest, container})
  }


  /**
   * Slop New York (CESIUM.md, "New York"): load it the first time the camera
   * is over Manhattan with the switch on (newYorkRange 'show': within tens of
   * km, low enough for buildings), draw it from there, stop drawing it
   * farther out, and free it far away.  Freed too when the switch, Earth's
   * Cesium layer or the widget goes (beforeRender, _fail).
   *
   * @param {object} body Earth's
   * @param {Array<number>} positionEcef Cesium's camera position this frame
   */
  _updateNewYork(body, positionEcef) {
    const range = newYorkRange(positionEcef, body.heightM)
    this._newYorkRange = range
    if (!this.newYork.enabled) {
      return
    }
    const nyc = this._newYork
    if (!nyc) {
      if (range === 'show') {
        this._loadNewYork(body)
      }
      return
    }
    if (range === 'free') {
      this._freeNewYork()
    } else if (nyc.status === 'ready') {
      nyc.city.setShown(range === 'show')
      nyc.city.update()
    }
  }


  /**
   * @param {object} body Earth's, ready
   */
  async _loadNewYork(body) {
    const nyc = {status: 'loading', city: null}
    this._newYork = nyc
    try {
      const {createNewYork} = await import('./newYorkGuest.js')
      const city = await createNewYork({
        Cesium: body.Cesium, netgl: body.netgl, widget: body.widget,
        guestBase: this.newYork.guestBase, shadows: this.newYork.shadows, lean: this.newYork.lean,
        cesiumShadow: body.guest?.core?.shadow,
      })
      if (this._newYork !== nyc) {
        // Freed while it loaded.
        city.dispose()
        return
      }
      nyc.city = city
      nyc.status = 'ready'
    } catch (err) {
      // Not retried this page: Earth's layer carries on without it.
      console.warn('[new york] the city failed to load; Earth\'s layer carries on without it', err)
      if (this._newYork === nyc) {
        nyc.status = 'error'
      }
    }
  }


  /** Stop and free the city, if it's loaded or loading. */
  _freeNewYork() {
    const nyc = this._newYork
    this._newYork = null
    nyc?.city?.dispose()
  }


  /**
   * Turn the New York switch on or off for the page (`?nyc=1` turns it on
   * at load); off stops and frees the city.
   *
   * @param {boolean} on
   */
  setNewYork(on) {
    this.newYork.enabled = on
    if (!on) {
      this._freeNewYork()
    }
    const store = this.ui.useStore?.getState()
    if (store?.setNewYorkOn && store.newYorkOn !== on) {
      store.setNewYorkOn(on)
    }
  }


  /**
   * A console diagnostic of the city on a real GPU (newYorkDebug.js; CESIUM.md,
   * "New York", found on a real GPU): `c.ui.layers.newYorkDebug()` watches
   * `seconds` of the app's frames, logs the report as JSON and returns it.
   *
   * @param {object} [options] {seconds}, default 10
   * @returns {Promise<object>}
   */
  async newYorkDebug(options) {
    const {runNewYorkDebug} = await import('./newYorkDebug.js')
    const report = await runNewYorkDebug(this, options)
    console.log(`[new york] debug: ${JSON.stringify(report)}`)
    return report
  }


  /**
   * Follow the store's switch (the layers control's toggle, the permalink's
   * `layers:nyc`).  `?nyc=1` turns it on in the store, once, on the first
   * frame with a store.  Without a store (tests, a page without the app's
   * chrome) the page's switch stands alone.
   *
   * @param {object} [store] The store's state this frame
   */
  _syncNewYork(store) {
    if (typeof store?.setNewYorkOn !== 'function') {
      return
    }
    if (this._newYorkFromUrl) {
      this._newYorkFromUrl = false
      if (this.newYork.enabled && store.newYorkOn !== true) {
        store.setNewYorkOn(true)
        return
      }
    }
    const on = store.newYorkOn === true
    if (on !== this.newYork.enabled) {
      this.setNewYork(on)
    }
  }


  /**
   * Publish for the layers control whether the city can show from here
   * (Earth's Cesium layer in use, the camera in the city's range: 'show') and
   * its load state, when either changes.  In use is active or warming: loaded
   * and wanted, its tiles for the view perhaps not in yet (on a slow GPU
   * that lasts; the city loads meanwhile and shows with the layer).
   *
   * @param {object} [store] The store's state this frame
   */
  _publishNewYork(store) {
    const isEarth = (a) => a.name === 'earth'
    const earthInUse = this.active.some(isEarth) || this.warming.some(isEarth)
    if (!earthInUse) {
      this._newYorkRange = null
    }
    if (typeof store?.setNewYorkState !== 'function') {
      return
    }
    const near = earthInUse && this._newYorkRange === 'show'
    const status = newYorkStatus(this._newYork)
    if (store.newYorkNear !== near || store.newYorkStatus !== status) {
      store.setNewYorkState({near, status})
    }
  }


  /**
   * Ask ion for a globe's detail imagery (Bing) once the camera is near
   * enough to need it, and not before: ion bills the imagery by sessions,
   * one for every viewer that requests it, and the bundled Blue Marble is
   * all the globe shows from afar (CESIUM.md, "Cesium ion sessions").  It is
   * requested once and kept for the page's life, under the altitude where a
   * base texel spans more than MAX_BASE_TEXEL_PX pixels (ionImagery.js).
   * (The terrain isn't deferred: see _createWidget.)
   *
   * @param {string} name
   * @param {object} body
   * @param {number} fovyRad The camera's vertical field of view, radians
   * @param {number} heightPx The canvas's height, CSS pixels
   */
  _requestIon(name, body, fovyRad, heightPx) {
    requestIon(body, name, fovyRad, heightPx)
  }


  /** @returns {number} The simulation date's month, 1-12 */
  _month() {
    const jd = this.time?.simTimeJulianDay()
    return jd === undefined ? new Date().getUTCMonth() + 1 : monthOfJulianDay(jd)
  }


  /**
   * Keep a body's monthly base imagery on the simulation date's month.  The
   * new month's layer goes in above the old one, which is removed once the
   * globe's tiles are in again, so the globe never shows without imagery.
   *
   * @param {object} body
   * @param {object} config
   */
  _updateMonthlyImagery(body, config) {
    updateMonthlyImagery(body, config, this._month())
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
    if (name === 'earth') {
      this._freeNewYork()
    }
    this.bodies[name]?.credits?.remove()
    this.bodies[name]?.iframe?.remove()
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
 * The decode's scale from a body's Cesium frame (stored value × Lambert)
 * into _sceneRT's units: DISPLAY_GAIN, as celestiary's own surfaces, and
 * the body's imagery against celestiary's texture (bodies.js textureGain,
 * imageryScale).
 *
 * @param {string} name
 * @returns {number}
 */
export function bodyGain(name) {
  const config = CESIUM_BODIES[name] ?? {}
  return DISPLAY_GAIN * (config.textureGain ?? 1) / (config.imageryScale ?? 1)
}


/**
 * @returns {object} The ShaderMaterial of the night lights' decode
 *   (_drawNightLights): the lights frame (the layer's stored values on
 *   black, opaque where the globe is) into _sceneRT, added, as emitted
 *   light in exposure units.  Each pixel's N·L comes from the view ray
 *   against the body's sphere, and the band from it as celestiary's surface
 *   shader has it, `smoothstep(-0.05, 0.05, -N·L)` (Planet.js), so the two
 *   sides of the swap light the same ground alike.
 */
function newLightsMaterial() {
  return new ShaderMaterial({
    uniforms: {
      tCesium: {value: null},
      uHdr: {value: 1},
      // nightLightRadiance() × the renderer's exposure.
      uGain: {value: 0},
      uProjectionInverse: {value: new Matrix4()},
      uCenter: {value: new Vector3()},
      uSun: {value: new Vector3(0, 0, -1)},
      uRadius: {value: 1},
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }`,
    fragmentShader: `
      uniform sampler2D tCesium;
      uniform float uHdr;
      uniform float uGain;
      uniform mat4 uProjectionInverse;
      uniform vec3 uCenter;
      uniform vec3 uSun;
      uniform float uRadius;
      varying vec2 vUv;
      ${NEUTRAL_GLSL}
      void main() {
        vec4 c = texture2D(tCesium, vUv);
        if (c.a < 0.5 / 255.0) discard;
        // The view ray's first hit on the body's sphere, or where it passes
        // nearest (a limb pixel of the ellipsoid, a ridge over the horizon).
        vec4 v = uProjectionInverse * vec4(vUv * 2.0 - 1.0, -1.0, 1.0);
        vec3 dir = normalize(v.xyz / v.w);
        float along = dot(uCenter, dir);
        float miss = dot(uCenter, uCenter) - along * along;
        float chord = sqrt(max(uRadius * uRadius - miss, 0.0));
        float t = along - chord;
        if (t < 0.0) t = along + chord;
        vec3 normal = normalize(dir * max(t, 0.0) - uCenter);
        float nightFactor = smoothstep(-${NIGHT_LIGHT_EDGE.toFixed(2)}, ${NIGHT_LIGHT_EDGE.toFixed(2)}, -dot(normal, uSun));
        vec3 rgb = min(c.rgb * nightFactor * uGain, vec3(${HDR_MAX_VALUE.toFixed(1)}));
        if (uHdr < 0.5) {
          rgb = neutralToneMap(rgb);
        }
        gl_FragColor = vec4(rgb, 1.0);
      }`,
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: OneFactor,
    blendDst: OneFactor,
    blendSrcAlpha: ZeroFactor,
    blendDstAlpha: OneFactor,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    toneMapped: false,
  })
}


/**
 * @returns {object} The ShaderMaterial of composite's decode pass: _cesiumRT
 *   (transparent black where Cesium drew nothing) into _sceneRT, scaled by
 *   the body's gain (bodyGain).
 */
function newDecodeMaterial() {
  return new ShaderMaterial({
    uniforms: {
      tCesium: {value: null},
      uHdr: {value: 1},
      uGain: {value: DISPLAY_GAIN},
      uDistanceScale: {value: 1},
      uLogEncoded: {value: 0},
      uProjection: {value: new Matrix4()},
      uProjectionInverse: {value: new Matrix4()},
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }`,
    fragmentShader: `
      uniform sampler2D tCesium;
      uniform float uHdr;
      uniform float uGain;
      uniform float uDistanceScale;
      uniform float uLogEncoded;
      uniform mat4 uProjection;
      uniform mat4 uProjectionInverse;
      varying vec2 vUv;
      ${NEUTRAL_GLSL}
      ${DECODE_DISTANCE_GLSL}
      ${LOG_DECODE_GLSL}
      void main() {
        vec4 c = texture2D(tCesium, vUv);
        if (c.a < 0.5 / 255.0) discard;
        // Every body's frame: stored value × Lambert, opaque, its distance
        // in alpha (distance.js).  Into the HDR buffer scaled by the body's
        // gain; into the LDR fallback's display values, tone-mapped too.
        // A tileset's frame comes log-encoded (encoding.js); a globe's linear.
        vec3 stored = uLogEncoded > 0.5 ? cesiumLogDecode(c.rgb) : c.rgb;
        vec3 rgb = min(stored * uGain, vec3(${HDR_MAX_VALUE.toFixed(1)}));
        if (uHdr < 0.5) {
          rgb = neutralToneMap(rgb);
        }
        // The distance becomes this pixel's depth, for the atmosphere pass
        // (terrain above and below the sphere), written while depthWrite is
        // on (_decodeInto).
        vec4 v = uProjectionInverse * vec4(vUv * 2.0 - 1.0, -1.0, 1.0);
        vec3 dir = normalize(v.xyz / v.w);
        // At the encoding's limit the distance is "at least 5.5 D"
        // (distance.js MAX_U), and that is the depth: a surface that far,
        // which the pass hazes as one.  Not the ground sphere's depth where
        // the ray meets it (the first cut): from a few metres up that is a
        // few hundred metres off, and far mountains came out dark and near.
        float d = decodeDistance(c.a, uDistanceScale);
        vec4 clip = uProjection * vec4(dir * max(d, 1.0), 1.0);
        gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
        gl_FragColor = vec4(rgb, 1.0);
      }`,
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    blendSrcAlpha: OneFactor,
    blendDstAlpha: OneMinusSrcAlphaFactor,
    // Always passes: where Cesium's frame has a pixel, its stencil shell
    // already passed celestiary's depth (_blitDepth), so nothing celestiary
    // drew is nearer there.  A real test failed wherever a line or point
    // behind the body had written a depth nearer than the one decoded
    // (from space, the far plane), and drew it over the globe.  On only
    // so the depth can be written, for bodies that carry a distance
    // (_decodeInto).
    depthTest: true,
    depthFunc: AlwaysDepth,
    depthWrite: false,
    transparent: true,
    toneMapped: false,
  })
}


const STENCIL_REF = 1
// How long a frame waits for a guest page's frame of its view, ms, before
// it's drawn with the last one (CesiumLayers.awaitingGuests).
const GUEST_WAIT_MS = 100
// Smallest on-screen radius, in pixels, at which a body is drawn by Cesium:
// under a few pixels across, celestiary's own mesh shows the same.
const MIN_PIXEL_RADIUS = 2
// The night lights' frame is skipped when the brightest light it could add,
// in exposure units, is under this: half a display step (_lightsShow).
const LIGHTS_DISPLAY_STEP = 0.5 / 255
// The crossfade from celestiary's surface to Cesium's, ms.
const FADE_MS = 1000
// Highest camera, over the surface, m, at which the terrain's distance
// becomes celestiary's depth (_decodeInto).  Higher, a ridge over the
// sphere's horizon is hundreds of km off and a pixel or two high, and 8
// bits over the ground in view are too coarse: from 37 km up, steps of
// several km at the ground showed as rings of speckle in its haze.
const TERRAIN_DEPTH_MAX_HEIGHT_M = 2e4
// Planet.newPlanet's LOD: the body's mesh, then a point, then nothing.
const PLANET_LOD_NAME = 'planet LOD'
// The lazily-added near shape of a Planet (Planet.nearShape).
const SURFACE_GROUP_NAME = 'planet surface and guides'


/**
 * The Cesium bodies to start loading when a body is targeted: the target
 * and its parent, since from the Moon or Phobos their planet is in view.
 *
 * @param {object} target A body's rotating node, with props.name and
 *   props.parent
 * @returns {Array<string>}
 */
export function preloadNames(target) {
  const props = target?.props
  return [props?.name, props?.parent].filter((name) => Object.hasOwn(CESIUM_BODIES, name ?? ''))
}


/**
 * How far out celestiary draws the body as a mesh rather than a point: the
 * distance at which its 'planet LOD' (Planet.newPlanet) swaps in the next
 * level, at INITIAL_FOV: callers scale the camera distance by `fovScale`.
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


/**
 * Draw a guest page's credits (credits.js) with this page's own elements.
 *
 * @param {HTMLElement} el The body's credits' element
 * @param {Array<{text?: string, href?: string, img?: string}>} items Sanitized
 */
export function showCredits(el, items) {
  el.replaceChildren()
  items.forEach((item, i) => {
    if (i > 0) {
      el.append(' \u2022 ')
    }
    let node
    if (item.img) {
      node = document.createElement('img')
      node.src = item.img
      node.alt = item.text ?? ''
      node.style.height = '1.6em'
      node.style.verticalAlign = 'middle'
    } else {
      node = document.createElement('span')
      node.textContent = item.text
    }
    if (item.href) {
      const a = document.createElement('a')
      a.href = item.href
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      a.style.color = 'inherit'
      a.append(node)
      node = a
    }
    el.append(node)
  })
}
