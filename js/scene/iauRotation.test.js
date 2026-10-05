import {describe, expect, it} from 'bun:test'
import {Quaternion, Vector3} from 'three'
import {J2000_JD, gmstRad, precessionQuaternion, utcToTtJulianDay} from './celestialFrame.js'
import {
  bodyQuaternion,
  poleAndMeridian,
  rotationModel,
  subPoint,
  textureTurn,
} from './iauRotation.js'
import {moonArguments, moonOrientation, moonScenePosition} from './lunarTheory.js'
import {icrfToScene, meanElements, orbitAt} from './meanElements.js'
import horizons from './iauRotation.horizons.json'
import table from './iauRotation.json'
import callisto from '../../public/data/callisto.json'
import charon from '../../public/data/charon.json'
import dione from '../../public/data/dione.json'
import europa from '../../public/data/europa.json'
import ganymede from '../../public/data/ganymede.json'
import iapetus from '../../public/data/iapetus.json'
import io from '../../public/data/io.json'
import jupiter from '../../public/data/jupiter.json'
import proteus from '../../public/data/proteus.json'
import rhea from '../../public/data/rhea.json'
import sun from '../../public/data/sun.json'
import tethys from '../../public/data/tethys.json'
import titan from '../../public/data/titan.json'


const toRad = Math.PI / 180
const MINUTES_PER_DAY = 1440
const DAYS_PER_YEAR = 365.25
const EARTH_OBLIQUITY_DEG = 23.4392811
const X_AXIS = new Vector3(1, 0, 0)
const Y_AXIS = new Vector3(0, 1, 0)
// Horizons' dates in the fixture (UT): 1950, J2000, 2026-10-01, 2050.
const DATES = [2433282.5, 2451545.0, 2461314.5, 2469807.5]


/**
 * @param {number} deg
 * @returns {number} in [-180, 180]
 */
function wrap180(deg) {
  return deg - (360 * Math.round(deg / 360))
}


/**
 * Earth's orientation as celestiary draws it (Planet.load's rotateX(-ε),
 * Animation's GMST spin), body frame → scene (ecliptic of date).
 *
 * @param {number} jdUtc
 * @returns {Quaternion}
 */
function earthQuaternion(jdUtc) {
  return new Quaternion().setFromAxisAngle(X_AXIS, -EARTH_OBLIQUITY_DEG * toRad)
      .multiply(new Quaternion().setFromAxisAngle(Y_AXIS, gmstRad(jdUtc)))
}


/**
 * An orientation of date, taken back to the ecliptic of J2000.
 *
 * @param {Quaternion} q body frame → scene, of date
 * @param {number} jdUtc
 * @returns {Quaternion} body frame → ecliptic J2000
 */
function toJ2000(q, jdUtc) {
  return q.premultiply(precessionQuaternion(J2000_JD, utcToTtJulianDay(jdUtc)).invert())
}


/**
 * @param {string} body
 * @returns {Function} jdUtc → body frame → ecliptic J2000, by the IAU model
 */
function iau(body) {
  const model = rotationModel(body)
  return (jdUtc) => bodyQuaternion(model, utcToTtJulianDay(jdUtc))
}


/**
 * Horizons' sub-observer point in a row, as planetocentric east longitude
 * and latitude.
 *
 * @param {object} entry
 * @param {Array<number>} row
 * @returns {{lng: number, lat: number}} degrees
 */
function horizonsSubPoint(entry, row) {
  const [, , , lon, lat] = row
  const [a, , c] = entry.radiiKm
  const east = entry.longitudePositive === 'west' ? -lon : lon
  // Planetodetic to planetocentric, on the frame's spheroid.
  const centric = Math.atan(((c / a) ** 2) * Math.tan(lat * toRad)) / toRad
  return {lng: wrap180(east), lat: centric}
}


/**
 * The sub-observer point an orientation gives for a Horizons row: the body
 * as it was when the light left it (the row's light time), seen along the
 * row's astrometric direction.  Aberration (≤ 20″) is left out.
 *
 * @param {Function} orient jdUtc → body frame → ecliptic J2000
 * @param {Array<number>} row
 * @returns {{lng: number, lat: number}} degrees
 */
function modelSubPoint(orient, row) {
  const [jdUtc, ra, dec, , , ltMin] = row
  return subPoint(orient(jdUtc - (ltMin / MINUTES_PER_DAY)), icrfToScene(ra, dec).negate())
}


/**
 * The worst differences of an orientation from an entry's rows: longitude
 * as a great-circle distance along the parallel, and latitude.
 *
 * @param {object} entry
 * @param {Function} orient
 * @returns {{dLng: number, dLat: number}} degrees
 */
function worst(entry, orient) {
  let dLng = 0
  let dLat = 0
  for (const row of entry.rows) {
    const got = modelSubPoint(orient, row)
    const want = horizonsSubPoint(entry, row)
    dLng = Math.max(dLng, Math.abs(wrap180(got.lng - want.lng)) * Math.cos(want.lat * toRad))
    dLat = Math.max(dLat, Math.abs(got.lat - want.lat))
  }
  return {dLng, dLat}
}


/**
 * @param {string} body
 * @param {string} observer
 * @returns {object} the fixture's entry
 */
function findEntry(body, observer) {
  return horizons.entries.find((e) => e.body === body && e.observer === observer)
}


describe('the IAU WGCCRE table', () => {
  it('has a sourced model for every body celestiary turns, and none for Hyperion', () => {
    for (const name of [...sun.system, 'moon', 'phobos', 'deimos', 'io', 'europa', 'ganymede', 'callisto', 'titan',
      'rhea', 'dione', 'tethys', 'iapetus', 'janus', 'titania', 'oberon', 'triton', 'proteus', 'charon']) {
      const model = rotationModel(name)
      expect(model).not.toBeNull()
      expect(model.source).toMatch(/WGCCRE (2009|2015)/)
    }
    expect(rotationModel('hyperion')).toBeNull()
    expect(table.source).toMatch(/Archinal et al\. 2018/)
  })


  it('gives the report\'s values at J2000, periodic terms and all', () => {
    // Jupiter: System III, with the pole's Ja-Je terms (2015).
    const j = poleAndMeridian(rotationModel('jupiter'), J2000_JD)
    expect(j.w).toBeCloseTo(284.95, 9)
    expect(j.ra).toBeCloseTo(268.056595 + (0.000117 * Math.sin(99.360714 * toRad)) +
      (0.000938 * Math.sin(175.895369 * toRad)) + (0.001432 * Math.sin(300.323162 * toRad)) +
      (0.000030 * Math.sin(114.012305 * toRad)) + (0.002150 * Math.sin(49.511251 * toRad)), 9)
    // Mars: the 2015 model, with its periodic terms, is the 2009 one at
    // J2000 (pole 317.68143, 52.8865; W 176.630) to 0.003°.
    const m = poleAndMeridian(rotationModel('mars'), J2000_JD)
    expect(Math.abs(m.ra - 317.68143)).toBeLessThan(0.003)
    expect(Math.abs(m.dec - 52.8865)).toBeLessThan(0.003)
    expect(Math.abs(m.w - 176.630)).toBeLessThan(0.003)
  })


  it('turns each body at its own rate: Mars once a sol, Venus backwards in 243 days', () => {
    const w = (name, jde) => poleAndMeridian(rotationModel(name), jde).w
    // A sidereal day of Mars, 24h 37m 22.66s.
    expect(wrap180(w('mars', J2000_JD + 1.02595675) - w('mars', J2000_JD))).toBeCloseTo(0, 2)
    expect(wrap180(w('venus', J2000_JD + 1) - w('venus', J2000_JD))).toBeCloseTo(-1.4813688, 6)
  })
})


describe('IAU rotation models against JPL Horizons (offline fixture)', () => {
  // Horizons' IAU_* frames are the same report, so what's left is TT for
  // TDB, aberration and Horizons' own rounding: ≤ 0.0025° (Jupiter) at
  // 1950, 2000, 2026 and 2050.
  const IAU_TOLERANCE_DEG = 0.01
  for (const e of horizons.entries.filter((x) => x.body !== 'earth' && x.body !== 'moon')) {
    it(`puts ${e.body}'s sub-${e.observer} point where Horizons does (${e.frame})`, () => {
      const {dLng, dLat} = worst(e, iau(e.body))
      expect(dLng).toBeLessThan(IAU_TOLERANCE_DEG)
      expect(dLat).toBeLessThan(IAU_TOLERANCE_DEG)
    })
  }


  it('keeps Earth on GMST, within 0.01° of Horizons\' ITRF93, where the IAU\'s Earth is 0.14° off', () => {
    const e = findEntry('earth', 'moon')
    const own = worst(e, (jd) => toJ2000(earthQuaternion(jd), jd))
    // Longitude 0.002°; latitude 0.007°, the mean equator of date's
    // J2000 obliquity and the nutation (≤ 9″) left out.
    expect(own.dLng).toBeLessThan(0.005)
    expect(own.dLat).toBeLessThan(0.01)
    // The 2009 report's low-precision Earth (the 2015 one gives none, and
    // defers to the IERS): its W is in TDB, where Earth turns with UT1.
    const model = worst(e, iau('earth'))
    expect(model.dLng).toBeGreaterThan(0.1)
    expect(model.dLng).toBeLessThan(0.2)
  })


  it('turns the Moon by the IAU model, within 0.003° of Horizons\' mean-Earth frame', () => {
    const e = findEntry('moon', 'earth')
    const model = worst(e, iau('moon'))
    expect(model.dLng).toBeLessThan(0.003)
    expect(model.dLat).toBeLessThan(0.003)
    // Cassini's laws (Meeus 53), the Moon's orientation before #96, miss
    // its physical libration: 0.02° and 0.035°, about a kilometre.
    const cassini = worst(e, (jd) => toJ2000(moonOrientation(moonArguments(utcToTtJulianDay(jd))), jd))
    expect(cassini.dLng).toBeLessThan(0.03)
    expect(cassini.dLat).toBeLessThan(0.04)
  })
})


/**
 * A moon's sub-planet longitude as celestiary draws it: its IAU
 * orientation, and its position from its mean elements.
 *
 * @param {string} name
 * @param {object} props JSON
 * @param {number} jdUtc
 * @returns {number} east longitude, degrees
 */
function appSubPlanetLongitude(name, props, jdUtc) {
  const jde = utcToTtJulianDay(jdUtc)
  const pos = new Vector3
  orbitAt(meanElements(props.orbit), jde, new Quaternion, pos)
  return subPoint(bodyQuaternion(rotationModel(name), jde), pos.negate()).lng
}


describe('synchronous moons face their planets', () => {
  // Horizons' own sub-planet longitudes, 1950-2050: the IAU meridians put
  // each moon's longitude 0 toward its planet to within its eccentricity's
  // optical libration and the model's rounding.
  it('by Horizons, within 6°', () => {
    for (const e of horizons.entries.filter((x) => x.observer !== 'earth' && x.body !== 'earth')) {
      for (const row of e.rows) {
        expect(Math.abs(horizonsSubPoint(e, row).lng)).toBeLessThan(6)
      }
    }
  })


  // As drawn: the IAU orientation and the mean-element position.  Holds
  // where the elements keep the moon's phase (DESIGN.md, mean elements).
  const FACING = [
    ['io', io, 2.5], ['europa', europa, 4], ['ganymede', ganymede, 3], ['callisto', callisto, 2],
    ['tethys', tethys, 5.5], ['dione', dione, 1.5], ['rhea', rhea, 3], ['titan', titan, 6], ['iapetus', iapetus, 6],
    ['proteus', proteus, 7], ['charon', charon, 2],
  ]
  for (const [name, props, tol] of FACING) {
    it(`as drawn: ${name}, within ${tol}°`, () => {
      for (const jd of DATES) {
        expect(Math.abs(appSubPlanetLongitude(name, props, jd))).toBeLessThan(tol)
      }
    })
  }


  it('as drawn: the Moon, within its optical libration', () => {
    for (const jd of DATES) {
      const jde = utcToTtJulianDay(jd)
      const toEarth = moonScenePosition(jde).negate().applyQuaternion(precessionQuaternion(J2000_JD, jde).invert())
      const {lng, lat} = subPoint(bodyQuaternion(rotationModel('moon'), jde), toEarth)
      expect(Math.abs(lng)).toBeLessThan(8)
      expect(Math.abs(lat)).toBeLessThan(7)
    }
  })


  // The IAU meridians face the real positions (Horizons, above), but these
  // moons' mean elements lose their phase: Phobos and Deimos by up to 170°
  // in 1950 and 2050, Janus 130° (it swaps orbits with Epimetheus), Triton
  // 55°, and Titania and Oberon at every date (URA182's epoch angles).
  it.todo('as drawn: Phobos, Deimos, Janus, Titania, Oberon and Triton, once their orbital phase follows Horizons (#97)')
})


describe('Jupiter\'s clouds (texture_rotation)', () => {
  const spec = jupiter.texture_rotation


  /**
   * The Great Red Spot's System II west longitude as drawn: where the
   * texture's spot lands in the body frame (System III), taken to System II.
   *
   * @param {number} jdUtc
   * @returns {number} degrees
   */
  function grsSystemII(jdUtc) {
    const jde = utcToTtJulianDay(jdUtc)
    const w3 = poleAndMeridian(rotationModel('jupiter'), jde).w
    const east3 = spec.feature.textureLongitude + textureTurn(spec, jde, w3)
    // East of the node by w3 + east3; System II west longitude is W_II less that.
    const w2 = spec.w[0] + (spec.w[1] * (jde - J2000_JD))
    return ((((w2 - (w3 + east3)) % 360) + 360) % 360)
  }


  it('puts the Great Red Spot at its observed System II longitude', () => {
    // Sky & Telescope's transit predictions (JUPOS): 216° on 2014-09-08,
    // 349° in 2021 January; Stellarium's default, 46° on 2023-10-01.
    for (const [jd, want] of [[2456908.5, 216], [2459216, 349], [2460218.5, 46]]) {
      expect(Math.abs(wrap180(grsSystemII(jd) - want))).toBeLessThan(2)
    }
  })


  it('turns the clouds with System II (0.266°/day behind System III) and the spot\'s drift', () => {
    const jd = 2461314.5
    const turn = (d) => textureTurn(spec, utcToTtJulianDay(d), poleAndMeridian(rotationModel('jupiter'),
        utcToTtJulianDay(d)).w)
    const drift = wrap180(turn(jd + 1) - turn(jd))
    expect(drift).toBeCloseTo(870.270 - 870.536 - (spec.feature.driftPerYear / DAYS_PER_YEAR), 4)
  })
})
