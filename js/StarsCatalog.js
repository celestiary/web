import {LENGTH_SCALE, LIGHTYEAR_METER} from './shared.js'
import {assertEquals, assertNotNullOrUndefined} from './utils.js'

// Format description at https://en.wikibooks.org/wiki/Celestia/Binary_Star_File
const littleEndian = true

/** @typedef {Map<number, StarProps>} StarByHip A map from Hipparcos ID to star object. */

/** @typedef {Map<string, number>} HipByName Hipparcos ID by star name. */

/** @typedef {Map<number, Array.<string>>} NamesByHip Array of names for the star by Hipparcos ID. */

/**
 * @typedef {{
 *   x: number,
 *   y: number,
 *   z: number,
 *   hipId: number,
 *   absMag: number,
 *   kind: number,
 *   spectralType: number,
 *   sub: number,
 *   lumClass: number,
 *   lumRelSun: number,
 *   radius: number,
 * }} StarProps
 */


/**
 */
export default class StarsCatalog {
  /**
   * @param {number} numStars
   * @param {StarByHip} starByHip
   * @param {HipByName} hipByName
   * @param {NamesByHip} namesByHip
   * @param {number} minMag
   * @param {number} maxMag
   * @param {number} starScale
   * @param {number} lengthScale
   * @see StarsCatalog#downsample for call with all the args.
   */
  constructor(
    numStars = 0,
    starByHip = /** @type {StarByHip}*/ new Map(),
    hipByName = /** @type {HipByName}*/ new Map(),
    namesByHip = /** @type {NamesByHip}*/ new Map(),
    minMag = -8.25390625,
    maxMag = 15.4453125,
    // 1E1 looks decent.  2E1 much more intriguing but a little fake.
    starScale = LIGHTYEAR_METER,
    lengthScale = LENGTH_SCALE) {
    /** @type {StarByHip} */
    this.starByHip = starByHip

    /** @type {HipByName} */
    this.hipByName = hipByName

    /** @type {NamesByHip} */
    this.namesByHip = namesByHip
    this.minMag = minMag
    this.maxMag = maxMag
    this.numStars = numStars
    this.numNamedStars = 0
    this.numNames = 0
    this.starScale = starScale
    this.lengthScale = lengthScale
    this.sceneScale = starScale * lengthScale
  }


  /**
   * @param {Function} cb
   */
  load(cb) {
    if (!cb) {
      throw new Error('Undefined callback')
    }
    fetch('/data/stars.dat').then((starsData) => {
      starsData.arrayBuffer().then(
        /**
         * @param {ArrayBuffer} buffer
         */
        (buffer) => {
          this.read(buffer)
          fetch('/data/starnames.dat').then((namesData) => {
            namesData.text().then((text) => {
              this.readNames(text)
              cb()
            })
          })
        })
    })
  }


  /**
   * @param {ArrayBuffer} buffer
   * @returns {object}
   */
  read(buffer) {
    const header = 'CELSTARS\x00\x01'
    const data = new DataView(buffer)
    let offset = 0
    assertDataView(header, data, offset)
    offset += header.length

    this.numStars = data.getUint32(offset, littleEndian)
    offset += 4
    let mX = 0, mY = 0, mZ = 0
    const sun = getSunProps()
    this.starByHip.set(0, sun)
    for (let i = 0; i < this.numStars; i++) {
      const hipId = data.getUint32(offset, littleEndian)
      offset += 4

      const x = data.getFloat32(offset, littleEndian)
      offset += 4

      const y = data.getFloat32(offset, littleEndian)
      offset += 4

      const z = data.getFloat32(offset, littleEndian)
      offset += 4

      const absMag = data.getInt16(offset, littleEndian) / 256
      offset += 2

      const clazz = data.getUint16(offset, littleEndian)
      offset += 2

      const kind = (clazz & 0xF000) >>> 12
      const type = (clazz & 0x0F00) >>> 8
      const sub = (clazz & 0x00F0) >>> 4
      const lumClass = clazz & 0x000F

      // http://cas.sdss.org/dr4/en/proj/advanced/hr/radius1.asp
      // Omitting the temperature factor for now as it changes radius by
      // only a factor of 3 up or down.
      const absMagDelta = sun.absMag - absMag
      const lumRelSun = Math.pow(2.512, absMagDelta)
      const radiusRelSun = Math.pow(lumRelSun, 0.5)

      // Compute star's luminous flux from absolute magnitude, from ChatG
      //    ratio = 10^((M_sun - M_star)/2.5)
      const magFactor = Math.pow(10.0, (sun.absMag - absMag) / 2.5)
      const lumens = sun.lumens * magFactor

      /** @type {StarProps} */
      const star = {
        hipId: hipId,
        x: x * LIGHTYEAR_METER,
        y: y * LIGHTYEAR_METER,
        z: z * LIGHTYEAR_METER,
        absMag: absMag,
        kind: kind,
        spectralType: type,
        sub: sub,
        lumClass: lumClass,
        radius: radiusRelSun * sun.radius,
        // Used by stars.vert
        lumens: lumens,
      }
      this.starByHip.set(hipId, star)
    }
    return this
  }


  /** @param {string} text */
  readNames(text) {
    const records = text.split('\n')
    for (let i = 0; i < records.length; i++) {
      const record = records[i]
      const parts = record.split(':')
      if (parts.length < 2 && i < records.length - 1) {
        console.warn(`Malformed name record ${i}: `, parts)
        continue
      }
      const hipId = parseInt(assertNotNullOrUndefined(parts.shift()))
      this.namesByHip.set(hipId, parts)
      this.numNamedStars++
      for (let j = 0; j < parts.length; j++) {
        const part = parts[j]
        this.hipByName.set(part, hipId)
        this.numNames++
        // ZET1 Aqr -> ZET Aqr
        let match = part.match(/(\w{2,3})\d+ (\w{3})/)
        if (match) {
          const fix = `${match[1] } ${ match[2]}`
          this.hipByName.set(fix, hipId)
          this.numNames++
        }
        // IOT Cnc A -> Iot Cnc
        match = part.match(/(\w{2,3}) (\w{3}).*/)
        if (match) {
          const fix = `${match[1] } ${ match[2]}`
          this.hipByName.set(fix, hipId)
          this.numNames++
        }
      }
    }
  }


  /**
   * @param {number} numToKeep
   * @param {Set<number>} keep
   * @returns {StarsCatalog}
   */
  downsample(numToKeep, keep = new Set()) {
    if (this.numStars < numToKeep) {
      return this
    }

    /** @type {Array.<StarProps>} */
    let sampled = Array.from(this.starByHip.values())
    // ChatGPT hooked me up with this!
    sampled = sampled.sort(() => Math.random() - 0.5).slice(0, numToKeep)
    assertEquals(numToKeep, sampled.length)

    /** @type {StarByHip} */
    const starByHip = new Map()

    /** @type {HipByName} */
    const hipByName = new Map()

    /** @type {NamesByHip} */
    const namesByHip = new Map()

    let minMag = Number.MAX_VALUE; let maxMag = Number.MIN_VALUE
    sampled.forEach((star) => {
      if (star.absMag < minMag) {
        minMag = star.absMag
      }
      if (star.absMag > maxMag) {
        maxMag = star.absMag
      }
      const hipId = star.hipId
      starByHip.set(hipId, star)
      const names = this.namesByHip.get(hipId)
      if (names) {
        namesByHip.set(hipId, names)
      }
    })
    this.hipByName.forEach((hipId, name) => {
      if (starByHip.get(hipId)) {
        hipByName.set(name, hipId)
      }
    })
    return new StarsCatalog(numToKeep, starByHip, hipByName, namesByHip, minMag, maxMag)
  }


  /**
   * @param {number} hipId
   * @returns {string|number}
   */
  getNameOrId(hipId) {
    const names = this.namesByHip.get(hipId)
    if (names && names.length > 0) {
      return names[0]
    }
    return hipId
  }


  /**
   * @param {string} origName
   * @returns {Array.<any>}
   */
  reifyName(origName) {
    let name = origName
    let hipId = this.hipByName.get(name)
    if (!hipId) {
      name = abbrev(name)
      hipId = this.hipByName.get(name)
    }
    if (!hipId) {
      name = abbrevVariant(name)
      hipId = this.hipByName.get(name)
    }
    if (hipId) {
      const names = this.namesByHip.get(hipId)
      if (names && names.length > 0) {
        name = names[0]
      }
    }
    // if (!hipId)
    //  throw new Error(`Could not reify origName(${origName}) for hipId(${hipId})`);
    return [origName, name, hipId]
  }
}


// Didn't see the sun in the stars.dat catalog, so adding it
// manually.  If wrong, it'll be in there twice but indexed once
/** @returns {StarProps} */
export function getSunProps(radius = 695700000) {
  return {
    x: 0, y: 0, z: 0,
    hipId: 0,
    absMag: 4.83,
    kind: 0,
    spectralType: 4,
    sub: 2,
    lumClass: 6,
    radius: radius,
    lumens: 3.0e28,
  }
}


/**
 * Generates a star like _tmpl_ but at random position and given id.
 *
 * @param {StarProps} tmpl
 * @param {number} id
 * @param {number} posScale
 * @returns {StarProps}
 */
export function genStar(tmpl, id, posScale = 1e10) {
  return {
    x: posScale * (Math.random() - 0.5),
    y: posScale * (Math.random() - 0.5),
    z: posScale * (Math.random() - 0.5),
    hipId: id,
    absMag: tmpl.absMag,
    kind: tmpl.kind,
    spectralType: tmpl.spectralType,
    sub: tmpl.sub,
    lumClass: tmpl.lumClass,
    lumRelSun: tmpl.lumRelSun,
    radius: tmpl.radius,
  }
}


// TODO: Unify with temperature-based color alg in shaders/star.frag.
//
// TODO: plenty of color work to do here based on
// https://en.wikipedia.org/wiki/Stellar_classification. The
// method used here to choose colors is to hover my mouse over the
// color chart near the top of the page, above a given class, and
// record the RGB values in the table below.
//
// TODO: use color lookup attributes:
// https://threejs.org/examples/#webgl_geometry_colors_lookuptable
export const StarSpectra = [
  [142, 176, 255, 'O'], // 0,
  [165, 191, 255, 'B'], // 1,
  [205, 218, 255, 'A'], // 2,
  [242, 239, 254, 'F'], // 3,
  [255, 238, 229, 'G'], // 4,
  [255, 219, 178, 'K'], // 5,
  [255, 180, 80, 'M'], // 6,
  [255, 180, 80, 'R'], // 7, like M
  [255, 180, 80, 'S'], // 8, like M
  [255, 180, 80, 'N'], // 9, like M
  [142, 176, 255, 'WC'], // 10, like O
  [142, 176, 255, 'WN'], // 11, like O
  [142, 176, 255, 'Unk.'], // 12, like O?
  [255, 118, 0, 'L'], // 13,
  [255, 0, 0, 'T'], // 14,
  [10, 10, 10, 'Carbon']] // 15, ?


/**
 * @param {string} name
 * @returns {string}
 */
function abbrev(name) {
  const parts = name.split(/\s+/)
  parts[0] = parts[0].substring(0, 3).toUpperCase()
  const out = parts.join(' ')
  return out
}


/**
 * @param {string} name
 * @returns {string}
 */
function abbrevVariant(name) {
  const parts = name.split(/\s+/)
  const num = variants.get(parts[0])
  if (num) {
    parts[0] = num
  }
  return parts.join(' ')
}


// TODO: https://en.wikipedia.org/wiki/Bayer_designation
// Meantime, these are what I've observed:
/** @type {Map.<string, string>} */
const variants = new Map()
variants.set('ALP', 'ALF')
variants.set('THE', 'TET')


/**
 * @param {string} expect
 * @param {DataView} actual
 * @param {number} offset
 */
function assertDataView(expect, actual, offset) {
  for (let i = 0; i < expect.length; i++) {
    const eC = expect.charCodeAt(i)
    const aC = actual.getUint8(offset + i)
    if (eC === aC) {
      continue
    }
    throw new Error(`Check failed at index ${i}, expected: ${eC}, actual: ${aC}`)
  }
}


export const FAVES = new Map(Object.entries({
  0: 'Sol',
  439: 'Gliese 1',
  8102: 'Tau Ceti',
  11767: 'Polaris',
  21421: 'Aldebaran',
  24436: 'Rigel',
  25336: 'Bellatrix',
  27989: 'Betelgeuse',
  30438: 'Canopus',
  32349: 'Sirius',
  37279: 'Procyon',
  49669: 'Regulus',
  57632: 'Denebola',
  65474: 'Spica',
  69673: 'Arcturus',
  70890: 'Proxima Centauri',
  80763: 'Antares',
  83608: 'Arrakis',
  91262: 'Vega',
  102098: 'Deneb',
  97649: 'Altair',
  113881: 'Scheat',
}).map((entArr) => [parseInt(entArr[0]), entArr[1]]))
