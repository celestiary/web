import {Color} from 'three'
import Constellation from './Constellation.js'


// SpaceX's Starlink, the whole constellation (Networks.md, "Starlink"): a
// Constellation of CelesTrak's GROUP=starlink, coloured by shell.


/**
 * The shells, by inclination (degrees, the upper bound of each): colour and
 * what they are.  CelesTrak's group also holds satellites raising their
 * orbits or coming down; they take their shell's colour, dimmer, below
 * LOW_KM.
 */
export const SHELLS = [
  {maxInc: 48, color: 0x6fe0c8, text: '43° shells'},
  {maxInc: 60, color: 0x7fb8ff, text: '53° shells'},
  {maxInc: 80, color: 0xc89fff, text: '70° shell'},
  {maxInc: 180, color: 0xffa8d8, text: 'polar (97.6°) shells'},
]
// Under this height (from the mean motion), km: still raising its orbit,
// or coming down.  The working shells are at about 340 to 580 km.
export const LOW_KM = 330
const LOW_DIM = 0.45
const GM_EARTH_KM3_S2 = 398600.4418
const EARTH_EQUATORIAL_KM = 6378.137


/**
 * @param {{inclination: number}} rec
 * @returns {object} its SHELLS entry
 */
export function shellOf(rec) {
  return SHELLS.find((s) => rec.inclination < s.maxInc) ?? SHELLS[SHELLS.length - 1]
}


/**
 * @param {{meanMotion: number}} rec rev/day
 * @returns {number} the mean height, km, from the mean motion
 */
export function meanHeightKm(rec) {
  const n = rec.meanMotion * 2 * Math.PI / 86400
  return Math.cbrt(GM_EARTH_KM3_S2 / (n * n)) - EARTH_EQUATORIAL_KM
}


/**
 * @param {Array<object>} records sgp4.js SatRecords
 * @param {object} [opts] As Constellation takes them (layer, camera)
 * @returns {Constellation}
 */
export function newStarlink(records, opts = {}) {
  const colors = new Float32Array(records.length * 3)
  const c = new Color
  records.forEach((rec, i) => {
    c.setHex(shellOf(rec).color)
    if (meanHeightKm(rec) < LOW_KM) {
      c.multiplyScalar(LOW_DIM)
    }
    c.toArray(colors, i * 3)
  })
  return new Constellation(records, {name: 'starlink', colors, pointSize: 2, refreshFrames: 20, ...opts})
}
