import {dataUrl} from '../dataUrl.js'
import {LENGTH_SCALE, LIGHTYEAR_METER} from '../shared.js'
import {assertEquals, assertNotNullOrUndefined} from '../assert.js'
import {starParams} from './starParams.js'


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
 *   radius: number,
 *   teff: number,
 *   lumens: number,
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
    // Bumped when stars are added (addStars), for what is built from them.
    this.version = 0
    this.numNamedStars = 0
    this.numNames = 0
    this.starScale = starScale
    this.lengthScale = lengthScale
    this.sceneScale = starScale * lengthScale
  }


  /**
   * The whole catalogue from one file, `stars.dat`, then the names: the
   * fallback path, and the guide's (Stars.md, "Brightness tiers").  The
   * app reads the catalogue as tiles (catalogue/cataloguePopulation.js).
   *
   * @param {Function} cb Called once both are in
   * @param {Function} [onErr] Called with the error if either fails
   * @param {boolean} [withNames] Load the names too (not if already asked for)
   */
  load(cb, onErr, withNames = true) {
    if (!cb) {
      throw new Error('Undefined callback')
    }
    fetchOk(dataUrl('data/stars.dat'))
        .then((rsp) => rsp.arrayBuffer())
        .then((buffer) => {
          this.read(buffer)
          return withNames ? this.loadNames() : null
        })
        .then(() => cb())
        .catch((e) => {
          // Once a page: a page without the data (the tests') would say it for every scene.
          if (!warnedLoad) {
            warnedLoad = true
            console.warn(`Stars: the catalogue failed to load: ${e?.message ?? e}`)
          }
          onErr?.(e)
        })
  }


  /**
   * The names, `starnames.dat` (small: plain data, a relative URL).  Every
   * name is known as soon as this is in, whichever of the catalogue's tiers
   * holds its star.
   *
   * @returns {Promise<void>}
   */
  loadNames() {
    return fetchOk('data/starnames.dat')
        .then((rsp) => rsp.text())
        .then((text) => this.readNames(text))
  }


  /**
   * @param {ArrayBuffer} buffer
   * @returns {object}
   */
  read(buffer) {
    const raw = readCelestiaStars(buffer)
    this.numStars = raw.length
    const sun = this.addSun()
    for (const r of raw) {
      const star = catalogueStar(r, sun)
      this.starByHip.set(star.hipId, star)
    }
    return this
  }


  /**
   * The Sun, at HIP 0: it isn't in stars.dat.  Once.
   *
   * @returns {StarProps} The catalogue's Sun
   */
  addSun() {
    let sun = this.starByHip.get(0)
    if (!sun) {
      sun = getSunProps()
      this.starByHip.set(0, sun)
    }
    return sun
  }


  /**
   * Stars from one of the catalogue's tiles (catalogue/catalogueTile.js),
   * added to what it holds.  `numStars` counts them (not the Sun, as
   * `read` doesn't), and `version` changes, for what is built from the
   * stars it holds (the picking index).
   *
   * @param {Array<StarProps>} stars
   */
  addStars(stars) {
    for (const star of stars) {
      if (!this.starByHip.has(star.hipId)) {
        this.numStars++
      }
      this.starByHip.set(star.hipId, star)
    }
    this.version++
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
        // A trailing colon ("13421:SIG Eri:") leaves an empty name, which
        // would map '' to whichever star has one last (the guide's
        // no-hash white disc, #165).
        if (part === '') {
          continue
        }
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
   * Display-friendly identifier: proper name when available, otherwise the
   * catalog-prefixed ID ("HIP 1234") — never a bare number.  Used for 3D
   * sprite labels, search breadcrumb chip, and document title so they all
   * read consistently.
   *
   * @param {number} hipId
   * @returns {string}
   */
  getNameOrId(hipId) {
    const names = this.namesByHip.get(hipId)
    if (names && names.length > 0) {
      return names[0]
    }
    return `HIP ${hipId}`
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


/**
 * @typedef {object} RawStar A star as stars.dat holds it
 * @property {number} hipId Its Hipparcos number
 * @property {number} x Light-years, float32 as stored (the catalogue frame)
 * @property {number} y Light-years
 * @property {number} z Light-years
 * @property {number} absMag Absolute V, in the file's 1/256 mag steps
 * @property {number} clazz Its spectral class, packed as Celestia does:
 *   kind, type, subclass and luminosity class, a nibble each
 */


/**
 * The records of a Celestia binary star file, as stored: no conversion.
 * The catalogue's tiles (catalogue/tiers.js) are built from these, so a
 * tile's star is the same float32 position, magnitude and class.
 *
 * @param {ArrayBuffer} buffer
 * @returns {Array<RawStar>}
 */
export function readCelestiaStars(buffer) {
  const header = 'CELSTARS\x00\x01'
  const data = new DataView(buffer)
  let offset = 0
  assertDataView(header, data, offset)
  offset += header.length
  const numStars = data.getUint32(offset, littleEndian)
  offset += 4
  const out = new Array(numStars)
  for (let i = 0; i < numStars; i++) {
    out[i] = {
      hipId: data.getUint32(offset, littleEndian),
      x: data.getFloat32(offset + 4, littleEndian),
      y: data.getFloat32(offset + 8, littleEndian),
      z: data.getFloat32(offset + 12, littleEndian),
      absMag: data.getInt16(offset + 16, littleEndian) / 256,
      clazz: data.getUint16(offset + 18, littleEndian),
    }
    offset += 20
  }
  return out
}


/**
 * One star as the scene holds it, from its stored values: the same for
 * stars.dat and for the catalogue's tiles.
 *
 * @param {RawStar} raw
 * @param {StarProps} [sun] The catalogue's Sun, for the photometry
 * @returns {StarProps}
 */
export function catalogueStar({hipId, x, y, z, absMag, clazz}, sun = SUN) {
  const kind = (clazz & 0xF000) >>> 12
  const type = (clazz & 0x0F00) >>> 8
  const sub = (clazz & 0x00F0) >>> 4
  const lumClass = clazz & 0x000F

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
    // Used by stars.vert
    lumens: lumens,
  }
  // Its radius by Stefan-Boltzmann from its luminosity and temperature
  // (it was the square root of its visual luminosity: Betelgeuse 115
  // R☉ where it is 764, Proxima 0.01 where it is 0.15), and its
  // temperature, from its class and magnitude or as measured
  // (starParams.js, Stars.md).
  const params = starParams(star)
  star.radius = params.radius * sun.radius
  star.teff = params.teffMean
  return star
}


/**
 * @param {string} url
 * @returns {Promise<Response>} Rejected for a status that isn't OK
 */
function fetchOk(url) {
  return fetch(url).then((rsp) => {
    if (!rsp?.ok) {
      throw new Error(`${url}: HTTP ${rsp?.status}`)
    }
    return rsp
  })
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


const SUN = getSunProps()
let warnedLoad = false


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


// A star's colour, as a point and as a disc, is its blackbody's at its
// effective temperature (stellar.js blackbodyColor, starTeff); its class's
// name is stellar.js spectralTypeName.


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
