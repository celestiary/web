import {describe, expect, it} from 'bun:test'
import {readFileSync} from 'node:fs'
import {SITE_URL, fillPlaceholders, rootFiles, siteHead} from './site.js'


describe('siteHead', () => {
  it('credits the site\'s address from every copy', () => {
    const head = siteHead()
    expect(SITE_URL).toBe('https://celestiary.org/')
    expect(head).toContain('<link rel="canonical" href="https://celestiary.org/"/>')
    expect(head).toContain('<meta property="og:url" content="https://celestiary.org/"/>')
    expect(head).not.toContain('noindex')
  })

  it('keeps a preview out of the index', () => {
    expect(siteHead({noindex: true})).toContain('<meta name="robots" content="noindex"/>')
  })

  it('has a place in index.html', () => {
    expect(readFileSync(new URL('../public/index.html', import.meta.url), 'utf8')).toContain('{{SITE_HEAD}}')
  })
})


describe('rootFiles', () => {
  const files = rootFiles('celestiary.org')

  it('names the domain for GitHub Pages', () => {
    expect(files['CNAME']).toBe('celestiary.org\n')
  })

  it('lets everything be crawled but the previews, and points to the sitemap', () => {
    const robots = files['robots.txt']
    expect(robots).toContain('User-agent: *')
    expect(robots).toContain('Disallow: /web/pr-preview/')
    expect(robots).not.toMatch(/Disallow: \/\s*$/m)
    expect(robots).toContain('Sitemap: https://celestiary.org/sitemap.xml')
  })

  it('lists the root in the sitemap', () => {
    expect(files['sitemap.xml']).toContain('<loc>https://celestiary.org/</loc>')
    expect(files['sitemap.xml']).toMatch(/^<\?xml/)
  })
})


describe('fillPlaceholders', () => {
  const page = '<base href="{{BASE_PATH}}"/>{{SITE_HEAD}} keep={{PATH_SEGMENTS_TO_KEEP}} moved=\'{{MOVED_TO}}\''

  it('fills the root', () => {
    expect(fillPlaceholders(page, {basePath: '/', siteHead: 'H'})).toBe('<base href="/"/>H keep=0 moved=\'\'')
  })

  it('fills a preview, counting its base path\'s segments', () => {
    expect(fillPlaceholders(page, {basePath: 'web/pr-preview/pr-42', siteHead: 'H'}))
        .toBe('<base href="/web/pr-preview/pr-42/"/>H keep=3 moved=\'\'')
  })

  it('says where a retired copy moved to', () => {
    expect(fillPlaceholders(page, {basePath: '/web/', siteHead: '', movedTo: '/'})).toBe('<base href="/web/"/> keep=1 moved=\'/\'')
  })
})
