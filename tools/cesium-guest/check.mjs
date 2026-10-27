#!/usr/bin/env node
import fs from 'node:fs'
import http from 'node:http'
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
 * Needs a build in docs/ (`CESIUM_ION_TOKEN= yarn build`); it doesn't build.
 * Other hosts are refused: ion, GIBS (the clouds fall back to the bundled
 * map) and analytics.
 *
 * Usage: yarn cesium-guest-check [--view earth-orbit|earth-12km] [--motion s]
 *                                [--wait ms] [--viewport WxH] [--out dir]
 *                                [--docs dir] [--chromium path]
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
}
const CHROMIUM_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
const MACHINE_CHROMIUM = '/opt/pw-browsers/chromium'
const BLOCKED = /googletagmanager|gibs\.earthdata\.nasa\.gov|api\.cesium\.com|assets\.ion\.cesium\.com/
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
    } else if (key === '--chromium') {
      opts.chromium = value
    } else {
      throw new Error(`unknown option ${key}`)
    }
    i++
  }
  if (!VIEWS[opts.view]) {
    throw new Error(`--view is one of ${Object.keys(VIEWS).join(', ')}`)
  }
  return opts
}


/**
 * @param {string} root
 * @returns {Promise<{port: number, close: Function}>} A static server with CORS open
 */
async function serve(root) {
  const server = http.createServer((req, res) => {
    const requested = path.join(root, decodeURIComponent(new URL(req.url, 'http://localhost').pathname))
    const file = requested.startsWith(root) && fs.existsSync(requested) && fs.statSync(requested).isFile() ?
      requested : path.join(root, 'index.html')
    res.writeHead(200, {'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'access-control-allow-origin': '*'})
    fs.createReadStream(file).pipe(res)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {port: server.address().port, close: () => server.close()}
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
  await page.route(BLOCKED, (route) => route.abort())
  const guest = `http://localhost:${ports.guest}/cesium-guest.html`
  const query = mode === 'iframe' ? `?cesium=iframe&cesiumGuest=${encodeURIComponent(guest)}&cesiumWait=${opts.wait}` : ''
  await page.goto(`http://127.0.0.1:${ports.app}/${query}${VIEWS[opts.view]}`)
  await page.waitForFunction(() => window.c?.ui?.layers, null, {timeout: 600000})
  await page.evaluate(() => {
    window.c.ui.layers.fadeOf = () => 1
  })
  const state = () => page.evaluate(() => {
    const b = window.c.ui.layers.bodies.earth
    return {
      status: b?.status ?? 'none',
      shown: b?.shown === true,
      active: window.c.ui.layers.active.some((a) => a.name === 'earth'),
      tilesLoaded: b?.remote ? b.tilesLoaded : b?.widget?.scene?.globe?.tilesLoaded === true,
      wire: b?.receiver ? {...b.receiver.wire} : null,
    }
  })
  let st = await state()
  const deadline = Date.now() + 900000
  while (!(st.shown && st.active && st.tilesLoaded) && st.status !== 'error' && Date.now() < deadline) {
    await page.waitForTimeout(1000)
    st = await state()
  }
  if (!(st.shown && st.active)) {
    throw new Error(`${mode}: Earth's layer never showed: ${JSON.stringify(st)} ${errors.join(' | ')}`)
  }

  // The permalink's instant, to the minute, the same in every run; then the
  // tiles settled, and one frame read in the task that draws it.
  await page.evaluate(() => {
    const jd = window.c.time.simTimeJulianDay()
    window.c.time.setTime(((Math.round(jd * 1440) / 1440) - 2440587.5) * 864e5)
    window.c.time.isPaused = true
  })
  for (let i = 0, settled = 0; i < 180 && settled < 5; i++) {
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
    const s0 = body.steps ? {...body.steps} : null
    const t0 = performance.now()
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000))
    const dt = (performance.now() - t0) / 1000
    ui._keepAboveGround = keep
    ui._drawFrame = draw
    const d = s0 ? Object.fromEntries(Object.keys(s0).map((k) => [k, body.steps[k] - s0[k]])) : null
    return {fps: +(drawn / dt).toFixed(2), drawn, ...(d ? {inStep: d.inStep, guestDrawn: d.drawn,
      tripMs: +(d.tripMs / Math.max(1, d.trips)).toFixed(1)} : {})}
  }, [opts.motion, opts.wait])

  await page.close()
  return {mode, wire: st.wire, motion, png, shot, errors: errors.slice(0, 10)}
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
  const browser = await chromium.launch({args: CHROMIUM_ARGS, ...(opts.chromium ? {executablePath: opts.chromium} : {})})
  try {
    const ports = {app: app.port, guest: guest.port}
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
      wire: results.iframe.wire,
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
    if (diff.max > 1) {
      fails.push(`the frames differ: ${diff.differing} of ${diff.pixels} pixels, by up to ${diff.max}`)
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
  }
}


main().catch((err) => {
  console.error(err.message ?? err)
  process.exit(2)
})
