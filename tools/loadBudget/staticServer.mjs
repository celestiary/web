import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import zlib from 'node:zlib'


// What GitHub Pages compresses (gzip) and doesn't, measured against the live
// site: everything but already-compressed media.  stars.dat, which is binary,
// goes as gzip (2.1 MB to 1.8 MB), as do JSON and JS.
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.zip': 'application/zip',
}
const NOT_GZIPPED = /^(image\/(jpeg|png|webp|gif|avif)|video\/|audio\/|application\/zip)/
const OK = 200
const NOT_FOUND = 404
// GitHub Pages' default.
const MAX_AGE_S = 600


/**
 * A static server for a built site that behaves like GitHub Pages where it
 * counts for a load measurement: gzip for all but media (cached in memory),
 * `cache-control: max-age=600`, a directory's index.html, and the site's own
 * 404.html with a 404 status for a missing path (not index.html, so a
 * request for a file that isn't there costs what it does in production).
 *
 * @param {string} root The built site (docs/)
 * @returns {Promise<{url: string, close: function(): void}>} listening on an
 *   ephemeral local port; `url` ends in '/'
 */
export async function serveLikePages(root) {
  const cache = new Map()
  const server = http.createServer((req, res) => {
    const found = resolve(root, new URL(req.url, 'http://localhost').pathname)
    const file = found ?? path.join(root, '404.html')
    const type = TYPES[path.extname(file)] ?? 'application/octet-stream'
    const headers = {'content-type': type, 'cache-control': `max-age=${MAX_AGE_S}`, 'vary': 'Accept-Encoding'}
    const gzip = !NOT_GZIPPED.test(type) && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '')
    if (!gzip) {
      res.writeHead(found ? OK : NOT_FOUND, headers)
      fs.createReadStream(file).pipe(res)
      return
    }
    let body = cache.get(file)
    if (!body) {
      body = zlib.gzipSync(fs.readFileSync(file))
      cache.set(file, body)
    }
    res.writeHead(found ? OK : NOT_FOUND, {...headers, 'content-encoding': 'gzip', 'content-length': body.length})
    res.end(body)
  })
  await new Promise((resolveListening) => server.listen(0, '127.0.0.1', resolveListening))
  return {url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close()}
}


/**
 * @param {string} root
 * @param {string} urlPath A request's path
 * @returns {string|null} the file it names under root (a directory's
 *   index.html), or null if there's none
 */
function resolve(root, urlPath) {
  let file = path.join(root, decodeURIComponent(urlPath))
  if (file !== root && !file.startsWith(`${root}${path.sep}`)) {
    return null
  }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    file = path.join(file, 'index.html')
  }
  return fs.existsSync(file) && fs.statSync(file).isFile() ? file : null
}
