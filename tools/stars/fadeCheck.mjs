#!/usr/bin/env node
// Traces the catalogue's faint tiers arriving in a dark view, frame by
// frame (js/scene/Stars.md, "Brightness tiers", the fade-in), in headless
// Chromium on SwiftShader against a built docs/:
//
//   node tools/stars/fadeCheck.mjs [--docs docs] [--out file.json] [--meter 1]
//
// The view: 4.7 AU over the Sun's north, looking away from it, Gaia off.
// The page loads with the faint packs held back; once it is revealed, the
// frame is held at the dark-adapted gain (4e6, the naked eye's limit) and
// the packs are let go, and each frame from then is rendered by hand, 50
// ms apart on the population's clock (SwiftShader's own loop is a frame a
// second or slower, and a frame now and then takes a second: so the fade's
// clock steps 50 ms a frame, a 20 fps trace), with its mean luminance
// (0-255) and the catalogue's tiles and their fade.  With
// --meter 1 the meter runs instead of the held gain, and its gain is
// traced too: whether it steps when the light arrives.
//
// Not in `yarn precommit`: it needs a build and a browser.
import {writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {chromium} from 'playwright'
import {serveLikePages} from '../loadBudget/staticServer.mjs'


const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']
const LINK = '?gaia=0#sun@60,0,700Gm;t=9771.1jd;cq=0.3536,-0.6124,0.3536,0.6124;fov=45deg;s=poU'
const FRAMES = 100
const FRAME_MS = 50


const a = process.argv.slice(2)
const opts = {}
for (let i = 0; i < a.length; i += 2) {
  opts[a[i].replace(/^--/, '')] = a[i + 1]
}
const meter = opts.meter === '1'
const site = await serveLikePages(resolve(opts.docs ?? 'docs'))
const browser = await chromium.launch({args: ARGS})
try {
  const page = await browser.newPage({viewport: {width: 320, height: 200}})
  const held = []
  let released = false
  await page.route('**/large/stars/v1/packs/*.bin', (route) => {
    if (released || route.request().url().endsWith('packs/roots.bin')) {
      return route.continue()
    }
    held.push(route)
    return undefined
  })
  await page.goto(`${site.url}${LINK}`)
  await page.waitForFunction(() => window.c?._reveal?.done && window.c.scene.stars.drawn(), null, {timeout: 120000})
  // Hold the frame: the loop stopped, labels and asterisms off; the gain
  // the dark-adapted eye's, or (--meter) the meter's from the dark gain on.
  await page.evaluate((withMeter) => {
    const c = window.c
    c.ui.renderer.setAnimationLoop(null)
    c.time.isPaused = true
    c.scene.applySettings({...c.scene.getSettings(), a: false, l: false})
    c.scene.overlays.finish()
    c.ui._meterGain = c.ui._meterGainGoal = 4e6
    if (!withMeter) {
      c.ui._meter = () => {}
    }
    for (let i = 0; i < 3; i++) {
      c.ui._lastExposureMs = null
      c.shared.targets.tween = null
      c.ui.renderLoop(performance.now())
    }
  }, meter)
  // The packs, let go.
  released = true
  held.splice(0).forEach((route) => route.continue())
  // Frames by hand, each read back in its own task.
  const trace = await page.evaluate(async ({frames, frameMs, withMeter}) => {
    const c = window.c
    const out = []
    const t0 = performance.now()
    // The fade's clock: 50 ms a frame (PointPopulation's `now`).
    let virtualMs = 0
    const pop0 = c.scene.stars.population
    if (pop0) {
      pop0.now = () => virtualMs
      for (const tile of pop0.loaded.values()) {
        tile.landedAt = -1e9
      }
    }
    const px = new Uint8Array(4 * c.ui.width * c.ui.height)
    for (let i = 0; i < frames; i++) {
      if (!withMeter) {
        c.ui._lastExposureMs = null
      }
      c.shared.targets.tween = null
      c.ui.renderLoop(performance.now())
      const gl = c.ui.renderer.getContext()
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, px)
      let sum = 0
      let lit = 0
      for (let j = 0; j < px.length; j += 4) {
        const l = (px[j] + px[j + 1] + px[j + 2]) / 3
        sum += l
        lit += l > 40 ? 1 : 0
      }
      const pop = c.scene.stars.population
      const gains = pop ? [...pop.loaded.values()].map((t) => t.gain ?? 1) : []
      out.push({
        frame: i, frameMs: virtualMs, wallMs: Math.round(performance.now() - t0), lum: +(sum / (px.length / 4)).toFixed(3), lit,
        tiles: pop?.loaded.size ?? 0, fading: gains.filter((g) => g < 1).length,
        minGain: gains.length ? +Math.min(...gains).toFixed(3) : 1,
        meterGain: Math.round(c.ui._meterGain), meterGoal: Math.round(c.ui._meterGainGoal),
      })
      await new Promise((r) => setTimeout(r, frameMs))
      virtualMs += frameMs
    }
    return out
  }, {frames: FRAMES, frameMs: FRAME_MS, withMeter: meter})
  for (const f of trace) {
    console.log(JSON.stringify(f))
  }
  if (opts.out) {
    writeFileSync(opts.out, `${JSON.stringify({link: LINK, meter, trace}, null, 1)}\n`)
  }
} finally {
  await browser.close()
  site.close()
}
