import Loader from '../../Loader.js'
import {dataUrl} from '../../dataUrl.js'
import {utcToTtJulianDay} from '../celestialFrame.js'
import PointPopulation, {DEFAULT_BUDGET} from '../points/PointPopulation.js'
import {decodeStarTile} from '../points/starTile.js'
import {newStarsMaterial} from '../starsMaterial.js'


/**
 * Gaia DR3's stars as a point population (js/scene/Gaia.md): the tiles
 * under public/large/gaia/v1/ (dataUrl, so a PR preview reads production's),
 * drawn by the stars' own shader with their space motion, to the star
 * field's limiting magnitude.  Until the tiles are built the manifest is
 * absent and nothing is drawn or fetched past it.
 *
 * `?gaia=0` leaves it out; `?pointBudget=N` sets the most points it draws.
 */


/** The tiles' directory under public/, by format version (tools/gaia/gaia.mjs writes it). */
export const GAIA_TILES_DIR = 'large/gaia/v1'


/**
 * @param {string} [search] location.search
 * @returns {{enabled: boolean, budget: number}}
 */
export function gaiaOptions(search) {
  const params = new URLSearchParams(search ?? '')
  const budget = parseInt(params.get('pointBudget') ?? '')
  return {
    enabled: params.get('gaia') !== '0',
    budget: Number.isFinite(budget) && budget >= 0 ? budget : DEFAULT_BUDGET,
  }
}


/**
 * @param {object} ui ThreeUi: its camera and limitingMagnitude()
 * @returns {?PointPopulation} null where there is no page (tests) or ?gaia=0
 */
export function newGaiaPopulation(ui) {
  if (typeof location === 'undefined' || typeof fetch === 'undefined' || !ui?.camera ||
      typeof ui.limitingMagnitude !== 'function') {
    return null
  }
  const {enabled, budget} = gaiaOptions(location.search)
  if (!enabled) {
    return null
  }
  const material = newStarsMaterial({motion: true})
  const population = new PointPopulation({
    name: 'Gaia DR3',
    baseUrl: dataUrl(GAIA_TILES_DIR),
    decode: decodeStarTile,
    material,
    budget,
    host: {
      camera: () => ui.camera,
      limitingMagnitude: () => ui.limitingMagnitude(),
      heightPx: () => ui.height,
    },
  })
  let shaderReady = false
  new Loader().loadShaders(material, () => {
    shaderReady = true
  })
  // From the animation callback, each frame (Animation.animateSystem): the
  // date for the stars' motion, then the selection.  Nothing is drawn
  // before the shader's sources are in.
  population.preAnimCb = (time, jd) => {
    if (!shaderReady) {
      return
    }
    population.setDate(utcToTtJulianDay(jd ?? time.simTimeJulianDay()))
    population.update()
  }
  return population
}
