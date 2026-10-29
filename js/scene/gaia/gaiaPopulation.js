import Loader from '../../Loader.js'
import {addCredit, followCredit, removeCredit} from '../../credits.js'
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
 * Gaia's credit in the credits footer (credits.js) while its stars are
 * drawn (gaiaDrawn): ESA's requested "ESA/Gaia/DPAC", linked to Gaia's page,
 * and the licence, CC BY-SA 3.0 IGO, whose §4(a) asks for its URI with the
 * work (Gaia.md, "The source and its licence").  On arrival then fading,
 * on its own clock (§4(c): "in any reasonable manner", "reasonable to the
 * medium"), whatever stays, at the maintainer's call (CESIUM.md, "Credits").
 */
export const GAIA_CREDIT_ID = 'gaia'

export const GAIA_CREDIT = Object.freeze([
  Object.freeze({text: 'ESA/Gaia/DPAC', href: 'https://www.cosmos.esa.int/gaia'}),
  Object.freeze({text: 'CC BY-SA 3.0 IGO', href: 'https://creativecommons.org/licenses/by-sa/3.0/igo/'}),
])


/**
 * Whether any of Gaia's stars are drawn: the manifest in, the last frame's
 * selection drawing some (tiles loaded, in the field and to the limiting
 * magnitude: PointPopulation.update's `last.drawn`), and nothing over it
 * hidden.
 *
 * @param {?object} population
 * @returns {boolean}
 */
export function gaiaDrawn(population) {
  if (population?.status !== 'ready' || !(population.last?.drawn > 0)) {
    return false
  }
  for (let o = population; o; o = o.parent) {
    if (o.visible === false) {
      return false
    }
  }
  return true
}


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
    // Tiles fade in once the scene is revealed (Stars.revealed), as the
    // catalogue's do.
    shown: false,
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
  const credit = followCredit(creditGaia)
  population.preAnimCb = (time, jd) => {
    if (!shaderReady) {
      return
    }
    population.setDate(utcToTtJulianDay(jd ?? time.simTimeJulianDay()))
    population.update()
    credit(gaiaDrawn(population))
  }
  return population
}


/**
 * Gaia's credit in or out (followCredit, as gaiaDrawn changes).
 *
 * @param {boolean} drawn
 */
export function creditGaia(drawn) {
  if (drawn) {
    addCredit(GAIA_CREDIT_ID, GAIA_CREDIT, {persistence: 'timed'})
  } else {
    removeCredit(GAIA_CREDIT_ID)
  }
}
