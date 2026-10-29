/**
 * The credits dialog's facts (ui/CreditsDialog.jsx, credits/catalog.js):
 * what celestiary uses from each source, computed from the scene's live
 * state where it holds it, each provider a pure function of that state so
 * the tests can hand it a synthetic one.  A provider returns a list of
 * `{label, value}`; one that can't measure something says so rather than
 * guessing.  Loaded with the dialog, on its first open: nothing here is in
 * the first load, and nothing here imports from it (a module the first load
 * and this chunk both import splits the first load's chunks: esbuild/
 * budget.js), so the tables it reads come in `refs` (ui/creditsDialog.js
 * CREDITS_DIALOG_DEPS): {bodies: bodies.js CESIUM_BODIES, spectralClasses:
 * stellar.js SPECTRAL_CLASSES, bingShown}.
 */


/**
 * @param {number} x
 * @returns {string} With thousands separators
 */
export function count(x) {
  return Number.isFinite(x) ? Math.round(x).toLocaleString('en-US') : '?'
}


/**
 * @param {number} share 0 to 1
 * @returns {string}
 */
function percent(share) {
  return `${Math.round(100 * share)}%`
}


/**
 * @param {number} bytes
 * @returns {string}
 */
function megabytes(bytes) {
  return `${(bytes / 1e6).toFixed(1)} MB`
}


/**
 * A mix of counts by name, largest first, as "K 41%, G 22%, ...", leaving
 * out what's under half a percent.
 *
 * @param {Array<[string, number]>} pairs
 * @returns {?string} null with nothing counted
 */
export function mix(pairs) {
  const total = pairs.reduce((a, [, n]) => a + n, 0)
  if (!(total > 0)) {
    return null
  }
  return pairs.filter(([, n]) => n / total >= 0.005).sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k} ${percent(n / total)}`).join(', ')
}


/**
 * What ion serves each body (bodies.js CESIUM_BODIES; cesiumBody.js
 * createWidget: World Terrain with a token, Bing from detailFromLevel once
 * requestIon asks; the Moon and Mars are ion 3D tilesets, imagery baked in).
 *
 * @param {string} name
 * @param {object} bodies CESIUM_BODIES
 * @returns {string}
 */
function ionServes(name, bodies) {
  switch (name) {
    case 'earth': return 'Cesium World Terrain (ion asset 1): global heights.  Bing Maps aerial imagery (ion asset ' +
      `2): global, from globe tile level ${bodies.earth.detailFromLevel} (bodies.js detailFromLevel), asked for only ` +
      'once the camera is near the ground (ionImagery.js).  Under them, the bundled Blue Marble (levels 0-3) and ' +
      'NASA GIBS\'s Black Marble night lights (levels 0-8, ~600 m a pixel).'
    case 'moon': return `Cesium Moon Terrain (ion asset ${bodies.moon.ionTileset}): global 3D tiles, terrain with ` +
      'ion\'s copy of the LRO WAC mosaic baked in (bodies.js imageryScale).'
    case 'mars': return `Cesium Mars (ion asset ${bodies.mars.ionTileset}): global 3D tiles, terrain with imagery ` +
      'baked in (the Viking MDIM2.1 colour mosaic: Planet.md, surface texture sources).'
    default: return '?'
  }
}


/**
 * One body's Cesium layer: what ion serves it, and, live, whether Cesium
 * draws the body now and how much of it is loaded.  "How much of the
 * surface": while a layer is active the whole of the body's disc in the
 * frame is Cesium's (CesiumLayers hides celestiary's surface under it), so
 * the measurable share is that, and the tiles behind it; a body drawn on a
 * guest page (`?cesium=iframe`) keeps its tile counts there.
 *
 * @param {string} name earth, moon or mars
 * @param {?object} layers CesiumLayers (ui.layers)
 * @param {object} refs {bodies}
 * @returns {Array<{label: string, value: string}>}
 */
export function cesiumBodyFacts(name, layers, {bodies}) {
  const facts = [{label: 'From ion', value: ionServes(name, bodies)}]
  const body = layers?.bodies?.[name]
  if (!body) {
    facts.push({label: 'Now', value: 'Not loaded: the layer loads when the camera comes near the body'})
    return facts
  }
  const active = Boolean(layers.active?.some((a) => a.name === name))
  const warming = Boolean(layers.warming?.some((a) => a.name === name))
  if (active) {
    const fade = layers.fadeOf?.(name)
    facts.push({
      label: 'Drawn by Cesium now',
      value: `All of the body's disc in view${Number.isFinite(fade) && fade < 1 ? ` (fading in, ${percent(fade)})` : ''}`,
    })
  } else {
    facts.push({label: 'Drawn by Cesium now', value: warming ? 'Not yet: its tiles are loading' : 'No: out of range'})
  }
  if (body.remote) {
    facts.push({label: 'Tiles', value: 'Drawn on a guest page, which keeps its tile counts'})
    return facts
  }
  if (name === 'earth') {
    facts.push({label: 'With a token', value: body.ion ? `yes; Bing ${body.ion.imagery ? 'asked for' : 'not asked for yet'}` :
      'no: the ellipsoid and the bundled Blue Marble'})
  }
  const tileset = body.tileset
  if (tileset?.statistics) {
    // Cesium3DTilesetStatistics, as of its last frame.
    const s = tileset.statistics
    facts.push({label: 'Tiles', value: `${count(s.selected)} drawn, ${count(s.numberOfTilesWithContentReady)} loaded`})
    facts.push({label: 'In memory', value: megabytes((s.geometryByteLength ?? 0) + (s.texturesByteLength ?? 0))})
    return facts
  }
  const tiles = globeTiles(body)
  if (tiles) {
    const levels = tiles.map((t) => t.level)
    const from = bodies[name]?.detailFromLevel
    const detail = Number.isFinite(from) && body.ion?.imagery ? tiles.filter((t) => t.level >= from).length : 0
    facts.push({
      label: 'Globe tiles drawn',
      value: tiles.length === 0 ? 'none this frame' : `${count(tiles.length)}, levels ${Math.min(...levels)}-` +
        `${Math.max(...levels)}${body.ion?.imagery ? `; ${count(detail)} at Bing's levels` : ''}`,
    })
  }
  return facts
}


/**
 * @param {object} body A CesiumLayers body
 * @returns {?Array<{level: number}>} The globe's tiles drawn last frame
 *   (Cesium's QuadtreePrimitive `_tilesToRender`, private: null if absent)
 */
function globeTiles(body) {
  try {
    const tiles = body.widget?.scene?.globe?._surface?._tilesToRender
    return Array.isArray(tiles) ? tiles : null
  } catch {
    return null
  }
}


/** The classes of starTile.js's per-tile counts, by index (TEFF_CLASS_BOUNDS, then M). */
export const TEFF_CLASS_NAMES = Object.freeze(['O', 'B', 'A', 'F', 'G', 'K', 'M'])


// Gaia DR3's dates (Gaia Collaboration, Vallenari et al. 2023, A&A 674, A1:
// the data from 25 July 2014 to 28 May 2017, 34 months; released 13 June
// 2022).
export const GAIA_DR3 = Object.freeze({from: '25 July 2014', to: '28 May 2017', months: 34, released: '13 June 2022'})


/**
 * Gaia's stars: the catalogue celestiary ships (its manifest, public/large/
 * gaia/v1/index.json: count, tiles, build, the cut, the magnitude
 * histogram, what the merge dropped) and, live, what's loaded and drawn,
 * with the loaded stars' spectral mix from their Teff (starTile.js classes).
 *
 * @param {?object} gaia Scene.gaia, a PointPopulation
 * @returns {Array<{label: string, value: string}>}
 */
export function gaiaFacts(gaia) {
  const facts = [
    {label: 'Observed', value: `${GAIA_DR3.from} to ${GAIA_DR3.to} (${GAIA_DR3.months} months)`},
    {label: 'Released', value: `${GAIA_DR3.released}, as Gaia DR3`},
  ]
  const m = gaia?.manifest
  if (!m) {
    facts.push({label: 'Shipped', value: gaia ? 'Its manifest isn\'t in yet' : 'Off (?gaia=0), or no page'})
    return facts
  }
  facts.push({label: 'Shipped', value: `${count(m.count)} stars in ${count(m.tileCount)} tiles (${megabytes(m.bytes)}), ` +
    `${m.title ?? ''}`})
  const bins = Array.isArray(m.histogram) ? m.histogram.filter(([, n]) => n > 0) : []
  if (bins.length > 0) {
    // The histogram's bins are 0.5 mag of V from the Sun, by lower edge.
    facts.push({label: 'Brightness', value: `V ${bins[0][0]} to ${bins.at(-1)[0] + 0.5} from the Sun; ` +
      `G < 10.8 cut, V from G and BP-RP`})
  }
  if (m.report?.dropped?.hip) {
    facts.push({label: 'Left out', value: `${count(m.report.dropped.hip)} already in the bundled catalogue (Hipparcos)`})
  }
  const stats = gaia.stats?.()
  if (stats) {
    facts.push({label: 'Loaded now', value: `${count(stats.loadedPoints)} stars in ${count(stats.loadedTiles)} tiles`})
  }
  facts.push({label: 'Drawn now', value: `${count(gaia.last?.drawn ?? 0)} stars, to magnitude ` +
    `${Number.isFinite(gaia.last?.limit) ? gaia.last.limit.toFixed(1) : '?'}`})
  const classes = new Array(TEFF_CLASS_NAMES.length).fill(0)
  for (const tile of gaia.loaded?.values?.() ?? []) {
    tile.classes?.forEach((n, k) => {
      classes[k] += n
    })
  }
  const types = mix(TEFF_CLASS_NAMES.map((name, k) => [name, classes[k]]))
  if (types) {
    facts.push({label: 'Types loaded (by Teff)', value: types})
  }
  if (m.built) {
    facts.push({label: 'Built', value: `from the ESA Gaia archive, ${m.built.slice(0, 10)}`})
  }
  return facts
}


/**
 * The bundled catalogue (Celestia's Hipparcos-based stars.dat, in brightness
 * tiers: Stars.md): its stars and names loaded now, and their spectral mix.
 *
 * @param {?object} catalog Stars.catalog, a StarsCatalog
 * @param {object} refs {spectralClasses}
 * @returns {Array<{label: string, value: string}>}
 */
export function starsFacts(catalog, {spectralClasses}) {
  // stars.dat holds 106,747 stars (Stars.md, brightness tiers); the
  // Hipparcos catalogue (ESA 1997, The Hipparcos and Tycho Catalogues,
  // ESA SP-1200) is complete to about V 7.3 and reaches about V 12.4.
  const facts = [{label: 'Shipped', value: '106,747 stars (stars.dat), loaded brightest first'},
    {label: 'Brightness', value: 'Hipparcos: complete to about V 7.3, its faintest about V 12.4'}]
  if (!catalog) {
    return facts
  }
  facts.push({label: 'Loaded now', value: `${count(catalog.numStars)} stars`})
  const counts = new Map()
  for (const star of catalog.starByHip?.values?.() ?? []) {
    if (star.hipId === 0) {
      continue
    }
    const name = star.kind === 1 ? 'white dwarfs' : (spectralClasses[star.spectralType] ?? '?')
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  const types = mix([...counts])
  if (types) {
    facts.push({label: 'Types', value: types})
  }
  return facts
}


/**
 * @param {?object} catalog
 * @returns {Array<{label: string, value: string}>}
 */
export function starNamesFacts(catalog) {
  // starnames.dat: 3,369 lines, a star each (Stars.md, names).
  const facts = [{label: 'Shipped', value: '3,369 named stars (starnames.dat): proper names, Bayer and Flamsteed ' +
    'designations, Gliese numbers'}]
  if (catalog?.hipByName?.size > 0) {
    facts.push({label: 'Names known now', value: count(catalog.hipByName.size)})
  }
  return facts
}


/**
 * @param {?object} galaxies Scene.galaxies
 * @returns {Array<{label: string, value: string}>}
 */
export function galaxiesFacts(galaxies) {
  // public/data/sparc/galaxies.json: 175 galaxies (Galaxies.md).
  const loaded = galaxies?.records?.length ?? 0
  return [
    {label: 'Shipped', value: '175 disc galaxies with their rotation curves (SPARC), positions from NED, position ' +
      'angles from SIMBAD, RC3 or PGC 2003, photometry from RC3'},
    {label: 'Loaded now', value: loaded > 0 ? `${count(loaded)} galaxies` : 'Not yet: they load when one is in view or ' +
      'searched for'},
  ]
}


/**
 * Earth's satellites and the networks' constellations: the snapshot's counts
 * and dates (public/data/earth/satellites/index.json, networks/*.json), and
 * what's loaded now.
 *
 * @param {?object} scene
 * @returns {Array<{label: string, value: string}>}
 */
export function satellitesFacts(scene) {
  // index.json: 447 satellites in 8 groups, fetched 2026-10-23T17:20Z;
  // starlink.json 11,116 (epochs from 2026-10-20), iridium.json 80 (from
  // 2026-10-07), the same fetch.
  const facts = [
    {label: 'Shipped', value: '447 satellites in 8 groups, Starlink\'s 11,116 and Iridium NEXT\'s 80'},
    {label: 'Snapshot', value: 'GP elements fetched 23 October 2026; propagated with SGP4 to the date shown'},
  ]
  const rows = scene?.satellites?.records?.length
  const fetched = scene?.satelliteData?.fetched
  const when = fetched ? `, fetched ${fetched.slice(0, 10)}` : ''
  facts.push({label: 'Loaded now', value: rows ? `${count(rows)} satellites${when}` : 'Not yet: they load near Earth'})
  for (const [key, name] of [['S', 'Starlink'], ['I', 'Iridium']]) {
    // Constellation.count; IridiumNetwork's is its sats'.
    const network = scene?.networks?.[key]
    const n = network?.count ?? network?.sats?.count
    if (n) {
      facts.push({label: `${name} loaded`, value: count(n)})
    }
  }
  return facts
}


/**
 * @param {?object} scene
 * @returns {Array<{label: string, value: string}>}
 */
export function dsnFacts(scene) {
  // dsn.js: DSN Now's dsn.xml, polled every 5 s (POLL_MS) while shown;
  // the three complexes, Goldstone, Madrid and Canberra.
  const network = scene?.networks?.D
  return [
    {label: 'What', value: 'The Deep Space Network\'s dishes at Goldstone, Madrid and Canberra, and their live links ' +
      'to spacecraft, from DSN Now, every 5 s while shown'},
    {label: 'Now', value: network ? 'Loaded' : 'Not loaded (the DSN overlay, D)'},
  ]
}


/**
 * @param {?object} cloudMap Earth's clouds' CloudMap
 * @returns {Array<{label: string, value: string}>}
 */
export function gibsFacts(cloudMap) {
  const facts = [
    {label: 'Clouds', value: 'Each date\'s Corrected Reflectance (true colour) mosaic, 15 tiles at 16 km a pixel, ' +
      'VIIRS (NOAA-20, Suomi NPP) from 2015 or MODIS (Aqua, Terra) before (Planet.md, clouds)'},
    {label: 'Night lights', value: 'VIIRS Black Marble (2016), on Earth\'s Cesium layer, levels 0-8, ~600 m a pixel'},
  ]
  const s = cloudMap?.status
  if (s?.kind === 'daily') {
    facts.push({label: 'Clouds now', value: s.ready ?
      `${s.date}, from ${(s.satellites ?? []).join(' and ') || '?'}` :
      `building ${s.building ?? s.wanted} (${s.tilesDone ?? 0} of ${s.tilesTotal ?? '?'} tiles)`})
  } else if (s?.kind === 'bundled') {
    facts.push({label: 'Clouds now', value: 'the bundled clouds: no GIBS mosaic for this date'})
  }
  return facts
}


/**
 * @param {?object} scene
 * @returns {Array<{label: string, value: string}>}
 */
export function placesFacts(scene) {
  // public/data/places-index.json: 8,405 places on 24 bodies (places.md).
  let loaded = 0
  const bodies = []
  for (const [name, obj] of Object.entries(scene?.objects ?? {})) {
    const n = obj?.places?.entries?.length
    if (n > 0) {
      loaded += n
      bodies.push(name)
    }
  }
  return [
    {label: 'Shipped', value: '8,405 named features on 24 bodies (craters, mountains, maria, ...)'},
    {label: 'Loaded now', value: loaded > 0 ? `${count(loaded)} on ${bodies.join(', ')}` : 'None yet: a body\'s load near it'},
  ]
}


/**
 * @param {?object} animation Celestiary.animation
 * @returns {Array<{label: string, value: string}>}
 */
export function vsopFacts(animation) {
  return [
    {label: 'What', value: 'VSOP87C (Bretagnon & Francou 1988): the eight planets\' heliocentric positions, ' +
      'through the vsop87 package'},
    {label: 'Now', value: animation?.vsop ? 'In use' : 'Loading: the planets are on their orbital elements until it\'s in'},
  ]
}


/**
 * @param {?object} newYork CesiumLayers._newYork
 * @returns {Array<{label: string, value: string}>}
 */
export function newYorkFacts(newYork) {
  // slop-newyork's js/nyc-geodata.js (tools/build-geodata.mjs), counted
  // 2026-10-29: 3,246 road polylines and 2,691 blocks from the street
  // centrelines (CSCL), 116 parks (NYC Parks Properties), 5 borough
  // outlines (NYC DCP, with New Jersey's shore); from OSM 69 piers, 36
  // landmark footprints and Central Park's lawns, water, drives and paths.
  return [
    {label: 'NYC Open Data', value: '3,246 road lines and 2,691 blocks (Street Centerline), 116 parks (Parks ' +
      'Properties), the borough boundaries (City Planning)'},
    {label: 'OpenStreetMap', value: '69 piers, 36 landmark footprints, Central Park\'s lawns, water and paths, ' +
      'the New Jersey shore'},
    {label: 'Now', value: newYork?.status === 'ready' ? 'The city is in' : 'Off (the layers control\'s New York switch)'},
  ]
}
