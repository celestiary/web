#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {chromium} from 'playwright'
import {RUNTIME_BUDGET} from '../../esbuild/budget.js'
import {
  NetworkRecorder, budgetProblems, foldersByRequests, formatTop, kbText, originOf, summarize, topRequests,
} from './network.mjs'
import {serveLikePages} from './staticServer.mjs'


/**
 * The homepage's load against the runtime budget: `yarn load-budget`.  See
 * DESIGN.md, "Load budgets".
 *
 * Opens the homepage (the bare URL) in headless Chromium and records every
 * request and its encoded (on the wire) bytes through a CDP session, not
 * `page.route`, which would switch the HTTP cache off.  With no --url it
 * serves docs/ itself (`yarn build` first) the way GitHub Pages does, gzip
 * included, and refuses every other host; with --url it measures that
 * page, e.g. https://celestiary.org/ or a PR preview
 * (https://celestiary.org/web/pr-preview/pr-<n>/).
 *
 * Two moments are measured: "ready", when the scene is in
 * (`c.ui.sceneReady()`, the reveal's trigger), and "settled", when the
 * network has then been quiet for --quiet seconds (the ephemeris and
 * whatever else is fetched with the scene on screen).  Each is compared with
 * RUNTIME_BUDGET (esbuild/budget.js); the 15 biggest requests are printed
 * either way; exits 1 over budget.
 *
 * Usage: yarn load-budget [--url url] [--docs dir] [--no-budget]
 *          [--viewport WxH] [--timeout seconds] [--quiet seconds] [--settle seconds]
 *          [--allow-origin origin]... [--json file]
 *          [--chromium path] [--chromium-arg arg]... [--trust-ca file]
 *
 * --trust-ca: a CA certificate (PEM) the browser should accept, pinned by
 * its public key (--ignore-certificate-errors-spki-list), for a sandbox
 * whose proxy re-signs TLS (AGENTS.md); verification stays on for everything
 * else.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_DOCS = path.join(HERE, '..', '..', 'docs')
const DEFAULT_TIMEOUT_S = 180
const DEFAULT_QUIET_S = 3
const DEFAULT_SETTLE_S = 60
const DEFAULT_VIEWPORT = [1280, 720]
const POLL_MS = 250
const MS = 1000
const EXIT_FAIL = 1
const EXIT_SETUP = 2
const CHROMIUM_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
// Hosts the app may reach that the budget isn't about: refused, so a slow or
// failing third party can't change the measurement.  Anything else outside
// the site's origins is listed in the report but not counted.
const BLOCKED_HOSTS = [
  'fonts.googleapis.com', 'fonts.gstatic.com', 'www.googletagmanager.com', 'www.google-analytics.com',
  'api.cesium.com', 'assets.ion.cesium.com', 'gibs.earthdata.nasa.gov', 'trek.nasa.gov', 'eoimages.gsfc.nasa.gov',
  'cdn.jsdelivr.net', 'unpkg.com',
]


/**
 * @param {Array<string>} argv
 * @returns {object} the options
 */
function parseArgs(argv) {
  const opts = {url: null, docs: DEFAULT_DOCS, budget: true, viewport: DEFAULT_VIEWPORT, timeout: DEFAULT_TIMEOUT_S,
    quiet: DEFAULT_QUIET_S, settle: DEFAULT_SETTLE_S, allowOrigins: [], json: null, chromium: null,
    chromiumArgs: [], trustCa: null}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const value = () => {
      if (i + 1 >= argv.length) {
        throw new Error(`${arg} needs a value`)
      }
      return argv[++i]
    }
    switch (arg) {
      case '--url': opts.url = value(); break
      case '--docs': opts.docs = path.resolve(value()); break
      case '--no-budget': opts.budget = false; break
      case '--viewport': opts.viewport = value().split('x').map(Number); break
      case '--timeout': opts.timeout = Number(value()); break
      case '--quiet': opts.quiet = Number(value()); break
      case '--settle': opts.settle = Number(value()); break
      case '--allow-origin': opts.allowOrigins.push(value()); break
      case '--json': opts.json = path.resolve(value()); break
      case '--chromium': opts.chromium = value(); break
      case '--chromium-arg': opts.chromiumArgs.push(value()); break
      case '--trust-ca': opts.trustCa = value(); break
      default: throw new Error(`unknown argument ${arg}`)
    }
  }
  return opts
}


/**
 * @param {string} pemFile A CA certificate
 * @returns {string} the base64 SHA-256 of its SubjectPublicKeyInfo, as
 *   Chromium's --ignore-certificate-errors-spki-list takes it
 */
function spkiHash(pemFile) {
  const der = new crypto.X509Certificate(fs.readFileSync(pemFile)).publicKey.export({type: 'spki', format: 'der'})
  return crypto.createHash('sha256').update(der).digest('base64')
}


/**
 * @param {object} page
 * @returns {Promise<boolean>} whether the scene is in
 */
function sceneReady(page) {
  return page.evaluate(() => Boolean(window.c?.ui?.sceneReady?.())).catch(() => false)
}


/**
 * @param {object} page
 * @returns {Promise<boolean>} whether the ephemeris has loaded, the last thing
 *   the first load fetches once the scene is on screen (Celestiary.frame)
 */
function ephemerisIn(page) {
  return page.evaluate(() => Boolean(window.c?.animation?.vsop)).catch(() => false)
}


/**
 * Loads the page and takes the two snapshots.
 *
 * @param {object} opts
 * @param {string} url The page
 * @param {boolean} local Whether it's our own server (refuse other hosts at
 *   the resolver too)
 * @returns {Promise<{ready: Array<object>, settled: Array<object>, quiet: boolean, readyMs: number}>}
 */
async function measure(opts, url, local) {
  const args = [...CHROMIUM_ARGS, ...opts.chromiumArgs]
  if (local) {
    args.push('--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1')
  }
  if (opts.trustCa) {
    args.push(`--ignore-certificate-errors-spki-list=${spkiHash(opts.trustCa)}`)
  }
  const browser = await chromium.launch({headless: true, args, executablePath: opts.chromium ?? undefined})
  try {
    const [width, height] = opts.viewport
    const context = await browser.newContext({viewport: {width, height}})
    const page = await context.newPage()
    const cdp = await context.newCDPSession(page)
    const recorder = new NetworkRecorder()
    let lastActivity = Date.now()
    const onEvent = (method) => (params) => {
      recorder.handle(method, params)
      lastActivity = Date.now()
    }
    for (const method of ['requestWillBeSent', 'requestServedFromCache', 'responseReceived', 'dataReceived',
      'loadingFinished', 'loadingFailed']) {
      cdp.on(`Network.${method}`, onEvent(`Network.${method}`))
    }
    await cdp.send('Network.enable')
    await cdp.send('Network.setBlockedURLs', {urls: BLOCKED_HOSTS.map((host) => `*://${host}/*`)})
    const started = Date.now()
    await page.goto(url, {waitUntil: 'commit'})
    const deadline = started + (opts.timeout * MS)
    while (!await sceneReady(page)) {
      if (Date.now() > deadline) {
        throw new Error(`the scene wasn't ready in ${opts.timeout} s (window.c.ui.sceneReady())`)
      }
      await page.waitForTimeout(POLL_MS)
    }
    const readyMs = Date.now() - started
    const ready = recorder.snapshot()
    // Settled: the ephemeris is in, and nothing has been requested or
    // received for --quiet seconds, with nothing in flight; at most --settle
    // seconds.
    lastActivity = Date.now()
    const settleBy = Date.now() + (opts.settle * MS)
    let quiet = false
    while (Date.now() < settleBy) {
      const inFlight = recorder.entries.some((e) => !e.done)
      if (!inFlight && Date.now() - lastActivity >= opts.quiet * MS && await ephemerisIn(page)) {
        quiet = true
        break
      }
      await page.waitForTimeout(POLL_MS)
    }
    return {ready, settled: recorder.snapshot(), quiet, readyMs}
  } finally {
    await browser.close()
  }
}


/**
 * @param {string} stage
 * @param {object} summary
 * @param {string} origin The page's
 * @param {object} limit
 * @returns {{text: string, problems: string[]}} the stage's report, and what's over
 */
function report(stage, summary, origin, limit) {
  const folders = foldersByRequests(summary.counted, origin)
      .map((f) => `    ${String(f.requests).padStart(3)} requests  ${kbText(f.bytes).padStart(11)}  ${f.folder}`)
  const text = `${stage}: ${summary.requests} requests, ${kbText(summary.bytes)} transferred ` +
    `(budget ${limit.requests} requests, ${limit.kb.toLocaleString('en-US')} KB)\n` +
    `  the 15 biggest requests:\n${formatTop(topRequests(summary.counted), origin)}\n` +
    `  the folders with the most requests:\n${folders.join('\n')}`
  return {text, problems: budgetProblems(stage, summary, limit)}
}


/**
 * Runs the measurement and exits 1 if over budget.
 */
async function main() {
  const opts = parseArgs(process.argv.slice(2))
  let server = null
  let url = opts.url
  if (!url) {
    if (!fs.existsSync(path.join(opts.docs, 'index.html'))) {
      console.error(`No build in ${opts.docs}: run \`yarn build\` first.`)
      process.exit(EXIT_SETUP)
    }
    server = await serveLikePages(opts.docs)
    url = server.url
  }
  try {
    const origins = [originOf(url), ...opts.allowOrigins]
    const {ready, settled, quiet, readyMs} = await measure(opts, url, !opts.url)
    console.log(`Homepage load budget: ${url}${server ? ' (docs/, served with gzip)' : ''}`)
    const summaries = {ready: summarize(ready, origins), settled: summarize(settled, origins)}
    const stages = Object.entries(summaries).map(([stage, summary]) =>
      report(stage, summary, `${originOf(url)}/`, RUNTIME_BUDGET[stage]))
    console.log(`\nScene ready after ${(readyMs / MS).toFixed(1)} s.`)
    stages.forEach((s) => console.log(`\n${s.text}`))
    if (!quiet) {
      console.warn(`\nThe load hadn't settled (the ephemeris in, the network quiet) within ${opts.settle} s of ` +
        'the scene being ready; "settled" is what had arrived by then.')
    }
    const outside = summaries.settled.outside
    if (outside.length > 0) {
      const hosts = [...new Set(outside.map((r) => originOf(r.url)))].join(', ')
      console.log(`\n${outside.length} requests outside the site (not counted): ${hosts}`)
    }
    if (opts.json) {
      fs.writeFileSync(opts.json, JSON.stringify({url, readyMs, quiet,
        ready: {...summaries.ready, outside: undefined}, settled: {...summaries.settled, outside: undefined},
        budget: RUNTIME_BUDGET}, null, 2))
    }
    const problems = stages.flatMap((s) => s.problems)
    if (opts.budget && problems.length > 0) {
      console.error(`\nThe homepage's load is over its budget (esbuild/budget.js):\n  ${problems.join('\n  ')}\n` +
        '  What grew is in the tables above (the biggest requests, the folders with the most).  Load the new ' +
        'data later (on demand, or on approach), or if the growth is intended raise the limit in ' +
        'esbuild/budget.js and say why in the PR.')
      process.exit(EXIT_FAIL)
    }
    console.log(opts.budget ? '\nWithin budget.' : '\n(No budget applied.)')
  } finally {
    server?.close()
  }
}


main().catch((err) => {
  console.error(err.message ?? err)
  process.exit(EXIT_SETUP)
})
