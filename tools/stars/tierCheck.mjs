#!/usr/bin/env node
// Checks the catalogue's brightness tiers in the app (js/scene/Stars.md,
// "Brightness tiers"), in headless Chromium on SwiftShader, against a built
// docs/ and, optionally, a build of main from before the tiers:
//
//   node tools/stars/tierCheck.mjs [--docs docs] [--main DIR] [--out DIR] [--width 480 --height 300]
//
// The same views, rendered held still at the dark-adapted gain (the naked
// eye's limit, 6.5), with Gaia's stars off (`gaia=0`) so the frame is the
// catalogue's:
//
// - wide: a 90° field from 4.7 AU over the Sun's north, looking away from it;
// - orion: Orion with its stars' labels and the asterisms;
//
// each with only the bright tier in (the faint packs held back, never
// answered), with every tier in, and on main (stars.dat, one geometry).
// It reports how the frames differ, pixel by pixel, and which of the
// naked-eye stars in the field the bright tier draws; with --out it writes
// the PNGs and report.json.
//
// Not in `yarn precommit`: it needs a build and a browser.
import {mkdirSync, writeFileSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {chromium} from 'playwright'
import {serveLikePages} from '../loadBudget/staticServer.mjs'


const CHROMIUM_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']
// skyCheck's view (tools/gaia/skyCheck.mjs): deep space over the Sun's
// north, orbits and the galaxy off, on 2026's date; Gaia's stars off.
const LINK = '?gaia=0#sun@60,0,0.7Tm;t=9771.1jd;cq=0,0,0,1;fov=45deg;s=poU'
const VIEWS = {
  // Straight away from the Sun, 90° wide; no labels.
  wide: {fov: 90, away: true, labels: false},
  // Orion (Betelgeuse, HIP 27989, and Rigel, 24436, a little either side
  // of the middle), with the stars' labels and the asterisms.
  orion: {fov: 50, toward: [27989, 24436], labels: true},
}
const BRIGHT_PACK = 'packs/roots.bin'


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
 * @param {object} browser
 * @param {string} url The site
 * @param {object} opts
 * @param {boolean} opts.brightOnly Hold the faint packs back, unanswered
 * @param {Array<number>} opts.viewport
 * @returns {Promise<object>} The page, its catalogue loaded as asked
 */
async function openPage(browser, url, {brightOnly, viewport}) {
  const page = await browser.newPage({viewport: {width: viewport[0], height: viewport[1]}})
  page.on('console', (m) => m.text().startsWith('capture') && console.error(m.text()))
  const held = []
  if (brightOnly) {
    await page.route('**/large/stars/v1/packs/*.bin', (route) => {
      if (route.request().url().endsWith(BRIGHT_PACK)) {
        return route.continue()
      }
      // Not answered while the page is looked at (an abort would be a lost
      // tier, and the fallback); let go when it closes (release).
      return new Promise((resolve) => held.push(() => route.abort().catch(() => {}).then(resolve)))
    })
  }
  page.release = async () => {
    await page.unrouteAll({behavior: 'ignoreErrors'})
    await Promise.all(held.map((letGo) => letGo()))
  }
  await page.goto(`${url}${LINK}`)
  await page.waitForFunction(() => window.c?.scene?.stars?.drawn?.() ??
      Boolean(window.c?.scene?.stars?.getObjectByName?.('StarsPoints')), null, {timeout: 120000})
  if (!brightOnly) {
    await page.waitForFunction(() => window.c.scene.stars.catalogComplete?.() ??
        window.c.scene.stars.catalog.numStars > 0, null, {timeout: 120000})
  }
  return page
}


/**
 * Point the camera, set the overlays, hold the frame at the dark gain.
 *
 * @param {object} page
 * @param {object} view VIEWS'
 * @returns {Promise<object>} The view's numbers
 */
async function setView(page, view) {
  return page.evaluate(async (v) => {
    const c = window.c
    const sc = c.scene
    sc.applySettings({...sc.getSettings(), a: v.labels, l: v.labels, p: false, o: false, U: false})
    const cam = c.ui.camera
    cam.fov = v.fov
    cam.updateProjectionMatrix()
    const p = cam.getWorldPosition(cam.position.clone())
    if (v.away) {
      cam.lookAt(p.multiplyScalar(2))
    } else {
      const stars = sc.stars
      const t = v.toward.map((hip) => stars.catalog.starByHip.get(hip))
      const at = t[0] ? stars.localToWorld(cam.position.clone().set((t[0].x + t[1].x) / 2, (t[0].y + t[1].y) / 2,
          (t[0].z + t[1].z) / 2)) : p
      cam.lookAt(at)
    }
    cam.updateMatrixWorld()
    c.ui.renderer.setAnimationLoop(null)
    c.ui._meter = () => {}
    c.time.isPaused = true
    c.ui._meterGain = c.ui._meterGainGoal = 4e6
    // Frames until the limit holds for a second (the exposure eases to the
    // gain on the wall clock; the field sets where it ends: 6.5 at 45°,
    // brighter wider), at most 90 s.
    let last = NaN
    let lastAt = performance.now()
    const end = performance.now() + 90000
    while (performance.now() < end) {
      c.shared.targets.tween = null
      c.ui.renderLoop(performance.now())
      await new Promise((r) => setTimeout(r, 10))
      const now = c.ui.limitingMagnitude()
      if (Math.abs(now - last) >= 0.005) {
        last = now
        lastAt = performance.now()
      } else if (performance.now() - lastAt > 1000) {
        break
      }
    }
    // The faint tiles this view wants, if any could still land: a frame or
    // two to let the selection see the view.
    for (let i = 0; i < 3; i++) {
      c.shared.targets.tween = null
      c.ui.renderLoop(performance.now())
      await new Promise((r) => setTimeout(r, 50))
    }
    // Which naked-eye stars (V 6.5 from the Sun) are in the field, and
    // whether the points drawn include each: its tile drawn, or the one
    // geometry.
    const stars = sc.stars
    const pop = stars.population
    const drawnHips = new Set()
    if (pop) {
      for (const tile of pop.loaded.values()) {
        if (tile.points.visible) {
          tile.hips.forEach((h) => drawnHips.add(h))
        }
      }
    }
    const v3 = cam.position.clone()
    let inField = 0
    let drawn = 0
    for (const [hip, s] of stars.catalog.starByHip) {
      const ly = Math.hypot(s.x, s.y, s.z) / 9.4607304725808e15
      const mag = s.absMag + (5 * Math.log10(ly / 3.2615637771674333 / 10))
      if (hip === 0 || !(mag <= 6.5)) {
        continue
      }
      stars.localToWorld(v3.set(s.x, s.y, s.z)).project(cam)
      if (Math.abs(v3.x) <= 1 && Math.abs(v3.y) <= 1 && v3.z < 1) {
        inField++
        if (!pop || drawnHips.has(hip)) {
          drawn++
        }
      }
    }
    return {
      limitingMagnitude: c.ui.limitingMagnitude(),
      catalogueStars: stars.catalog.numStars,
      complete: stars.catalogComplete?.() ?? true,
      tiers: pop ? {loadedTiles: pop.loaded.size, visibleTiles: pop.stats().visibleTiles,
        drawnPoints: pop.stats().drawn} : 'one geometry (stars.dat)',
      nakedEyeInField: inField,
      nakedEyeDrawn: drawn,
    }
  }, view)
}


/**
 * @param {object} page
 * @returns {Promise<object>} The frame: RGBA bytes and a PNG
 */
async function capture(page) {
  const shot = await page.evaluate(() => {
    const c = window.c
    const t0 = performance.now()
    c.shared.targets.tween = null
    c.ui.renderLoop(performance.now())
    c.shared.targets.tween = null
    c.ui.renderLoop(performance.now())
    console.log(`capture: two frames in ${Math.round(performance.now() - t0)} ms`)
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
  })
  return {width: shot.width, height: shot.height, data: Buffer.from(shot.base64, 'base64'), png: shot.png}
}


/**
 * @param {object} a capture()
 * @param {object} b
 * @returns {object} How the two frames differ, by luminance (0-255)
 */
function compare(a, b) {
  const n = a.width * a.height
  let differ = 0
  let differ8 = 0
  let maxDiff = 0
  let sumA = 0
  let sumB = 0
  let litA = 0
  let litB = 0
  for (let i = 0; i < n; i++) {
    const la = (a.data[4 * i] + a.data[(4 * i) + 1] + a.data[(4 * i) + 2]) / 3
    const lb = (b.data[4 * i] + b.data[(4 * i) + 1] + b.data[(4 * i) + 2]) / 3
    const d = Math.abs(la - lb)
    differ += d > 0 ? 1 : 0
    differ8 += d > 8 ? 1 : 0
    maxDiff = Math.max(maxDiff, d)
    sumA += la
    sumB += lb
    litA += la > 8 ? 1 : 0
    litB += lb > 8 ? 1 : 0
  }
  return {pixels: n, differ, differOver8: differ8, maxDiff: +maxDiff.toFixed(1), lightRatio: +(sumB / sumA).toFixed(5),
    litA, litB}
}


const opts = parseArgs()
const viewport = [parseInt(opts.width ?? '480'), parseInt(opts.height ?? '300')]
const docs = resolve(opts.docs ?? 'docs')
const main = opts.main ? resolve(opts.main) : null
const out = opts.out ? resolve(opts.out) : null
if (out) {
  mkdirSync(out, {recursive: true})
}
const site = await serveLikePages(docs)
const mainSite = main ? await serveLikePages(main) : null
const browser = await chromium.launch({args: CHROMIUM_ARGS})
const report = {link: LINK, viewport, views: {}}
try {
  const states = [['bright', site.url, true], ['all', site.url, false]]
  if (mainSite) {
    states.push(['main', mainSite.url, false])
  }
  const frames = {}
  for (const [state, url, brightOnly] of states) {
    for (const [name, view] of Object.entries(VIEWS)) {
      const t0 = Date.now()
      const page = await openPage(browser, url, {brightOnly, viewport})
      console.error(`${name} ${state}: loaded in ${Date.now() - t0} ms`)
      const numbers = await setView(page, view)
      console.error(`${name} ${state}: view set at ${Date.now() - t0} ms`)
      const frame = await capture(page)
      await page.release?.()
      await page.close()
      frames[`${name}-${state}`] = frame
      report.views[name] ??= {}
      report.views[name][state] = numbers
      if (out) {
        writeFileSync(join(out, `${name}-${state}.png`), Buffer.from(frame.png, 'base64'))
      }
      console.log(name, state, JSON.stringify(numbers))
    }
  }
  for (const name of Object.keys(VIEWS)) {
    const v = report.views[name]
    v.allVsBright = compare(frames[`${name}-all`], frames[`${name}-bright`])
    if (mainSite) {
      v.allVsMain = compare(frames[`${name}-main`], frames[`${name}-all`])
      v.brightVsMain = compare(frames[`${name}-main`], frames[`${name}-bright`])
    }
    console.log(name, JSON.stringify({allVsBright: v.allVsBright, allVsMain: v.allVsMain, brightVsMain: v.brightVsMain}))
  }
  if (out) {
    writeFileSync(join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  }
} finally {
  await browser.close()
  site.close()
  mainSite?.close()
}
