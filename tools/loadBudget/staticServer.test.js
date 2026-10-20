import {afterAll, beforeAll, describe, expect, it} from 'bun:test'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import {serveLikePages} from './staticServer.mjs'


describe('serveLikePages', () => {
  let root
  let server

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'bud-site-'))
    fs.writeFileSync(path.join(root, 'index.html'), '<html>home</html>')
    fs.writeFileSync(path.join(root, '404.html'), '<html>gone</html>')
    fs.writeFileSync(path.join(root, 'app.js'), 'x'.repeat(5000))
    fs.writeFileSync(path.join(root, 'stars.dat'), Buffer.alloc(5000, 7))
    fs.writeFileSync(path.join(root, 'pic.jpg'), Buffer.alloc(5000, 7))
    server = await serveLikePages(root)
  })

  afterAll(() => {
    server.close()
    fs.rmSync(root, {recursive: true})
  })

  // node:http, not fetch (other tests replace the global one), and the body undecoded.
  const get = (p, headers = {'accept-encoding': 'gzip'}) => new Promise((resolve, reject) => {
    http.get(`${server.url}${p}`, {headers}, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        const body = Buffer.concat(chunks)
        resolve({
          status: res.statusCode,
          header: (name) => res.headers[name] ?? null,
          body,
          text: () => (res.headers['content-encoding'] === 'gzip' ? zlib.gunzipSync(body) : body).toString(),
        })
      })
    }).on('error', reject)
  })

  it('serves the index for the root', async () => {
    expect((await get('')).text()).toBe('<html>home</html>')
  })

  it('gzips text and binary data, and says so', async () => {
    for (const file of ['app.js', 'stars.dat']) {
      const res = await get(file)
      expect(res.header('content-encoding')).toBe('gzip')
      expect(res.body.length).toBeLessThan(5000)
      expect(zlib.gunzipSync(res.body).length).toBe(5000)
    }
  })

  it('leaves images alone, and sends plain bytes to a client that won\'t take gzip', async () => {
    expect((await get('pic.jpg')).header('content-encoding')).toBeNull()
    const res = await get('app.js', {'accept-encoding': 'identity'})
    expect(res.header('content-encoding')).toBeNull()
    expect(res.text().length).toBe(5000)
  })

  it('caches for ten minutes, as GitHub Pages does', async () => {
    expect((await get('app.js')).header('cache-control')).toBe('max-age=600')
  })

  it('answers a missing file with 404.html and a 404, not the index', async () => {
    const res = await get('data/nothing.json')
    expect(res.status).toBe(404)
    expect(res.text()).toBe('<html>gone</html>')
  })

  it('does not serve outside the root', async () => {
    const res = await get('..%2F..%2Fetc%2Fpasswd')
    expect(res.status).toBe(404)
  })
})
