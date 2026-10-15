import {describe, expect, it} from 'bun:test'
import {
  NetworkRecorder, budgetProblems, foldersByRequests, formatTop, kbText, originOf, summarize, topRequests,
} from './network.mjs'


const KB = 1024
const ORIGIN = 'http://127.0.0.1:5000'


/**
 * Feeds a recorder one request's whole life.
 *
 * @param {NetworkRecorder} rec
 * @param {string} id
 * @param {string} url
 * @param {number} bytes The encoded length at the end
 * @param {object} [extra] {type, status, cached}
 */
function load(rec, id, url, bytes, {type = 'Fetch', status = 200, cached = false} = {}) {
  rec.handle('Network.requestWillBeSent', {requestId: id, request: {url}, type})
  if (cached) {
    rec.handle('Network.requestServedFromCache', {requestId: id})
  }
  rec.handle('Network.responseReceived', {requestId: id, response: {status, encodedDataLength: 300}})
  rec.handle('Network.dataReceived', {requestId: id, dataLength: bytes * 2, encodedDataLength: bytes - 300})
  rec.handle('Network.loadingFinished', {requestId: id, encodedDataLength: bytes})
}


describe('NetworkRecorder', () => {
  it('records a request\'s url, type, status and the encoded bytes loadingFinished reports', () => {
    const rec = new NetworkRecorder()
    load(rec, '1', `${ORIGIN}/data/stars.dat`, 2000 * KB)
    expect(rec.snapshot()).toEqual([{url: `${ORIGIN}/data/stars.dat`, type: 'Fetch', status: 200,
      bytes: 2000 * KB, done: true, fromCache: false, failed: false, error: ''}])
  })

  it('counts a request in flight by what has arrived so far', () => {
    const rec = new NetworkRecorder()
    rec.handle('Network.requestWillBeSent', {requestId: '1', request: {url: `${ORIGIN}/a.js`}, type: 'Script'})
    rec.handle('Network.responseReceived', {requestId: '1', response: {status: 200, encodedDataLength: 300}})
    rec.handle('Network.dataReceived', {requestId: '1', dataLength: 5000, encodedDataLength: 1000})
    const [entry] = rec.snapshot()
    expect(entry.done).toBe(false)
    expect(entry.bytes).toBe(1300)
  })

  it('snapshots are copies: later events don\'t change them', () => {
    const rec = new NetworkRecorder()
    rec.handle('Network.requestWillBeSent', {requestId: '1', request: {url: `${ORIGIN}/a.js`}, type: 'Script'})
    const before = rec.snapshot()
    rec.handle('Network.loadingFinished', {requestId: '1', encodedDataLength: 900})
    expect(before[0].done).toBe(false)
    expect(rec.snapshot()[0].bytes).toBe(900)
  })

  it('counts a cache hit as a request of no bytes', () => {
    const rec = new NetworkRecorder()
    load(rec, '1', `${ORIGIN}/a.jpg`, 500 * KB)
    load(rec, '2', `${ORIGIN}/a.jpg`, 0, {cached: true})
    const [first, second] = rec.snapshot()
    expect(first.bytes).toBe(500 * KB)
    expect(second.fromCache).toBe(true)
    expect(second.bytes).toBe(0)
  })

  it('records a failure, and why', () => {
    const rec = new NetworkRecorder()
    rec.handle('Network.requestWillBeSent', {requestId: '1', request: {url: 'https://fonts.gstatic.com/x'}})
    rec.handle('Network.loadingFailed', {requestId: '1', errorText: 'net::ERR_BLOCKED_BY_CLIENT', blockedReason: 'inspector'})
    const [entry] = rec.snapshot()
    expect(entry.failed).toBe(true)
    expect(entry.error).toBe('blocked: inspector')
    expect(entry.done).toBe(true)
  })

  it('takes a redirect as two requests under one id', () => {
    const rec = new NetworkRecorder()
    rec.handle('Network.requestWillBeSent', {requestId: '1', request: {url: `${ORIGIN}/a`}})
    rec.handle('Network.requestWillBeSent', {requestId: '1', request: {url: `${ORIGIN}/b`},
      redirectResponse: {status: 301, encodedDataLength: 200}})
    rec.handle('Network.loadingFinished', {requestId: '1', encodedDataLength: 1000})
    expect(rec.snapshot().map((e) => [e.url, e.status, e.bytes])).toEqual([[`${ORIGIN}/a`, 301, 200], [`${ORIGIN}/b`, 0, 1000]])
  })

  it('ignores events for requests it never saw, and other methods', () => {
    const rec = new NetworkRecorder()
    rec.handle('Network.loadingFinished', {requestId: 'nope', encodedDataLength: 5})
    rec.handle('Page.loadEventFired', {})
    expect(rec.snapshot()).toEqual([])
  })
})


describe('summarize', () => {
  const requests = () => {
    const rec = new NetworkRecorder()
    load(rec, '1', `${ORIGIN}/`, 3 * KB, {type: 'Document'})
    load(rec, '2', `${ORIGIN}/data/stars.dat`, 2000 * KB)
    load(rec, '3', 'data:image/png;base64,AAAA', 0, {type: 'Image'})
    load(rec, '4', 'https://fonts.googleapis.com/css2', 4 * KB, {type: 'Stylesheet'})
    return rec.snapshot()
  }

  it('counts the site\'s own requests and their bytes', () => {
    const s = summarize(requests(), [ORIGIN])
    expect(s.requests).toBe(2)
    expect(s.bytes).toBe(2003 * KB)
  })

  it('sets other hosts aside, and data: URLs aside entirely', () => {
    const s = summarize(requests(), [ORIGIN])
    expect(s.outside.map((r) => r.url)).toEqual(['https://fonts.googleapis.com/css2'])
  })

  it('counts a host it\'s told is the site\'s (where a preview\'s data comes from)', () => {
    expect(summarize(requests(), [ORIGIN, 'https://fonts.googleapis.com']).requests).toBe(3)
  })
})


describe('topRequests and formatTop', () => {
  const rec = new NetworkRecorder()
  load(rec, '1', `${ORIGIN}/small.json`, 2 * KB)
  load(rec, '2', `${ORIGIN}/data/stars.dat`, 2000 * KB)
  load(rec, '3', `${ORIGIN}/chunk.js`, 200 * KB, {type: 'Script'})
  const all = rec.snapshot()

  it('lists the biggest first, at most n', () => {
    expect(topRequests(all, 2).map((r) => r.url)).toEqual([`${ORIGIN}/data/stars.dat`, `${ORIGIN}/chunk.js`])
  })

  it('prints size, status, type and the path', () => {
    const text = formatTop(topRequests(all, 1), `${ORIGIN}/`)
    expect(text).toContain('2,000.0 KB')
    expect(text).toContain('200')
    expect(text).toContain('Fetch')
    expect(text).toContain('/data/stars.dat')
    expect(text).not.toContain('127.0.0.1')
  })

  it('shortens a long URL from the front', () => {
    const long = {url: `${ORIGIN}/${'a/'.repeat(60)}x.json`, type: 'Fetch', status: 200, bytes: 1, failed: false}
    const line = formatTop([long], `${ORIGIN}/`)
    expect(line).toContain('...')
    expect(line).toContain('x.json')
  })
})


describe('foldersByRequests', () => {
  it('names the folders that took the most requests, and their bytes', () => {
    const rec = new NetworkRecorder()
    for (let i = 0; i < 5; i++) {
      load(rec, `p${i}`, `${ORIGIN}/data/places/body${i}.json`, 2 * KB)
    }
    for (let i = 0; i < 3; i++) {
      load(rec, `b${i}`, `${ORIGIN}/data/body${i}.json?v=1`, 1 * KB)
    }
    load(rec, 'one', `${ORIGIN}/index.js`, 1 * KB)
    load(rec, 'two', `${ORIGIN}/other/lone.js`, 1 * KB)
    expect(foldersByRequests(rec.snapshot(), `${ORIGIN}/`)).toEqual([
      {folder: '/data/places/', requests: 5, bytes: 10 * KB},
      {folder: '/data/', requests: 3, bytes: 3 * KB},
    ])
  })
})


describe('budgetProblems', () => {
  const summary = {requests: 95, bytes: 3000 * KB}

  it('passes within both limits, and exactly at them', () => {
    expect(budgetProblems('ready', summary, {requests: 100, kb: 3500})).toEqual([])
    expect(budgetProblems('ready', summary, {requests: 95, kb: 3000})).toEqual([])
  })

  it('fails the request count, by how many', () => {
    const problems = budgetProblems('ready', summary, {requests: 90, kb: 3500})
    expect(problems).toEqual(['homepage ready: 95 requests, over the 90 request budget by 5.'])
  })

  it('fails the bytes, and by how much', () => {
    const problems = budgetProblems('settled', summary, {requests: 100, kb: 2500})
    expect(problems).toEqual(['homepage settled: 3,000.0 KB transferred, over the 2,500 KB budget by 500.0 KB.'])
  })

  it('reports both when both are over', () => {
    expect(budgetProblems('ready', summary, {requests: 1, kb: 1})).toHaveLength(2)
  })
})


describe('small helpers', () => {
  it('kbText formats with one decimal', () => {
    expect(kbText(1536)).toBe('1.5 KB')
  })

  it('originOf is empty for what isn\'t a URL', () => {
    expect(originOf('https://celestiary.org/web/x')).toBe('https://celestiary.org')
    expect(originOf('nonsense')).toBe('')
  })
})
