import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import {fillPlaceholders, siteHead} from './site.js'


/**
 * @param {string} proxiedHost The host to which traffic will be sent. E.g. localhost
 * @param {number} port The port to which traffic will be sent.  E.g. 8079
 * @param {{key: Buffer, cert: Buffer}} [tlsOptions] When supplied, the
 *   proxy listens on HTTPS using these credentials.  esbuild stays HTTP
 *   on `host:port`; TLS terminates at the proxy.
 * @see https://esbuild.github.io/api/#serve-proxy
 * @returns {object} Proxy server
 */
export function createProxyServer(host, port, tlsOptions) {
  const handler = (req, res) => {
    const options = {
      hostname: host,
      port: port,
      path: req.url,
      method: req.method,
      headers: req.headers,
    }

    // Forward each incoming request to esbuild
    const proxyReq = http.request(options, (proxyResponse) => {
      // If esbuild cannot find the resource to serve, send our react-router bounce.
      if (proxyResponse.statusCode === HTTP_NOT_FOUND) {
        console.log('Serving 404 bounce page')
        serveNotFound(res)
        return
      }

      // Otherwise, forward the response from esbuild to the client
      res.writeHead(proxyResponse.statusCode, proxyResponse.headers)
      proxyResponse.pipe(res, {end: true})
    })

    // Forward the body of the request to esbuild
    req.pipe(proxyReq, {end: true})
  }
  return tlsOptions ? https.createServer(tlsOptions, handler) : http.createServer(handler)
}


const HTTP_OK = 200
const HTTP_NOT_FOUND = 404

/**
 * We interpret any 404 as a potential react-router bounce: the site's own
 * 404.html (public/404.html), filled in for the root, as GitHub Pages
 * serves it in production.
 */
const serveNotFound = ((res) => {
  const template = fs.readFileSync(new URL('../public/404.html', import.meta.url), 'utf8')
  res.writeHead(HTTP_OK, {'Content-Type': 'text/html'})
  res.end(fillPlaceholders(template, {basePath: '/', siteHead: siteHead()}))
})
