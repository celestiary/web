import {clearSharedImages, sharedBlob, sharedImage, sharedObjectUrl} from './sharedImage.js'


const URL_A = 'textures/earth/blue-marble/2004-10.jpg'
const URL_B = 'textures/earth/blue-marble/2004-11.jpg'

let realFetch
let realDocument
let fetched

/**
 * @param {function(string): (Response|Promise<Response>)} serve
 */
function stubFetch(serve = (url) => new Response(`bytes of ${url}`)) {
  fetched = []
  globalThis.fetch = (url) => {
    fetched.push(url)
    return Promise.resolve(serve(url))
  }
}


beforeEach(() => {
  realFetch = globalThis.fetch
  realDocument = globalThis.document
  clearSharedImages()
  stubFetch()
})


afterEach(() => {
  globalThis.fetch = realFetch
  globalThis.document = realDocument
  clearSharedImages()
})


describe('sharedBlob', () => {
  it('fetches a URL once, however many ask at once', async () => {
    const [a, b, c] = await Promise.all([sharedBlob(URL_A), sharedBlob(URL_A), sharedBlob(URL_A)])
    expect(fetched).toEqual([URL_A])
    expect(a).toBe(b)
    expect(b).toBe(c)
    expect(await a.text()).toBe(`bytes of ${URL_A}`)
  })

  it('fetches a URL once, however late the next ask is', async () => {
    await sharedBlob(URL_A)
    await sharedBlob(URL_A)
    expect(fetched).toEqual([URL_A])
  })

  it('fetches each URL on its own', async () => {
    await Promise.all([sharedBlob(URL_A), sharedBlob(URL_B)])
    expect(fetched.toSorted()).toEqual([URL_A, URL_B])
  })

  it('forgets a failure, so the next ask tries again', async () => {
    stubFetch(() => new Response('nope', {status: 503}))
    await expect(sharedBlob(URL_A)).rejects.toThrow('HTTP 503')
    stubFetch()
    expect(await (await sharedBlob(URL_A)).text()).toBe(`bytes of ${URL_A}`)
    expect(fetched).toEqual([URL_A])
  })
})


describe('sharedObjectUrl', () => {
  it('is one blob: URL of the one fetch', async () => {
    const [a, b] = await Promise.all([sharedObjectUrl(URL_A), sharedObjectUrl(URL_A)])
    expect(a.startsWith('blob:')).toBe(true)
    expect(b).toBe(a)
    expect(await sharedObjectUrl(URL_A)).toBe(a)
    expect(fetched).toEqual([URL_A])
  })
})


describe('sharedImage', () => {
  /** A document whose images load whatever they're given, or fail. */
  function stubDocument(fails = false) {
    const made = []
    globalThis.document = {
      createElementNS: () => {
        const listeners = {}
        const image = {
          addEventListener: (type, fn) => {
            listeners[type] = fn
          },
          get src() {
            return this._src
          },
          set src(value) {
            this._src = value
            queueMicrotask(() => listeners[fails ? 'error' : 'load']())
          },
        }
        made.push(image)
        return image
      },
    }
    return made
  }

  it('loads from the shared fetch, a new image each time', async () => {
    const made = stubDocument()
    const a = await sharedImage(URL_A)
    const b = await sharedImage(URL_A)
    expect(a).not.toBe(b)
    expect(made.length).toBe(2)
    expect(a.src.startsWith('blob:')).toBe(true)
    expect(a.crossOrigin).toBe('anonymous')
    expect(b.src).toBe(a.src)
    expect(fetched).toEqual([URL_A])
  })

  it('shares the fetch with the other ways of asking for it', async () => {
    stubDocument()
    const [blob, url, image] = await Promise.all([sharedBlob(URL_A), sharedObjectUrl(URL_A), sharedImage(URL_A)])
    expect(blob.size).toBeGreaterThan(0)
    expect(image.src).toBe(url)
    expect(fetched).toEqual([URL_A])
  })

  it('loads the URL itself if the shared fetch fails', async () => {
    stubFetch(() => new Response('nope', {status: 404}))
    stubDocument()
    const image = await sharedImage(URL_A)
    expect(image.src).toBe(URL_A)
  })

  it('rejects if the image doesn\'t load', async () => {
    stubDocument(true)
    await expect(sharedImage(URL_A)).rejects.toThrow('didn\'t load')
  })
})
