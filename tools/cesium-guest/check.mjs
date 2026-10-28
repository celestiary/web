#!/usr/bin/env node
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {chromium} from 'playwright'


/**
 * The Cesium guest page's check (design/CesiumGuest.md): Earth's Cesium
 * layer drawn by Cesium on this page, and by the guest page on another
 * origin (`?cesium=iframe`), compared.
 *
 * It serves docs/ twice, as the app on 127.0.0.1 and the guest on
 * localhost (two sites, so Chromium puts the guest in a process of its
 * own), with CORS open: the guest fetches the Blue Marble from the app's.
 * For each mode it opens the view, waits for Earth's layer to be shown with
 * its tiles in, then:
 *   - pins the permalink's instant, lets the tiles settle, and reads a
 *     frame as it's drawn;
 *   - orbits the camera a little every frame for `--motion` seconds and
 *     counts the frames drawn and, for the guest, those drawn with the
 *     guest's frame of their own view (in step) and the round trips.
 * It exits non-zero if the two frames differ by more than one level
 * anywhere, or if a guest frame was out of step under motion.
 *
 * `--pan deg` adds the late-frame check (RFC 0003 §4; portal-netgl 0.6.10's
 * named targets, the celestiary/netgl-reproject Cesium patch), on the guest
 * page: the camera turned by `deg` about the body (B), the guest's own
 * frame of B (the truth); then the guest's frame of A composed at B, with
 * the guest held (no view posted, the last frame re-run), corrected and,
 * with `guestReproject` off, as it came.  It fails if the corrected frame
 * isn't nearer the truth than the uncorrected one.
 *
 * Needs a build in docs/ (`CESIUM_ION_TOKEN= yarn build`); it doesn't build.
 * Other hosts are refused: ion, GIBS (the clouds fall back to the bundled
 * map, and there are no night lights) and analytics.  `--gibs` lets GIBS
 * through, from Node, for the night lights (`--view earth-night`).
 *
 * Usage: yarn cesium-guest-check [--view earth-orbit|earth-12km|earth-night]
 *                                [--motion s] [--wait ms] [--viewport WxH]
 *                                [--pan deg]
 *                                [--out dir] [--docs dir] [--gibs]
 *                                [--nyc <slop-newyork checkout>]
 *                                [--chromium path]
 *
 * `--nyc` is the `nyc` view: Slop New York over Lower Manhattan, drawn by
 * Earth's Cesium on each side, from that checkout (`?nycGuest=`) and three.js
 * from GitHub; it passes if the city loads on both and replays without
 * error, and the frames are for comparing by eye (`--out`).  Minutes a side.
 *
 * `--chromium` is the browser to run, for a Playwright whose own isn't
 * installed; in a cloud session, where the machine's Chromium is a version
 * the repo's Playwright doesn't know, the link /opt/pw-browsers/chromium
 * is taken when it's there.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const VIEWS = {
  'earth-orbit': '#sun/earth@15,20.7446,20Mm;t=9233.1234jd;cq=-0.0108,0.9967,-0.0736,0.031;fov=45deg;s=alpoU',
  'earth-12km': '#sun/earth@25,-88,12km;t=2066.4167jd;cq=-0.3707,-0.4287,-0.0058,0.8239;fov=45deg;s=alpoU',
  // earth-orbit's, the camera then moved to Earth's night side (NIGHT): the
  // night lights' frame (with --gibs; refused, there are none).
  'earth-night': '#sun/earth@15,20.7446,20Mm;t=9233.1234jd;cq=-0.0108,0.9967,-0.0736,0.031;fov=45deg;s=alpoU',
}
// Views seen from Earth's night side: the camera put opposite the Sun, as far
// from Earth as the permalink put it, looking at Earth.
const NIGHT = new Set(['earth-night'])
// Slop New York over Lower Manhattan from 780 m, the clock paused
// (CHANGELOG's permalink), with --nyc: the city drawn by Earth's Cesium.
VIEWS.nyc = '#sun/earth@40.5025,-74.0298,780m;t=9792.377067jd;cq=0.2348,-0.1201,-0.2007,0.9435;fov=45deg;s=alpoU;' +
  'time:pause;layers:nyc'
// The city's three.js, as the pages' import map names it on jsDelivr (which
// the sandbox refuses), taken from GitHub's raw files instead, kept here.
const THREE_CDN = /^https:\/\/cdn\.jsdelivr\.net\/gh\/mrdoob\/three\.js@([0-9a-f]{40})\/(.*)$/
const THREE_CACHE = path.join(os.tmpdir(), 'celestiary-three')
const CHROMIUM_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
const MACHINE_CHROMIUM = '/opt/pw-browsers/chromium'
const BLOCKED = /googletagmanager|gibs\.earthdata\.nasa\.gov|api\.cesium\.com|assets\.ion\.cesium\.com/
const GIBS = /^https:\/\/gibs\.earthdata\.nasa\.gov\//
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.wasm': 'application/wasm', '.jpg': 'image/jpeg', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary',
}


/**
 * @param {Array<string>} argv
 * @returns {object}
 */
function parseArgs(argv) {
  const opts = {view: 'earth-orbit', motion: 20, wait: 3000, viewport: [480, 300], out: null,
    docs: path.join(HERE, '..', '..', 'docs'), chromium: fs.existsSync(MACHINE_CHROMIUM) ? MACHINE_CHROMIUM : null}
  for (let i = 0; i < argv.length; i++) {
    const [key, value] = [argv[i], argv[i + 1]]
    if (key === '--view') {
      opts.view = value
    } else if (key === '--pan') {
      opts.pan = Number(value)
    } else if (key === '--motion') {
      opts.motion = Number(value)
    } else if (key === '--wait') {
      opts.wait = Number(value)
    } else if (key === '--viewport') {
      opts.viewport = value.split('x').map(Number)
    } else if (key === '--out') {
      opts.out = value
    } else if (key === '--docs') {
      opts.docs = value
    } else if (key === '--nyc') {
      opts.nyc = value
      opts.view = 'nyc'
    } else if (key === '--gibs') {
      opts.gibs = true
      i--
    } else if (key === '--chromium') {
      opts.chromium = value
    } else {
      throw new Error(`unknown option ${key}`)
    }
    i++
  }
  if (opts.view === 'nyc') {
    if (!opts.nyc || !fs.existsSync(path.join(opts.nyc, 'js', 'guest-entry.mjs'))) {
      throw new Error('--nyc is a slop-newyork checkout (with js/guest-entry.mjs)')
    }
    // The camera stays over the city.
    opts.motion = 0
  }
  if (!VIEWS[opts.view]) {
    throw new Error(`--view is one of ${Object.keys(VIEWS).join(', ')}`)
  }
  return opts
}


/**
 * @param {string} root
 * @param {object} [options]
 * @param {boolean} [options.fallback] Answer a missing file with index.html
 *   (the app's routes), else 404 (slop-newyork's: its index.html is the app)
 * @returns {Promise<{port: number, close: Function}>} A static server with CORS open
 */
async function serve(root, {fallback = true} = {}) {
  const server = http.createServer((req, res) => {
    const requested = path.join(root, decodeURIComponent(new URL(req.url, 'http://localhost').pathname))
    const found = requested.startsWith(root) && fs.existsSync(requested) && fs.statSync(requested).isFile()
    if (!found && !fallback) {
      res.writeHead(404, {'access-control-allow-origin': '*'})
      res.end()
      return
    }
    const file = found ? requested : path.join(root, 'index.html')
    res.writeHead(200, {'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'access-control-allow-origin': '*'})
    fs.createReadStream(file).pipe(res)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {port: server.address().port, close: () => server.close()}
}


/**
 * Answer a request for the city's three.js on jsDelivr with GitHub's raw
 * file of that commit, fetched once and kept in THREE_CACHE.
 *
 * @param {object} route Playwright's
 */
async function serveThree(route) {
  const [, commit, file] = route.request().url().match(THREE_CDN)
  const cached = path.join(THREE_CACHE, commit, file)
  if (!fs.existsSync(cached)) {
    const response = await route.fetch({url: `https://raw.githubusercontent.com/mrdoob/three.js/${commit}/${file}`})
    if (!response.ok()) {
      await route.fulfill({status: response.status()})
      return
    }
    fs.mkdirSync(path.dirname(cached), {recursive: true})
    fs.writeFileSync(cached, await response.body())
  }
  await route.fulfill({body: fs.readFileSync(cached),
    headers: {'content-type': 'text/javascript', 'access-control-allow-origin': '*'}})
}


/**
 * In the page: put the camera on Earth's night side, opposite the Sun at its
 * distance from Earth now, looking at Earth, and stop the permalink's
 * arrival from turning it.
 */
function toNightSide() {
  const {ui, scene, shared} = window.c
  const Vector3 = ui.camera.position.constructor
  ui.scene.updateMatrixWorld()
  const earth = scene.objects.earth.getWorldPosition(new Vector3())
  const sun = scene.objects.sun.getWorldPosition(new Vector3())
  const at = ui.camera.getWorldPosition(new Vector3())
  const away = earth.clone().sub(sun).normalize().multiplyScalar(at.distanceTo(earth)).add(earth)
  shared.targets.tween = null
  ui.camera.position.copy(ui.camera.parent.worldToLocal(away))
  ui.camera.updateMatrixWorld()
  ui.camera.lookAt(earth)
  ui.camera.updateMatrixWorld()
}


/**
 * One mode: 'page' (Cesium on this page) or 'iframe' (the guest page).
 *
 * @param {object} browser
 * @param {object} opts
 * @param {string} mode
 * @param {{app: number, guest: number}} ports
 * @returns {Promise<object>}
 */
async function runMode(browser, opts, mode, ports) {
  const [width, height] = opts.viewport
  const page = await browser.newPage({viewport: {width, height}})
  const errors = []
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) &&
    errors.push(m.text().slice(0, 300)))
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)))
  page.on('crash', () => console.error(`${mode}: the page crashed`))
  await page.route(BLOCKED, (route) => route.abort())
  if (opts.gibs) {
    // NASA GIBS (the clouds' map, the night lights) through Node, which
    // trusts the sandbox proxy's CA where Chromium doesn't; for the guest
    // page's frame too.  Registered last, so it wins over BLOCKED.
    await page.route(GIBS, async (route) => {
      try {
        const response = await route.fetch()
        await route.fulfill({response, headers: {...response.headers(), 'access-control-allow-origin': '*'}})
      } catch {
        await route.abort()
      }
    })
  }
  if (ports.nyc) {
    await page.route(THREE_CDN, (route) => serveThree(route))
  }
  const guest = `http://localhost:${ports.guest}/cesium-guest.html`
  const params = new URLSearchParams()
  if (mode === 'iframe') {
    params.set('cesium', 'iframe')
    params.set('cesiumGuest', guest)
    params.set('cesiumWait', String(opts.wait))
  }
  if (ports.nyc) {
    params.set('nycGuest', `http://localhost:${ports.nyc}/`)
  }
  const query = params.size ? `?${params}` : ''
  await page.goto(`http://127.0.0.1:${ports.app}/${query}${VIEWS[opts.view]}`)
  await page.waitForFunction(() => window.c?.ui?.layers, null, {timeout: 600000})
  await page.evaluate(() => {
    window.c.ui.layers.fadeOf = () => 1
  })
  if (NIGHT.has(opts.view)) {
    await page.evaluate(toNightSide)
  }
  const city = opts.view === 'nyc'
  const state = () => page.evaluate((forceShown) => {
    const L = window.c.ui.layers
    const b = L.bodies.earth
    // Low over the ground the tiles never settle on SwiftShader, and the
    // layer would stay warming: drawn regardless (AGENTS.md, New York).
    if (forceShown && b?.status === 'ready') {
      b.shown = true
    }
    const nyc = L._newYork
    return {
      nyc: nyc ? (nyc.city?.stage?.chunks > 0 ? 'loading' : nyc.status) : null,
      status: b?.status ?? 'none',
      shown: b?.shown === true,
      active: window.c.ui.layers.active.some((a) => a.name === 'earth'),
      tilesLoaded: b?.remote ? b.tilesLoaded : b?.widget?.scene?.globe?.tilesLoaded === true,
      wire: b?.receiver ? {...b.receiver.wire} : null,
    }
  }, city)
  let st = await state()
  const deadline = Date.now() + (city ? 1500000 : 900000)
  const ready = (x) => x.shown && x.active && (city ? x.nyc === 'ready' || x.nyc === 'error' : x.tilesLoaded)
  const started = Date.now()
  for (let n = 1; !ready(st) && st.status !== 'error' && Date.now() < deadline; n++) {
    await page.waitForTimeout(1000)
    st = await state()
    if (n % 30 === 0) {
      console.error(`  ${mode}, ${n} s: ${JSON.stringify({...st, wire: undefined})}`)
    }
  }
  if (!(st.shown && st.active)) {
    throw new Error(`${mode}: Earth's layer never showed: ${JSON.stringify(st)} ${errors.join(' | ')}`)
  }
  const cityAt = city ? {status: st.nyc, seconds: Math.round((Date.now() - started) / 1000)} : null

  // The permalink's instant, to the minute, the same in every run; then the
  // tiles settled, and one frame read in the task that draws it.
  await page.evaluate(() => {
    const jd = window.c.time.simTimeJulianDay()
    window.c.time.setTime(((Math.round(jd * 1440) / 1440) - 2440587.5) * 864e5)
    window.c.time.isPaused = true
  })
  for (let i = 0, settled = 0; i < (city ? 20 : 180) && settled < 5; i++) {
    await page.waitForTimeout(1000)
    settled = (await state()).tilesLoaded ? settled + 1 : 0
  }
  // The loop keeps running; the frames are read as it draws them, in the
  // task that draws each (the page's animation frame, or the guest's
  // message).  A long wait, so each is in step.
  const png = await page.evaluate(async () => {
    const {ui} = window.c
    ui.layers.guestWaitMs = 60000
    window.c.shared.targets.tween = null
    const shots = []
    const draw = ui._drawFrame.bind(ui)
    ui._drawFrame = () => {
      draw()
      shots.push(ui.renderer.domElement.toDataURL('image/png').split(',')[1])
    }
    const t = performance.now()
    while (shots.length < 3 && performance.now() - t < 120000) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    ui._drawFrame = draw
    return shots.at(-1) ?? null
  })
  const shot = png ? await page.evaluate(async (data) => {
    const img = new Image()
    img.src = `data:image/png;base64,${data}`
    await img.decode()
    const canvas = Object.assign(document.createElement('canvas'), {width: img.width, height: img.height})
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)
    return {width: img.width, height: img.height, rgba: Array.from(ctx.getImageData(0, 0, img.width, img.height).data)}
  }, png) : null
  const motion = await page.evaluate(async ([seconds, wait]) => {
    const {ui} = window.c
    ui.layers.guestWaitMs = wait
    const earth = ui.sceneManager.objects.earth
    const keep = ui._keepAboveGround.bind(ui)
    const Vector3 = ui.camera.position.constructor
    const at = new Vector3()
    const axis = new Vector3(0, 1, 0)
    ui._keepAboveGround = () => {
      ui.camera.position.applyAxisAngle(axis, 0.003)
      earth.getWorldPosition(at)
      ui.camera.updateMatrixWorld()
      ui.camera.lookAt(at)
      keep()
    }
    let drawn = 0
    const draw = ui._drawFrame.bind(ui)
    ui._drawFrame = () => {
      drawn++
      draw()
    }
    const body = ui.layers.bodies.earth
    const w0 = {...ui.guestWait}
    const s0 = body.steps ? {...body.steps} : null
    const t0 = performance.now()
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000))
    const dt = (performance.now() - t0) / 1000
    ui._keepAboveGround = keep
    ui._drawFrame = draw
    const d = s0 ? Object.fromEntries(Object.keys(s0).map((k) => [k, body.steps[k] - s0[k]])) : null
    return {fps: +(drawn / dt).toFixed(2), drawn, ...(d ? {inStep: d.inStep, guestDrawn: d.drawn,
      tripMs: +(d.tripMs / Math.max(1, d.trips)).toFixed(1),
      // The time a drawn frame waited for the guest's, on average.
      waitMs: +((ui.guestWait.ms - w0.ms) / Math.max(1, drawn)).toFixed(1),
      // The last round trips, split: the way in, the guest's frame, the way back.
      split: ui.layers.guestStats()[0] ?? null,
      // The night lights' part: the guest has them, the receiver routes
      // parts, and the last drain had them.
      lights: {night: body.night === true, parts: body.parts === true, drawn: body.lastLights === true}} : {})}
  }, [opts.motion, opts.wait])

  const pan = mode === 'iframe' && opts.pan > 0 ? await panCheck(page, opts.pan) : null

  const replayErrors = city ? await page.evaluate(() => window.c.ui.layers._newYork?.city?.replayErrors ?? null) : null
  await page.close()
  return {mode, wire: st.wire, motion, pan, png, shot, city: cityAt && {...cityAt, replayErrors}, errors: errors.slice(0, 10)}
}


/**
 * The late-frame check (--pan): see the header.
 *
 * @param {object} page On the guest page (?cesium=iframe), the view settled
 * @param {number} deg How far B is turned from A, about the body
 * @returns {Promise<object>} The two composites' distances from the truth
 */
async function panCheck(page, deg) {
  return page.evaluate(async (deg) => {
    const {ui} = window.c
    const L = ui.layers
    const body = L.bodies.earth
    const earth = ui.sceneManager.objects.earth
    const Vector3 = ui.camera.position.constructor
    const at = new Vector3()
    const posA = ui.camera.position.clone()
    const posB = posA.clone().applyAxisAngle(new Vector3(0, 1, 0), deg * Math.PI / 180)
    let hold = posA
    const keep = ui._keepAboveGround.bind(ui)
    ui._keepAboveGround = () => {
      ui.camera.position.copy(hold)
      earth.getWorldPosition(at)
      ui.camera.updateMatrixWorld()
      ui.camera.lookAt(at)
      keep()
    }
    window.c.shared.targets.tween = null
    L.guestWaitMs = 60000
    const draw = ui._drawFrame.bind(ui)
    const pixels = () => {
      const gl = ui.renderer.getContext()
      const {width, height} = gl.canvas
      const out = new Uint8Array(width * height * 4)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, out)
      ui.renderer.resetState()
      return out
    }
    // `n` frames drawn as they are, after `then` runs in the task of the
    // first; the last frame's pixels, read in the task that draws it.
    const frames = (n, then = () => {}) => new Promise((resolve, reject) => {
      let k = 0
      const timer = setTimeout(() => reject(new Error('no frames')), 180000)
      ui._drawFrame = () => {
        if (k === 0) {
          then()
        }
        draw()
        if (++k === n) {
          ui._drawFrame = draw
          clearTimeout(timer)
          resolve(pixels())
        }
      }
    })
    const distance = (a, b) => {
      let sum = 0
      let far = 0
      for (let i = 0; i < a.length; i += 4) {
        const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]))
        sum += d
        far += d > 16 ? 1 : 0
      }
      return {mean: +(sum / (a.length / 4)).toFixed(3), over16: far}
    }
    try {
      // The truth: the guest's own frame of B, in step (a long wait).
      hold = posB
      await frames(2)
      const truth = await frames(2)
      // Back at A, in step; then the guest held and the camera at B.
      hold = posA
      await frames(3)
      const postViews = L.guests.postViews.bind(L.guests)
      L.guests.postViews = () => {}
      const corrected0 = body.corrected ?? 0
      const corrected = await frames(2, () => {
        hold = posB
      })
      const correctedFrames = (body.corrected ?? 0) - corrected0
      L.guestReproject = false
      const uncorrected = await frames(2)
      L.guestReproject = true
      L.guests.postViews = postViews
      const c = distance(corrected, truth)
      const u = distance(uncorrected, truth)
      return {deg, corrected: c, uncorrected: u, correctedFrames,
        correctedDraws: body.receiver.replay.reprojectStats.correctedDraws}
    } finally {
      ui._drawFrame = draw
      ui._keepAboveGround = keep
    }
  }, deg)
}


/**
 * @param {object} a {width, height, rgba}
 * @param {object} b
 * @returns {{differing: number, max: number, pixels: number}}
 */
function compare(a, b) {
  if (!a || !b || a.width !== b.width || a.height !== b.height) {
    return {differing: Infinity, max: Infinity, pixels: 0}
  }
  let differing = 0
  let max = 0
  for (let i = 0; i < a.rgba.length; i += 4) {
    let d = 0
    for (let k = 0; k < 4; k++) {
      d = Math.max(d, Math.abs(a.rgba[i + k] - b.rgba[i + k]))
    }
    differing += d > 0 ? 1 : 0
    max = Math.max(max, d)
  }
  return {differing, max, pixels: a.rgba.length / 4}
}


/** Run both modes, compare, report. */
async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const root = path.resolve(opts.docs)
  if (!fs.existsSync(path.join(root, 'cesium-guest.html'))) {
    throw new Error(`no cesium-guest.html in ${root}: run \`CESIUM_ION_TOKEN= yarn build\` first`)
  }
  const app = await serve(root)
  const guest = await serve(root)
  const nyc = opts.view === 'nyc' ? await serve(path.resolve(opts.nyc ?? ''), {fallback: false}) : null
  const browser = await chromium.launch({args: CHROMIUM_ARGS, ...(opts.chromium ? {executablePath: opts.chromium} : {})})
  try {
    const ports = {app: app.port, guest: guest.port, nyc: nyc?.port}
    const results = {}
    for (const mode of ['page', 'iframe']) {
      console.log(`${opts.view}: Cesium on ${mode === 'page' ? 'this page' : 'the guest page'}...`)
      results[mode] = await runMode(browser, opts, mode, ports)
    }
    const diff = compare(results.page.shot, results.iframe.shot)
    const iframe = results.iframe.motion
    const report = {
      view: opts.view,
      viewport: opts.viewport,
      wait: opts.wait,
      frame: diff,
      motion: {page: results.page.motion, iframe},
      ...(results.iframe.pan ? {pan: results.iframe.pan} : {}),
      wire: results.iframe.wire,
      ...(nyc ? {city: {page: results.page.city, iframe: results.iframe.city}} : {}),
      errors: {page: results.page.errors, iframe: results.iframe.errors},
    }
    console.log(JSON.stringify(report, null, 1))
    if (opts.out) {
      fs.mkdirSync(opts.out, {recursive: true})
      for (const mode of ['page', 'iframe']) {
        if (results[mode].png) {
          fs.writeFileSync(path.join(opts.out, `${opts.view}-${mode}.png`), Buffer.from(results[mode].png, 'base64'))
        }
      }
      fs.writeFileSync(path.join(opts.out, 'report.json'), JSON.stringify(report, null, 1))
    }
    const fails = []
    if (nyc) {
      // Low over the ground the tiles differ run to run: the frames are
      // compared by eye (--out), and the city must load and replay cleanly.
      for (const mode of ['page', 'iframe']) {
        const c = results[mode].city
        if (c?.status !== 'ready' || c.replayErrors > 0) {
          fails.push(`${mode}: the city ${c?.status ?? 'never loaded'}, ${c?.replayErrors ?? '?'} replay errors`)
        }
      }
    } else if (diff.max > 1) {
      fails.push(`the frames differ: ${diff.differing} of ${diff.pixels} pixels, by up to ${diff.max}`)
    }
    const pan = results.iframe.pan
    if (pan && !(pan.corrected.mean < pan.uncorrected.mean)) {
      fails.push(`a late frame corrected to the camera (${pan.corrected.mean}) isn't nearer its own frame than as it came (${pan.uncorrected.mean})`)
    }
    if (iframe.inStep !== iframe.guestDrawn) {
      fails.push(`${iframe.guestDrawn - iframe.inStep} of ${iframe.guestDrawn} guest frames out of step under motion`)
    }
    console.log(fails.length ? `FAIL: ${fails.join('; ')}` : 'PASS')
    process.exitCode = fails.length ? 1 : 0
  } finally {
    await browser.close()
    app.close()
    guest.close()
    nyc?.close()
  }
}


main().catch((err) => {
  console.error(err.message ?? err)
  process.exit(2)
})
