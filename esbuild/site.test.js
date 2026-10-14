import {describe, expect, it} from 'bun:test'
import {readFileSync} from 'node:fs'
import {SITE_URL, rootFiles, siteHead} from './site.js'


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
