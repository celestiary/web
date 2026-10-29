/**
 * Every credit the app can show (the credits dialog's *All*), and which are
 * in the scene now (its *Active*): one entry per source the docs name
 * (Stars.md, Gaia.md, Galaxies.md, Satellites.md, Networks.md, Planet.md,
 * places.md, Lagrange.md, models.md, CESIUM.md), each with its name, its
 * attribution and licence links, whether it ever shows in the credits
 * footer (`footer`), and its facts (credits/facts.js), live where the scene
 * holds them.  Loaded with the dialog, on its first open.
 *
 * An entry: {id, name, footer, attribution: [{text, href}], licence: {text,
 * href}, note?, active(ctx) → boolean, facts(ctx) → [{label, value}]}, where
 * ctx is {c: the Celestiary, has(id): whether the footer's registry holds a
 * credit (credits.js), refs: the first load's tables and bingShown, passed
 * in (facts.js says why)}.
 */
import {
  cesiumBodyFacts,
  dsnFacts,
  galaxiesFacts,
  gaiaFacts,
  gibsFacts,
  newYorkFacts,
  placesFacts,
  satellitesFacts,
  starNamesFacts,
  starsFacts,
  vsopFacts,
} from './facts.js'


/** GIBS's suggested acknowledgement, word for word (nasa-gibs/gibs-api-docs docs/index.md). */
export const GIBS_ACKNOWLEDGEMENT = 'We acknowledge the use of imagery provided by services from NASA\'s Global ' +
  'Imagery Browse Services (GIBS), part of NASA\'s Earth Science Data and Information System (ESDIS).'


const layers = (ctx) => ctx.c?.ui?.layers ?? null
const scene = (ctx) => ctx.c?.scene ?? null
const object = (ctx, name) => scene(ctx)?.objects?.[name] ?? null
const cesiumActive = (ctx, name) => Boolean(layers(ctx)?.active?.some((a) => a.name === name))
const cloudMap = (ctx) => object(ctx, 'earth')?.clouds?.userData?.map ?? null


/** @type {Array<object>} */
export const CREDITS_CATALOG = [
  {
    id: 'cesium',
    name: 'Cesium ion and CesiumJS',
    footer: true,
    attribution: [{text: 'Cesium ion', href: 'https://cesium.com/platform/cesium-ion/'},
      {text: 'CesiumJS', href: 'https://cesium.com/platform/cesiumjs/'}],
    licence: {text: 'Cesium ion Terms of Service', href: 'https://cesium.com/legal/terms-of-service/'},
    note: 'In the footer, Cesium\'s own credits: in full for 8 s as a body\'s ground comes into view, then the ion ' +
      'logo alone, which ion\'s terms want on screen while its data is; in full the whole time Bing\'s imagery is drawn.',
    active: (ctx) => ctx.has('cesium'),
    facts: (ctx) => {
      const L = layers(ctx)
      const names = ['earth', 'moon', 'mars']
      const on = names.filter((n) => L?.bodies?.[n])
      return [
        {label: 'Bodies', value: 'Earth, the Moon and Mars, each in place of celestiary\'s own surface up close'},
        {label: 'Loaded now', value: on.length > 0 ? on.join(', ') : 'none: Cesium loads when a body comes near'},
        {label: 'CesiumJS', value: 'Apache 2.0, patched for celestiary (celestiary/cesium; CESIUM.md)'},
      ]
    },
  },
  {
    id: 'ion-earth',
    name: 'Earth from Cesium ion: World Terrain and Bing Maps',
    footer: true,
    attribution: [{text: 'Cesium World Terrain', href: 'https://cesium.com/platform/cesium-ion/content/cesium-world-terrain/'},
      {text: 'Bing Maps imagery © Microsoft', href: 'https://www.microsoft.com/en-us/maps/bing-maps/product'}],
    licence: {text: 'ion\'s terms for Bing Maps content', href: 'https://cesium.com/legal/terms-for-bing/'},
    note: 'Bing\'s logo and text stay in the footer the whole time its imagery is drawn: its terms forbid removing, ' +
      'obscuring or minimising them.',
    active: (ctx) => cesiumActive(ctx, 'earth'),
    facts: (ctx) => [...cesiumBodyFacts('earth', layers(ctx), ctx.refs),
      ...(ctx.refs.bingShown?.(layers(ctx)?.credits) ? [{label: 'Bing\'s credit', value: 'In the footer now'}] : [])],
  },
  {
    id: 'ion-moon',
    name: 'Cesium Moon Terrain',
    footer: true,
    attribution: [{text: 'Cesium Moon Terrain', href: 'https://cesium.com/platform/cesium-ion/content/'}],
    licence: {text: 'Cesium ion Terms of Service', href: 'https://cesium.com/legal/terms-of-service/'},
    active: (ctx) => cesiumActive(ctx, 'moon'),
    facts: (ctx) => cesiumBodyFacts('moon', layers(ctx), ctx.refs),
  },
  {
    id: 'ion-mars',
    name: 'Cesium Mars',
    footer: true,
    attribution: [{text: 'Cesium Mars', href: 'https://cesium.com/platform/cesium-ion/content/'}],
    licence: {text: 'Cesium ion Terms of Service', href: 'https://cesium.com/legal/terms-of-service/'},
    active: (ctx) => cesiumActive(ctx, 'mars'),
    facts: (ctx) => cesiumBodyFacts('mars', layers(ctx), ctx.refs),
  },
  {
    id: 'gaia',
    name: 'ESA Gaia DR3',
    footer: true,
    attribution: [{text: 'ESA/Gaia/DPAC', href: 'https://www.cosmos.esa.int/gaia'}],
    licence: {text: 'CC BY-SA 3.0 IGO', href: 'https://creativecommons.org/licenses/by-sa/3.0/igo/'},
    note: 'This work has made use of data from the European Space Agency (ESA) mission Gaia, processed by the Gaia ' +
      'Data Processing and Analysis Consortium (DPAC).  Funding for the DPAC has been provided by national ' +
      'institutions, in particular the institutions participating in the Gaia Multilateral Agreement.',
    active: (ctx) => ctx.has('gaia'),
    facts: (ctx) => gaiaFacts(scene(ctx)?.gaia ?? null),
  },
  {
    id: 'nasa-gibs',
    name: 'NASA GIBS',
    footer: true,
    attribution: [{text: 'NASA Global Imagery Browse Services (GIBS), ESDIS', href: 'https://earthdata.nasa.gov/gibs'}],
    licence: {text: 'NASA\'s open data policy',
      href: 'https://www.earthdata.nasa.gov/engage/open-data-services-software-policies'},
    note: GIBS_ACKNOWLEDGEMENT,
    active: (ctx) => ctx.has('nasa-gibs'),
    facts: (ctx) => gibsFacts(cloudMap(ctx)),
  },
  {
    id: 'osm',
    name: 'OpenStreetMap',
    footer: true,
    attribution: [{text: '© OpenStreetMap contributors', href: 'https://www.openstreetmap.org/copyright'}],
    licence: {text: 'ODbL 1.0', href: 'https://opendatacommons.org/licenses/odbl/'},
    active: (ctx) => ctx.has('new-york'),
    facts: (ctx) => newYorkFacts(layers(ctx)?._newYork).filter((f) => f.label !== 'NYC Open Data'),
  },
  {
    id: 'nyc-open-data',
    name: 'NYC Open Data',
    footer: true,
    attribution: [{text: 'NYC Open Data', href: 'https://opendata.cityofnewyork.us/'}],
    licence: {text: 'NYC.gov terms of use', href: 'https://www.nyc.gov/home/terms-of-use.page'},
    active: (ctx) => ctx.has('new-york'),
    facts: (ctx) => newYorkFacts(layers(ctx)?._newYork).filter((f) => f.label !== 'OpenStreetMap'),
  },
  {
    id: 'stars',
    name: 'The bright stars: Hipparcos, through Celestia\'s stars.dat',
    footer: false,
    attribution: [{text: 'ESA Hipparcos', href: 'https://www.cosmos.esa.int/web/hipparcos'},
      {text: 'Celestia', href: 'https://celestiaproject.space/'}],
    licence: null,
    note: 'stars.dat\'s licence isn\'t recorded in celestiary\'s docs.',
    active: (ctx) => Boolean(scene(ctx)?.stars),
    facts: (ctx) => starsFacts(scene(ctx)?.stars?.catalog ?? null, ctx.refs),
  },
  {
    id: 'star-names',
    name: 'Star names: Celestia\'s starnames.dat',
    footer: false,
    attribution: [{text: 'Celestia', href: 'https://celestiaproject.space/'}],
    licence: null,
    active: (ctx) => Boolean(scene(ctx)?.stars?.catalog?.hipByName?.size),
    facts: (ctx) => starNamesFacts(scene(ctx)?.stars?.catalog ?? null),
  },
  {
    id: 'sparc',
    name: 'SPARC galaxies',
    footer: false,
    attribution: [{text: 'Lelli, McGaugh & Schombert 2016, AJ 152, 157', href: 'https://astroweb.case.edu/SPARC/'},
      {text: 'NED', href: 'https://ned.ipac.caltech.edu/'}, {text: 'SIMBAD, VizieR (CDS)', href: 'https://cds.unistra.fr/'}],
    licence: {text: 'Cite the SPARC paper; VizieR J/AJ/152/157', href: 'https://doi.org/10.26093/cds/vizier.51520157'},
    note: 'This research has made use of the NASA/IPAC Extragalactic Database, and of the SIMBAD database and the ' +
      'VizieR catalogue access tool, CDS, Strasbourg.',
    active: (ctx) => (scene(ctx)?.galaxies?.records?.length ?? 0) > 0,
    facts: (ctx) => galaxiesFacts(scene(ctx)?.galaxies ?? null),
  },
  {
    id: 'celestrak',
    name: 'Satellites, Starlink and Iridium: CelesTrak',
    footer: false,
    attribution: [{text: 'CelesTrak', href: 'https://celestrak.org/'},
      {text: 'US Space Force catalogue (space-track.org)', href: 'https://www.space-track.org/'}],
    licence: {text: 'CelesTrak\'s usage policy', href: 'https://celestrak.org/usage-policy.php'},
    active: (ctx) => Boolean(scene(ctx)?.satellites || scene(ctx)?.networks?.S || scene(ctx)?.networks?.I),
    facts: (ctx) => satellitesFacts(scene(ctx)),
  },
  {
    id: 'dsn-now',
    name: 'NASA DSN Now',
    footer: false,
    attribution: [{text: 'NASA/JPL DSN Now', href: 'https://eyes.nasa.gov/dsn/dsn.html'}],
    licence: {text: 'NASA media usage', href: 'https://www.nasa.gov/nasa-brand-center/images-and-media/'},
    active: (ctx) => Boolean(scene(ctx)?.networks?.D),
    facts: (ctx) => dsnFacts(scene(ctx)),
  },
  {
    id: 'jpl-periodic-orbits',
    name: 'JPL three-body periodic orbits',
    footer: false,
    attribution: [{text: 'NASA/JPL Three-Body Periodic Orbits', href: 'https://ssd.jpl.nasa.gov/tools/periodic_orbits.html'}],
    licence: null,
    // public/data/periodicOrbits.json: 7 systems, retrieved 2026-10-23
    // (Lagrange.md, three-body orbits).
    active: () => false,
    facts: () => [{label: 'Shipped', value: 'Halo, Lyapunov, DRO and NRHO families for 7 systems (Earth-Moon, ' +
      'Sun-Earth, Sun-Mars, Mars-Phobos, Jupiter-Europa, Saturn-Enceladus, Saturn-Titan), retrieved 23 October 2026'}],
  },
  {
    id: 'vsop87',
    name: 'VSOP87',
    footer: false,
    attribution: [{text: 'Bretagnon & Francou 1988, A&A 202, 309', href: 'https://ui.adsabs.harvard.edu/abs/1988A%26A...202..309B'}],
    licence: null,
    active: (ctx) => Boolean(ctx.c?.animation?.vsop),
    facts: (ctx) => vsopFacts(ctx.c?.animation ?? null),
  },
  {
    id: 'jpl-horizons',
    name: 'JPL Horizons',
    footer: false,
    attribution: [{text: 'NASA/JPL Horizons', href: 'https://ssd.jpl.nasa.gov/horizons/'}],
    licence: null,
    active: (ctx) => Boolean(object(ctx, 'webb')),
    facts: () => [{label: 'What', value: 'The James Webb Space Telescope\'s trajectory, a table interpolated in the ' +
      'app (models.md, positions); the reference vectors the ephemerides are tested against'}],
  },
  {
    id: 'iau-rotation',
    name: 'IAU rotation models (WGCCRE 2015)',
    footer: false,
    attribution: [{text: 'Archinal et al. 2018, Celest. Mech. Dyn. Astr. 130:22', href: 'https://doi.org/10.1007/s10569-017-9805-5'},
      {text: 'NAIF pck00011.tpc', href: 'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/'}],
    licence: null,
    active: (ctx) => Boolean(scene(ctx)),
    // js/scene/iauRotation.json: 27 bodies, from pck00011.tpc (2022-12-27).
    facts: () => [{label: 'What', value: 'The poles and prime meridians of 27 bodies, so each turns as the IAU ' +
      'defines it'}],
  },
  {
    id: 'iau-gazetteer',
    name: 'IAU Gazetteer of Planetary Nomenclature',
    footer: false,
    attribution: [{text: 'USGS Astrogeology and the IAU WGPSN', href: 'https://planetarynames.wr.usgs.gov/'}],
    licence: {text: 'Public domain (USGS)', href: 'https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits'},
    active: (ctx) => Object.values(scene(ctx)?.objects ?? {}).some((o) => o?.places?.entries?.length > 0),
    facts: (ctx) => placesFacts(scene(ctx)),
  },
  {
    id: 'blue-marble',
    name: 'Blue Marble Next Generation',
    footer: false,
    attribution: [{text: 'NASA Earth Observatory', href: 'https://earthobservatory.nasa.gov/features/BlueMarble'}],
    licence: {text: 'Public domain (NASA)', href: 'https://earthobservatory.nasa.gov/image-use-policy'},
    active: (ctx) => Boolean(object(ctx, 'earth')),
    // Planet.md, surface texture sources: the 2004 monthly mosaics,
    // 4096×2048, and Cesium's base layers cut from them (levels 0-3).
    facts: () => [{label: 'What', value: 'Earth\'s cloud-free surface, a mosaic for each month of 2004 (June from May ' +
      'and July), at 4096×2048; the base of Earth\'s Cesium layer too'}],
  },
  {
    id: 'black-marble',
    name: 'Black Marble (VIIRS night lights)',
    footer: false,
    attribution: [{text: 'NASA Earth Observatory, Suomi NPP VIIRS', href: 'https://earthobservatory.nasa.gov/features/NightLights'}],
    licence: {text: 'Public domain (NASA)', href: 'https://earthobservatory.nasa.gov/image-use-policy'},
    active: (ctx) => Boolean(object(ctx, 'earth')),
    facts: () => [{label: 'What', value: 'Earth\'s city lights, the 2016 composite, at 3600×1800; GIBS serves the ' +
      'same product to the Cesium layer (Planet.md)'}],
  },
  {
    id: 'planetary-mosaics',
    name: 'The Moon\'s and Mars\'s mosaics',
    footer: false,
    attribution: [{text: 'LRO WAC (NASA/GSFC/ASU)', href: 'https://trek.nasa.gov/moon/'},
      {text: 'Viking MDIM2.1 (NASA/USGS)', href: 'https://trek.nasa.gov/mars/'}],
    licence: {text: 'Public domain (NASA, USGS)', href: 'https://www.nasa.gov/nasa-brand-center/images-and-media/'},
    active: (ctx) => Boolean(object(ctx, 'moon') || object(ctx, 'mars')),
    facts: () => [{label: 'What', value: 'The global mosaics of the Moon (LRO WAC) and Mars (Viking MDIM2.1 colour), ' +
      '4096×2048 each, from NASA Trek; the same imagery as their Cesium layers'}],
  },
  {
    id: 'noaa-swpc',
    name: 'NOAA SWPC solar cycle',
    footer: false,
    attribution: [{text: 'NOAA Space Weather Prediction Center', href: 'https://www.swpc.noaa.gov/'}],
    licence: {text: 'US Government work (17 U.S.C. 105)', href: 'https://www.swpc.noaa.gov/'},
    active: (ctx) => Boolean(object(ctx, 'sun')),
    // js/scene/sun/sunspots.json: SWPC's monthly and smoothed sunspot
    // numbers and its forecast, fetched 2026-10-10 (Sun.md).
    facts: () => [{label: 'What', value: 'The monthly sunspot number and SWPC\'s forecast, which set the Sun\'s ' +
      'activity by date: its spots, flares and corona'}],
  },
  {
    id: 'rubin-model',
    name: 'The Rubin Observatory\'s telescope model',
    footer: false,
    attribution: [{text: 'Credit Rubin Observatory/NSF/AURA', href: 'https://noirlab.edu/public/products/models3d/model3d004/'}],
    licence: {text: 'NOIRLab\'s usage terms', href: 'https://noirlab.edu/public/copyright/'},
    note: 'The credit is mandatory and visible: the Rubin app\'s panel carries it.',
    active: (ctx) => Boolean(scene(ctx)?.rubin),
    facts: () => [{label: 'What', value: 'The Simonyi Survey Telescope on its pier, model3d004, 567 KB as glTF'}],
  },
  {
    id: 'webb-model',
    name: 'The James Webb Space Telescope\'s model',
    footer: false,
    attribution: [{text: 'NASA 3D Resources, NASA Goddard', href: 'https://science.nasa.gov/3d-resources/james-webb-space-telescope-a/'}],
    licence: {text: 'NASA media usage', href: 'https://www.nasa.gov/nasa-brand-center/images-and-media/'},
    active: (ctx) => Boolean(object(ctx, 'webb')),
    facts: () => [{label: 'What', value: 'JWST, deployed, 2.38 MB as glTF, at its Horizons positions'}],
  },
]


/**
 * @param {?object} c The Celestiary
 * @param {function(string): boolean} has credits.js hasCredit
 * @param {object} refs {bodies, spectralClasses, bingShown}
 * @returns {object} The catalogue's ctx
 */
export function creditsContext(c, has, refs) {
  return {c, has, refs}
}


/**
 * @param {Array<object>} catalog
 * @param {object} ctx
 * @returns {Array<object>} The entries whose data is in the scene now
 */
export function activeCredits(catalog, ctx) {
  return catalog.filter((entry) => {
    try {
      return Boolean(entry.active(ctx))
    } catch {
      return false
    }
  })
}


/**
 * @param {object} entry
 * @param {object} ctx
 * @returns {Array<{label: string, value: string}>} Its facts, or none if
 *   they fail (a state the provider didn't foresee)
 */
export function factsOf(entry, ctx) {
  try {
    return entry.facts(ctx) ?? []
  } catch (err) {
    console.warn(`[credits] ${entry.id}'s facts failed`, err)
    return []
  }
}
