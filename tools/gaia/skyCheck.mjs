#!/usr/bin/env node
// Checks the point-population engine in the app (js/scene/Gaia.md,
// "Checks"), in headless Chromium on SwiftShader, against a built docs/:
//
//   node tools/gaia/skyCheck.mjs [--tiles DIR] [--out DIR] [--width 480 --height 300]
//
// --tiles serves large/gaia/v1/ from DIR (a population built by
// `yarn gaia catalogue --out DIR`, or the real tiles); without it the page
// loads what docs/ has.  It reports, and with --out writes PNGs and
// report.json:
//
// - progress: the population's tiles and points over the first seconds;
// - same: the catalogue's own points against the population's drawing of
//   the same stars (a test population of stars.dat), every point drawn,
//   pixel by pixel; and with the default margin, what the margin leaves out;
// - budget: the points drawn with a small budget;
// - telescope: the tiles a 1° field at +5 mag pages in;
// - cost: draw calls and points in the scene pass (?perf=1), with and
//   without the population.
//
// Not in `yarn precommit`: it needs a build and a browser.
import {createServer} from 'node:http'
import {mkdirSync, readFileSync, writeFileSync, existsSync} from 'node:fs'
import {extname, join, resolve} from 'node:path'
import {chromium} from 'playwright'


const CHROMIUM_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
const MIME = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.vert': 'text/plain', '.frag': 'text/plain', '.glsl': 'text/plain', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.bin': 'application/octet-stream', '.dat': 'application/octet-stream', '.svg': 'image/svg+xml'}
// Deep space, 4.7 AU over the Sun's north, labels, orbits and the galaxy
// off, at the date of the HDR.md measurements (2026).
const VIEW = '#sun@60,0,0.7Tm;t=9771.1jd;cq=0,0,0,1;fov=45deg;s=poU'


/** @returns {object} */
function parseArgs() {
  const out = {}
  const a = process.argv.slice(2)
  for (let i = 0; i < a.length; i += 2) {
    out[a[i].replace(/^--/, '')] = a[i + 1]
  }
  return out
}


/**
 * @param {string} root
 * @returns {Promise<{server: object, url: string}>}
 */
function serve(root) {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    let file = join(root, path)
    if (path.endsWith('/')) {
      file = join(file, 'index.html')
    }
    if (!file.startsWith(root) || !existsSync(file)) {
      res.writeHead(404)
      res.end()
      return
    }
    res.writeHead(200, {'content-type': MIME[extname(file)] ?? 'application/octet-stream'})
    res.end(readFileSync(file))
  })
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({server, url: `http://127.0.0.1:${server.address().port}/`})))
}


/**
 * Render one frame now and read it back, in one task (the drawing buffer
 * is cleared once it ends).  `setup` runs in the page first.
 *
 * @param {object} page
 * @param {string} setup A function's source, (c) => void
 * @returns {Promise<{width: number, height: number, data: Buffer, png: string}>}
 */
async function capture(page, setup) {
  const shot = await page.evaluate(async (src) => {
    const c = window.c
    // eslint-disable-next-line no-new-func
    await (new Function('c', `return (${src})(c)`))(c)
    c.shared.targets.tween = null
    c.ui.renderLoop(performance.now())
    c.shared.targets.tween = null
    c.ui.renderLoop(performance.now())
    const gl = c.ui.renderer.getContext()
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    const w = gl.drawingBufferWidth
    const h = gl.drawingBufferHeight
    const bytes = new Uint8Array(w * h * 4)
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, bytes)
    let binary = ''
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    }
    return {width: w, height: h, base64: btoa(binary), png: c.ui.renderer.domElement.toDataURL('image/png').split(',')[1]}
  }, setup)
  return {width: shot.width, height: shot.height, data: Buffer.from(shot.base64, 'base64'), png: shot.png}
}


/**
 * @param {object} a capture()
 * @param {object} b
 * @returns {object} How the two frames differ, by luminance (0-255)
 */
function compare(a, b) {
  let differ = 0
  let maxDiff = 0
  let sumA = 0
  let sumB = 0
  let litA = 0
  let litB = 0
  const n = a.width * a.height
  for (let i = 0; i < n; i++) {
    const la = (a.data[4 * i] + a.data[(4 * i) + 1] + a.data[(4 * i) + 2]) / 3
    const lb = (b.data[4 * i] + b.data[(4 * i) + 1] + b.data[(4 * i) + 2]) / 3
    sumA += la
    sumB += lb
    litA += la >= 10 ? 1 : 0
    litB += lb >= 10 ? 1 : 0
    const d = Math.abs(la - lb)
    if (d > 0) {
      differ++
    }
    maxDiff = Math.max(maxDiff, d)
  }
  return {pixels: n, differ, maxDiff: Math.round(maxDiff * 10) / 10, sumRatio: sumB / Math.max(sumA, 1e-9), litA, litB}
}


/**
 * Run the page's own frames until the population has nothing in flight.
 *
 * @param {object} page
 * @param {number} [ms]
 * @returns {Promise<object>} Its stats
 */
function settlePopulation(page, ms = 60000) {
  return page.evaluate(async (limit) => {
    const c = window.c
    const g = c.scene.gaia
    const end = performance.now() + limit
    let quiet = 0
    while (performance.now() < end) {
      c.shared.targets.tween = null
      c.ui.renderLoop(performance.now())
      await new Promise((r) => setTimeout(r, 20))
      quiet = (g.inFlight.size === 0 && g.stats().missing === 0) ? quiet + 1 : 0
      if (quiet >= 3) {
        break
      }
    }
    return g.stats()
  }, ms)
}


const opts = parseArgs()
const width = parseInt(opts.width ?? '480')
const height = parseInt(opts.height ?? '300')
const docs = resolve(opts.docs ?? 'docs')
const tiles = opts.tiles ? resolve(opts.tiles) : null
const out = opts.out ? resolve(opts.out) : null
if (out) {
  mkdirSync(out, {recursive: true})
}
const {server, url} = await serve(docs)
const browser = await chromium.launch({args: CHROMIUM_ARGS})
const report = {view: VIEW, viewport: [width, height], tiles: tiles ?? 'docs/large/gaia/v1'}
try {
  const page = await browser.newPage({viewport: {width, height}})
  page.on('console', (m) => {
    if (m.type() === 'error' || /Shader Error/.test(m.text())) {
      console.warn(`[page] ${m.text().slice(0, 300)}`)
    }
  })
  await page.route(/googletagmanager\.com/, (route) => route.abort())
  if (tiles) {
    await page.route(/\/large\/gaia\/v1\//, (route) => {
      const rel = new URL(route.request().url()).pathname.replace(/^.*\/large\/gaia\/v1\//, '')
      const file = join(tiles, rel)
      if (!existsSync(file)) {
        return route.fulfill({status: 404})
      }
      return route.fulfill({status: 200, body: readFileSync(file),
        contentType: rel.endsWith('.json') ? 'application/json' : 'application/octet-stream'})
    })
  }
  await page.goto(`${url}?perf=1${VIEW}`)
  await page.waitForFunction(() => window.c?.scene?.stars?.catalog?.numStars > 0 && window.c.scene.gaia, null,
      {timeout: 120000})
  // Look straight away from the Sun.
  await page.evaluate(() => {
    const cam = window.c.ui.camera
    const p = cam.getWorldPosition(cam.position.clone())
    cam.lookAt(p.multiplyScalar(2))
  })
  // Hold the frame still: no animation loop, no meter, the clock paused;
  // and the exposure at the dark-adapted gain (exposure.js METER_GAIN_MAX,
  // 4e6 over the keyed exposure: the naked eye's limit, 6.5), so the
  // frames are the night sky's whatever the meter made of the view.
  report.meteredGain = await page.evaluate(() => window.c.ui._meterGain)
  report.limitAfterDarkGain = await page.evaluate(async () => {
    const c = window.c
    c.ui.renderer.setAnimationLoop(null)
    c.ui._meter = () => {}
    c.time.isPaused = true
    c.ui._meterGain = c.ui._meterGainGoal = 4e6
    const end = performance.now() + 60000
    while (performance.now() < end && Math.abs(c.ui.limitingMagnitude() - 6.5) > 0.02) {
      c.shared.targets.tween = null
      c.ui.renderLoop(performance.now())
      await new Promise((r) => setTimeout(r, 10))
    }
    return c.ui.limitingMagnitude()
  })
  // The population loading, frame by frame, at the dark-adapted gain: its
  // tiles and the points it draws, until nothing it wants is missing.
  report.progress = await page.evaluate(async () => {
    const c = window.c
    const g = c.scene.gaia
    const t0 = performance.now()
    const samples = []
    let next = 0
    while (performance.now() - t0 < 60000) {
      c.shared.targets.tween = null
      c.ui.renderLoop(performance.now())
      await new Promise((r) => setTimeout(r, 10))
      const s = g.stats()
      const ms = performance.now() - t0
      if (ms >= next || (s.missing === 0 && s.inFlight === 0)) {
        samples.push({ms: Math.round(ms), loadedTiles: s.loadedTiles, loadedPoints: s.loadedPoints, drawn: s.drawn,
          requests: s.requests, missing: s.missing, limit: s.limit})
        next += 250
      }
      if (s.missing === 0 && s.inFlight === 0 && s.requests > 0) {
        break
      }
    }
    return samples
  })
  report.limitingMagnitude = await page.evaluate(() => window.c.ui.limitingMagnitude())
  const catalogueOnly = await capture(page, `(c) => {
    c.scene.gaia.visible = false
    c.scene.stars.getObjectByName('StarsPoints').visible = true
  }`)
  report.populationAll = await page.evaluate(async () => {
    const g = window.c.scene.gaia
    g.marginMag = 30
    g.visible = true
    window.c.scene.stars.getObjectByName('StarsPoints').visible = false
    return g.stats()
  })
  report.populationAll = await settlePopulation(page)
  const populationAll = await capture(page, '(c) => {}')
  report.populationAllDrawn = await page.evaluate(() => window.c.scene.gaia.stats())
  await page.evaluate(() => {
    window.c.scene.gaia.marginMag = 1
  })
  await settlePopulation(page)
  const populationMargin = await capture(page, '(c) => {}')
  report.populationMarginDrawn = await page.evaluate(() => window.c.scene.gaia.stats())
  report.same = compare(catalogueOnly, populationAll)
  report.margin = compare(catalogueOnly, populationMargin)
  // The cost: draws and points in the scene pass, the population drawing
  // every point, against the catalogue alone.
  report.cost = await page.evaluate(async () => {
    const c = window.c
    const g = c.scene.gaia
    const info = c.ui.renderer.info
    const measure = (label) => {
      info.autoReset = false
      info.reset()
      c.shared.targets.tween = null
      const t0 = performance.now()
      c.ui.renderLoop(performance.now())
      c.ui.renderer.getContext().finish()
      const ms = performance.now() - t0
      const r = {label, calls: info.render.calls, points: info.render.points, frameMs: Math.round(ms)}
      info.autoReset = true
      return r
    }
    const stars = c.scene.stars.getObjectByName('StarsPoints')
    stars.visible = true
    g.visible = false
    const a = measure('catalogue only')
    stars.visible = false
    g.visible = true
    g.marginMag = 30
    const b = measure('population only, every point')
    g.marginMag = 1
    const d = measure('population only, margin 1')
    stars.visible = true
    g.visible = true
    const e = measure('both, margin 1')
    return [a, b, d, e, {perf: window.perf?.snapshot?.()?.totals ?? null}]
  })
  // The budget.
  report.budget = await page.evaluate(() => {
    const c = window.c
    const g = c.scene.gaia
    g.marginMag = 30
    g.budget = 20000
    c.shared.targets.tween = null
    c.ui.renderLoop(performance.now())
    const s = g.stats()
    g.budget = 500000
    g.marginMag = 1
    return s
  })
  // A telescope: a 1° field, five magnitudes deeper, on the densest part of
  // the test population's tree.
  report.telescope = await page.evaluate(async () => {
    const c = window.c
    const g = c.scene.gaia
    const deepest = [...g.tiles.values()].sort((a, b) => b.order - a.order)[0]
    const before = new Set(g.loaded.keys())
    // Turn the camera to that tile's centre (catalogue frame → world).
    const cam = c.ui.camera
    const centre = cam.position.clone().set(...deepest.centre).transformDirection(g.matrixWorld)
    const p = cam.getWorldPosition(cam.position.clone())
    cam.lookAt(p.add(centre.multiplyScalar(1e20)))
    cam.fov = 1
    cam.updateProjectionMatrix()
    c.ui.setStarMagnitudeOffset(5)
    const end = performance.now() + 60000
    let quiet = 0
    while (performance.now() < end && quiet < 3) {
      c.shared.targets.tween = null
      c.ui.renderLoop(performance.now())
      await new Promise((r) => setTimeout(r, 20))
      quiet = (g.inFlight.size === 0 && g.stats().missing === 0) ? quiet + 1 : 0
    }
    const added = [...g.loaded.keys()].filter((k) => !before.has(k))
    return {aimedAt: deepest.key, limit: c.ui.limitingMagnitude(), added, stats: g.stats()}
  })
  if (out) {
    writeFileSync(join(out, 'catalogue-only.png'), Buffer.from(catalogueOnly.png, 'base64'))
    writeFileSync(join(out, 'population-all.png'), Buffer.from(populationAll.png, 'base64'))
    writeFileSync(join(out, 'population-margin1.png'), Buffer.from(populationMargin.png, 'base64'))
    writeFileSync(join(out, 'report.json'), `${JSON.stringify(report, null, 1)}\n`)
  }
  console.log(JSON.stringify(report, null, 1))
} finally {
  await browser.close()
  server.close()
}
