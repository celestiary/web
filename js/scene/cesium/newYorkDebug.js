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
 *   those that read the same with and without the city there (holes)
 */
export function classifyCityPixels({width, height, dayWith, dayWithout, sceneWith, sceneWithout, lightsWith}) {
  const out = {city: 0, dayLit: 0, dayCodes: {}, dayMax: [0, 0, 0], lightsAdded: 0, lightsMax: [0, 0, 0],
    sceneLit: 0, sceneMax: [0, 0, 0], sceneMean: [0, 0, 0], holes: 0}
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
        out.sceneMean[k] += v
      })
      if (s.every((v, k) => v === sceneWithout[o + k])) {
        out.holes++
      }
    }
  }
  out.sceneMean = out.sceneMean.map((v) => (out.sceneLit ? v / out.sceneLit : 0))
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
  const scene = earth.widget.scene
  const info = gl.getExtension('WEBGL_debug_renderer_info')
  const guest = city.guest
  return {
    frames: summarizeFrames(rows),
    pixels,
    pixelsLightsHidden,
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
