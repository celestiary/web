#!/usr/bin/env node
// The telescope-field memory check for Cesium's Earth layer (#176; CESIUM.md,
// "Detail at narrow fields of view").  From the ground in Amapá, Brazil, at
// a narrow field, track Jupiter as it sets and print, per step of simulated
// time, the JS heap, the globe's tiles (drawn, queued for load, held,
// visited this frame, deepest level drawn), its maximumScreenSpaceError and
// the frame time.  Before #176's fix the tab ran out of memory at 0.04° and
// 0.01°; after it the heap peaks under 200 MB.
//
// Needs a build in docs/ (`yarn build`, with CESIUM_ION_TOKEN for World
// Terrain).  ion is fetched through Node with the production Referer, as
// yarn parity does; no response body is printed (they echo the token).
//
// Usage: node tools/narrow-fov/narrowFov.mjs <fovDeg> [--docs dir]
//          [--frames N] [--viewport WxH] [--advance hours] [--from elevDeg]
//          [--to elevDeg] [--step minutes]
// The run in the PR: --advance 10 --from 6 --to -1 --step 1.5 --frames 20
// (Jupiter is rising at the permalink's time; 10 h on it is setting).
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {chromium} from 'playwright'

const [fovArg, ...rest] = process.argv.slice(2)
const opt = (name, dflt) => {
  const i = rest.indexOf(`--${name}`)
  return i >= 0 ? rest[i + 1] : dflt
}
const FOV = Number(fovArg)
const FRAMES = Number(opt('frames', 40))
const [W, H] = opt('viewport', '480x300').split('x').map(Number)
const FROM = opt('from', 'now') === 'now' ? null : Number(opt('from'))
const TO = Number(opt('to', -1))
const STEP_MIN = Number(opt('step', 2))
const HASH = `#sun/earth@3.0078,-51.7143,156m;t=9774.7938jd;cq=-0.5616,0.0248,0.7822,-0.2685;fov=${FOV}deg;s=poL`
const ION_HOSTS = /^https:\/\/(api\.cesium\.com|assets\.ion\.cesium\.com)\//
const ION_HEADERS = {referer: 'https://celestiary.github.io/', origin: 'https://celestiary.github.io'}
const MIME = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.wasm': 'application/wasm', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml'}

const root = path.resolve(opt('docs', path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs')))
const server = http.createServer((req, res) => {
  const requested = path.join(root, decodeURIComponent(new URL(req.url, 'http://localhost').pathname))
  const file = requested.startsWith(root) && fs.existsSync(requested) && fs.statSync(requested).isFile() ?
    requested : path.join(root, 'index.html')
  res.writeHead(200, {'content-type': MIME[path.extname(file)] ?? 'application/octet-stream'})
  fs.createReadStream(file).pipe(res)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}/`

const browser = await chromium.launch({args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist', '--enable-precise-memory-info']})
const page = await browser.newPage({viewport: {width: W, height: H}})
let crashed = false
let lastElev = null
page.on('crash', () => {
  crashed = true
  console.log(`PAGE CRASHED (Jupiter last at ${lastElev?.toFixed(2)}°)`)
  process.exit(3)
})
const ion = {}
await page.route(ION_HOSTS, async (route) => {
  try {
    const headers = {...await route.request().allHeaders(), ...ION_HEADERS}
    const response = await route.fetch({headers})
    ion[response.status()] = (ion[response.status()] ?? 0) + 1
    await route.fulfill({response, headers: {...response.headers(), 'access-control-allow-origin': '*'}})
  } catch {
    await route.abort().catch(() => {})
  }
})
const t0 = Date.now()
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a)

await page.goto(base + HASH)
await page.waitForFunction(() => window.c?.ui?.layers && window.c.firstTime === false, null, {timeout: 600000})
// Wait for Earth's layer to be up, with ion terrain.
await page.waitForFunction(() => {
  const b = window.c.ui.layers.bodies.earth
  return b?.status === 'ready' && b.widget.scene.globe.terrainProvider.constructor.name !== 'EllipsoidTerrainProvider'
}, null, {timeout: 600000, polling: 1000}).catch(() => log('no ion terrain (continuing)'))

// Target and track Jupiter, as the user did (t), with the clock paused.
const setup = await page.evaluate(() => {
  const c = window.c
  c.time.isPaused = true
  c.scene.setTarget('jupiter')
  c.shared.targets.tween = null
  c.scene.track()
  return {fov: c.ui.camera.fov, jd: c.time.simTimeJulianDay(),
    terrain: c.ui.layers.bodies.earth?.widget?.scene.globe.terrainProvider.constructor.name}
})
log('setup', JSON.stringify(setup), 'ion', JSON.stringify(ion))

const elevation = () => page.evaluate(() => {
  const c = window.c
  c.ui.scene.updateMatrixWorld()
  const V = c.ui.camera.position.constructor
  const cam = c.ui.camera.getWorldPosition(new V())
  const e = c.scene.objects.earth.getWorldPosition(new V())
  const j = c.scene.objects.jupiter.getWorldPosition(new V())
  const up = cam.clone().sub(e).normalize()
  const dir = j.clone().sub(cam).normalize()
  return Math.asin(up.dot(dir)) * 180 / Math.PI
}).then((e) => (lastElev = e))

// Jump ahead (--advance hours, to the setting side), then move the clock
// so Jupiter starts FROM degrees up, by Newton steps on its measured rate.
const ADVANCE_H = Number(opt('advance', 0))
const shift = (min) => page.evaluate((m) => window.c.time.setTime(window.c.time.simTime + m * 60000), min)
if (ADVANCE_H) {
  await shift(ADVANCE_H * 60)
}
let el = await elevation()
log(`after advance ${el.toFixed(2)}°`)
for (let i = 0; FROM !== null && i < 8 && Math.abs(el - FROM) > 0.05; i++) {
  await shift(1)
  const rate = (await elevation()) - el
  await shift(-1)
  await shift(Math.max(-180, Math.min(180, (FROM - el) / rate)))
  el = await elevation()
}
log(`start elevation ${el.toFixed(2)}°`)

const sample = () => page.evaluate(async (frames) => {
  const c = window.c
  const t = performance.now()
  const f0 = c.ui.renderer.info.render.frame
  await new Promise((resolve) => {
    const tick = () => (c.ui.renderer.info.render.frame - f0 >= frames ? resolve() : requestAnimationFrame(tick))
    requestAnimationFrame(tick)
  })
  const ms = (performance.now() - t) / (c.ui.renderer.info.render.frame - f0)
  const b = c.ui.layers.bodies.earth
  const s = b?.widget?.scene.globe._surface
  const q = (n) => s?.[n]?.length ?? 0
  return {
    heapMB: performance.memory.usedJSHeapSize / 1048576,
    render: s?._tilesToRender.length ?? 0,
    loadQ: q('_tileLoadQueueHigh') + q('_tileLoadQueueMedium') + q('_tileLoadQueueLow'),
    cached: s?._tileReplacementQueue.count ?? 0,
    visited: s?._debug.tilesVisited ?? 0,
    maxLevel: Math.max(0, ...(s?._tilesToRender ?? []).map((x) => x.level)),
    sse: b?.widget?.scene.globe.maximumScreenSpaceError,
    msPerFrame: ms,
    active: c.ui.layers.isActive(c.scene.objects.earth),
  }
}, FRAMES)

console.log('elev°\theapMB\trender\tloadQ\tcached\tvisited\tmaxLvl\tSSE\tms/frame\tactive')
let peak = 0
while (!crashed) {
  let r
  try {
    r = await Promise.race([sample(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 600000))])
  } catch (err) {
    log('sample failed:', err.message.split('\n')[0])
    break
  }
  peak = Math.max(peak, r.heapMB)
  console.log([el.toFixed(2), r.heapMB.toFixed(0), r.render, r.loadQ, r.cached, r.visited, r.maxLevel, r.sse,
    r.msPerFrame.toFixed(0), r.active].join('\t'))
  if (el < TO) {
    break
  }
  await page.evaluate((m) => window.c.time.setTime(window.c.time.simTime + m * 60000), STEP_MIN)
  el = await elevation()
}
log(`fov ${FOV}°: ${crashed ? 'CRASHED' : 'survived'}, peak heap ${peak.toFixed(0)} MB, ion ${JSON.stringify(ion)}`)
await browser.close().catch(() => {})
server.close()
process.exit(0)
