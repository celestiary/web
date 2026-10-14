import {describe, expect, it} from 'bun:test'
import {readFileSync} from 'node:fs'
import {fillPlaceholders, siteHead, webStubFiles} from './site.js'


// public/404.html's bounce, run as GitHub Pages serves it: the site's
// top-level 404.html, for every missing path under the site.
const TEMPLATE = readFileSync(new URL('../public/404.html', import.meta.url), 'utf8')


/**
 * @param {string} page A filled-in 404.html
 * @returns {string} Its bounce script
 */
function bounceScript(page) {
  return page.match(/<script type="text\/javascript" id="bounce">([\s\S]*?)<\/script>/)[1]
}


/**
 * Run a page's bounce at a URL.
 *
 * @param {string} page A filled-in 404.html
 * @param {string} href The URL GitHub Pages answered with the page
 * @returns {{to: ?string, stopped: boolean}} Where it sent the browser
 *   (null if nowhere), and whether it showed its not-found text instead
 */
function visit(page, href) {
  const url = new URL(href)
  let to = null
  const listeners = []
  const notFound = {hidden: true}
  const window = {
    location: {
      protocol: url.protocol, hostname: url.hostname, port: url.port,
      pathname: url.pathname, search: url.search, hash: url.hash,
      replace: (u) => {
        to = u
      },
    },
  }
  const document = {
    title: '',
    addEventListener: (type, fn) => listeners.push(fn),
    getElementById: (id) => (id === 'not-found' ? notFound : null),
  }
  new Function('window', 'document', bounceScript(page))(window, document)
  listeners.forEach((fn) => fn())
  return {to, stopped: !notFound.hidden}
}


const ROOT = fillPlaceholders(TEMPLATE, {basePath: '/', siteHead: siteHead()})
const STUB = webStubFiles(TEMPLATE)
const VIEW = '#sun/earth@-38.15,145.2,6.4Mm;t=9779.5417jd;cq=-0.0283,-0.4559,-0.0145,0.8895;fov=45deg;s=F'


describe('the root\'s 404.html (celestiary.org)', () => {
  it('bounces a deep route to the app, keeping the query and the fragment', () => {
    expect(visit(ROOT, 'https://celestiary.org/about').to).toBe('https://celestiary.org/?/about')
    expect(visit(ROOT, 'https://celestiary.org/guide/star?perf=1&hdr=0#sun').to)
        .toBe('https://celestiary.org/?/guide/star&perf=1~and~hdr=0#sun')
  })

  it('keeps the port, for a local server', () => {
    expect(visit(ROOT, 'http://localhost:5400/about').to).toBe('http://localhost:5400/?/about')
  })

  it('stops instead of bouncing again (no loop)', () => {
    expect(visit(ROOT, 'https://celestiary.org/missing/?/x')).toEqual({to: null, stopped: true})
  })

  it('fills every placeholder', () => {
    expect(ROOT).not.toContain('{{')
    expect(ROOT).toContain('var pathSegmentsToKeep = 0')
    expect(ROOT).toContain('var movedTo = \'\'')
    expect(ROOT).toContain('<link rel="canonical" href="https://celestiary.org/"/>')
  })
})


describe('the /web/ redirect stub', () => {
  it('is the same page at /web/ and for every missing path under it', () => {
    expect(STUB['index.html']).toBe(STUB['404.html'])
    expect(STUB['404.html']).not.toContain('{{')
    expect(STUB['404.html']).toContain('<link rel="canonical" href="https://celestiary.org/"/>')
    expect(STUB['404.html']).not.toContain('noindex')
  })

  it('sends no referrer, which the app would route to (js/Routed.jsx)', () => {
    expect(STUB['404.html']).toContain('<meta name="referrer" content="no-referrer">')
  })

  const page = STUB['404.html']

  it('sends /web/ to the root', () => {
    expect(visit(page, 'https://celestiary.org/web/').to).toBe('https://celestiary.org/')
    expect(visit(page, 'https://celestiary.org/web').to).toBe('https://celestiary.org/')
  })

  it('keeps a scene link\'s fragment', () => {
    expect(visit(page, `https://celestiary.org/web/${VIEW}`).to).toBe(`https://celestiary.org/${VIEW}`)
    expect(visit(page, 'https://celestiary.org/web/#sun/earth/new-york').to)
        .toBe('https://celestiary.org/#sun/earth/new-york')
    expect(visit(page, 'https://celestiary.org/web/#;news:tour').to).toBe('https://celestiary.org/#;news:tour')
  })

  it('keeps the query as it was', () => {
    expect(visit(page, `https://celestiary.org/web/?perf=1&off=clouds${VIEW}`).to)
        .toBe(`https://celestiary.org/?perf=1&off=clouds${VIEW}`)
  })

  it('keeps the route, for the root\'s own 404.html to bounce', () => {
    expect(visit(page, 'https://celestiary.org/web/about').to).toBe('https://celestiary.org/about')
    expect(visit(page, 'https://celestiary.org/web/guide/star?perf=1#sun').to)
        .toBe('https://celestiary.org/guide/star?perf=1#sun')
    expect(visit(page, 'https://celestiary.org/web/index.html#sun').to).toBe('https://celestiary.org/index.html#sun')
  })

  it('sends an already bounced link on as it is, for the root\'s index.html to restore', () => {
    expect(visit(page, 'https://celestiary.org/web/?/about&perf=1#sun').to)
        .toBe('https://celestiary.org/?/about&perf=1#sun')
  })

  it('stays on the host it was reached at', () => {
    expect(visit(page, 'http://localhost:5400/web/settings#sun').to).toBe('http://localhost:5400/settings#sun')
  })

  it('bounces a PR preview\'s deep link to the preview, not the root', () => {
    expect(visit(page, 'https://celestiary.org/web/pr-preview/pr-261/guide/star?perf=1#sun').to)
        .toBe('https://celestiary.org/web/pr-preview/pr-261/?/guide/star&perf=1#sun')
    expect(visit(page, `https://celestiary.org/web/pr-preview/pr-261/about${VIEW}`).to)
        .toBe(`https://celestiary.org/web/pr-preview/pr-261/?/about${VIEW}`)
  })

  it('stops at a removed preview instead of bouncing for ever', () => {
    const first = visit(page, 'https://celestiary.org/web/pr-preview/pr-12/')
    expect(first.to).toBe('https://celestiary.org/web/pr-preview/pr-12/?/')
    expect(visit(page, first.to)).toEqual({to: null, stopped: true})
  })

  it('treats a path that only looks like a preview as moved', () => {
    expect(visit(page, 'https://celestiary.org/web/pr-preview/').to).toBe('https://celestiary.org/pr-preview/')
    expect(visit(page, 'https://celestiary.org/web/pr-preview/latest/x').to)
        .toBe('https://celestiary.org/pr-preview/latest/x')
  })
})
