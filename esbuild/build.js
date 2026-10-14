import fs from 'node:fs'
import esbuild from 'esbuild'
import {normalizeBasePath} from './basePath.js'
import {copyCesiumAssets} from './cesiumAssets.js'
import config from './common.js'
import {SITE_URL, rootFiles, siteHead} from './site.js'


const BASE_PATH = normalizeBasePath(process.env.BASE_PATH || '/')
const PATH_SEGMENTS_TO_KEEP = BASE_PATH.split('/').filter(Boolean).length
// The domain this build is served at the root of (CNAME, robots.txt,
// sitemap.xml), or empty; and whether it's a copy to keep out of search
// results (a PR preview).  esbuild/site.js.
const CUSTOM_DOMAIN = (process.env.CUSTOM_DOMAIN || '').trim()
const NOINDEX = process.env.NOINDEX === 'true'
const SITE_HEAD = siteHead({siteUrl: SITE_URL, noindex: NOINDEX})


esbuild
    .build(config)
    .then((result) => {
      substitutePlaceholders(`${config.outdir}/index.html`)
      substitutePlaceholders(`${config.outdir}/404.html`)
      copyCesiumAssets(config.outdir)
      if (CUSTOM_DOMAIN) {
        for (const [name, content] of Object.entries(rootFiles(CUSTOM_DOMAIN))) {
          fs.writeFileSync(`${config.outdir}/${name}`, content)
        }
      }
      console.log(`Build succeeded.  BASE_PATH=${BASE_PATH}` +
        (CUSTOM_DOMAIN ? `  CUSTOM_DOMAIN=${CUSTOM_DOMAIN}` : '') + (NOINDEX ? '  NOINDEX' : ''))
    })
    .catch((err) => {
      console.error(`Build failed:`, err)
      process.exit(1)
    })


/**
 * Replace `{{BASE_PATH}}`, `{{PATH_SEGMENTS_TO_KEEP}}` and `{{SITE_HEAD}}` in
 * the given file.
 * No-op if the file is missing.
 *
 * @param {string} filePath
 */
function substitutePlaceholders(filePath) {
  if (!fs.existsSync(filePath)) return
  const content = fs.readFileSync(filePath, 'utf8')
  const result = content
      .replaceAll('{{BASE_PATH}}', BASE_PATH)
      .replaceAll('{{PATH_SEGMENTS_TO_KEEP}}', String(PATH_SEGMENTS_TO_KEEP))
      .replaceAll('{{SITE_HEAD}}', SITE_HEAD)
  fs.writeFileSync(filePath, result)
}
