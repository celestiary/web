/**
 * What a build says about the site to the web: its canonical address, and,
 * for the build served at the domain's root, the files GitHub Pages and
 * crawlers read there (CNAME, robots.txt, sitemap.xml).  DESIGN.md, "Hosting
 * and the domain".
 */


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
 *   under the project page (`/web/pr-preview/`).  The project page itself
 *   (`/web/`) stays crawlable so the links to it keep their weight; its
 *   canonical tag credits the root.
 * - sitemap.xml: the root for now; the crawlable pages (#244) add theirs.
 *
 * @param {string} domain e.g. 'celestiary.org'
 * @returns {Object<string, string>}
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
