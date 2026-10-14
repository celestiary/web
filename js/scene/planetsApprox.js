import {Quaternion, Vector3} from 'three'
import {ASTRO_UNIT_METER} from '../shared.js'
import {J2000_JD, precessionQuaternion, utcToTtJulianDay} from './celestialFrame.js'
import {moonScenePosition} from './lunarTheory.js'
import {meanElements, orbitAt} from './meanElements.js'


// The planets' approximate places, for before VSOP87C has loaded: the app
// runs without the series (2.6 MB of coefficients, loaded after the first
// frame; Animation.loadEphemeris) and draws the planets from these, then
// hands over to VSOP87C (Animation.planetCoords).
//
// Standish, "Keplerian elements for approximate positions of the major
// planets", JPL SSD (ssd.jpl.nasa.gov/planets/approx_pos.html), table 1,
// valid 1800-2050: a, e, I, mean longitude L, longitude of perihelion ϖ and
// of the node Ω at J2000 in the ecliptic and equinox of J2000, each with a
// rate per Julian century.  The same form as Pluto's `orbit` block, so
// meanElements.js reads them.  Against VSOP87C (planetsApprox.test.js, and
// DESIGN.md "Before the ephemeris loads") they are within a few arcminutes
// of the Sun over 1800-2050, and degrade outside it, to tens of degrees at
// the supported range's ends; Standish's table 2 (3000 BC - 3000 AD) adds
// terms for Jupiter to Neptune that aren't kept, since this only fills the
// seconds before the series is in.
//
// The table gives the Earth-Moon barycentre; the Earth is placed by taking
// the Moon's share of the lunar position off it, as OrbitPath does for
// Earth's line (Animation.newOrbitPath).


// Rows: a (AU), e, I (deg), L, ϖ, Ω; each a value then its rate per century.
const TABLE_1 = {
  mercury: [0.38709927, 0.00000037, 0.20563593, 0.00001906, 7.00497902, -0.00594749,
    252.25032350, 149472.67411175, 77.45779628, 0.16047689, 48.33076593, -0.12534081],
  venus: [0.72333566, 0.00000390, 0.00677672, -0.00004107, 3.39467605, -0.00078890,
    181.97909950, 58517.81538729, 131.60246718, 0.00268329, 76.67984255, -0.27769418],
  // The Earth-Moon barycentre.
  earth: [1.00000261, 0.00000562, 0.01671123, -0.00004392, -0.00001531, -0.01294668,
    100.46457166, 35999.37244981, 102.93768193, 0.32327364, 0.0, 0.0],
  mars: [1.52371034, 0.00001847, 0.09339410, 0.00007882, 1.84969142, -0.00813131,
    -4.55343205, 19140.30268499, -23.94362959, 0.44441088, 49.55953891, -0.29257343],
  jupiter: [5.20288700, -0.00011607, 0.04838624, -0.00013253, 1.30439695, -0.00183714,
    34.39644051, 3034.74612775, 14.72847983, 0.21252668, 100.47390909, 0.20469106],
  saturn: [9.53667594, -0.00125060, 0.05386179, -0.00050991, 2.48599187, 0.00193609,
    49.95424423, 1222.49362201, 92.59887831, -0.41897216, 113.66242448, -0.28867794],
  uranus: [19.18916464, -0.00196176, 0.04725744, -0.00004397, 0.77263783, -0.00242939,
    313.23810451, 428.48202785, 170.95427630, 0.40805281, 74.01692503, 0.04240589],
  neptune: [30.06992276, 0.00026291, 0.00859048, 0.00005105, 1.77004347, 0.00035372,
    -55.12002969, 218.45945325, 44.96476227, -0.32241464, 131.78422574, -0.00508664],
}

/** The planets, in VSOP87C's names. */
export const PLANET_NAMES = Object.keys(TABLE_1)

// The Moon's share of the Earth-Moon mass, 1 / (1 + M_Earth / M_Moon), as
// Animation's.
const MOON_MASS_FRACTION = 1 / (1 + 81.30056)

/** @type {{[name: string]: object}} meanElements() of each planet */
const ELEMENTS = {}
for (const [name, r] of Object.entries(TABLE_1)) {
  ELEMENTS[name] = meanElements({
    referencePlane: 'ecliptic',
    epoch: J2000_JD,
    semiMajorAxis: r[0] * ASTRO_UNIT_METER,
    eccentricity: r[2],
    inclination: r[4],
    meanLongitude: r[6],
    longitudeOfPericenter: r[8],
    longitudeOfAscendingNode: r[10],
    ratesPerCentury: {
      semiMajorAxisAu: r[1],
      eccentricity: r[3],
      inclination: r[5],
      meanLongitude: r[7],
      longitudeOfPericenter: r[9],
      longitudeOfAscendingNode: r[11],
    },
  })
}

const quat = new Quaternion
const precession = new Quaternion
const pos = new Vector3
const moon = new Vector3


/**
 * The planets' heliocentric positions as VSOP87C gives them, approximately.
 *
 * @param {number} jd Julian Day (UTC)
 * @param {object} [target] receives {mercury: {x, y, z}, ...}, made if absent
 * @returns {object} each planet's (x, y, z) in AU, in the mean ecliptic and
 *   equinox of date (VSOP87C's axes)
 */
export function planetsApprox(jd, target = {}) {
  const jde = utcToTtJulianDay(jd)
  precessionQuaternion(J2000_JD, jde, precession)
  moonScenePosition(jde, moon)
  for (const name of PLANET_NAMES) {
    orbitAt(ELEMENTS[name], jde, quat, pos)
    pos.applyQuaternion(precession)
    if (name === 'earth') {
      pos.addScaledVector(moon, -MOON_MASS_FRACTION)
    }
    // Scene (x, y, z) is ecliptic (x, z, -y): back to the ecliptic's.
    const c = target[name] ?? (target[name] = {x: 0, y: 0, z: 0})
    c.x = pos.x / ASTRO_UNIT_METER
    c.y = -pos.z / ASTRO_UNIT_METER
    c.z = pos.y / ASTRO_UNIT_METER
  }
  return target
}
