/**
 * One fetch of an image for everything that wants it.
 *
 * Earth's month of Blue Marble is wanted three ways: as a texture (an
 * <img>, Planet.monthlyMap), as pixels for unmixing the clouds (CloudMap),
 * and as a URL for Cesium's base layer (CesiumLayers).  Each used to load
 * it its own way (an image load, a fetch(), Cesium's own XHR), at different
 * times: three requests for the same 845 KB.  The browser's cache answered
 * the later two once the first had finished, but the page still made them,
 * and the ones that overlapped went to the network twice.
 *
 * Now the bytes are fetched once, as a Blob kept for the session, and each
 * consumer takes what it needs from it: an <img> or a `blob:` URL for the
 * first and third, the Blob itself for the second.  A month's entry is
 * about 0.8 MB, at most twelve of them.  Planet.md, "Surface texture
 * sources".
 */


// Entries by URL: {blob: Promise<Blob>, objectUrl: ?string}.
const entries = new Map()


/**
 * @param {string} url Absolute, or relative to the page
 * @returns {Promise<Blob>} The image's bytes; one fetch() however often and
 *   however many times at once it is asked for, and none for a URL already
 *   fetched.  A failed fetch is forgotten, so the next ask tries again.
 */
export function sharedBlob(url) {
  let entry = entries.get(url)
  if (!entry) {
    // fetch() looked up when called, so a test can replace it.
    const blob = fetch(url).then((response) => {
      if (!response.ok) {
        throw new Error(`${url}: HTTP ${response.status}`)
      }
      return response.blob()
    })
    entry = {blob, objectUrl: null}
    entries.set(url, entry)
    blob.catch(() => {
      if (entries.get(url) === entry) {
        entries.delete(url)
      }
    })
  }
  return entry.blob
}


/**
 * @param {string} url As sharedBlob's
 * @returns {Promise<string>} A `blob:` URL for the image, the same one each
 *   time, for what takes a URL and fetches it itself (Cesium).  Kept for the
 *   session, with the Blob.
 */
export async function sharedObjectUrl(url) {
  const blob = await sharedBlob(url)
  const entry = entries.get(url)
  if (!entry) {
    // Forgotten between the two (a failure and a retry): its own URL.
    return URL.createObjectURL(blob)
  }
  entry.objectUrl ??= URL.createObjectURL(blob)
  return entry.objectUrl
}


/**
 * @param {string} url As sharedBlob's
 * @returns {Promise<HTMLImageElement>} A new image of it, loaded.  If the
 *   shared fetch fails, the image loads the URL itself.
 */
export async function sharedImage(url) {
  let src
  try {
    src = await sharedObjectUrl(url)
  } catch {
    src = url
  }
  return new Promise((resolve, reject) => {
    // As three's ImageLoader makes its images (which the tests' document
    // stands in for).
    const image = document.createElementNS('http://www.w3.org/1999/xhtml', 'img')
    image.addEventListener('load', () => resolve(image))
    image.addEventListener('error', () => reject(new Error(`${url}: the image didn't load`)))
    // For a URL on another origin, as ImageLoader sets it.
    image.crossOrigin = 'anonymous'
    image.src = src
  })
}


/** Forget every entry, and free the object URLs (for tests). */
export function clearSharedImages() {
  for (const entry of entries.values()) {
    if (entry.objectUrl) {
      URL.revokeObjectURL(entry.objectUrl)
    }
  }
  entries.clear()
}
