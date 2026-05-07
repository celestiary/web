import fs from 'node:fs'
import os from 'node:os'
import esbuild from 'esbuild'
import config from './common.js'
import {createProxyServer} from './proxy.js'


const ctx = await esbuild.context(config)
await ctx.watch()


/**
 * "It's not possible to hook into esbuild's local server to customize
 * the behavior of the server itself. Instead, behavior should be
 * customized by putting a proxy in front of esbuild."
 *
 * We intend to serve on the SERVE_PORT defined above, so run esbuild
 * on the port below it, and use the SERVE_PORT for a proxy.  The
 * proxy handles 404s with the bounce script above.
 *
 * See https://esbuild.github.io/api/#customizing-server-behavior
 */
const SERVE_PORT = parseInt(process.env.PORT ?? '8080')
const {host, port} = await ctx.serve({
  port: SERVE_PORT - 1,
  servedir: config.outdir,
})

const tlsOptions = loadTlsOptions()
createProxyServer(host, port, tlsOptions).listen(SERVE_PORT)

const scheme = tlsOptions ? 'https' : 'http'
const lanIp = firstLanIPv4()
console.log(`serving on ${scheme}://localhost:${SERVE_PORT} and watching...`)
if (lanIp) {
  console.log(`  LAN: ${scheme}://${lanIp}:${SERVE_PORT}`)
}
if (!tlsOptions) {
  console.log('  (set DEV_HTTPS_KEY + DEV_HTTPS_CERT, or run `yarn cert:dev`, to enable HTTPS for mobile sensor APIs)')
}


/**
 * Read PEM key/cert paths from env.  HTTPS is opt-in: both `DEV_HTTPS_KEY`
 * and `DEV_HTTPS_CERT` must be set (which `yarn serve:https` does).  Plain
 * `yarn serve` always speaks HTTP, even if `dev-certs/` files exist — this
 * matters for `adb reverse` from a phone, where `localhost` is already a
 * secure context and TLS just gets in the way.
 *
 * @returns {{key: Buffer, cert: Buffer} | undefined}
 */
function loadTlsOptions() {
  const keyPath = process.env.DEV_HTTPS_KEY
  const certPath = process.env.DEV_HTTPS_CERT
  if (!keyPath || !certPath) {
    return undefined
  }
  return {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  }
}


/**
 * @returns {string | undefined} First non-internal IPv4 address, or undefined
 */
function firstLanIPv4() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address
      }
    }
  }
  return undefined
}
