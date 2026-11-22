import {dataUrl, isAbsoluteUrl} from '../../dataUrl.js'
import {monthWeight, monthlyPath, overAlphas, stepMonthShares} from '../monthly.js'
import {sharedObjectUrl} from '../sharedImage.js'


/**
 * Earth's globe through the year (CESIUM.md, "Data"; Planet.md, "The months
 * blended by day"): the Blue Marble of the two months a date falls between,
 * blended by the day as celestiary's own Earth blends them, and, once ion's
 * detail is asked for (requestIon), its detail over each month's colour
 * (detailImagery.js).
 *
 * Each month shown is an entry of layers: its map (the 4096 px picture, one
 * image over the globe), its tiles (from globe level `fromLevel`) and its
 * detail.  The months' maps and tiles are drawn bottom up in the entries'
 * order, then their details in the same order, then the night lights; each
 * layer's alpha makes the stack the mix of the months by their shares
 * (overAlphas), and the details the mix of the months' details by the same
 * shares, over the bases by the detail's strength.  A month's share grows
 * from 0 once its map is in (stepMonthShares), and an entry goes once its
 * share is 0 and the blend has left it.
 */


/**
 * Seconds the detail takes to come in once ion's first answer is in, so its
 * arrival isn't a pop.  Across levels it needs no fade: the detail is an
 * octave a level from the Blue Marble's (detailTransfer.js).
 */
export const DETAIL_FADE_S = 1.5

/**
 * A month's map is ready once loaded and the globe's tiles are in, or this
 * long after the map is in, where the tiles never settle (low over the
 * ground, the camera moving).
 */
export const TILES_WAIT_MS = 3000


/**
 * @param {string} url Absolute, or relative to the page's base
 * @returns {string} Absolute
 */
export function absoluteUrl(url) {
  return isAbsoluteUrl(url) ? url : new URL('.', document.baseURI).href + url
}


/**
 * The Blue Marble of a month as one image: the map celestiary's own Earth is
 * textured with, laid over the whole globe, at every level.  It is all the
 * globe has until its tiles reach `fromLevel` (monthlyTileLayer), and the
 * tiles' own levels 0-2 are no better (4096 px across is level 2 of 512 px
 * tiles): so it is one request, where the tiles took ten (levels 0 and 1),
 * popping in as they came.  Async: the layer is ready once the image has
 * loaded.  Celestiary's own Earth and its clouds have fetched the image
 * already (or are fetching it), so Cesium is given a `blob:` URL of the
 * same bytes (sharedImage.js) and makes no request; if that fetch failed, it
 * is given the image's URL to try itself.
 *
 * @param {object} Cesium
 * @param {object} imagery A body's monthlyImagery config (bodies.js)
 * @param {number} month 1-12
 * @returns {object} Cesium.ImageryLayer
 */
export function monthlyBaseLayer(Cesium, imagery, month) {
  const url = dataUrl(monthlyPath(imagery.singleUrl, month))
  const provider = sharedObjectUrl(url)
      .catch(() => absoluteUrl(url))
      .then((src) => Cesium.SingleTileImageryProvider.fromUrl(src, {credit: imagery.credit}))
  return Cesium.ImageryLayer.fromProviderAsync(provider)
}


/**
 * The Blue Marble of a month as tiles, over its map (monthlyBaseLayer):
 * shown from globe level `fromLevel`, and asking for nothing above it.
 * `minimumLevel` as well as `minimumTerrainLevel`: a globe tile at level 3
 * would pick the imagery level by its texel size, and might pick 2.
 *
 * @param {object} Cesium
 * @param {object} imagery A body's monthlyImagery config (bodies.js)
 * @param {number} month 1-12
 * @returns {object} Cesium.ImageryLayer
 */
export function monthlyTileLayer(Cesium, imagery, month) {
  const {url, tileSize, maximumLevel, fromLevel, credit} = imagery
  return new Cesium.ImageryLayer(new Cesium.UrlTemplateImageryProvider({
    // Cesium wants an absolute URL: the data base URL if the build has one
    // (DESIGN.md, data policy), else the page's base (celestiary may be
    // served under a path).  Not new URL(url, base), which escapes the
    // {z}/{x}/{y} placeholders.
    url: absoluteUrl(dataUrl(monthlyPath(url, month))),
    tilingScheme: new Cesium.GeographicTilingScheme(),
    tileWidth: tileSize,
    tileHeight: tileSize,
    minimumLevel: fromLevel,
    maximumLevel,
    credit,
  }), {minimumTerrainLevel: fromLevel})
}


/**
 * A month's Blue Marble tile at the pyramid's finest level, decoded off the
 * main thread (createImageBitmap), for the detail's colour.  The URL is the
 * tile layer's, so the browser's cache has it when the globe has drawn it.
 *
 * @param {object} imagery A body's monthlyImagery config
 * @param {number} month
 * @returns {function(number, number): Promise<ImageBitmap>}
 */
function baseTileFetcher(imagery, month) {
  const pattern = absoluteUrl(dataUrl(monthlyPath(imagery.url, month)))
  return async (x, y) => {
    const url = pattern.replace('{z}', String(imagery.maximumLevel)).replace('{x}', String(x)).replace('{y}', String(y))
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`${url}: HTTP ${response.status}`)
    }
    return createImageBitmap(await response.blob())
  }
}


/**
 * The globe's first month, made with the widget: its map is the widget's
 * base layer, and its tiles go in over it.
 *
 * @param {object} Cesium
 * @param {object} widget
 * @param {object} baseLayer The widget's, monthlyBaseLayer's
 * @param {object} imagery A body's monthlyImagery config
 * @param {number} month
 * @returns {object} The body's `season`
 */
export function createSeason(Cesium, widget, baseLayer, imagery, month) {
  const tiles = monthlyTileLayer(Cesium, imagery, month)
  widget.imageryLayers.add(tiles)
  return {
    // Shown at once: there is nothing under it.
    entries: [{month, base: baseLayer, tiles, detail: null, ready: true, shown: 1, at: 0}],
    // ion's provider, once asked for (addDetail), and the detail's strength.
    ion: null,
    detail: 0,
    detailDropped: false,
    last: null,
  }
}


/**
 * Keep the globe's months on the blend: add the months it wants, step their
 * shares, set the layers' alphas, and drop the months it has left.
 *
 * @param {object} body A body with `season` (createSeason)
 * @param {object} config Its CESIUM_BODIES entry
 * @param {{a: number, b: number, w: number}} blend monthly.js monthBlendOfJulianDay's
 * @param {number} [now] ms
 */
export function updateSeason(body, config, blend, now = performance.now()) {
  const {widget, season} = body
  const layers = widget.imageryLayers
  const dt = season.last === null ? 0 : (now - season.last) / 1000
  season.last = now
  for (const month of new Set([blend.a, blend.b])) {
    if (monthWeight(blend, month) > 0 && !season.entries.some((e) => e.month === month)) {
      addMonth(body, config, month)
    }
  }
  for (const e of season.entries) {
    if (!e.ready && e.base.ready !== false) {
      e.at ||= now
      e.ready = widget.scene.globe.tilesLoaded || now - e.at > TILES_WAIT_MS
    }
  }
  const shares = stepMonthShares(season.entries, blend, dt)
  if (shares.some((s) => s > 0)) {
    overAlphas(shares).forEach((alpha, i) => {
      season.entries[i].base.alpha = alpha
      season.entries[i].tiles.alpha = alpha
    })
    if (season.ion && season.entries.some((e) => e.detail?.ready)) {
      season.detail = Math.min(1, season.detail + (dt / DETAIL_FADE_S))
    }
    const d = season.detail
    overAlphas([1 - d, ...shares.map((s) => s * d)]).slice(1).forEach((alpha, i) => {
      if (season.entries[i].detail) {
        season.entries[i].detail.alpha = alpha
      }
    })
  }
  // The months the blend has left, faded out.
  for (const e of [...season.entries]) {
    if (e.shown === 0 && monthWeight(blend, e.month) === 0 && season.entries.length > 1) {
      for (const layer of [e.base, e.tiles, e.detail]) {
        if (layer) {
          layers.remove(layer, true)
        }
      }
      season.entries.splice(season.entries.indexOf(e), 1)
    }
  }
}


/**
 * A month's layers, over the others': its map and tiles over theirs, its
 * detail over theirs, all at alpha 0 until its share grows.
 *
 * @param {object} body
 * @param {object} config
 * @param {number} month
 */
function addMonth(body, config, month) {
  const {Cesium, widget, season} = body
  const layers = widget.imageryLayers
  const n = season.entries.length
  const base = monthlyBaseLayer(Cesium, config.monthlyImagery, month)
  const tiles = monthlyTileLayer(Cesium, config.monthlyImagery, month)
  base.alpha = 0
  tiles.alpha = 0
  layers.add(base, 2 * n)
  layers.add(tiles, (2 * n) + 1)
  const entry = {month, base, tiles, detail: null, ready: false, shown: 0, at: 0}
  season.entries.push(entry)
  if (season.ion) {
    entry.detail = detailLayer(body, config, month)
    entry.detail.alpha = 0
    layers.add(entry.detail, (2 * season.entries.length) + n)
  }
}


/**
 * Ask ion for its world imagery (Bing, asset 2), and put a detail layer over
 * each month's.  Calling this opens an ion imagery session (billed), so the
 * caller does it once, and only when the base's texels would show
 * (ionImagery.js).  If ion can't give it (no network, a token scoped to
 * other assets, a 401 or 403 from the token or the account's quota) the
 * detail layers go and the Blue Marble stays, with one line in the console
 * and no error thrown.
 *
 * @param {object} body
 * @param {object} config
 * @param {function(object): string} ionFailure What to say of an error (its HTTP status)
 */
export function addDetail(body, config, ionFailure) {
  const {Cesium, widget, season} = body
  season.ion = Cesium.createWorldImageryAsync()
  season.ion.then((inner) => {
    // Tile errors from Bing's side: no retries, and imagery that is refused
    // is dropped, rather than failing tile by tile.
    inner.errorEvent.addEventListener((err) => {
      err.retry = false
      const failure = ionFailure(err)
      if (failure === 'HTTP 401' || failure === 'HTTP 403') {
        dropDetail(body, failure)
      }
    })
  }, (err) => dropDetail(body, ionFailure(err)))
  const layers = widget.imageryLayers
  const n = season.entries.length
  season.entries.forEach((e, i) => {
    e.detail = detailLayer(body, config, e.month)
    e.detail.alpha = 0
    layers.add(e.detail, (2 * n) + i)
  })
}


/**
 * @param {object} body
 * @param {object} config
 * @param {number} month
 * @returns {object} Cesium.ImageryLayer: ion's detail over the month's colour
 */
function detailLayer(body, config, month) {
  const {Cesium, season} = body
  const imagery = config.monthlyImagery
  const raw = typeof location === 'object' && new URLSearchParams(location.search).get('detail') === 'raw'
  // The detail's code is a chunk of its own, wanted only once ion is asked.
  const code = import('./detailImagery.js')
  const provider = Promise.all([season.ion, code]).then(([inner, {detailProvider}]) => detailProvider(Cesium, inner, {
    month,
    fetchBaseTile: baseTileFetcher(imagery, month),
    grid: {tilesX: 2 * (2 ** imagery.maximumLevel), tilesY: 2 ** imagery.maximumLevel, tileSize: imagery.tileSize},
    raw,
  }))
  const layer = Cesium.ImageryLayer.fromProviderAsync(provider, {minimumTerrainLevel: config.detailFromLevel})
  // The endpoint's failure is said once, by addDetail; here quietly (Cesium
  // logs a layer's error when nothing listens, and ion's echo the token).
  layer.errorEvent.addEventListener(() => undefined)
  return layer
}


/**
 * Drop the detail, keeping the Blue Marble.  Said once, by HTTP status
 * only: ion's error bodies echo the access token.
 *
 * @param {object} body
 * @param {string} why
 */
function dropDetail(body, why) {
  const {widget, season} = body
  if (season.detailDropped) {
    return
  }
  season.detailDropped = true
  console.warn(`[cesium layer] ion imagery unavailable (${why}); using the base imagery`)
  season.ion = null
  for (const e of season.entries) {
    if (e.detail && !widget.isDestroyed()) {
      widget.imageryLayers.remove(e.detail)
    }
    e.detail = null
  }
}
