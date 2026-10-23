#!/usr/bin/env node
// Serve layer mode for checks on two origins (design/LayerMode.md): the
// built site (docs/, `yarn build` first) as the guest's origin, and a small
// three.js host (tools/layer/host.js) as the host's.
//
//   node tools/layer/serve.mjs [--guest 5480] [--host 5481]
//
// Then open http://localhost:5481/host.html?guest=http://127.0.0.1:5480
// (two hosts, so two origins).

import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import esbuild from 'esbuild'
import config from '../../esbuild/common.js'


const arg = (name, d) => {
  const i = process.argv.indexOf(name)
  return i > 0 ? Number(process.argv[i + 1]) : d
}
const GUEST_PORT = arg('--guest', 5480)
const HOST_PORT = arg('--host', 5481)
const ROOT = new URL('../../', import.meta.url).pathname
const TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.jpg': 'image/jpeg',
  '.map': 'application/json', '.css': 'text/css', '.png': 'image/png', '.wasm': 'application/wasm'}

const built = await esbuild.build({
  entryPoints: [path.join(ROOT, 'tools/layer/host.js')], bundle: true, format: 'esm', write: false,
  plugins: config.plugins, logLevel: 'error',
})
const HOST_FILES = {
  '/host.html': fs.readFileSync(path.join(ROOT, 'tools/layer/host.html')),
  '/host-bundle.js': built.outputFiles[0].contents,
  '/earth.jpg': fs.readFileSync(path.join(ROOT, 'public/textures/earth/blue-marble/2004-10.jpg')),
  '/satellites.json': fs.readFileSync(path.join(ROOT, 'public/data/satellites.json')),
}

/**
 * @param {string} p
 * @returns {string}
 */
const typeOf = (p) => TYPES[path.extname(p)] ?? 'application/octet-stream'

http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  const file = path.join(ROOT, 'docs', p === '/' ? 'index.html' : p)
  if (!file.startsWith(path.join(ROOT, 'docs')) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end()
    return
  }
  res.writeHead(200, {'content-type': typeOf(file)}).end(fs.readFileSync(file))
}).listen(GUEST_PORT, '127.0.0.1')

http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname
  const body = HOST_FILES[p]
  if (!body) {
    res.writeHead(404).end()
    return
  }
  res.writeHead(200, {'content-type': typeOf(p)}).end(body)
}).listen(HOST_PORT, 'localhost')

console.log(`guest http://127.0.0.1:${GUEST_PORT}/layer.html, host http://localhost:${HOST_PORT}/host.html` +
  `?guest=http://127.0.0.1:${GUEST_PORT}`)
