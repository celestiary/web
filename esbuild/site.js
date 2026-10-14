/**
 * What a build says about the site to the web: its canonical address; for
 * the build served at the domain's root, the files GitHub Pages and crawlers
 * read there (CNAME, robots.txt, sitemap.xml); and the redirect stub left at
 * the old /web/ address.  DESIGN.md, "Hosting and the domain".
 */

import {normalizeBasePath} from './basePath.js'


/** The site's address: where search engines should credit every copy. */
export const SITE_URL = 'https://celestiary.org/'


/**
 * The tags `{{SITE_HEAD}}` in index.html becomes.
 *
 * @param {object} opts
 * @param {string} [opts.siteUrl] The canonical address
 * @param {boolean} [opts.noindex] A copy that shouldn't be indexed at all
 *   (a PR preview)
 * @returns {string}
 */
export function siteHead({siteUrl = SITE_URL, noindex = false} = {}) {
  const tags = [
    `<link rel="canonical" href="${siteUrl}"/>`,
    `<meta property="og:url" content="${siteUrl}"/>`,
  ]
  if (noindex) {
    tags.push('<meta name="robots" content="noindex"/>')
  }
  return tags.join('\n    ')
}


/**
 * The files for the build served at a custom domain's root, by name.
 *
 * - CNAME: GitHub Pages keeps the custom domain in this file on the deployed
 *   branch.  The deploy replaces the branch's contents (`clean: true`), so
 *   without it in the build each deploy would drop the domain.
 * - robots.txt: everything may be crawled but the PR previews, which live
 *   under the project page (`/web/pr-preview/`).  The rest of `/web/` is the
 *   redirect stub (webStubFiles), left crawlable so crawlers follow it to the
 *   root and the links to it keep their weight.
 * - sitemap.xml: the root for now; the crawlable pages (#244) add theirs.
 *
 * @param {string} domain e.g. 'celestiary.org'
 * @returns {{[name: string]: string}}
 */
export function rootFiles(domain) {
  const url = `https://${domain}/`
  return {
    'CNAME': `${domain}\n`,
    'robots.txt': [
      'User-agent: *',
      'Disallow: /web/pr-preview/',
      '',
      `Sitemap: ${url}sitemap.xml`,
      '',
    ].join('\n'),
    'sitemap.xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      `  <url><loc>${url}</loc></url>`,
      '</urlset>',
      '',
    ].join('\n'),
  }
}


/**
 * Fill a page's build-time placeholders: `{{BASE_PATH}}`,
 * `{{PATH_SEGMENTS_TO_KEEP}}` (404.html's count of the base path's
 * segments), `{{MOVED_TO}}` (404.html: where a retired copy sends its
 * visitors, or empty) and `{{SITE_HEAD}}`.
 *
 * @param {string} content
 * @param {object} opts
 * @param {string} opts.basePath The URL prefix the page is served under
 * @param {string} opts.siteHead What `{{SITE_HEAD}}` becomes (siteHead)
 * @param {string} [opts.movedTo] A path, e.g. '/'
 * @returns {string}
 */
export function fillPlaceholders(content, {basePath, siteHead: head, movedTo = ''}) {
  const base = normalizeBasePath(basePath)
  return content
      .replaceAll('{{BASE_PATH}}', base)
      .replaceAll('{{PATH_SEGMENTS_TO_KEEP}}', String(base.split('/').filter(Boolean).length))
      .replaceAll('{{MOVED_TO}}', movedTo)
      .replaceAll('{{SITE_HEAD}}', head)
}


/** This repo's Pages site: once a second copy of the site, now the stub, with the PR previews under it. */
export const WEB_STUB_PATH = '/web/'


/**
 * The redirect stub at celestiary.org/web/, which used to be a second full
 * copy of the site.  Both files are 404.html's bounce (public/404.html),
 * told the site moved to the root: index.html answers `/web/` itself and
 * 404.html every other path under it but the PR previews', which keep their
 * own bounce.  The query and the `#` fragment come along.
 *
 * @param {string} template public/404.html
 * @returns {{[name: string]: string}} By file name
 */
export function webStubFiles(template) {
  const page = fillPlaceholders(template, {basePath: WEB_STUB_PATH, siteHead: siteHead(), movedTo: '/'})
  return {
    'index.html': page,
    '404.html': page,
  }
}
