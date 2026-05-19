import fs from 'node:fs'
import esbuild from 'esbuild'
import config from './common.js'


const BASE_PATH = normalizeBasePath(process.env.BASE_PATH || '/')
const PATH_SEGMENTS_TO_KEEP = BASE_PATH.split('/').filter(Boolean).length


esbuild
    .build(config)
    .then((result) => {
      substitutePlaceholders(`${config.outdir}/index.html`)
      substitutePlaceholders(`${config.outdir}/404.html`)
      console.log(`Build succeeded.  BASE_PATH=${BASE_PATH}`)
    })
    .catch((err) => {
      console.error(`Build failed:`, err)
      process.exit(1)
    })


/**
 * Replace `{{BASE_PATH}}` and `{{PATH_SEGMENTS_TO_KEEP}}` in the given file.
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
  fs.writeFileSync(filePath, result)
}


/**
 * Coerce a deploy base into the form `/foo/` (leading and trailing slash).
 * Empty or "/" stays "/".
 *
 * @param {string} input
 * @returns {string}
 */
function normalizeBasePath(input) {
  let p = input.trim()
  if (!p || p === '/') return '/'
  if (!p.startsWith('/')) p = `/${p}`
  if (!p.endsWith('/')) p = `${p}/`
  return p
}
