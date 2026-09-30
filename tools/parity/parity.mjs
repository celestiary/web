#!/usr/bin/env node
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {chromium} from 'playwright'
import {allPass, evaluateView, formatTable, measureView, terminatorLine} from './measure.mjs'


/**
 * Cesium-vs-celestiary parity check: `yarn parity`.  See CESIUM.md, "Parity
 * check".
 *
 * For each view in views.json, render it in headless Chromium with the body's
 * Cesium layer forced fully on and then fully off (`c.ui.layers.fadeOf`),
 * once its tiles and frames have settled; compare the two renders (median
 * pixel ratios over the lit region, brightness profile across the
 * terminator); print one table of metric, value, tolerance and PASS/FAIL;
 * exit 1 if anything failed.
 *
 * Needs a build in docs/ (`yarn build`, with CESIUM_ION_TOKEN set for the
 * Moon and Mars, and Earth's ion terrain).  It doesn't build one itself.
 *
 * Usage: yarn parity [--only id,id] [--out dir] [--views file] [--docs dir]
 *                    [--viewport WxH] [--timeout seconds] [--list]
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_VIEWS = path.join(HERE, 'views.json')
const DEFAULT_DOCS = path.join(HERE, '..', '..', 'docs')
const DEFAULT_TIMEOUT_S = 1800
// The page's frame loop is slow on SwiftShader; poll the readiness signals
// every so often rather than per frame.
const POLL_MS = 1000
// How often to say what a slow wait is waiting for.
const NOTE_EVERY_MS = 30000
// Frames the tiles must stay loaded and the network idle for, to call the
// view settled: Cesium requests tiles from its render loop, so "loaded" can
// read true for a frame before the next round of requests goes out.
const SETTLE_FRAMES = 6
const ION_HOSTS = /^https:\/\/(api\.cesium\.com|assets\.ion\.cesium\.com)\//
// ion's token is restricted by Referer to the production site (AGENTS.md,
// Secrets).
const ION_HEADERS = {referer: 'https://celestiary.github.io/', origin: 'https://celestiary.github.io'}
const CHROMIUM_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
const EXIT_FAIL = 1
const EXIT_SETUP = 2
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.map': 'application/json',
}


/**
 * @param {Array<string>} argv
 * @returns {object} Parsed options
 */
function parseArgs(argv) {
  const opts = {views: DEFAULT_VIEWS, docs: DEFAULT_DOCS, timeout: DEFAULT_TIMEOUT_S, only: null, out: null, list: false}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const value = () => {
      if (i + 1 >= argv.length) {
        throw new Error(`${arg} needs a value`)
      }
      return argv[++i]
    }
    switch (arg) {
      case '--views': opts.views = path.resolve(value()); break
      case '--docs': opts.docs = path.resolve(value()); break
      case '--out': opts.out = path.resolve(value()); break
      case '--only': opts.only = value().split(',').map((s) => s.trim()); break
      case '--timeout': opts.timeout = Number(value()); break
      case '--viewport': opts.viewport = value().split('x').map(Number); break
      case '--list': opts.list = true; break
      default: throw new Error(`unknown argument ${arg}`)
    }
  }
  return opts
}


/**
 * @param {string} root Directory to serve
 * @returns {Promise<{url: string, close: function(): void}>} A static server
 *   on an ephemeral local port; unknown paths get index.html, as the app's
 *   routes expect.
 */
async function serve(root) {
  const server = http.createServer((req, res) => {
    const requested = path.join(root, decodeURIComponent(new URL(req.url, 'http://localhost').pathname))
    const inside = requested.startsWith(root)
    const file = inside && fs.existsSync(requested) && fs.statSync(requested).isFile() ?
      requested : path.join(root, 'index.html')
    res.writeHead(200, {'content-type': MIME[path.extname(file)] ?? 'application/octet-stream'})
    fs.createReadStream(file).pipe(res)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close()}
}


/**
 * Send ion requests through Node with the Referer the token requires, and
 * hand the answer back to the page with CORS open.  Counts answers by status
 * only: ion's error bodies echo the token, so no body or query string is
 * ever logged.
 *
 * @param {object} page
 * @returns {object} Counts of ion answers by status, and of failed fetches
 */
async function routeIon(page) {
  const stats = {statuses: {}, failed: 0}
  await page.route(ION_HOSTS, async (route) => {
    try {
      // Keep the page's own headers (ion's asset requests carry a bearer
      // token): route.fetch replaces them when given `headers`.
      const headers = {...await route.request().allHeaders(), ...ION_HEADERS}
      const response = await route.fetch({headers})
      stats.statuses[response.status()] = (stats.statuses[response.status()] ?? 0) + 1
      await route.fulfill({response, headers: {...response.headers(), 'access-control-allow-origin': '*'}})
    } catch (err) {
      stats.failed++
      console.warn(`  ion request failed: ${err.name}`)
      await route.abort()
    }
  })
  return stats
}


/**
 * Requests in flight on the page, for "the network is idle".
 *
 * @param {object} page
 * @returns {{pending: function(): number}}
 */
function trackRequests(page) {
  const open = new Set()
  const ignored = (req) => ['eventsource', 'websocket', 'media'].includes(req.resourceType())
  page.on('request', (req) => ignored(req) || open.add(req))
  page.on('requestfinished', (req) => open.delete(req))
  page.on('requestfailed', (req) => open.delete(req))
  return {pending: () => open.size}
}


/**
 * @param {object} page
 * @param {string} body
 * @returns {Promise<object>} The layer's state in the page
 */
function layerState(page, body) {
  return page.evaluate((name) => {
    const layers = window.c.ui.layers
    const b = layers.bodies[name]
    const scene = b?.widget?.scene
    return {
      status: b?.status ?? 'none',
      shown: b?.shown === true,
      active: layers.active.some((a) => a.name === name),
      tilesLoaded: scene?.globe ? scene.globe.tilesLoaded : b?.tileset?.tilesLoaded === true,
      terrain: scene?.globe?.terrainProvider?.constructor?.name ?? null,
      frame: window.c.ui.renderer.info.render.frame,
      restored: window.c.firstTime === false,
      target: window.c.shared.targets.cur?.props?.name ?? null,
    }
  }, body)
}


/**
 * Wait until the view is restored from its permalink, the body's Cesium
 * layer is in place and its tiles have loaded, the network has been idle,
 * and a few frames have gone by with nothing changing.  Fails fast if the
 * layer errors.
 *
 * @param {object} page
 * @param {object} view
 * @param {{pending: function(): number}} requests
 * @param {number} timeoutS
 * @returns {Promise<object>} The settled layer state
 */
async function waitSettled(page, view, requests, timeoutS) {
  const deadline = Date.now() + (timeoutS * 1000)
  let stableSince = null
  let state = null
  let lastNote = Date.now()
  while (Date.now() < deadline) {
    state = await layerState(page, view.body)
    if (state.status === 'error') {
      throw new Error(`the ${view.body} Cesium layer failed to load (see the page's console.error above)`)
    }
    const ready = state.restored && state.target === view.body && state.status === 'ready' &&
      state.shown && state.active && state.tilesLoaded && requests.pending() === 0
    if (Date.now() - lastNote > NOTE_EVERY_MS) {
      lastNote = Date.now()
      console.warn(`  ${view.id}: waiting; layer ${state.status}${state.tilesLoaded ? ', tiles loaded' : ''}` +
        `${state.active ? ', active' : ''}, ${requests.pending()} requests, frame ${state.frame}`)
    }
    if (!ready) {
      stableSince = null
    } else if (stableSince === null) {
      stableSince = state.frame
    } else if (state.frame - stableSince >= SETTLE_FRAMES) {
      return state
    }
    await page.waitForTimeout(POLL_MS)
  }
  throw new Error(
      `${view.body} not settled after ${timeoutS}s: ${JSON.stringify(state)}, ${requests.pending()} requests ` +
      'pending.  Was docs/ built with CESIUM_ION_TOKEN (Moon and Mars need it)?')
}


/**
 * Render the view now, with the layer forced to `fade` (1 = Cesium's, 0 =
 * celestiary's), and read the frame back.  Runs in the page, in one task, so
 * the drawing buffer still holds the frame.
 *
 * @param {object} page
 * @param {number} fade
 * @param {boolean} wantPng Also return a PNG of the frame
 * @returns {Promise<{image: object, png: string|null}>} The image (RGBA,
 *   top row first) and, if asked, the PNG as base64
 */
async function capture(page, fade, wantPng) {
  const shot = await page.evaluate(([fadeValue, png]) => {
    const {ui} = window.c
    ui.layers.fadeOf = () => fadeValue
    // Twice: the first frame applies the new fade to Cesium's sky and the
    // fading surface; the second is the one read.
    ui.renderLoop(performance.now())
    ui.renderLoop(performance.now())
    const gl = ui.renderer.getContext()
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    const width = gl.drawingBufferWidth
    const height = gl.drawingBufferHeight
    const bytes = new Uint8Array(width * height * 4)
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bytes)
    // GL rows run bottom to top.
    const flipped = new Uint8Array(bytes.length)
    for (let y = 0; y < height; y++) {
      flipped.set(bytes.subarray(y * width * 4, (y + 1) * width * 4), (height - 1 - y) * width * 4)
    }
    let binary = ''
    const chunk = 0x8000
    for (let i = 0; i < flipped.length; i += chunk) {
      binary += String.fromCharCode(...flipped.subarray(i, i + chunk))
    }
    return {
      width,
      height,
      base64: btoa(binary),
      png: png ? ui.renderer.domElement.toDataURL('image/png').split(',')[1] : null,
    }
  }, [fade, wantPng])
  return {
    image: {width: shot.width, height: shot.height, data: Buffer.from(shot.base64, 'base64')},
    png: shot.png,
  }
}


/**
 * Where the body's disc lies in the render, and which way the Sun is from
 * it, in pixels.
 *
 * @param {object} page
 * @param {string} body
 * @returns {Promise<{disc: {cx: number, cy: number, r: number}, sun: Array<number>|null}>}
 *   `sun` is the unit vector, on screen, from the disc's centre toward the
 *   lit side; null at full or new phase, where it has no direction.
 */
function discGeometry(page, body) {
  return page.evaluate((name) => {
    const {ui} = window.c
    const THREE = window.c.three
    const node = ui.sceneManager.objects[name]
    const {camera} = ui
    const gl = ui.renderer.getContext()
    const width = gl.drawingBufferWidth
    const height = gl.drawingBufferHeight
    const center = node.getWorldPosition(new THREE.Vector3())
    const eye = camera.getWorldPosition(new THREE.Vector3())
    const radius = node.props.radius.scalar
    const distance = center.distanceTo(eye)
    const toPixels = (p) => {
      const ndc = p.clone().project(camera)
      return [(ndc.x + 1) / 2 * width, (1 - ndc.y) / 2 * height]
    }
    const [cx, cy] = toPixels(center)
    const halfFov = camera.fov * Math.PI / 360
    const r = Math.tan(Math.asin(radius / distance)) / Math.tan(halfFov) * height / 2
    const sunPos = ui.scene.getObjectByName('WorldGroup').getWorldPosition(new THREE.Vector3())
    const toSun = sunPos.sub(center).normalize()
    const [sx, sy] = toPixels(center.clone().addScaledVector(toSun, radius))
    const length = Math.hypot(sx - cx, sy - cy)
    return {
      disc: {cx, cy, r},
      sun: length > 1e-3 * r ? [(sx - cx) / length, (sy - cy) / length] : null,
    }
  }, body)
}


/**
 * @param {object} view A views.json entry
 * @param {object} geometry discGeometry's result
 * @param {{width: number, height: number}} size The render's size
 * @returns {object} The view with its region and profile resolved against the
 *   render: `region.disc: true` becomes the body's disc in pixels, and
 *   `profile.across: 'terminator'` a line along the Sun's direction, dark
 *   side to lit, from limb to limb (`reach` of the radius, to the image's
 *   edge if that's nearer).
 */
function resolveView(view, geometry, size) {
  const resolved = {...view}
  if (view.region.disc) {
    resolved.region = {disc: geometry.disc, inner: view.region.inner}
  }
  if (view.profile?.across === 'terminator') {
    if (!geometry.sun) {
      throw new Error(`${view.id}: no terminator to profile at this phase`)
    }
    const {from, to} = terminatorLine(geometry.disc, geometry.sun, size, view.profile.reach)
    resolved.profile = {...view.profile, from, to}
  }
  return resolved
}


/**
 * @param {string} file
 * @param {Array<string>|null} only
 * @returns {{defaults: object, views: Array<object>}}
 */
function loadViews(file, only) {
  const {defaults = {}, views} = JSON.parse(fs.readFileSync(file, 'utf8'))
  const chosen = only ? views.filter((v) => only.includes(v.id)) : views
  if (only) {
    const missing = only.filter((id) => !views.some((v) => v.id === id))
    if (missing.length > 0) {
      throw new Error(`no such view: ${missing.join(', ')}`)
    }
  }
  return {defaults, views: chosen}
}


/**
 * Run one view: load, settle, render on and off, measure.
 *
 * @param {object} context A browser context
 * @param {string} baseUrl
 * @param {object} view The view, defaults applied
 * @param {object} opts
 * @returns {Promise<object>} {rows, ratios, profile, state, ion, seconds, pngs}
 */
async function runView(context, baseUrl, view, opts) {
  const started = Date.now()
  const [width, height] = opts.viewport ?? view.viewport
  const page = await context.newPage()
  await page.setViewportSize({width, height})
  try {
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !/Failed to load resource|EventSource/.test(msg.text())) {
        console.warn(`  [page] ${msg.text().slice(0, 200)}`)
      }
    })
    const ion = await routeIon(page)
    const requests = trackRequests(page)
    // Analytics: not needed, and a hang on it would hold the network busy.
    await page.route(/googletagmanager\.com/, (route) => route.abort())
    await page.goto(`${baseUrl}${view.hash}`)
    await page.waitForFunction(() => window.c?.ui?.layers, null, {timeout: opts.timeout * 1000})
    // Force the layer fully on from the start: no crossfade to wait out.
    await page.evaluate(() => {
      window.c.ui.layers.fadeOf = () => 1
    })
    const state = await waitSettled(page, view, requests, opts.timeout)
    // Freeze the simulation, so the two renders are of the same instant.
    await page.evaluate(() => {
      window.c.time.isPaused = true
    })
    const geometry = await discGeometry(page, view.body)
    const on = await capture(page, 1, Boolean(opts.out))
    const off = await capture(page, 0, Boolean(opts.out))
    const after = await layerState(page, view.body)
    const resolved = resolveView(view, geometry, on.image)
    const measured = measureView(on.image, off.image, resolved)
    const rows = [
      {view: view.id, metric: 'cesium layer active', value: after.active ? 1 : 0, tolerance: '= 1', pass: after.active},
      ...evaluateView(view.id, measured, view.tolerance),
    ]
    return {
      rows,
      ratios: measured.ratios,
      profile: measured.profile,
      geometry,
      state: {before: state, after},
      ion,
      seconds: Math.round((Date.now() - started) / 1000),
      pngs: {on: on.png, off: off.png},
    }
  } finally {
    await page.close()
  }
}


/**
 * @param {string} dir
 * @param {object} results {id: runView's result}
 * @param {Array<object>} rows
 */
function writeReport(dir, results, rows) {
  fs.mkdirSync(dir, {recursive: true})
  const report = {}
  for (const [id, result] of Object.entries(results)) {
    const {pngs, ...rest} = result
    report[id] = rest
    for (const mode of ['on', 'off']) {
      if (pngs?.[mode]) {
        fs.writeFileSync(path.join(dir, `${id}-${mode}.png`), Buffer.from(pngs[mode], 'base64'))
      }
    }
  }
  fs.writeFileSync(path.join(dir, 'report.json'), `${JSON.stringify({pass: allPass(rows), rows, views: report}, null, 2)}\n`)
}


/**
 * @param {object} ion Counts of ion answers by status
 * @returns {string} A note if ion refused us
 */
function ionNote(ion) {
  return ion.statuses[401] ?
    'ion answered 401: the token in this build may be stale or not scoped to the site (AGENTS.md, Secrets).' :
    ''
}


/**
 * @returns {Promise<number>} The exit code
 */
async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const {defaults, views} = loadViews(opts.views, opts.only)
  if (opts.list) {
    for (const v of views) {
      console.log(`${v.id}\t${v.body}\t${v.description ?? ''}`)
    }
    return 0
  }
  if (!fs.existsSync(path.join(opts.docs, 'index.html'))) {
    console.error(`No build in ${opts.docs}.  Run \`yarn build\` first (with CESIUM_ION_TOKEN set).`)
    return EXIT_SETUP
  }
  if (!process.env.CESIUM_ION_TOKEN) {
    console.warn('CESIUM_ION_TOKEN is not set here; assuming the build in docs/ was made with it.')
  }
  const server = await serve(opts.docs)
  const browser = await chromium.launch({args: CHROMIUM_ARGS})
  const context = await browser.newContext()
  const results = {}
  const rows = []
  try {
    for (const raw of views) {
      const view = {...defaults, ...raw, tolerance: {...defaults.tolerance, ...raw.tolerance}}
      console.warn(`${view.id}: rendering ${view.body} ...`)
      try {
        const result = await runView(context, server.url, view, opts)
        results[view.id] = result
        rows.push(...result.rows)
        console.warn(`${view.id}: done in ${result.seconds}s ${ionNote(result.ion)}`.trimEnd())
      } catch (err) {
        console.warn(`${view.id}: ${err.message}`)
        rows.push({view: view.id, metric: 'ran', value: 0, tolerance: '= 1', pass: false})
        results[view.id] = {error: err.message}
      }
    }
  } finally {
    await context.close()
    await browser.close()
    server.close()
  }
  console.log(`\n${formatTable(rows)}`)
  const failed = rows.filter((r) => !r.pass).length
  console.log(`\n${views.length} views, ${rows.length} checks, ${failed} failed.`)
  if (opts.out) {
    writeReport(opts.out, results, rows)
    console.log(`Images and report.json in ${opts.out}`)
  }
  return failed === 0 ? 0 : EXIT_FAIL
}


try {
  process.exitCode = await main()
} catch (err) {
  console.error(err.message)
  process.exitCode = EXIT_SETUP
}
