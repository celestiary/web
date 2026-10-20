import {dataUrl} from '../../dataUrl.js'
import PointPopulation from '../points/PointPopulation.js'
import {decodeCatalogueTile} from './catalogueTile.js'
import {CATALOGUE_TILES_DIR} from './tiers.js'


/**
 * The bundled catalogue's stars as a point population (js/scene/Stars.md,
 * "Brightness tiers"): its tiles under public/large/stars/v1/ (dataUrl, so
 * a PR preview reads production's), fetched whole, the bright tier first
 * whatever the view, and every point of a loaded tile in the field drawn,
 * as the one geometry drew them.  Stars.js makes it and feeds the
 * catalogue (StarsCatalog) from each tile as it lands.
 *
 * `?starTiers=0` reads stars.dat whole instead, as before (the fallback,
 * which a missing manifest or a failed tile also takes).
 */


/**
 * @param {string} [search] location.search
 * @returns {boolean} Whether the catalogue loads as tiers
 */
export function starTiersEnabled(search) {
  return new URLSearchParams(search ?? '').get('starTiers') !== '0'
}


/**
 * @param {object} opts
 * @param {object} opts.ui ThreeUi: its camera, height and limitingMagnitude()
 * @param {object} opts.material The stars' material (starsMaterial.js)
 * @param {Function} opts.onTile (tileInfo, CatalogueTileData) => after each tile is added
 * @param {Function} [opts.onFail] (keys) => after a request fails
 * @param {Function} [opts.fetchFn] For tests
 * @param {string} [opts.baseUrl] For tests
 * @returns {PointPopulation}
 */
export function newCataloguePopulation({ui, material, onTile, onFail, fetchFn, baseUrl}) {
  const population = new PointPopulation({
    name: 'Catalogue',
    baseUrl: baseUrl ?? dataUrl(CATALOGUE_TILES_DIR),
    decode: decodeCatalogueTile,
    material,
    // Every star, as the catalogue's one geometry drew (drawAll); no budget.
    budget: Infinity,
    complete: true,
    drawAll: true,
    // The faint tiers wait for Stars.streamRest: the reveal, or a need.
    holdRest: true,
    // What lands before the reveal is at full light (the reveal fades the
    // scene in); after it (Stars.revealed), each tile's light fades in.
    shown: false,
    onTile,
    onFail,
    fetchFn,
    host: {
      camera: () => ui?.camera ?? null,
      // Before ThreeUi has an exposure (tests' stub: none), the naked eye's.
      limitingMagnitude: () => (typeof ui?.limitingMagnitude === 'function' ? ui.limitingMagnitude() : NaN),
      heightPx: () => ui?.height,
    },
  })
  // From the animation callback, each frame: what the view wants, first.
  // The catalogue doesn't move (its epoch is Hipparcos's; Gaia.md).
  population.preAnimCb = () => {
    population.update()
  }
  return population
}
