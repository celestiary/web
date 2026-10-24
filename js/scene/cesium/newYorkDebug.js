/**
 * A diagnostic of Slop New York in Earth's Cesium layer, for a real GPU
 * (CESIUM.md, "New York", found on a real GPU): `c.ui.layers.newYorkDebug()`
 * in the console, with the city in view.  It watches the app's own frames
 * for a few seconds and reports, per celestiary frame, whether Cesium drew,
 * whether it called the city, whether that call drew the city or replayed a
 * staged chunk, and how many of the city's draws reached celestiary's
 * context; then the state those depend on.  Imported only when called.
 */


const DRAWS = ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements']


/**
 * @param {Array<object>} rows One a celestiary frame: {t, cesiumRenders,
 *   lightsFrames, calls: [{staged}], cityDraws, shown}
 * @returns {object} The frames, those with the city shown and no draw of
 *   it, the frames between them, and the draws a frame
 */
export function summarizeFrames(rows) {
  const shown = rows.filter((r) => r.shown)
  const missing = shown.filter((r) => r.cityDraws === 0)
  const at = missing.map((r) => rows.indexOf(r))
  const gaps = at.slice(1).map((f, i) => f - at[i])
  const draws = shown.map((r) => r.cityDraws).sort((a, b) => a - b)
  const seconds = rows.length > 1 ? (rows.at(-1).t - rows[0].t) / 1000 : 0
  return {
    frames: rows.length,
    fps: seconds > 0 ? +((rows.length - 1) / seconds).toFixed(1) : null,
    framesShown: shown.length,
    framesWithoutCity: missing.length,
    withoutCityAt: at.slice(0, 20),
    framesBetween: gaps.slice(0, 20),
    stagedCalls: rows.reduce((n, r) => n + r.calls.filter((c) => c.staged).length, 0),
    cityDrawsPerFrame: draws.length ? {min: draws[0], median: draws[Math.floor(draws.length / 2)], max: draws.at(-1)} : null,
    cesiumRendersPerFrame: [...new Set(rows.map((r) => r.cesiumRenders))].sort(),
    cityCallsPerFrame: [...new Set(rows.map((r) => r.calls.length))].sort(),
    lightsFrames: rows.reduce((n, r) => n + r.lightsFrames, 0),
  }
}


/**
 * @param {number} h A half float's bits
 * @returns {number} Its value
 */
export function halfToFloat(h) {
  const sign = (h & 0x8000) ? -1 : 1
  const e = (h >> 10) & 0x1f
  const f = h & 0x3ff
  if (e === 0) {
    return sign * (2 ** -14) * (f / 1024)
  }
  if (e === 31) {
    return f ? NaN : sign * Infinity
  }
  return sign * (2 ** (e - 15)) * (1 + (f / 1024))
}


/**
 * Where the city's pixels' light comes from, from two frames, one with the
 * city and one without, each as Cesium's day frame (RGBA bytes, before the
 * decode) and the scene buffer after the composite (RGBA floats, before the
 * atmosphere pass), and the night lights' pass's addition in the frame with
 * the city (RGBA floats, or null when it didn't run).
 *
 * @param {object} f {width, height, dayWith, dayWithout, sceneWith, sceneWithout, lightsWith}
 * @returns {object} The city's pixels (its day frame differs), and among
 *   them: those its day frame lit (rgb codes over 0, the commonest),
 *   those the night lights added to, those lit in the scene buffer, and
 *   those that read the same with and without the city there (holes).
 *   `sceneLitMean` is over the `sceneLit` pixels only.
 */
export function classifyCityPixels({width, height, dayWith, dayWithout, sceneWith, sceneWithout, lightsWith}) {
  const out = {city: 0, dayLit: 0, dayCodes: {}, dayMax: [0, 0, 0], lightsAdded: 0, lightsMax: [0, 0, 0],
    sceneLit: 0, sceneMax: [0, 0, 0], sceneLitMean: [0, 0, 0], holes: 0}
  for (let i = 0; i < width * height; i++) {
    const o = 4 * i
    let city = false
    for (let k = 0; k < 4; k++) {
      city ||= dayWith[o + k] !== dayWithout[o + k]
    }
    if (!city) {
      continue
    }
    out.city++
    const rgb = [dayWith[o], dayWith[o + 1], dayWith[o + 2]]
    if (rgb.some((v) => v > 0)) {
      out.dayLit++
      const key = rgb.join(',')
      out.dayCodes[key] = (out.dayCodes[key] ?? 0) + 1
      rgb.forEach((v, k) => {
        out.dayMax[k] = Math.max(out.dayMax[k], v)
      })
    }
    if (lightsWith && [0, 1, 2].some((k) => lightsWith[o + k] > 0)) {
      out.lightsAdded++
      for (let k = 0; k < 3; k++) {
        out.lightsMax[k] = Math.max(out.lightsMax[k], lightsWith[o + k])
      }
    }
    const s = [sceneWith[o], sceneWith[o + 1], sceneWith[o + 2]]
    if (s.some((v) => v !== 0)) {
      out.sceneLit++
      s.forEach((v, k) => {
        out.sceneMax[k] = Math.max(out.sceneMax[k], v)
        out.sceneLitMean[k] += v
      })
      if (s.every((v, k) => v === sceneWithout[o + k])) {
        out.holes++
      }
    }
  }
  // Over the lit pixels only (sceneLit of them), not the city's
  out.sceneLitMean = out.sceneLitMean.map((v) => (out.sceneLit ? v / out.sceneLit : 0))
  out.dayCodes = Object.fromEntries(Object.entries(out.dayCodes).sort((a, b) => b[1] - a[1]).slice(0, 12))
  return out
}


/**
 * Watch `seconds` of the app's frames, then report.
 *
 * @param {object} layers CesiumLayers
 * @param {object} [options]
 * @param {number} [options.seconds]
 * @returns {Promise<object>} The report
 */
export async function runNewYorkDebug(layers, {seconds = 10} = {}) {
  const nyc = layers._newYork
  const earth = layers.bodies.earth
  if (!nyc?.city || !earth?.widget) {
    return {status: nyc?.status ?? 'off', earth: earth?.status ?? null,
      note: 'the city is not loaded: turn it on and fly over Manhattan first'}
  }
  const city = nyc.city
  const gl = layers.ui.renderer.getContext()
  const proto = Object.getPrototypeOf(gl)
  const rows = []
  let cur = null
  let inCity = false
  const undo = []
  // Each hook is wrap(self, prev, args), in place of obj[name] until undone
  const hook = (obj, name, wrap) => {
    const own = Object.prototype.hasOwnProperty.call(obj, name)
    const prev = obj[name]
    obj[name] = function(...args) {
      return wrap(this, prev, args)
    }
    undo.push(() => {
      if (own) {
        obj[name] = prev
      } else {
        delete obj[name]
      }
    })
  }
  const countDraw = (self, prev, args) => {
    if (inCity && self === gl && cur) {
      cur.cityDraws++
    }
    return prev.apply(self, args)
  }
  for (const name of DRAWS.filter((n) => typeof proto[n] === 'function')) {
    hook(proto, name, countDraw)
  }
  hook(layers, 'composite', (self, prev, args) => {
    cur = {t: performance.now(), cesiumRenders: 0, lightsFrames: 0, calls: [], cityDraws: 0, shown: city.renderer.show}
    try {
      return prev.apply(self, args)
    } finally {
      rows.push(cur)
      cur = null
    }
  })
  hook(layers, '_drawNightLights', (self, prev, args) => {
    if (cur) {
      cur.lightsFrames++
    }
    return prev.apply(self, args)
  })
  hook(earth.widget, 'render', (self, prev, args) => {
    if (cur) {
      cur.cesiumRenders++
    }
    return prev.apply(self, args)
  })
  hook(city.renderer, 'render', (self, prev, args) => {
    const staged = (city.stage?.chunks ?? 0) > 0
    inCity = true
    try {
      return prev.apply(self, args)
    } finally {
      inCity = false
      cur?.calls.push({staged, frustum: args[0]?.frustumIndex ?? null})
    }
  })
  try {
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000))
  } finally {
    for (const u of undo.reverse()) {
      u()
    }
  }
  // The night lights' frame with the city black (now), and hidden (before)
  const pixels = await capturePixels(layers, city)
  layers._newYorkLightsHidden = true
  let pixelsLightsHidden
  try {
    pixelsLightsHidden = await capturePixels(layers, city)
  } finally {
    delete layers._newYorkLightsHidden
  }
  // The passes after the composite, each switched off in turn
  const passes = await capturePasses(layers, city)
  const scene = earth.widget.scene
  const info = gl.getExtension('WEBGL_debug_renderer_info')
  const guest = city.guest
  return {
    frames: summarizeFrames(rows),
    pixels,
    pixelsLightsHidden,
    passes,
    gpu: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null,
    exposure: layers.ui.renderer.toneMappingExposure,
    meterGoal: layers.ui._meterGainGoal ?? null,
    heightM: earth.heightM,
    cameraUnderground: scene.cameraUnderground ?? null,
    terrain: scene.terrainProvider?.constructor?.name ?? null,
    lightsShow: layers._lightsShow(earth),
    stage: city.stage ? {...city.stage.stats, chunksWaiting: city.stage.chunks, queued: city.stage.queued} : null,
    replayErrors: city.replayErrors,
    guest: {
      preset: guest.lighting?.activePresetId ?? null,
      sun: guest.lighting?.sunLight?.intensity ?? null,
      sky: guest.lighting?.hemiLight?.intensity ?? null,
      environment: guest.scene?.environmentIntensity ?? null,
      daylight: guest.celestiary?.daylight?.value ?? null,
      occlude: guest.celestiary?.occlude?.value ?? null,
    },
  }
}


/**
 * Two of the app's frames read back, one with the city and one without
 * (classifyCityPixels).  Reads stall the GPU: a diagnostic only.
 *
 * @param {object} layers CesiumLayers
 * @param {object} city
 * @returns {Promise<object>}
 */
async function capturePixels(layers, city) {
  const renderer = layers.ui.renderer
  const sceneRT = layers.ui._sceneRT
  if (!sceneRT) {
    return null
  }
  const width = sceneRT.width
  const height = sceneRT.height
  const readScene = () => {
    const type = sceneRT.texture.type
    const n = width * height * 4
    if (type === 1016) {
      // HalfFloatType
      const raw = new Uint16Array(n)
      renderer.readRenderTargetPixels(sceneRT, 0, 0, width, height, raw)
      return Float32Array.from(raw, halfToFloat)
    }
    if (type === 1015) {
      const raw = new Float32Array(n)
      renderer.readRenderTargetPixels(sceneRT, 0, 0, width, height, raw)
      return raw
    }
    const raw = new Uint8Array(n)
    renderer.readRenderTargetPixels(sceneRT, 0, 0, width, height, raw)
    return Float32Array.from(raw, (v) => v / 255)
  }
  let want = null
  let got = null
  let done = null
  const undo = []
  const hook = (name, wrap) => {
    const own = Object.prototype.hasOwnProperty.call(layers, name)
    const prev = layers[name]
    layers[name] = function(...args) {
      return wrap(this, prev, args)
    }
    undo.push(() => {
      if (own) {
        layers[name] = prev
      } else {
        delete layers[name]
      }
    })
  }
  hook('_updateNewYork', (self, prev, args) => {
    const out = prev.apply(self, args)
    if (want === 'without') {
      city.renderer.show = false
    }
    return out
  })
  hook('_decodeInto', (self, prev, args) => {
    const [, cesiumRT, name] = args
    if (want && name === 'earth') {
      got.day = new Uint8Array(width * height * 4)
      renderer.readRenderTargetPixels(cesiumRT, 0, 0, width, height, got.day)
    }
    return prev.apply(self, args)
  })
  hook('_drawNightLights', (self, prev, args) => {
    if (!want || args[2] !== 'earth') {
      return prev.apply(self, args)
    }
    const before = readScene()
    const out = prev.apply(self, args)
    const after = readScene()
    got.lights = after.map((v, i) => v - before[i])
    return out
  })
  hook('composite', (self, prev, args) => {
    const out = prev.apply(self, args)
    if (want) {
      got.scene = readScene()
      done?.()
    }
    return out
  })
  // The second frame of each: the first after a switch can lag it
  // A frame's composite, or 10 s without one (Earth's layer not drawn)
  const nextFrame = () => new Promise((resolve) => {
    const timer = setTimeout(resolve, 10000)
    done = () => {
      clearTimeout(timer)
      resolve()
    }
  })
  const frames = async (mode) => {
    want = mode
    got = {}
    await nextFrame()
    got = {}
    await nextFrame()
    want = null
    return got
  }
  try {
    const withCity = await frames('with')
    const without = await frames('without')
    if (!withCity.day || !without.day) {
      return {note: 'Earth\'s layer drew no day frame'}
    }
    return classifyCityPixels({width, height, dayWith: withCity.day, dayWithout: without.day,
      sceneWith: withCity.scene, sceneWithout: without.scene, lightsWith: withCity.lights ?? null})
  } finally {
    for (const u of undo.reverse()) {
      u()
    }
  }
}


/**
 * @param {Uint8Array} canvas RGBA bytes
 * @param {Uint8Array} mask 1 where counted
 * @returns {{n: number, lit: number, mean: Array<number>}} The pixels, those
 *   over 0, and the mean byte over all of them
 */
export function canvasOver(canvas, mask) {
  let n = 0
  let lit = 0
  const sum = [0, 0, 0]
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) {
      continue
    }
    n++
    const o = 4 * i
    if (canvas[o] > 0 || canvas[o + 1] > 0 || canvas[o + 2] > 0) {
      lit++
    }
    for (let k = 0; k < 3; k++) {
      sum[k] += canvas[o + k]
    }
  }
  return {n, lit, mean: sum.map((v) => +(v / Math.max(1, n)).toFixed(3))}
}


/**
 * The final frame (after the atmosphere pass and the tone map, before the
 * labels) over the city's pixels and the ground's, as drawn and with each
 * pass after the composite switched off in turn: the cloud shell, the
 * volumetric clouds, the night sky (the galaxy's march, the zodiacal light,
 * the airglow), the airglow alone, the whole atmosphere pass.  The one whose
 * absence takes the light away is the one that adds it.
 *
 * @param {object} layers CesiumLayers
 * @param {object} city
 * @returns {Promise<object>}
 */
async function capturePasses(layers, city) {
  const ui = layers.ui
  const renderer = ui.renderer
  const gl = renderer.getContext()
  const sceneRT = ui._sceneRT
  const u = ui._atmMesh?.material?.uniforms
  if (!sceneRT || !u) {
    return null
  }
  const width = sceneRT.width
  const height = sceneRT.height
  let want = null
  let got = null
  let done = null
  const undo = []
  const hook = (obj, name, wrap) => {
    const own = Object.prototype.hasOwnProperty.call(obj, name)
    const prev = obj[name]
    obj[name] = function(...args) {
      return wrap(this, prev, args)
    }
    undo.push(() => {
      if (own) {
        obj[name] = prev
      } else {
        delete obj[name]
      }
    })
    return prev
  }
  // Each switch, on while `want` names it
  const off = {}
  hook(layers, '_updateNewYork', (self, prev, args) => {
    const out = prev.apply(self, args)
    if (want === 'withoutCity') {
      city.renderer.show = false
    }
    return out
  })
  hook(layers, '_decodeInto', (self, prev, args) => {
    const [, cesiumRT, name] = args
    if (want && name === 'earth') {
      got.day = new Uint8Array(width * height * 4)
      renderer.readRenderTargetPixels(cesiumRT, 0, 0, width, height, got.day)
    }
    return prev.apply(self, args)
  })
  hook(ui, '_drawCloudVolume', (self, prev, args) => {
    if (want === 'noCloudVolume') {
      self._setCloudComposite(null)
      return undefined
    }
    return prev.apply(self, args)
  })
  hook(ui, '_updateNightSkyShown', (self, prev, args) => {
    const out = prev.apply(self, args)
    if (want === 'noNightSky') {
      self._nightSkyShown = false
      if (self._milkyWay?.userData.galaxy) {
        self._milkyWay.userData.galaxy.skip = true
      }
    }
    return out
  })
  hook(ui, '_updateAtmUniforms', (self, prev, args) => {
    const out = prev.apply(self, args)
    if (want === 'noAirglow') {
      u.uAirglow.value.set(0, 0, 0, 0)
    } else if (want === 'noAtmosphere') {
      u.uAtmEnabled.value = 0
    }
    return out
  })
  // Right after the atmosphere pass drew the frame, to the canvas
  hook(ui, '_meter', (self, prev, args) => {
    if (want) {
      got.canvas = new Uint8Array(width * height * 4)
      renderer.setRenderTarget(null)
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, got.canvas)
      done?.()
    }
    return prev.apply(self, args)
  })
  const clouds = ui.sceneManager?.objects?.earth?.clouds ?? null
  const nextFrame = () => new Promise((resolve) => {
    const timer = setTimeout(resolve, 10000)
    done = () => {
      clearTimeout(timer)
      resolve()
    }
  })
  const frames = async (mode) => {
    want = mode
    const shellMask = clouds?.layers.mask
    if (mode === 'noCloudShell' && clouds) {
      off.shell = true
      clouds.layers.set(31)
    }
    try {
      got = {}
      await nextFrame()
      got = {}
      await nextFrame()
    } finally {
      if (off.shell && clouds) {
        clouds.layers.mask = shellMask
        off.shell = false
      }
      want = null
    }
    return got
  }
  try {
    const base = await frames('base')
    const without = await frames('withoutCity')
    if (!base.day || !without.day || !base.canvas) {
      return {note: 'Earth\'s layer drew no day frame'}
    }
    const cityMask = new Uint8Array(width * height)
    const groundMask = new Uint8Array(width * height)
    for (let i = 0; i < width * height; i++) {
      const o = 4 * i
      for (let k = 0; k < 4; k++) {
        if (base.day[o + k] !== without.day[o + k]) {
          cityMask[i] = 1
        }
      }
      if (!cityMask[i] && without.day[o + 3] > 0) {
        groundMask[i] = 1
      }
    }
    const out = {base: {city: canvasOver(base.canvas, cityMask), ground: canvasOver(base.canvas, groundMask)}}
    for (const mode of ['noCloudShell', 'noCloudVolume', 'noNightSky', 'noAirglow', 'noAtmosphere']) {
      const f = await frames(mode)
      out[mode] = f.canvas ? {city: canvasOver(f.canvas, cityMask), ground: canvasOver(f.canvas, groundMask)} : null
    }
    return out
  } finally {
    for (const un of undo.reverse()) {
      un()
    }
  }
}
