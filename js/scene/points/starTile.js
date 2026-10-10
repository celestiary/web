import {BufferAttribute, Float16BufferAttribute} from 'three'
import {getSunProps} from '../StarsCatalog.js'
import {PC_TO_CATALOGUE_LY} from '../gaia/astrometry.js'
import {luminosityFromMagnitude, radiusFromLuminosity} from '../starParams.js'
import {SUN_TEFF, blackbodyFromLut, sharedBlackbodyLut} from '../stellar.js'
import {LIGHTYEAR_METER} from '../../shared.js'
import {ABS_MAG_SCALE, decodeTile} from './tileFormat.js'


/**
 * A tile of stars to the star shader's attributes (shaders/stars.vert),
 * the same ones StarsBufferGeometry gives the bundled catalogue's: so a
 * Gaia star is drawn by the same law as a catalogue star (HDR.md, "Physical
 * stars"), its light from its absolute magnitude through the Sun's lumens
 * (StarsCatalog.js), its colour its blackbody's at its Teff (Stars.md,
 * "Colour"), its radius by Stefan-Boltzmann (starParams.js), which only
 * matters within a few AU of it, where the point fades into its disc.
 */


const SUN = getSunProps()
/** A star with no Teff is given the Sun's (Gaia.md: no BP−RP). */
export const DEFAULT_TEFF = SUN_TEFF


/**
 * @typedef {object} StarTileData
 * @property {number} count Points
 * @property {object} attributes three BufferAttributes by name
 * @property {Float32Array} mags Apparent magnitudes from the Sun at the epoch, ascending
 */


/**
 * @param {ArrayBuffer} buf A tile (tileFormat.js)
 * @returns {StarTileData}
 */
export function decodeStarTile(buf) {
  const t = decodeTile(buf)
  const n = t.count
  const position = new Float32Array(3 * n)
  const positionLow = new Float32Array(3 * n)
  const color = new Float32Array(3 * n)
  const radius = new Float32Array(n)
  const lumens = new Float32Array(n)
  const mags = new Float32Array(n)
  const lut = sharedBlackbodyLut()
  const colours = new Map()
  for (let i = 0; i < n; i++) {
    let r2 = 0
    for (let k = 0; k < 3; k++) {
      const ly = t.position[(3 * i) + k]
      // Metres in float64, then split as StarsBufferGeometry does: the
      // float32 high part and the residual, for the RTE shader.
      const m = ly * LIGHTYEAR_METER
      const hi = Math.fround(m)
      position[(3 * i) + k] = hi
      positionLow[(3 * i) + k] = m - hi
      r2 += ly * ly
    }
    const absMag = t.absMag[i] / ABS_MAG_SCALE
    const teff = t.teff[i] || DEFAULT_TEFF
    let rgb = colours.get(teff)
    if (!rgb) {
      rgb = blackbodyFromLut(lut, teff)
      colours.set(teff, rgb)
    }
    color[3 * i] = rgb[0]
    color[(3 * i) + 1] = rgb[1]
    color[(3 * i) + 2] = rgb[2]
    lumens[i] = SUN.lumens * (10 ** ((SUN.absMag - absMag) / 2.5))
    radius[i] = radiusFromLuminosity(luminosityFromMagnitude(absMag, teff), teff) * SUN.radius
    const pc = Math.sqrt(r2) / PC_TO_CATALOGUE_LY
    mags[i] = absMag + (5 * Math.log10(Math.max(pc, 1e-12) / 10))
  }
  const attributes = {
    position: new BufferAttribute(position, 3),
    positionLow: new BufferAttribute(positionLow, 3),
    color: new BufferAttribute(color, 3),
    radius: new BufferAttribute(radius, 1),
    lumens: new BufferAttribute(lumens, 1),
  }
  if (t.velocity) {
    attributes.velocity = new Float16BufferAttribute(t.velocity, 3)
  }
  // The tile is sorted by magnitude at its epoch; the quantised absolute
  // magnitude can reorder neighbours by 0.001 mag, so hold the order the
  // cut's binary search needs.
  for (let i = 1; i < n; i++) {
    if (mags[i] < mags[i - 1]) {
      mags[i] = mags[i - 1]
    }
  }
  return {count: n, attributes, mags}
}
