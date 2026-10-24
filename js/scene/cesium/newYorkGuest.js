/**
 * Slop New York drawn by Earth's Cesium layer: the guest loaded from its
 * site, its NetGL link into Cesium's context, its ground from Cesium's
 * terrain, and the external renderer Cesium calls inside its frame.
 * Imported only when the city is wanted (CesiumLayers, newYork.js).
 * CESIUM.md, "New York".
 *
 *   celestiary's context
 *     ← Earth's link (CesiumLayers._createWidget): Cesium's recorder
 *       ← the city's link (here): the city's recorder
 *
 * The city's calls replay into Cesium's recorder (`scene.context._gl`), which
 * is replaying into celestiary's context at that moment (Earth's link.frame),
 * so each lands in Cesium's pass framebuffer, depth-tested against the globe,
 * in the same frame.  Then it's Cesium's frame like any other: the distance
 * stage writes the city's distance into alpha from the depth it wrote, and
 * the composite's decode takes its colour as it takes the globe's.
 */
import {leanShadow, stageLink} from './netglLean.js'


/**
 * The guest's ground, from Cesium's terrain: a grid this far apart, metres,
 * sampled at this tile level (sampleTerrain, not sampleTerrainMostDetailed,
 * which would fetch World Terrain's finest tiles over the island).  Level 12
 * is ~12 tiles over Manhattan, a few hundred KB of ion data (billed by data,
 * not sessions); its meshes resolve the island's ~80 m of relief.
 */
const GROUND_SPACING_M = 100
const GROUND_LEVEL = 12

/**
 * How finely the lean city's ground layers follow that ground (slop-newyork
 * guest.js THE GROUND, its `drape` option): within 10 cm, no edge split
 * under 8 m, and a budget of 1.5 million triangles shared by area (a layer
 * keeps at least its own; the flat layers are 0.93 million).  The guest's
 * own detail (4 mm, 2 m) is for a demo hill: on real terrain it split the
 * whole island down to metres, for minutes and gigabytes.  Measured on
 * Terrarium heights resampled to this grid: 1.67 million triangles in 4.5 s
 * (SwiftShader's host CPU), against 12 s and 3.1 million at 2 cm (CESIUM.md,
 * "New York", what it costs).
 */
export const LEAN_DRAPE = {tolerance: 0.1, minEdge: 8, maxTriangles: 1.5e6}


/**
 * The guest's light in celestiary's units (CESIUM.md, "New York", the colour
 * contract): Cesium's frame holds stored value × the Sun's light, 1 for a
 * white Lambertian surface facing the Sun.  three's Lambert BRDF is albedo
 * / π, so a directional light of intensity π gives 1 there.  The sky's
 * share is a hemisphere light at SKY_FRACTION of that; the guest's baked
 * environment (its Preetham sky, for reflections) at ENVIRONMENT_INTENSITY.
 */
export const SUN_INTENSITY = Math.PI
export const SKY_FRACTION = 0.15
export const ENVIRONMENT_INTENSITY = 0.15


/**
 * Load the guest and add it to the Earth widget's external renderers.
 *
 * @param {object} args
 * @param {object} args.Cesium
 * @param {object} args.netgl portal-netgl
 * @param {object} args.widget Earth's CesiumWidget
 * @param {string} args.guestBase slop-newyork's site, ending in '/'
 * @param {boolean} [args.shadows]
 * @param {object} [args.cesiumShadow] Cesium's shadow context (its NetGL
 *   guest's core.shadow), made lean for the city's calls
 * @param {boolean} [args.lean] The lean city (CESIUM.md, "New York", what it
 *   costs): no crowds, lean shadow contexts, its set-up staged over frames.
 *   false: as the guest comes
 * @returns {Promise<object>} The city: {guest, renderer, setShown(on),
 *   update(), dispose()}
 */
export async function createNewYork({Cesium, netgl, widget, guestBase, shadows = false, cesiumShadow = null, lean = true}) {
  const scene = widget.scene
  if (!scene.externalRenderers || typeof Cesium.ExternalRenderer !== 'function') {
    throw new Error('Cesium has no externalRenderers (patches/@cesium+engine; CESIUM.md "Patching Cesium")')
  }
  const [entry, helpers] = await Promise.all([
    import(new URL('js/guest-entry.mjs', guestBase).href),
    import(new URL('js/guest-cesium.mjs', guestBase).href),
  ])

  const screen = helpers.cesiumScreenFramebuffer()
  let replayErrors = 0
  const link = netgl.makeNetGLImmediateLink({
    // Cesium's context: its NetGL recorder, in celestiary's page.
    gl: scene.context._gl,
    replay: {screenFramebuffer: screen},
    onError: (err) => {
      replayErrors++
      console.warn('[new york] replay error:', err)
    },
  })
  // Lean: the city's calls queued by reference and replayed a chunk a frame
  // (netglLean.js stageLink), not cloned and replayed at once
  const stage = lean ? stageLink(link) : null
  const width = Math.max(1, scene.drawingBufferWidth)
  const height = Math.max(1, scene.drawingBufferHeight)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  // Lean, the shadow context draws nothing (below), so its drawing buffer
  // is 1x1, on a canvas of its own: three sizes the city by `canvas`
  const shadowCanvas = lean ? document.createElement('canvas') : canvas
  if (lean) {
    shadowCanvas.width = 1
    shadowCanvas.height = 1
  }
  const guestCtx = netgl.makeNetGLGuestContext({
    canvas: shadowCanvas,
    transport: stage ? stage.transport : link.transport,
    contextAttributes: {alpha: true, antialias: false, depth: true, stencil: false},
  })
  stage?.attach(guestCtx)
  // Lean: the city's shadow and Cesium's (during the city's calls) keep its
  // objects and programs but none of its geometry, and draw none of it
  // (netglLean.js leanShadow): celestiary's context is the one that draws.
  let inCity = 0
  const unlean = []
  if (lean) {
    unlean.push(leanShadow(guestCtx.shadow))
    if (cesiumShadow) {
      unlean.push(leanShadow(cesiumShadow, () => inCity > 0))
    }
  }
  // The link as the renderer sees it: each guest frame through the stage,
  // with Cesium's shadow lean for it
  const cityFrame = (render) => {
    inCity++
    try {
      if (stage) {
        stage.frame(render)
      } else {
        link.frame(render)
      }
    } finally {
      inCity--
    }
  }
  const logDepth = scene.logarithmicDepthBuffer === true
  // lights: false drops the guest's clustered lamp lighting, which inCelestiaryFrame zeroes anyway (the lamps don't
  // fit Cesium's frame): on a real GPU (an Apple M-series) it and the sun's shadows cost most of the guest's frame
  // Lean, crowds: false builds no pedestrians, never drawn on the guest's
  // WebGL2 backend but walked and skinned every frame; and the ground's
  // drape is coarser (LEAN_DRAPE)
  const guest = await entry.createNYCGuest({
    canvas, context: guestCtx.gl, width, height,
    extent: 'manhattan', shadows, lights: false, composite: true, logDepth, crowds: !lean,
    drape: lean ? LEAN_DRAPE : undefined,
  })
  if (guest.composite !== true || (logDepth && guest.logDepth !== true)) {
    throw new Error(`the guest at ${guestBase} has no composite or logDepth option (slop-newyork#1)`)
  }
  inCelestiaryFrame(guest)
  inCelestiaryUnits(guest)

  let terrain = scene.terrainProvider
  await setGroundFrom(guest, Cesium, terrain, helpers.MANHATTAN_SEA_LEVEL)
  await guest.compile()

  // The Sun is Cesium's light, which celestiary sets each frame
  // (CesiumLayers._setCesiumView), not Cesium's own sun, which is its
  // clock's: so sun: false, and the light's direction here.
  const renderer = helpers.cesiumExternalRenderer(guest, Cesium, {link: {frame: cityFrame}, guestCtx, screen, sun: false})
  const draw = renderer.render
  const sunDir = new Cesium.Cartesian3()
  const light = {sunDirectionWC: new Cesium.Cartesian3()}
  let sunFrame = null
  renderer.render = (p) => {
    // The set-up's chunks first, one a frustum, the city undrawn until they're in
    if (stage?.chunks > 0) {
      screen.framebuffer = p.framebuffer
      inCity++
      try {
        stage.step()
      } finally {
        inCity--
      }
      return
    }
    if (p.frameNumber !== sunFrame) {
      sunFrame = p.frameNumber
      Cesium.Cartesian3.clone(p.lightDirectionWC, light.sunDirectionWC)
      guest.setSun(helpers.sunFromCesium(guest, Cesium, light, helpers.cityModelMatrix(guest, Cesium), sunDir))
    }
    draw(p)
  }
  scene.externalRenderers.add(renderer)

  let disposed = false
  let regrounding = false
  return {
    guest,
    renderer,
    link,
    stage,
    get replayErrors() {
      return replayErrors
    },
    /** @param {boolean} on Whether Cesium calls the city this frame */
    setShown(on) {
      renderer.show = on
    },
    /**
     * @param {boolean} on The city drawn black (its alpha and depth as
     *   ever) while on: an occluder, for the night lights' frame
     *   (CesiumLayers._drawNightLights), where the globe's lights under and
     *   behind its buildings must not show through them
     */
    setOccluding(on) {
      if (guest.celestiary?.occlude) {
        guest.celestiary.occlude.value = on ? 1 : 0
      }
    },
    /** Each frame: follow the globe's terrain when it changes (ion's World Terrain arriving). */
    update() {
      if (disposed || regrounding || scene.terrainProvider === terrain) {
        return
      }
      terrain = scene.terrainProvider
      regrounding = true
      setGroundFrom(guest, Cesium, terrain, helpers.MANHATTAN_SEA_LEVEL)
          .catch((err) => console.warn('[new york] terrain sampling failed; the city keeps its ground', err))
          .finally(() => {
            regrounding = false
          })
    },
    /**
     * Stop and free: off Cesium's renderers, its GL objects deleted through
     * the links (so in Cesium's shadow and celestiary's context as well as
     * its own), its shadow context lost.
     */
    dispose() {
      if (disposed) {
        return
      }
      disposed = true
      if (!widget.isDestroyed()) {
        scene.externalRenderers.remove(renderer)
      }
      try {
        cityFrame(() => {
          disposeScene(guest)
          guest.renderer.dispose()
          guestCtx.endFrame()
        })
      } catch (err) {
        console.warn('[new york] dispose failed', err)
      }
      for (const undo of unlean) {
        undo()
      }
      // The city's calls went through Cesium's recorder, outside Cesium's
      // frame: its state cache no longer says what's bound.
      if (!widget.isDestroyed()) {
        scene.context.resetState?.()
      }
      guestCtx.shadow.getExtension('WEBGL_lose_context')?.loseContext()
    },
  }
}


/**
 * Sample the terrain under the guest's ground grid and drape it there
 * (guest.setGround).  On the plain ellipsoid (no ion token, or before World
 * Terrain answers) every height is 0, so nothing is fetched: the city then
 * stands on the ellipsoid, curving with it.
 *
 * @param {object} guest
 * @param {object} Cesium
 * @param {object} provider The globe's terrain provider
 * @param {number} seaLevel Mean sea level over the ellipsoid at Manhattan, m
 */
async function setGroundFrom(guest, Cesium, provider, seaLevel) {
  const {lonLat, cols, rows} = guest.groundSamples(GROUND_SPACING_M)
  const n = cols * rows
  const heights = new Float64Array(n)
  if (!(provider instanceof Cesium.EllipsoidTerrainProvider)) {
    const positions = new Array(n)
    for (let i = 0; i < n; i++) {
      positions[i] = Cesium.Cartographic.fromDegrees(lonLat[2 * i], lonLat[(2 * i) + 1])
    }
    const sampled = await Cesium.sampleTerrain(provider, GROUND_LEVEL, positions)
    for (let i = 0; i < n; i++) {
      const h = sampled[i].height
      heights[i] = Number.isFinite(h) ? h : NaN
    }
  }
  guest.setGround(heights, {seaLevel})
}


/**
 * Light the guest in celestiary's units, a stopgap until the guest has an
 * option for it (CESIUM.md, "New York", the colour contract):
 *
 * - The Sun white at SUN_INTENSITY while it is up, and nothing once it is
 *   down.  The guest's presets (lighting.js, chosen by the Sun's elevation
 *   in setSun) set their light for a tone-mapped display, the Sun at up to
 *   6.6 (a white wall facing it at 2.1, which Cesium's 8-bit frame clips),
 *   and under the horizon light the city by a moon of their own.
 * - The sky's hemisphere light at SKY_FRACTION of the Sun's, and the
 *   environment at ENVIRONMENT_INTENSITY, both fading out with the Sun.
 * - The guest's lights switched off (cityUniforms.uInteriorGlow 0: lit
 *   windows, street lamps, the cars' lamps), and its unlit materials dimmed
 *   with the sky (inCelestiaryFrame's daylight).
 *
 * Re-applied after every setSun, which can switch presets.
 *
 * @param {object} guest
 */
export function inCelestiaryUnits(guest) {
  let up = 1
  const apply = () => {
    const {sunLight, hemiLight, scene} = guest.lighting ?? {}
    // The sky dims from 10° up to 5° under the horizon (civil dusk's middle).
    const sky = smoothstep(-0.09, 0.17, up)
    if (sunLight) {
      sunLight.color.setRGB(1, 1, 1)
      sunLight.intensity = SUN_INTENSITY * smoothstep(-0.01, 0.01, up)
    }
    if (hemiLight) {
      hemiLight.intensity = SUN_INTENSITY * SKY_FRACTION * sky
    }
    if (scene) {
      scene.environmentIntensity = ENVIRONMENT_INTENSITY * sky
    }
    // The guest's dusk-to-night switch for its lights (windows, lamps):
    // off, so its night shading (lit windows reflected) stays dark too.
    const glow = globalThis.NYC?.cityUniforms?.uInteriorGlow
    if (glow) {
      glow.value = 0
    }
    if (guest.celestiary) {
      guest.celestiary.daylight.value = sky
    }
  }
  const setSun = guest.setSun
  guest.setSun = (dir) => {
    // The Sun's height in the city's frame, y up, before the presets lift
    // it to 3° (lighting.js setSunDirection).
    up = dir.y / Math.max(1e-9, Math.hypot(dir.x, dir.y, dir.z))
    setSun(dir)
    apply()
  }
  apply()
}


/**
 * Make the guest's materials write what Cesium's frame holds for the
 * composite's decode (HDR.md, "Colour spaces: stored values"; CESIUM.md,
 * "New York", the colour contract): stored value × the Sun's light, linear
 * in the light, and nothing emitted.  Three switches, as uniforms on
 * `guest.celestiary` (1, 1, 0 here; 0, 1, 1 is the guest's own output), and a
 * fourth for the night lights' frame:
 *
 * - `stored`: each material's diffuse colour, which three has decoded from
 *   sRGB to linear, encoded back before it is lit, and the output linear
 *   (no sRGB encode at the end).  The guest's composite output encodes the
 *   lit colour instead, so its light went through sRGB's curve: a wall lit
 *   at 15% of the Sun showed at 42% of its sunlit value, not 15%.
 * - `daylight`: unlit materials (lights false: signs, sprites) are their
 *   colour whatever the light, as if lit by the Sun; scaled by daylight
 *   (inCelestiaryUnits), they are dark at night like the rest.
 * - `occlude` (0 here): the whole output black, alpha and depth as ever,
 *   for the night lights' frame, where the city hides the globe's lights
 *   under it (CesiumLayers._drawNightLights; setOccluding).
 * - `emission`: emissive light (windows, signals) and the city's lamps
 *   (point and spot lights) times this.  It
 *   doesn't fit the frame (CESIUM.md, "Night lights": a lit surface up to
 *   1 in 8 bits, where city lights are ~1e-4 of it), and at night's gain (up
 *   to 4e6) any of it is a sunlit white.
 *
 * Before the guest's programs compile (createNewYork compiles after).  A
 * stopgap until the guest has the option (CESIUM.md, "New York", what
 * slop-newyork needs): it reaches into three's NodeMaterial
 * (setupDiffuseColor, emissiveNode) through the guest's own three.
 *
 * @param {object} guest
 * @returns {object|null} {stored, daylight, emission, occlude}, or null if the
 *   guest's three lacks the nodes
 */
export function inCelestiaryFrame(guest) {
  const TSL = globalThis.NYC?.TSL
  if (!TSL?.diffuseColor || !TSL.sRGBTransferOETF || typeof guest.setLinearOutput !== 'function') {
    console.warn('[new york] the guest\'s three has no diffuseColor or sRGBTransferOETF; its colours stay its own')
    return null
  }
  const {diffuseColor, mix, output, select, sRGBTransferOETF, uniform, vec4} = TSL
  const u = {stored: uniform(1), daylight: uniform(1), emission: uniform(0), occlude: uniform(0)}
  const seen = new Set()
  guest.scene.traverse((obj) => {
    for (const m of [obj.material ?? []].flat()) {
      if (!m?.isNodeMaterial || seen.has(m) || typeof m.setupDiffuseColor !== 'function') {
        continue
      }
      seen.add(m)
      const unlit = m.lights !== true
      const setup = m.setupDiffuseColor
      m.setupDiffuseColor = function(builder) {
        setup.call(this, builder)
        const rgb = mix(diffuseColor.rgb, sRGBTransferOETF(diffuseColor.rgb), u.stored)
        diffuseColor.assign(vec4(unlit ? rgb.mul(u.daylight) : rgb, diffuseColor.a))
      }
      if (m.emissiveNode) {
        m.emissiveNode = m.emissiveNode.mul(u.emission)
      }
      // Black while `occlude` (the night lights' frame): selected, not
      // multiplied, so nothing the material computes (a NaN) gets through
      if (select && output) {
        const shaded = vec4(m.outputNode ?? output)
        m.outputNode = select(u.occlude.greaterThan(0.5), vec4(0, 0, 0, shaded.a), shaded)
      }
      const key = m.customProgramCacheKey
      m.customProgramCacheKey = function() {
        return `${key.call(this)}:celestiary`
      }
    }
  })
  // Plain emissive colours (no emissiveNode) by their intensity, a uniform.
  const intensities = new Map()
  for (const m of seen) {
    if (!m.emissiveNode && m.emissiveIntensity > 0 && m.emissive?.getHex?.() !== 0) {
      intensities.set(m, m.emissiveIntensity)
    }
  }
  // The city's lamps (street lamps, shop lights, the cars' lamps) are point
  // and spot lights whose intensity the guest sets as it goes: read through
  // the switch.  Not the Sun (a SunLight) nor the sky (a HemisphereLight).
  guest.scene.traverse((obj) => {
    if ((obj.isPointLight || obj.isSpotLight) && !Object.getOwnPropertyDescriptor(obj, 'intensity')?.get) {
      let intensity = obj.intensity
      Object.defineProperty(obj, 'intensity', {
        configurable: true,
        enumerable: true,
        get: () => intensity * u.emission.value,
        set: (value) => {
          intensity = value
        },
      })
    }
  })
  u.setEmission = (on) => {
    u.emission.value = on
    for (const [m, intensity] of intensities) {
      m.emissiveIntensity = intensity * on
    }
  }
  u.setEmission(0)
  // The external renderer sets the output each frustum (linear for an HDR
  // Cesium, which celestiary's isn't): linear always while `stored` is on,
  // so the light stays linear over the stored values.
  const setLinearOutput = guest.setLinearOutput
  guest.setLinearOutput = (linear) => setLinearOutput(u.stored.value > 0.5 ? true : linear)
  setLinearOutput(true)
  guest.celestiary = u
  return u
}


/**
 * @param {number} a
 * @param {number} b
 * @param {number} x
 * @returns {number} GLSL's smoothstep
 */
function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - (2 * t))
}


/**
 * Dispose the guest scene's geometries, materials and textures, so its
 * renderer deletes their GL objects.
 *
 * @param {object} guest
 */
function disposeScene(guest) {
  const seen = new Set()
  const once = (x) => {
    if (x && !seen.has(x) && typeof x.dispose === 'function') {
      seen.add(x)
      x.dispose()
    }
  }
  guest.scene.traverse((obj) => {
    once(obj.geometry)
    for (const m of [obj.material ?? []].flat()) {
      for (const value of Object.values(m)) {
        if (value?.isTexture) {
          once(value)
        }
      }
      once(m)
    }
  })
}
