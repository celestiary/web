import {dataUrl, isAbsoluteUrl} from '../../dataUrl.js'
import {DISPLAY_GAIN} from '../../shared.js'
import {CESIUM_BODIES} from './bodies.js'
import {DISTANCE_SCALE_M, DISTANCE_STAGE_GLSL} from './distance.js'
import {baseTexelMeters, ionImageryAltitude} from './ionImagery.js'
import {LOG_ENCODE_GLSL} from './encoding.js'
import {RELIEF_GLSL} from './relief.js'
import {LUNAR_PHOTOMETRY_GLSL} from '../lunarPhotometry.js'
import {monthlyPath} from '../monthly.js'
import {sharedObjectUrl} from '../sharedImage.js'


/**
 * A Cesium body: Cesium's widget for Earth, the Moon or Mars, and what is
 * done to it each frame, wherever Cesium runs.  Celestiary's page drives it
 * through a same-page NetGL link (CesiumLayers), and the Cesium guest page
 * through messages from celestiary in another origin (js/cesium-guest/;
 * design/CesiumGuest.md).  Either way the host computes a frame's view as
 * plain data (CesiumLayers._viewOf), and `applyView` sets it here.
 *
 * Nothing in this module knows celestiary's scene: a view is the camera in
 * the body's ECEF frame, Cesium's field of view and far plane, the size of
 * the frame, the Sun's direction, and the few numbers that steer what
 * Cesium loads (the detail scale, the camera's height, the month).
 */


/**
 * Make a body's Cesium widget, on offline imagery and the plain ellipsoid
 * (ion's terrain and imagery come later, if there's a token).
 *
 * @param {object} Cesium
 * @param {string} name A key of CESIUM_BODIES
 * @param {object} opts
 * @param {HTMLElement} opts.container Laid out at the frame's size (Cesium sizes its canvas from it)
 * @param {object} opts.contextOptions From portal-netgl's makeNetGLCesiumGuest
 * @param {HTMLElement} opts.creditContainer Where Cesium writes the body's credits
 * @param {HTMLElement} [opts.creditViewport] Where its "Data attribution" list opens
 * @param {number} opts.month 1-12, for the monthly imagery
 * @param {string|null} opts.token Cesium ion's, or none
 * @param {function(object): void} opts.onError A render or load failure
 * @returns {object} The body: {name, Cesium, widget, ellipsoid, credits,
 *   night, customShader, ion, month, tileset (once loaded), distanceScale,
 *   heightM, frames}
 */
export function createWidget(Cesium, name, {container, contextOptions, creditContainer, creditViewport, month, token, onError}) {
  const config = CESIUM_BODIES[name]
  if (token) {
    Cesium.Ion.defaultAccessToken = token
  }
  const body = {name, Cesium, credits: creditContainer, month, frames: 0, distanceScale: DISTANCE_SCALE_M}
  const ellipsoid = Cesium.Ellipsoid[config.ellipsoid]
  Cesium.Ellipsoid.default = ellipsoid
  const surface = config.ionTileset ?
    // An ion 3D-tiles body (Moon, Mars): no globe, the tileset is the surface.
    {globe: false, baseLayer: false} :
    // The globe always starts on offline imagery and the plain ellipsoid,
    // so it draws whatever ion does (requestIon): for Earth the month's
    // Blue Marble, bundled with celestiary; else Cesium's Natural Earth II.
    config.monthlyImagery ?
      {baseLayer: monthlyBaseLayer(Cesium, config.monthlyImagery, month)} :
      {baseLayer: Cesium.ImageryLayer.fromProviderAsync(
          Cesium.TileMapServiceImageryProvider.fromUrl(Cesium.buildModuleUrl('Assets/Textures/NaturalEarthII')))}
  const widget = new Cesium.CesiumWidget(container, {
    contextOptions,
    useDefaultRenderLoop: false,
    showRenderLoopErrors: false,
    creditContainer,
    creditViewport,
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
  // A tileset's shader, kept for its per-frame uniforms (applyView's earthshine).
  const customShader = config.ionTileset ?
    sunlitShader(Cesium, config.nightFloor ?? 0, {
      lunar: config.photometry === 'lunar',
      reliefUrl: config.relief ? absoluteUrl(dataUrl(config.relief)) : null,
    }) : null
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
      customShader,
    })
        .then((tileset) => {
          widget.scene.primitives.add(tileset)
          body.tileset = tileset
        })
        .catch(onError)
  }
  if (config.monthlyImagery) {
    widget.imageryLayers.add(monthlyTileLayer(Cesium, config.monthlyImagery, month))
  }
  const night = widget.scene.globe && config.nightImagery ?
    addNightLights(Cesium, widget, config.nightImagery) : null
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
    uniforms: {distanceScale: () => body.distanceScale},
  }))
  scene.atmosphere.dynamicLighting = Cesium.DynamicAtmosphereLightingType.SCENE_LIGHT
  if (scene.skyAtmosphere) {
    scene.skyAtmosphere.show = config.atmosphere
  }
  scene.renderError.addEventListener((_scene, err) => onError(err))

  // An ion globe (Earth, with a token) takes ion's World Terrain now, and
  // asks for its detail imagery only once the camera is near
  // (requestIon).  Terrain now, not near: it is billed by data, a few
  // hundred KB at the coarse levels, and it is what gives the globe
  // vertex normals, so its lighting is Lambert on the terrain's slopes.
  // Until it answers, the plain ellipsoid is lit by Lambert on its smooth
  // normal (litSurfaceOnly, with the patched Cesium).
  const ion = token && !config.ionTileset ? {imagery: false} : null
  if (ion) {
    addIonTerrain(Cesium, widget)
  }
  return Object.assign(body, {widget, ellipsoid, night, customShader, ion})
}


/**
 * Set a frame's view on a body's widget.
 *
 * @param {object} body From createWidget
 * @param {object} view The host's (CesiumLayers._viewOf):
 *   {position, direction, up}: the camera in the body's ECEF frame, metres,
 *     the position on the same ray as over the host's sphere and at the same
 *     height over Cesium's ellipsoid (frames.ellipsoidCameraPosition);
 *   far, fov: Cesium's far plane (m) and its fov (rad, across the wider
 *     side; frames.cesiumFov);
 *   size: [w, h], the frame's CSS pixels;
 *   detail: the screen-space error's scale (detail.js);
 *   fovyRad, heightM, distanceScale: the host's vertical fov, the camera's
 *     height over the sphere, and the scale of the distance in alpha;
 *   sunDirection: the direction the Sun's light travels, ECEF;
 *   month: 1-12;
 *   earthshine: {level, direction} for the Moon's shader, or null
 */
export function applyView(body, view) {
  const {Cesium, widget, container} = body
  const config = CESIUM_BODIES[body.name]
  // Keep Cesium's canvas the frame's size.
  const [width, height] = view.size
  if (container && (container.style.width !== `${width}px` || container.style.height !== `${height}px`)) {
    container.style.width = `${width}px`
    container.style.height = `${height}px`
  }
  body.heightM = view.heightM
  body.distanceScale = view.distanceScale
  // Set directly, not through camera.setView: setView converts direction
  // and up to heading, pitch and roll in the local east-north-up frame and
  // back, and near pitch −90° (looking at the body's centre, as on
  // arrival) that round trip turned the camera by several degrees.
  // Cesium's body then sat off celestiary's stencil and atmosphere, worst
  // off-centre on screen.  The camera's transform stays the identity.
  const cesiumCamera = widget.scene.camera
  const {Cartesian3} = Cesium
  Cartesian3.fromArray(view.position, 0, cesiumCamera.position)
  Cartesian3.fromArray(view.direction, 0, cesiumCamera.direction)
  Cartesian3.fromArray(view.up, 0, cesiumCamera.up)
  Cartesian3.cross(cesiumCamera.direction, cesiumCamera.up, cesiumCamera.right)
  cesiumCamera.frustum.far = view.far
  cesiumCamera.frustum.fov = view.fov
  if (widget.scene.globe) {
    widget.scene.globe.maximumScreenSpaceError = GLOBE_SCREEN_SPACE_ERROR * view.detail
  }
  if (body.tileset) {
    body.tileset.maximumScreenSpaceError = TILE_SCREEN_SPACE_ERROR * view.detail
  }
  requestIon(body, body.name, view.fovyRad, height)
  if (config.monthlyImagery) {
    updateMonthlyImagery(body, config, view.month)
  }
  widget.scene.light.direction = new Cesium.Cartesian3(...view.sunDirection)
  if (view.earthshine && body.customShader) {
    body.customShader.setUniform('u_earthshine', view.earthshine.level)
    body.customShader.setUniform('u_earthDirWC', new Cesium.Cartesian3(...view.earthshine.direction))
  }
}


/**
 * Ask ion for its detail imagery (a billed session) once, when the camera
 * comes low enough that the base imagery's texels would show (ionImagery.js).
 *
 * @param {object} body
 * @param {string} name
 * @param {number} fovyRad The host's vertical field of view
 * @param {number} heightPx The frame's height
 */
export function requestIon(body, name, fovyRad, heightPx) {
  const {ion} = body
  if (!ion || ion.imagery) {
    return
  }
  const config = CESIUM_BODIES[name]
  const imageryBelow = ionImageryAltitude(baseTexelMeters(config.monthlyImagery, config.radii[0]), fovyRad, heightPx)
  if (body.heightM < imageryBelow) {
    ion.imagery = true
    addIonImagery(body.Cesium, body.widget, config.detailFromLevel, body.night)
  }
}


/**
 * Keep a body's monthly base imagery on the simulation date's month.  The
 * new month's layer goes in above the old one, which is removed once the
 * globe's tiles are in again, so the globe never shows without imagery.
 *
 * @param {object} body
 * @param {object} config
 * @param {number} month 1-12
 */
export function updateMonthlyImagery(body, config, month) {
  const {Cesium, widget} = body
  const layers = widget.imageryLayers
  // Once the new month's tiles are in and its map has loaded (an async
  // layer, which the globe's tiles don't wait for).
  if (body.oldBase && widget.scene.globe.tilesLoaded && body.newBase?.ready !== false) {
    for (const layer of body.oldBase) {
      layers.remove(layer, true)
    }
    body.oldBase = null
    body.newBase = null
  }
  if (month === body.month || body.oldBase) {
    return
  }
  body.month = month
  // The old month's map and tiles, the first two layers; the new month's
  // go in above them, under any detail layer and the lights.
  body.oldBase = [layers.get(0), layers.get(1)]
  body.newBase = monthlyBaseLayer(Cesium, config.monthlyImagery, month)
  layers.add(body.newBase, 2)
  layers.add(monthlyTileLayer(Cesium, config.monthlyImagery, month), 3)
}


/**
 * Sample the terrain under Cesium's camera, at most every GROUND_SAMPLE_MS
 * and only within GROUND_SAMPLE_BELOW_M of the surface: into
 * `body.groundHeight`, metres over the ellipsoid, or null.
 *
 * @param {object} body
 * @param {string} name
 * @param {number} now ms
 */
export function sampleGround(body, name, now) {
  if (now - (body.groundAt ?? -Infinity) < GROUND_SAMPLE_MS) {
    return
  }
  body.groundAt = now
  const carto = body.ellipsoid.cartesianToCartographic(body.widget.scene.camera.position)
  body.groundHeight = carto && carto.height < GROUND_SAMPLE_BELOW_M ? terrainHeight(body, name, carto) : null
}


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
 * Height over the ellipsoid of the loaded terrain (Earth's globe) or
 * surface tiles (the Moon's and Mars's tilesets) at a place.
 *
 * @param {object} body
 * @param {string} name
 * @param {object} carto Cesium.Cartographic; its height is ignored
 * @returns {number|null}
 */
export function terrainHeight(body, name, carto) {
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
export function addNightLights(Cesium, widget, imagery) {
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
 * Render a body's night lights' frame: only its night layer, unlit, on
 * black (CESIUM.md, "Night lights").  The other layers are skipped (alpha
 * 0), not hidden, so their tiles stay loaded for the day frame; everything
 * is put back after, even if the render throws.  On the page
 * (CesiumLayers._drawNightLights) and on a guest page (cesium-guest/guest.js)
 * alike.
 *
 * @param {object} body A body's, from createWidget, with its night layer
 * @param {Function} render Renders the widget once
 */
export function renderNightLights(body, render) {
  const {Cesium, widget, night} = body
  const {globe} = widget.scene
  const layers = widget.imageryLayers
  const alphas = []
  for (let i = 0; i < layers.length; i++) {
    const layer = layers.get(i)
    alphas.push([layer, layer.alpha])
    layer.alpha = layer === night ? 1 : 0
  }
  const baseColor = globe.baseColor
  globe.baseColor = Cesium.Color.BLACK
  globe.enableLighting = false
  try {
    render()
  } finally {
    for (const [layer, alpha] of alphas) {
      layer.alpha = alpha
    }
    globe.baseColor = baseColor
    globe.enableLighting = true
  }
}


/**
 * @param {string} url Absolute, or relative to the page's base
 * @returns {string} Absolute
 */
export function absoluteUrl(url) {
  return isAbsoluteUrl(url) ? url : new URL('.', document.baseURI).href + url
}


/**
 * The Blue Marble of a month as one image: the map celestiary's own Earth is
 * textured with, laid over the whole globe, at every level.  It is all the
 * globe has until its tiles reach `fromLevel` (monthlyTileLayer), and the
 * tiles' own levels 0-2 are no better (4096 px across is level 2 of 512 px
 * tiles): so it is one request, where the tiles took ten (levels 0 and 1),
 * popping in as they came.  Async: the layer is ready once the image has
 * loaded.  Celestiary's own Earth and its clouds have fetched the image
 * already (or are fetching it), so Cesium is given a `blob:` URL of the
 * same bytes (sharedImage.js) and makes no request; if that fetch failed, it
 * is given the image's URL to try itself.
 *
 * @param {object} Cesium
 * @param {object} imagery A body's monthlyImagery config (bodies.js)
 * @param {number} month 1-12
 * @returns {object} Cesium.ImageryLayer
 */
function monthlyBaseLayer(Cesium, imagery, month) {
  const url = dataUrl(monthlyPath(imagery.singleUrl, month))
  const provider = sharedObjectUrl(url)
      .catch(() => absoluteUrl(url))
      .then((src) => Cesium.SingleTileImageryProvider.fromUrl(src, {credit: imagery.credit}))
  return Cesium.ImageryLayer.fromProviderAsync(provider)
}


/**
 * The Blue Marble of a month as tiles, over its map (monthlyBaseLayer):
 * shown from globe level `fromLevel`, and asking for nothing above it.
 * `minimumLevel` as well as `minimumTerrainLevel`: a globe tile at level 3
 * would pick the imagery level by its texel size, and might pick 2.
 *
 * @param {object} Cesium
 * @param {object} imagery A body's monthlyImagery config (bodies.js)
 * @param {number} month 1-12
 * @returns {object} Cesium.ImageryLayer
 */
function monthlyTileLayer(Cesium, imagery, month) {
  const {url, tileSize, maximumLevel, fromLevel, credit} = imagery
  return new Cesium.ImageryLayer(new Cesium.UrlTemplateImageryProvider({
    // Cesium wants an absolute URL: the data base URL if the build has one
    // (DESIGN.md, data policy), else the page's base (celestiary may be
    // served under a path).  Not new URL(url, base), which escapes the
    // {z}/{x}/{y} placeholders.
    url: absoluteUrl(dataUrl(monthlyPath(url, month))),
    tilingScheme: new Cesium.GeographicTilingScheme(),
    tileWidth: tileSize,
    tileHeight: tileSize,
    minimumLevel: fromLevel,
    maximumLevel,
    credit,
  }), {minimumTerrainLevel: fromLevel})
}


/**
 * Lights an ion 3D-tiles surface (Moon, Mars) by celestiary's Sun.  The
 * tilesets come unlit, so without this the night side is as bright as the
 * day side.
 *
 * Lambert on the smooth sphere, which gives a clean terminator at any
 * distance; the Moon (`photometry: 'lunar'`) by the lunar photometric
 * function instead, as celestiary's Moon mesh (lunarPhotometry.js: lunar-
 * Lambert, its phase function fitted to Horizons' V(1, α), with μ0, μ and
 * the fragment's own phase angle; the decode's textureGain makes the stored
 * values normal albedo).  Not on the terrain: the tilesets carry no normals, and
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
 * The night side: the Moon's is lit by earthshine, Earth's reflected
 * sunlight, from Earth's direction (`u_earthshine`, `u_earthDirWC`, set
 * each frame by applyView, from the host's view; lunarPhotometry.js earthshineFraction: 7e-5
 * of sunlight at #192's crescent), through the same law as the sunlight.
 * It had a floor of 2% of full sun on the
 * whole night side, ~300× earthshine, which the meter's gain with the
 * crescent in frame turned into a lit, olive night side.  Other bodies
 * keep their `nightFloor` (Mars: dark, but not a hole in the sky).
 *
 * The slopes: where the body has a `relief` (the Moon's LOLA normal map,
 * Planet.md "Relief"), both lights are taken against that map's normal on
 * the sphere, sampled by the fragment's longitude and latitude (relief.js),
 * so the terminator shows crater walls in light and shade as celestiary's
 * own Moon does.  Still not the tiles' geometry: the map is the whole of
 * the shape the light sees.
 *
 * The result goes out log-encoded (encoding.js), for the composite's decode
 * to invert: Cesium writes it to an 8-bit buffer, and linear, the night
 * side and the terminator's last degrees had a few codes, flat bands and
 * black holes once the decode scaled them up (CESIUM.md, "Precision: a log
 * encoding, and the Moon's earthshine").
 *
 * @param {object} Cesium
 * @param {number} nightFloor The night side's light, a fraction of full sun
 * @param {object} [options]
 * @param {boolean} [options.lunar] Light it by the lunar photometric function, not Lambert's law
 * @param {string|null} [options.reliefUrl] The normal map to light the surface's slopes by
 *   (bodies.js `relief`; relief.js), absolute; null for the smooth sphere
 * @returns {object} Cesium.CustomShader
 */
function sunlitShader(Cesium, nightFloor, {lunar = false, reliefUrl = null} = {}) {
  const f = (x) => x.toFixed(4)
  // The light's law, toward a direction `l` from a surface of normal `n`
  // seen along `v` (eye space): the Moon's photometric function, as
  // celestiary's Moon mesh has it (lunarPhotometry.js; per unit of normal
  // albedo, which the decode's textureGain carries), or Lambert's.  With
  // relief, `n` is the map's normal, for μ0 and μ alike, as three's
  // normal-mapped `geometryNormal` is on celestiary's Moon (lunarSurface.js).
  const law = lunar ?
    'lunarReflectance(dot(n, l), dot(n, v), dot(l, v))' :
    'max(dot(n, l), 0.0)'
  const uniforms = {
    u_earthshine: {type: Cesium.UniformType.FLOAT, value: 0},
    u_earthDirWC: {type: Cesium.UniformType.VEC3, value: new Cesium.Cartesian3(1, 0, 0)},
  }
  if (reliefUrl) {
    // Fetched by Cesium when the shader is made, off the sync paths tests
    // drive; the shader draws the smooth sphere until the image is in.
    uniforms.u_reliefMap = {
      type: Cesium.UniformType.SAMPLER_2D,
      value: new Cesium.TextureUniform({
        url: reliefUrl,
        minificationFilter: Cesium.TextureMinificationFilter.LINEAR_MIPMAP_LINEAR,
        magnificationFilter: Cesium.TextureMagnificationFilter.LINEAR,
        maximumAnisotropy: RELIEF_ANISOTROPY,
      }),
    }
    uniforms.u_reliefScale = {type: Cesium.UniformType.FLOAT, value: 1}
  }
  return new Cesium.CustomShader({
    lightingModel: Cesium.LightingModel.UNLIT,
    uniforms,
    // Stored value × light, as Earth's globe draws (litSurfaceOnly): the
    // texture's stored values, not Cesium's linear ones, lit; Cesium's
    // output encodes linear back to what's returned here, the code.
    // `normal` is the surface normal both lights are taken against: the
    // smooth sphere's, or with relief the map's slopes on it (relief.js).
    fragmentShaderText: `
      ${LOG_ENCODE_GLSL}
      ${reliefUrl ? RELIEF_GLSL : ''}
      ${lunar ? LUNAR_PHOTOMETRY_GLSL : ''}
      float sunlitLaw(vec3 n, vec3 l, vec3 v) {
        return ${law};
      }
      void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
        vec3 positionWC = fsInput.attributes.positionWC;
        vec3 normal = czm_viewRotation * ${reliefUrl ? 'reliefNormal(positionWC)' : 'normalize(positionWC)'};
        vec3 toEye = normalize(-fsInput.attributes.positionEC);
        float sun = sunlitLaw(normal, czm_lightDirectionEC, toEye);
        float earth = sunlitLaw(normal, czm_viewRotation * u_earthDirWC, toEye);
        float light = ${f(nightFloor)} + ${f(1 - nightFloor)} * sun + u_earthshine * earth;
        vec3 stored = czm_linearToSrgb(material.diffuse) * light;
        material.diffuse = czm_srgbToLinear(cesiumLogEncode(stored, gl_FragCoord.xy));
      }`,
  })
}


/**
 * Make a Cesium globe draw only its lit surface, as celestiary lights its
 * own: its imagery's stored values × Lambert (Cesium's defaults add 0.3 and
 * scale Lambert by 0.9), with no ground atmosphere (celestiary's atmosphere
 * pass draws it), lit at every distance (Cesium fades day-night shading out
 * below lightingFadeOutDistance, ~10,000 km from Earth's centre, and with it
 * the ground atmosphere).  With terrain normals (ion World Terrain) that's
 * Lambert on the terrain; on the plain ellipsoid, Lambert on the
 * ellipsoid's normal.  The ellipsoid's day-night shading was a hard-coded
 * 5 × Lambert + 0.3 that no setting reached; our Cesium patch
 * (patches/, CESIUM.md "Patching Cesium") gives it
 * dayNightLambertDiffuseMultiplier and vertexShadowDarkness.  No water
 * effect: its sun glint and sky reflection lit the sunward ocean up to
 * twice celestiary's (whose ocean shine is its own, Planet.md).
 *
 * @param {object} globe Cesium.Globe
 */
function litSurfaceOnly(globe) {
  globe.showGroundAtmosphere = false
  globe.showWaterEffect = false
  globe.lambertDiffuseMultiplier = 1
  globe.dayNightLambertDiffuseMultiplier = 1
  globe.vertexShadowDarkness = 0
  globe.lightingFadeOutDistance = 0
  globe.lightingFadeInDistance = 1
}


// How often the terrain under the camera is sampled, ms, and from how high
// over the surface (Olympus Mons, the highest, is ~21 km over Mars's), m.
const GROUND_SAMPLE_MS = 200
const GROUND_SAMPLE_BELOW_M = 1e5
// ion tilesets' maximumScreenSpaceError, in pixels, and the globe's
// (Cesium's default), where a pixel spans MIN_PIXEL_ANGLE or more: every
// ordinary field of view (detail.js).
const TILE_SCREEN_SPACE_ERROR = 8
// The relief map's anisotropic filtering (relief.js): the limb and the terminator
// are seen at grazing angles.
const RELIEF_ANISOTROPY = 4
const GLOBE_SCREEN_SPACE_ERROR = 2
// Cesium's default PerspectiveFrustum far plane, metres.
export const DEFAULT_FAR = 5e8
