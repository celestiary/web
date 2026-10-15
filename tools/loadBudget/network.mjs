// What a page load fetched, from Chrome DevTools Protocol Network events,
// and the comparison with the runtime budget (esbuild/budget.js); the pure
// part of `yarn load-budget` (loadBudget.mjs), tested in network.test.js.
//
// CDP rather than Playwright's `page.route`: a route turns the HTTP cache
// off for the page, and the load must behave as a visitor's does.

const KB = 1024
const TOP_REQUESTS = 15
// How many folders the request count is broken down by.
const TOP_FOLDERS = 6
// The URL's tail shown in the table.
const URL_WIDTH = 78


/**
 * Collects the requests of a page load from CDP events (`Network.*`): feed it
 * each event with `handle(method, params)`, ask for a `snapshot()` at any
 * time.
 */
export class NetworkRecorder {
  constructor() {
    /** @type {Array<object>} Every request seen, in order */
    this.entries = []
    this._byId = new Map()
  }


  /**
   * @param {string} method e.g. 'Network.loadingFinished'
   * @param {object} params The event's
   */
  handle(method, params) {
    switch (method) {
      case 'Network.requestWillBeSent': this._started(params); break
      case 'Network.requestServedFromCache': this._fromCache(params); break
      case 'Network.responseReceived': this._responded(params); break
      case 'Network.dataReceived': this._data(params); break
      case 'Network.loadingFinished': this._finished(params); break
      case 'Network.loadingFailed': this._failed(params); break
      default: break
    }
  }


  /**
   * @returns {Array<object>} A copy of the requests so far: {url, type,
   *   status, bytes (received so far, headers included), done, fromCache,
   *   failed, error}
   */
  snapshot() {
    return this.entries.map((e) => ({...e}))
  }


  /**
   * @param {object} params requestWillBeSent
   */
  _started({requestId, request, type, redirectResponse}) {
    const previous = this._byId.get(requestId)
    if (previous && redirectResponse) {
      // A redirect continues under the same id: close the hop.
      previous.status = redirectResponse.status
      previous.bytes = redirectResponse.encodedDataLength ?? previous.bytes
      previous.done = true
    }
    const entry = {url: request.url, type: type ?? 'Other', status: 0, bytes: 0, done: false,
      fromCache: false, failed: false, error: ''}
    this.entries.push(entry)
    this._byId.set(requestId, entry)
  }


  /**
   * @param {object} params requestServedFromCache
   */
  _fromCache({requestId}) {
    const entry = this._byId.get(requestId)
    if (entry) {
      entry.fromCache = true
    }
  }


  /**
   * @param {object} params responseReceived
   */
  _responded({requestId, response}) {
    const entry = this._byId.get(requestId)
    if (entry) {
      entry.status = response.status
      entry.bytes = response.encodedDataLength ?? 0
      entry.fromCache ||= Boolean(response.fromDiskCache || response.fromPrefetchCache)
    }
  }


  /**
   * @param {object} params dataReceived
   */
  _data({requestId, encodedDataLength, dataLength}) {
    const entry = this._byId.get(requestId)
    if (entry) {
      entry.bytes += encodedDataLength ?? dataLength ?? 0
    }
  }


  /**
   * @param {object} params loadingFinished
   */
  _finished({requestId, encodedDataLength}) {
    const entry = this._byId.get(requestId)
    if (entry) {
      entry.done = true
      // The total received, headers included; 0 from a cache.
      entry.bytes = entry.fromCache ? 0 : (encodedDataLength ?? entry.bytes)
    }
  }


  /**
   * @param {object} params loadingFailed
   */
  _failed({requestId, errorText, blockedReason}) {
    const entry = this._byId.get(requestId)
    if (entry) {
      entry.done = true
      entry.failed = true
      entry.error = blockedReason ? `blocked: ${blockedReason}` : (errorText ?? 'failed')
    }
  }
}


/**
 * @param {Array<object>} requests From NetworkRecorder.snapshot
 * @param {string[]} origins The origins that are the site's (the page's, and
 *   where its data comes from): the rest is "outside"
 * @returns {{requests: number, bytes: number, counted: Array<object>,
 *   outside: Array<object>}} what the site's own requests came to; data: and
 *   blob: URLs fetch nothing, and a request to another host is not the site's
 *   to budget (a blocked font, analytics)
 */
export function summarize(requests, origins) {
  const counted = []
  const outside = []
  for (const r of requests) {
    if (/^(data|blob|about):/.test(r.url)) {
      continue
    }
    (origins.includes(originOf(r.url)) ? counted : outside).push(r)
  }
  return {
    requests: counted.length,
    bytes: counted.reduce((sum, r) => sum + r.bytes, 0),
    counted,
    outside,
  }
}


/**
 * @param {string} url
 * @returns {string} its origin, or '' if it isn't a URL
 */
export function originOf(url) {
  try {
    return new URL(url).origin
  } catch {
    return ''
  }
}


/**
 * @param {Array<object>} requests
 * @param {number} [n]
 * @returns {Array<object>} the n biggest by bytes
 */
export function topRequests(requests, n = TOP_REQUESTS) {
  return [...requests].sort((a, b) => b.bytes - a.bytes).slice(0, n)
}


/**
 * @param {number} bytes
 * @returns {string} e.g. "1,234.5 KB"
 */
export function kbText(bytes) {
  return `${(bytes / KB).toLocaleString('en-US', {minimumFractionDigits: 1, maximumFractionDigits: 1})} KB`
}


/**
 * @param {Array<object>} requests
 * @param {string} origin Dropped from the start of each URL shown
 * @returns {string} a table, one request a line: size, status, type, URL
 */
export function formatTop(requests, origin = '') {
  return requests.map((r) => {
    const shown = origin && r.url.startsWith(origin) ? r.url.slice(origin.length - 1) : r.url
    const tail = shown.length > URL_WIDTH ? `...${shown.slice(-URL_WIDTH + 3)}` : shown
    const status = r.failed ? 'FAIL' : (r.fromCache ? 'cache' : r.status)
    return `  ${kbText(r.bytes).padStart(11)}  ${String(status).padEnd(5)}  ${r.type.padEnd(10)}  ${tail}`
  }).join('\n')
}


/**
 * @param {Array<object>} requests The site's own (summarize's `counted`)
 * @param {string} origin The site's, with a trailing slash, dropped from paths
 * @param {number} [n]
 * @returns {Array<{folder: string, requests: number, bytes: number}>} the n
 *   folders that took the most requests (two or more), so a count that grew
 *   says where: e.g. /data/places/ with 24
 */
export function foldersByRequests(requests, origin, n = TOP_FOLDERS) {
  const folders = new Map()
  for (const r of requests) {
    const path = r.url.startsWith(origin) ? r.url.slice(origin.length - 1) : r.url
    const folder = path.slice(0, path.lastIndexOf('/') + 1).split('?')[0] || '/'
    const entry = folders.get(folder) ?? {folder, requests: 0, bytes: 0}
    entry.requests++
    entry.bytes += r.bytes
    folders.set(folder, entry)
  }
  return [...folders.values()].filter((f) => f.requests > 1).sort((a, b) => b.requests - a.requests).slice(0, n)
}


/**
 * @param {string} stage Which moment: 'ready' or 'settled'
 * @param {{requests: number, bytes: number}} summary From summarize
 * @param {{requests: number, kb: number}} limit From RUNTIME_BUDGET
 * @returns {string[]} one message per limit exceeded, naming the number, the
 *   limit and the excess; empty if within
 */
export function budgetProblems(stage, summary, limit) {
  const problems = []
  if (summary.requests > limit.requests) {
    problems.push(`homepage ${stage}: ${summary.requests} requests, over the ${limit.requests} request budget ` +
      `by ${summary.requests - limit.requests}.`)
  }
  if (summary.bytes > limit.kb * KB) {
    problems.push(`homepage ${stage}: ${kbText(summary.bytes)} transferred, over the ` +
      `${limit.kb.toLocaleString('en-US')} KB budget by ${kbText(summary.bytes - (limit.kb * KB))}.`)
  }
  return problems
}
