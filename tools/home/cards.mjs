#!/usr/bin/env node
import {execFileSync} from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {chromium} from 'playwright'


/**
 * Render the homepage's card images (DESIGN.md "Homepage"; js/home.js
 * HOME_CARDS): each card's view, with the HUD and the labels off, once it
 * has settled, at 1200 × 750, written to public/images/home/<id>.webp at
 * 600 × 375.
 *
 * Needs a build in docs/ (`yarn build`; it doesn't build one itself).  By
 * default it runs headless on SwiftShader, as in the sandbox; on a machine
 * with a GPU, `--gpu` renders on it, which is how to replace the committed
 * images with real-GPU captures:
 *
 *   yarn build && node tools/home/cards.mjs --gpu [--only earth,gaia] [--png dir]
 *
 * Earth is drawn by celestiary's own layer, as the homepage's tour draws
 * it, unless `--cesium`.  Any 600 × 375 WebP of the view will do in place of
 * one of these: the page loads public/images/home/<id>.webp as it is.
 *
 * Any other view, for a social post (tools/posts/README.md): `--hash` is
 * its permalink's fragment, without the `#`, and `--id` names the image,
 * `--png` the folder.  It writes the full 1200 × 750 PNG, <dir>/<id>.png,
 * and nothing under public/:
 *
 *   node tools/home/cards.mjs --gpu --id gaia-night --hash 'sun/earth@...' --png posts/images
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..', '..')
const DOCS = path.join(ROOT, 'docs')
const OUT = path.join(ROOT, 'public', 'images', 'home')
const WIDTH = 1200
const HEIGHT = 750
const CARD_WIDTH = 600
const CARD_HEIGHT = 375
const WEBP_QUALITY = 0.82
// The rule between a panel's frames, of the image's width.
const PANEL_GAP = 0.004
// After the scene says it's in: the exposure, clouds, Gaia's tiles.
const SETTLE_MS = 25000
const READY_TIMEOUT_MS = 240000
const POLL_MS = 1000
const SESSION_CHROMIUM = '/opt/pw-browsers/chromium'
const SWIFTSHADER = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
// Public hosts the page fetches from (clouds, the font), fetched from Node:
// a sandbox's Chromium may not trust its egress proxy where Node does.
const NODE_HOSTS = /^https:\/\/(gibs\.earthdata\.nasa\.gov|fonts\.googleapis\.com|fonts\.gstatic\.com)\//
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.wasm': 'application/wasm', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.map': 'application/json',
}


/**
 * The cards: the hash each opens (the card's link, from js/home.js), and,
 * for tonight's sky, which has none, a dark site's sky set up in the page.
 */
const CARDS = [
  {
    id: 'tonight',
    hash: 'sun/earth',
    // The Milky Way's core overhead from the Atacama, a June midnight.
    setup: `(() => {
      const c = window.c
      c._landTonight({lat: -24.627, lng: -70.404}, {ms: Date.parse('2026-06-20T04:30:00Z'), kind: 'now'})
      c.time.setPaused(true)
      // Up, nearly to the zenith, where the core is.
      const T = c.three
      const cam = c.ui.camera
      const up = cam.position.clone().normalize()
      const north = new T.Vector3(0, 1, 0).sub(up.clone().multiplyScalar(up.y)).normalize()
      const el = 78 * Math.PI / 180
      const look = north.multiplyScalar(Math.cos(el)).add(up.clone().multiplyScalar(Math.sin(el)))
      cam.quaternion.setFromRotationMatrix(new T.Matrix4().lookAt(new T.Vector3(), look, north.clone().negate()))
    })()`,
  },
  {id: 'earth', link: true},
  {
    // Not the card's own link, which runs: four moments of its eruption,
    // held (the activity view, js/scene/Sun.md): the flux rope face on and
    // edge on, then early and later.
    id: 'eruption',
    panel: [
      ['-50.7478,-141.4986', '8873.427083', '0.376,-0.4341,0.206,0.7923', '5.5'],
      ['39.1987,-145.0325', '8873.427083', '-0.2889,-0.4704,-0.1664,0.817', '5.5'],
      ['-50.7478,-141.4986', '8873.409722', '0.3798,-0.4198,0.1993,0.7999', '3.2'],
      ['-50.7478,-141.4986', '8873.458333', '0.3713,-0.4502,0.2133,0.7836', '10'],
    ].map(([at, t, cq, fov]) =>
      `sun@${at},23.604464Gm;t=${t}jd;cq=${cq};fov=${fov}deg;s=alpoGxF;time:pause;layers:sun=euv`),
  },
  {id: 'gaia', link: true},
]


/**
 * @param {Array<string>} argv
 * @returns {object}
 */
export function parseArgs(argv) {
  const opts = {gpu: false, cesium: false, only: null, png: null, hash: null, id: null, chromium: null}
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--gpu': opts.gpu = true; break
      case '--cesium': opts.cesium = true; break
      case '--only': opts.only = argv[++i].split(','); break
      case '--png': opts.png = argv[++i]; break
      case '--hash': opts.hash = argv[++i].replace(/^#/, ''); break
      case '--id': opts.id = argv[++i]; break
      case '--chromium': opts.chromium = argv[++i]; break
      default: throw new Error(`Unknown argument ${argv[i]}`)
    }
  }
  if (opts.hash !== null && (!opts.id || !opts.png)) {
    throw new Error('--hash needs --id (the image\'s name) and --png (its folder)')
  }
  if (opts.hash !== null && !/^[\w-]+$/.test(opts.id)) {
    throw new Error(`--id is a name, letters, digits, - and _: ${opts.id}`)
  }
  return opts
}


/**
 * @param {string} root
 * @returns {Promise<{url: string, close: Function}>} A static server for the build
 */
async function serve(root) {
  const server = http.createServer((req, res) => {
    const requested = path.join(root, decodeURIComponent(new URL(req.url, 'http://localhost').pathname))
    const file = requested.startsWith(root) && fs.existsSync(requested) && fs.statSync(requested).isFile() ?
      requested : path.join(root, 'index.html')
    res.writeHead(200, {'content-type': MIME[path.extname(file)] ?? 'application/octet-stream'})
    fs.createReadStream(file).pipe(res)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close()}
}


/**
 * js/home.js's cards, read through bun: the app's modules import each other
 * without extensions, and JSON, as the bundler takes them and Node doesn't.
 *
 * @returns {Array<{id: string, link: ?string}>}
 */
function homeCards() {
  const script = 'import {HOME_CARDS} from "./js/home.js"; console.log(JSON.stringify(HOME_CARDS))'
  return JSON.parse(execFileSync('bun', ['-e', script], {cwd: ROOT, encoding: 'utf8'}))
}


/**
 * Render one view in a page of its own.
 *
 * @param {object} browser
 * @param {string} base The build's URL
 * @param {object} card {hash, setup?}
 * @param {object} opts
 * @returns {Promise<string>} The canvas, a PNG data URL, WIDTH × HEIGHT
 */
async function capture(browser, base, card, opts) {
  const page = await browser.newPage({viewport: {width: WIDTH, height: HEIGHT}, deviceScaleFactor: 1})
  await page.route(NODE_HOSTS, async (route) => {
    try {
      const response = await route.fetch()
      await route.fulfill({response, headers: {...response.headers(), 'access-control-allow-origin': '*'}})
    } catch {
      await route.abort()
    }
  })
  await page.route(/googletagmanager/, (route) => route.abort())
  await page.goto(`${base}#${card.hash}`)
  await page.waitForFunction(() => window.c?._reveal?.done, null, {timeout: READY_TIMEOUT_MS, polling: POLL_MS})
  if (!opts.cesium) {
    // Celestiary's own Earth, as the homepage's tour draws it.
    await page.evaluate(() => {
      window.c.ui.layers.suspended = true
    })
  }
  if (card.setup) {
    await page.evaluate(card.setup)
  }
  // The labels and every other annotation off ('V'); the HUD is outside
  // the canvas, which is all that's read.
  await page.evaluate(() => {
    const c = window.c
    if (['a', 'l', 'p', 'o'].some((k) => c.scene.getSetting(k))) {
      c._toggleAllSceneInfo()
    }
  })
  await page.waitForFunction(() => window.c.ui.sceneReady(), null, {timeout: READY_TIMEOUT_MS, polling: POLL_MS})
  await page.waitForTimeout(SETTLE_MS)
  const png = await page.evaluate(() => {
    const c = window.c
    c.ui.renderer.setAnimationLoop(null)
    c.shared.targets.tween = null
    c.ui.renderLoop(performance.now())
    return c.ui.renderer.domElement.toDataURL('image/png')
  })
  await page.close()
  return png
}


/**
 * Lay frames out as one image: one whole, or a grid of them (four as 2 × 2),
 * a thin dark rule between.
 *
 * @param {object} browser
 * @param {Array<string>} frames PNG data URLs, each WIDTH × HEIGHT
 * @returns {Promise<{png: string, webp: string}>} Data URLs: the full size
 *   and the card's
 */
async function compose(browser, frames) {
  const page = await browser.newPage()
  const out = await page.evaluate(async ({urls, sizes, q, gap}) => {
    const images = await Promise.all(urls.map((url) => new Promise((resolve, reject) => {
      const img = new Image
      img.onload = () => resolve(img)
      img.onerror = reject
      img.src = url
    })))
    const cols = Math.ceil(Math.sqrt(images.length))
    const rows = Math.ceil(images.length / cols)
    return sizes.map(([w, h, type]) => {
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      ctx.imageSmoothingQuality = 'high'
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, w, h)
      const g = images.length > 1 ? Math.max(1, Math.round(gap * w)) : 0
      const cw = (w - (g * (cols - 1))) / cols
      const ch = (h - (g * (rows - 1))) / rows
      images.forEach((img, i) => {
        ctx.drawImage(img, (i % cols) * (cw + g), Math.floor(i / cols) * (ch + g), cw, ch)
      })
      return canvas.toDataURL(type, q)
    })
  }, {urls: frames, sizes: [[WIDTH, HEIGHT, 'image/png'], [CARD_WIDTH, CARD_HEIGHT, 'image/webp']], q: WEBP_QUALITY,
    gap: PANEL_GAP})
  await page.close()
  return {png: out[0], webp: out[1]}
}


/**
 * Render one card's view, or its panel's views, and write its image.
 *
 * @param {object} browser
 * @param {string} base The build's URL
 * @param {object} card
 * @param {object} opts
 */
async function render(browser, base, card, opts) {
  const frames = []
  for (const hash of card.panel ?? [card.hash]) {
    frames.push(await capture(browser, base, {...card, hash}, opts))
  }
  const {png, webp} = await compose(browser, frames)
  if (opts.png) {
    fs.mkdirSync(opts.png, {recursive: true})
    fs.writeFileSync(path.join(opts.png, `${card.id}.png`), Buffer.from(png.split(',')[1], 'base64'))
    console.log(`${card.id}: ${path.join(opts.png, `${card.id}.png`)}`)
  }
  if (!card.adhoc) {
    const out = path.join(OUT, `${card.id}.webp`)
    fs.writeFileSync(out, Buffer.from(webp.split(',')[1], 'base64'))
    console.log(`${card.id}: ${path.relative(ROOT, out)} (${fs.statSync(out).size} bytes)`)
  }
}


/** Render every card, or those asked for. */
async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (!fs.existsSync(path.join(DOCS, 'index.html'))) {
    throw new Error('No build in docs/: run `yarn build` first')
  }
  let cards
  if (opts.hash !== null) {
    cards = [{id: opts.id, hash: opts.hash, adhoc: true}]
  } else {
    fs.mkdirSync(OUT, {recursive: true})
    const links = Object.fromEntries(homeCards().map((c) => [c.id, c.link]))
    cards = CARDS
        .filter((c) => !opts.only || opts.only.includes(c.id))
        .map((c) => (c.link ? {...c, hash: links[c.id]} : c))
  }
  const server = await serve(DOCS)
  // A cloud session's Chromium, which the repo's Playwright doesn't know of.
  const executablePath = opts.chromium ?? (fs.existsSync(SESSION_CHROMIUM) ? SESSION_CHROMIUM : undefined)
  const browser = await chromium.launch({executablePath, args: opts.gpu ? ['--ignore-gpu-blocklist'] : SWIFTSHADER})
  try {
    for (const card of cards) {
      await render(browser, server.url, card, opts)
    }
  } finally {
    await browser.close()
    server.close()
  }
}


if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
