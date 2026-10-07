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
import {dataUrl, isAbsoluteUrl} from '../../dataUrl.js'
import {DISPLAY_GAIN, FADE_LAYER, toRad} from '../../shared.js'
import {bodyLayer} from '../../store/LayersSlice.js'
import {CESIUM_BODIES, ionToken, isCesiumBody} from './bodies.js'
import {
  bodyToEcef,
  cameraToEcefView,
  cesiumFov,
  ellipsoidCameraPosition,
  NIGHT_LIGHT_EDGE,
  nightInView,
  sunLightDirectionEcef,
} from './frames.js'
import {hiddenBehind, OCCLUDER_SCALE} from './visibility.js'
import {fovScale} from '../farPoint.js'
import {nightLightRadiance} from '../exposure.js'
import {HDR_MAX_VALUE, NEUTRAL_GLSL} from '../hdr.js'
import {DECODE_DISTANCE_GLSL, DISTANCE_SCALE_M, DISTANCE_STAGE_GLSL, distanceScale} from './distance.js'
import {detailScale} from './detail.js'
import {baseTexelMeters, ionImageryAltitude} from './ionImagery.js'
import {latLngAltToBodyFixed} from '../../coords.js'
import {perf} from '../../perf/perf.js'
import {monthOfJulianDay, monthlyPath} from '../monthly.js'


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
    // Celestiary's simulation clock (Time), for monthly imagery; set by
    // Celestiary.  Without it, today's month.
    this.time = null

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
    this._occluderPos = new Vector3()
    this._sunPos = new Vector3()
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
      if (!body.shown && tilesReady(body)) {
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
   *   body has one on offer (isCesiumBody) and the user's choice for it, or
   *   the default, is Cesium
   */
  _wanted(name) {
    return isCesiumBody(name) && bodyLayer(this.ui.useStore?.getState()?.bodyLayers, name) === 'cesium'
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
    if (this._now - (body.groundAt ?? -Infinity) < GROUND_SAMPLE_MS) {
      return
    }
    body.groundAt = this._now
    const carto = body.ellipsoid.cartesianToCartographic(body.widget.scene.camera.position)
    body.groundHeight = carto && carto.height < GROUND_SAMPLE_BELOW_M ? terrainHeight(body, name, carto) : null
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
    // The scale of the distance this frame carries in alpha (distance.js).
    body.heightM = Math.hypot(...view.position) - node.props.radius.scalar
    body.distanceScale = distanceScale(body.heightM)
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
    // No finer detail than for pixels of MIN_PIXEL_ANGLE (detail.js): at a
    // telescope's field, Cesium asked for sub-metre tiles kilometres off
    // and ran the page out of memory (#176).
    const detail = detailScale(camera.fov * toRad, canvas.clientHeight)
    if (widget.scene.globe) {
      widget.scene.globe.maximumScreenSpaceError = GLOBE_SCREEN_SPACE_ERROR * detail
    }
    if (body.tileset) {
      body.tileset.maximumScreenSpaceError = TILE_SCREEN_SPACE_ERROR * detail
    }
    this._requestIon(name, body, camera.fov * toRad, canvas.clientHeight)

    // Celestiary's Sun is at the world origin of its world group.
    this._sunPos.set(0, 0, 0)
    if (this.ui.scene?.getObjectByName) {
      const world = this.ui.scene.getObjectByName('WorldGroup')
      if (world) {
        world.getWorldPosition(this._sunPos)
      }
    }
    if (CESIUM_BODIES[name].monthlyImagery) {
      this._updateMonthlyImagery(body, CESIUM_BODIES[name])
    }
    this._sampleGround(body, name)

    const dir = sunLightDirectionEcef(node.matrixWorld, this._sunPos)
    widget.scene.light.direction = new Cesium.Cartesian3(...dir)
    // Whether any of the night side is in the frame, for the lights' pass
    // (_lightsShow): out to Cesium's shell, where its pixels end.
    body.nightInView = body.night ?
      nightInView(view, camera.fov * toRad, camera.aspect, dir, node.props.radius.scalar, shellScale * Math.max(...radii)) :
      false

    // Keep Cesium's canvas the size of celestiary's.
    const {width, height} = this.ui
    if (body.container.style.width !== `${width}px` || body.container.style.height !== `${height}px`) {
      body.container.style.width = `${width}px`
      body.container.style.height = `${height}px`
    }
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

    let widget = null
    const link = netgl.makeNetGLImmediateLink({
      gl: renderer.getContext(),
      replay: {
        // Cesium's "screen" is _cesiumRT, which composite() then brings into
        // celestiary's scene render target.
        screenFramebuffer: () => renderer.properties.get(this._cesiumTarget()).__webglFramebuffer,
        remapScreenViewport: (x, y, w, h) => {
          const canvas = widget?.canvas
          const target = this._cesiumRT
          if (!canvas?.width || !canvas?.height || !target) {
            return null
          }
          const sx = target.width / canvas.width
          const sy = target.height / canvas.height
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
      // The globe always starts on offline imagery and the plain ellipsoid,
      // so it draws whatever ion does (_requestIon): for Earth the month's
      // Blue Marble, bundled with celestiary; else Cesium's Natural Earth II.
      config.monthlyImagery ?
        {baseLayer: monthlyImageryLayer(Cesium, config.monthlyImagery, this._month())} :
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
        customShader: sunlitShader(Cesium, config.nightFloor ?? 0),
      })
          .then((tileset) => {
            widget.scene.primitives.add(tileset)
            if (this.bodies[name]) {
              this.bodies[name].tileset = tileset
            }
          })
          .catch((err) => this._fail(name, err))
    }
    const night = widget.scene.globe && config.nightImagery ?
      addNightLights(Cesium, widget, config.nightImagery) : null
    guest.attach(widget.scene)
    perf.attachCesium(name, link, guest)
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
    // Every body draws the same thing, whether Cesium loads it as a globe
    // (Earth: terrain and imagery) or as a 3D tileset (the Moon, Mars:
    // imagery baked in): its imagery's stored values × Lambert, at most 1,
    // which fits Cesium's 8-bit buffers, and its distance in alpha; the
    // composite's one decode scales it into _sceneRT (bodyGain), and
    // celestiary's atmosphere pass, where the body has one, hazes it.  A
    // globe that drew its own atmosphere (config.atmosphere; none does
    // now) would light at DISPLAY_GAIN, its own look.
    scene.light = new Cesium.DirectionalLight({
      direction: new Cesium.Cartesian3(1, 0, 0),
      intensity: config.atmosphere ? DISPLAY_GAIN : 1,
    })
    if (scene.globe) {
      scene.globe.enableLighting = true
      if (!config.atmosphere) {
        litSurfaceOnly(scene.globe)
        scene.fog.enabled = false
      }
      // The terrain's own depth for the distance stage: without
      // depthTestAgainstTerrain, Cesium clears a globe's depth after
      // drawing it and draws the ellipsoid's in its place, so the stage
      // read the ellipsoid, and the cleared far plane above its horizon,
      // where the ridges are.  A tileset keeps its own.
      scene.globe.depthTestAgainstTerrain = true
    }
    // Each pixel's distance, in alpha (distance.js).
    scene.postProcessStages.add(new Cesium.PostProcessStage({
      name: 'celestiary_distance',
      fragmentShader: DISTANCE_STAGE_GLSL,
      uniforms: {distanceScale: () => this.bodies[name]?.distanceScale ?? DISTANCE_SCALE_M},
    }))
    scene.atmosphere.dynamicLighting = Cesium.DynamicAtmosphereLightingType.SCENE_LIGHT
    if (scene.skyAtmosphere) {
      scene.skyAtmosphere.show = config.atmosphere
    }
    scene.renderError.addEventListener((_scene, err) => this._fail(name, err))

    // An ion globe (Earth, with a token) asks ion for its terrain and detail
    // imagery only once the camera is near (_requestIon), not here.
    const ion = token && !config.ionTileset ? {terrain: false, imagery: false} : null
    return {Cesium, widget, link, guest, container, ellipsoid, credits, night, ion, month: this._month()}
  }


  /**
   * Ask ion for a globe's World Terrain and detail imagery (Bing) once the
   * camera is near enough to need them, and not before: ion bills the
   * imagery by sessions, one for every viewer that requests it, and the
   * bundled Blue Marble is all the globe shows from afar (CESIUM.md, "Cesium
   * ion sessions").  Each is requested once and kept for the page's life.
   *
   * - Imagery: under the altitude where a base texel spans more than
   *   MAX_BASE_TEXEL_PX pixels (ionImagery.js).
   * - Terrain: the same, or under GROUND_SAMPLE_BELOW_M, where the camera's
   *   ground floor starts to sample it, whichever is higher.  (Billed by
   *   data, not sessions, so this one is only for the bytes.)
   *
   * @param {string} name
   * @param {object} body
   * @param {number} fovyRad The camera's vertical field of view, radians
   * @param {number} heightPx The canvas's height, CSS pixels
   */
  _requestIon(name, body, fovyRad, heightPx) {
    const {ion} = body
    if (!ion || (ion.terrain && ion.imagery)) {
      return
    }
    const config = CESIUM_BODIES[name]
    const imageryBelow = ionImageryAltitude(baseTexelMeters(config.monthlyImagery, config.radii[0]), fovyRad, heightPx)
    const {Cesium, widget} = body
    if (!ion.terrain && body.heightM < Math.max(imageryBelow, GROUND_SAMPLE_BELOW_M)) {
      ion.terrain = true
      addIonTerrain(Cesium, widget)
    }
    if (!ion.imagery && body.heightM < imageryBelow) {
      ion.imagery = true
      addIonImagery(Cesium, widget, config.detailFromLevel, body.night)
    }
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
    const {Cesium, widget} = body
    const layers = widget.imageryLayers
    if (body.oldBase && widget.scene.globe.tilesLoaded) {
      layers.remove(body.oldBase, true)
      body.oldBase = null
    }
    const month = this._month()
    if (month === body.month || body.oldBase) {
      return
    }
    body.month = month
    body.oldBase = layers.get(0)
    layers.add(monthlyImageryLayer(Cesium, config.monthlyImagery, month), 1)
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
 * What to say of an ion failure: its HTTP status, if it had one.  Not the
 * error itself: a RequestErrorEvent carries ion's response, and ion's error
 * bodies echo the access token.
 *
 * @param {object} err
 * @returns {string}
 */
function ionFailure(err) {
  const status = err?.statusCode ?? err?.error?.statusCode ?? err?.response?.statusCode
  return typeof status === 'number' ? `HTTP ${status}` : 'no answer'
}


/**
 * Upgrade the Earth globe to ion's World Terrain, once it has loaded.  If
 * the token can't reach the asset (no network, a token scoped to other
 * assets, a 401 or 403) the globe keeps the ellipsoid.  Handing
 * CesiumWidget `terrain: Terrain.fromWorldTerrain()` instead would unset the
 * globe's terrain until ion answered, and leave it unset on failure: an
 * empty globe.
 *
 * @param {object} Cesium
 * @param {object} widget
 */
function addIonTerrain(Cesium, widget) {
  Cesium.createWorldTerrainAsync({requestVertexNormals: true, requestWaterMask: true})
      .then((terrain) => {
        if (!widget.isDestroyed()) {
          widget.scene.globe.terrainProvider = terrain
        }
      })
      .catch((err) => console.warn(
          `[cesium layer] ion World Terrain unavailable (${ionFailure(err)}); using the ellipsoid`))
}


/**
 * Add ion's world imagery (Bing, asset 2) to the Earth globe, as detail over
 * the base's: shown only from globe tile level `detailFromLevel`.  Calling
 * this opens an ion imagery session (billed), so the caller does it once,
 * and only when the base's texels would show (ionImagery.js).  If ion
 * can't give it (no network, a token scoped to other assets, a 401 or 403
 * from the token or the account's quota) the layer is removed and the base
 * imagery stays, with one line in the console and no error thrown.
 *
 * @param {object} Cesium
 * @param {object} widget
 * @param {number} [detailFromLevel]
 * @param {object} [above] An imagery layer to go under, if any (the night
 *   lights', which stays on top)
 */
function addIonImagery(Cesium, widget, detailFromLevel, above) {
  const imagery = Cesium.ImageryLayer.fromWorldImagery({minimumTerrainLevel: detailFromLevel})
  let dropped = false
  const drop = (why) => {
    if (dropped) {
      return
    }
    dropped = true
    console.warn(`[cesium layer] ion imagery unavailable (${why}); using the base imagery`)
    if (!widget.isDestroyed()) {
      widget.imageryLayers.remove(imagery)
    }
  }
  // The endpoint request failed: no provider.
  imagery.errorEvent.addEventListener((err) => drop(ionFailure(err)))
  // Tile errors from Bing's side: no retries, and a layer that is refused is
  // dropped, rather than failing tile by tile.
  imagery.readyEvent.addEventListener((provider) => {
    provider.errorEvent.addEventListener((err) => {
      err.retry = false
      const failure = ionFailure(err)
      if (failure === 'HTTP 401' || failure === 'HTTP 403') {
        drop(failure)
      }
    })
  })
  const layers = widget.imageryLayers
  const at = above ? layers.indexOf(above) : -1
  layers.add(imagery, at >= 0 ? at : undefined)
}


/**
 * Add a globe's night lights imagery layer, with alpha 0: its tiles load
 * and stay cached, and the day frame skips it (Cesium draws no layer at
 * alpha 0); _drawNightLights turns it on for its own frame.  On top of the
 * stack, though in its frame it is the only layer drawn.
 *
 * @param {object} Cesium
 * @param {object} widget
 * @param {object} imagery A body's nightImagery config (bodies.js)
 * @returns {object} Cesium.ImageryLayer
 */
function addNightLights(Cesium, widget, imagery) {
  const {url, tileSize, maximumLevel, credit} = imagery
  const layer = new Cesium.ImageryLayer(new Cesium.UrlTemplateImageryProvider({
    url,
    // GIBS's EPSG:3857 tile matrix set: one 256 px tile at level 0.
    tilingScheme: new Cesium.WebMercatorTilingScheme(),
    tileWidth: tileSize,
    tileHeight: tileSize,
    maximumLevel,
    credit,
  }), {alpha: 0})
  let warned = false
  layer.errorEvent.addEventListener((err) => {
    if (!warned) {
      warned = true
      console.warn('[cesium layer] night lights imagery unavailable (NASA GIBS); no lights on Cesium\'s Earth', err)
    }
  })
  widget.imageryLayers.add(layer)
  return layer
}


/**
 * Height over the ellipsoid of the loaded terrain (Earth's globe) or
 * surface tiles (the Moon's and Mars's tilesets) at a place.
 *
 * @param {object} body
 * @param {string} name
 * @param {object} carto Cesium.Cartographic; its height is ignored
 * @returns {number|null}
 */
function terrainHeight(body, name, carto) {
  const {Cesium, widget, tileset} = body
  const at = new Cesium.Cartographic(carto.longitude, carto.latitude, 0)
  try {
    Cesium.Ellipsoid.default = body.ellipsoid
    const h = CESIUM_BODIES[name].ionTileset ?
      tileset?.getHeight(at, widget.scene) :
      widget.scene.globe?.getHeight(at)
    return Number.isFinite(h) ? h : null
  } catch {
    // A pick over tiles still loading: no height this time.
    return null
  }
}


/**
 * @param {string} url Absolute, or relative to the page's base
 * @returns {string} Absolute
 */
function absoluteUrl(url) {
  return isAbsoluteUrl(url) ? url : new URL('.', document.baseURI).href + url
}


/**
 * @param {object} Cesium
 * @param {object} imagery A body's monthlyImagery config (bodies.js)
 * @param {number} month 1-12
 * @returns {object} Cesium.ImageryLayer
 */
function monthlyImageryLayer(Cesium, imagery, month) {
  const {url, tileSize, maximumLevel, credit} = imagery
  return new Cesium.ImageryLayer(new Cesium.UrlTemplateImageryProvider({
    // Cesium wants an absolute URL: the data base URL if the build has one
    // (DESIGN.md, data policy), else the page's base (celestiary may be
    // served under a path).  Not new URL(url, base), which escapes the
    // {z}/{x}/{y} placeholders.
    url: absoluteUrl(dataUrl(monthlyPath(url, month))),
    tilingScheme: new Cesium.GeographicTilingScheme(),
    tileWidth: tileSize,
    tileHeight: tileSize,
    maximumLevel,
    credit,
  }))
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
 * Lit as celestiary lights its own surfaces, so the two match across the
 * swap: celestiary scales the texture's stored (sRGB) values and
 * tone-maps them (PBR Neutral, three's and Cesium's alike) straight to the
 * screen, with no sRGB decode or encode.  Cesium hands the shader the
 * imagery decoded to linear and sRGB-encodes what it returns.  Lighting
 * that linear colour instead lifted the dark side and the terminator and
 * dimmed the day side (the Moon: 18 vs 0 at night, 122 vs 190 by the
 * limb, of 255).  So: back to stored values, light and tone-map there,
 * then decode for Cesium's encode to undo.
 *
 * @param {object} Cesium
 * @param {number} gain Brightness scale for the imagery (textureGain over
 *   imageryScale)
 * @returns {object} Cesium.CustomShader
 */
function sunlitShader(Cesium, nightFloor) {
  const f = (x) => x.toFixed(3)
  return new Cesium.CustomShader({
    lightingModel: Cesium.LightingModel.UNLIT,
    // Stored value × Lambert, as Earth's globe draws (litSurfaceOnly): the
    // texture's stored values, not Cesium's linear ones, lit; Cesium's
    // output encodes linear back to stored.
    fragmentShaderText: `
      void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
        vec3 up = czm_viewRotation * normalize(fsInput.attributes.positionWC);
        float lambert = max(dot(up, czm_lightDirectionEC), 0.0);
        float light = ${f(nightFloor)} + ${f(1 - nightFloor)} * lambert;
        material.diffuse = czm_srgbToLinear(czm_linearToSrgb(material.diffuse) * light);
      }`,
  })
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
 * Make a Cesium globe draw only its lit surface, as celestiary lights its
 * own: its imagery's stored values × Lambert (Cesium's defaults add 0.3 and
 * scale Lambert by 0.9), with no ground atmosphere (celestiary's atmosphere
 * pass draws it), lit at every distance (Cesium fades day-night shading out
 * below lightingFadeOutDistance, ~10,000 km from Earth's centre, and with it
 * the ground atmosphere).  With terrain normals (ion World Terrain) that's
 * Lambert on the terrain; on the plain ellipsoid, Cesium's day-night shading,
 * which is steeper than Lambert (5 × Lambert + 0.3, clamped).  No water
 * effect: its sun glint and sky reflection lit the sunward ocean up to
 * twice celestiary's (whose ocean shine is its own, Planet.md).
 *
 * @param {object} globe Cesium.Globe
 */
function litSurfaceOnly(globe) {
  globe.showGroundAtmosphere = false
  globe.showWaterEffect = false
  globe.lambertDiffuseMultiplier = 1
  globe.vertexShadowDarkness = 0
  globe.lightingFadeOutDistance = 0
  globe.lightingFadeInDistance = 1
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
      uniform mat4 uProjection;
      uniform mat4 uProjectionInverse;
      varying vec2 vUv;
      ${NEUTRAL_GLSL}
      ${DECODE_DISTANCE_GLSL}
      void main() {
        vec4 c = texture2D(tCesium, vUv);
        if (c.a < 0.5 / 255.0) discard;
        // Every body's frame: stored value × Lambert, opaque, its distance
        // in alpha (distance.js).  Into the HDR buffer scaled by the body's
        // gain; into the LDR fallback's display values, tone-mapped too.
        vec3 rgb = min(c.rgb * uGain, vec3(${HDR_MAX_VALUE.toFixed(1)}));
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
// Smallest on-screen radius, in pixels, at which a body is drawn by Cesium:
// under a few pixels across, celestiary's own mesh shows the same.
const MIN_PIXEL_RADIUS = 2
// The night lights' frame is skipped when the brightest light it could add,
// in exposure units, is under this: half a display step (_lightsShow).
const LIGHTS_DISPLAY_STEP = 0.5 / 255
// How often the terrain under the camera is sampled, ms, and from how high
// over the surface (Olympus Mons, the highest, is ~21 km over Mars's), m.
const GROUND_SAMPLE_MS = 200
const GROUND_SAMPLE_BELOW_M = 1e5
// ion tilesets' maximumScreenSpaceError, in pixels, and the globe's
// (Cesium's default), where a pixel spans MIN_PIXEL_ANGLE or more: every
// ordinary field of view (detail.js).
const TILE_SCREEN_SPACE_ERROR = 8
const GLOBE_SCREEN_SPACE_ERROR = 2
// The crossfade from celestiary's surface to Cesium's, ms.
const FADE_MS = 1000
// Highest camera, over the surface, m, at which the terrain's distance
// becomes celestiary's depth (_decodeInto).  Higher, a ridge over the
// sphere's horizon is hundreds of km off and a pixel or two high, and 8
// bits over the ground in view are too coarse: from 37 km up, steps of
// several km at the ground showed as rings of speckle in its haze.
const TERRAIN_DEPTH_MAX_HEIGHT_M = 2e4
// Cesium's default PerspectiveFrustum far plane, metres.
const DEFAULT_FAR = 5e8
// Planet.newPlanet's LOD: the body's mesh, then a point, then nothing.
const PLANET_LOD_NAME = 'planet LOD'
// The lazily-added near shape of a Planet (Planet.nearShape).
const SURFACE_GROUP_NAME = 'planet surface and guides'


/**
 * Whether Cesium has the tiles for its current view: the globe's (Earth),
 * or the ion tileset's (Moon, Mars; none until its metadata loads).  Only
 * after a rendered frame: until then the globe has queued no tiles, and
 * reads as loaded.
 *
 * @param {object} body A ready entry of CesiumLayers.bodies
 * @returns {boolean}
 */
export function tilesReady(body) {
  if (!(body.frames > 0)) {
    return false
  }
  const scene = body.widget?.scene
  if (scene?.globe) {
    return scene.globe.tilesLoaded
  }
  return body.tileset?.tilesLoaded === true
}


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
