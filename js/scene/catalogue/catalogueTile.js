import {BufferAttribute} from 'three'
import {catalogueStar, getSunProps} from '../StarsCatalog.js'
import {starAttributes} from '../StarsBufferGeometry.js'
import {ABS_MAG_SCALE, decodeTile} from '../points/tileFormat.js'
import {apparentMag} from './tiers.js'


/**
 * One of the catalogue's tiles (tiers.js) to its stars and its points'
 * attributes: each star made by StarsCatalog.js catalogueStar from the
 * values stars.dat stores, and drawn by StarsBufferGeometry.js
 * starAttributes, so a star from a tile is the star stars.dat gave, and
 * draws the same (Stars.md, "Brightness tiers").
 */


const SUN = getSunProps()


/**
 * @typedef {object} CatalogueTileData
 * @property {number} count Stars
 * @property {object} attributes three BufferAttributes by name
 * @property {Float32Array} mags Apparent V from the Sun, ascending
 * @property {null} ids No 64-bit ids (Gaia's): the catalogue's are `hips`
 * @property {Int32Array} hips The stars' HIP numbers, in the points' order
 * @property {Array<object>} stars StarProps, in the points' order
 */


/**
 * @param {ArrayBuffer} buf
 * @returns {CatalogueTileData}
 */
export function decodeCatalogueTile(buf) {
  const t = decodeTile(buf)
  if (!t.hip || !t.clazz) {
    throw new Error('Not a catalogue tile: it has no HIP or class column')
  }
  const n = t.count
  const stars = new Array(n)
  const mags = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = t.position[3 * i]
    const y = t.position[(3 * i) + 1]
    const z = t.position[(3 * i) + 2]
    // The file's 1/256 mag steps, exactly (ABS_MAG_SCALE is 4 of them).
    const absMag = t.absMag[i] / ABS_MAG_SCALE
    stars[i] = catalogueStar({hipId: t.hip[i], x, y, z, absMag, clazz: t.clazz[i]}, SUN)
    mags[i] = apparentMag(absMag, x, y, z)
  }
  const a = starAttributes(stars, n)
  return {
    count: n,
    attributes: {
      position: new BufferAttribute(a.coords, 3),
      positionLow: new BufferAttribute(a.positionLow, 3),
      color: new BufferAttribute(a.colors, 3),
      radius: new BufferAttribute(a.radii, 1),
      lumens: new BufferAttribute(a.lumens, 1),
    },
    mags,
    ids: null,
    hips: a.idsByNdx,
    stars,
  }
}
