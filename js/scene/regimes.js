// The orbital regimes around a body (Lagrange.md, orbital regimes; #272's scope 2): the shells
// spacecraft use, the boundaries further out, and the orbits that define
// the families, in the body's equator.  Earth's first, and their analogues
// where they make sense (Mars's sun-synchronous orbit, set by its J2 as
// Earth's is); the Moon's low, frozen and elliptical orbits (#272's scope 4;
// Lagrange.md, near the Moon).  Drawn by RegimeMarks for the target.
//
// Distances are from the body's centre, in metres; altitudes are over the
// equatorial radius, the usual reference (GEO's 35,786 km).


const DEG = Math.PI / 180
const KM = 1e3


/**
 * Each body's regimes, each with a short `label` for the scene (a label
 * sprite stands above its point by half its width: SpriteSheet) and a
 * `text` for the info panel.  `shells` are altitude ranges, drawn as bands;
 * `spheres` boundaries, drawn as outlines (`radius` metres from the centre,
 * or `beyond` a pair's L2: Scene gives it); `orbits` the families' orbits,
 * in the equator: a, e, i, the argument of pericentre ω and the node Ω
 * (degrees), `planes` copies spaced in Ω, or `sunSync` an orbit at an
 * altitude whose inclination keeps its plane to the Sun, its node at a
 * local time (`ltan`, hours) that follows the Sun.  `notes` are lines for
 * the panel alone.
 */
export const REGIMES = {
  earth: {
    gm: 3.986004418e14,
    j2: 1.08262668e-3,
    equatorialRadius: 6378137,
    shells: [
      {name: 'LEO', label: 'LEO', text: 'low Earth orbit (LEO)', from: 160 * KM, to: 2000 * KM, color: 0x7fd0ff},
      {name: 'MEO', label: 'MEO', text: 'medium Earth orbit (MEO)', from: 2000 * KM, to: 35786 * KM, color: 0xb59bff},
    ],
    spheres: [
      // The cislunar explainer (#272): about here the Moon's pull starts
      // to tell on an orbit.  No standard name for it was found.
      {label: '100,000 km up', text: '100,000 km up: the Moon\'s pull starts to matter', altitude: 100000 * KM, color: 0xd8c27f},
      // The 2022 US definition: the volume beyond GEO under the Earth's
      // and the Moon's gravity, the Earth-Moon Lagrange points within it.
      {label: 'cislunar space', text: 'cislunar space: beyond GEO, out to the Earth–Moon L2', beyond: 'moon', color: 0xd8a07f},
    ],
    orbits: [
      {label: 'GEO graveyard', text: 'GEO graveyard, 300 km above GEO', a: (42164 * KM) + (300 * KM), color: 0x9a9a9a},
      {label: 'GPS', text: 'GPS: 6 planes at 55°, 20,200 km up', a: 26559.7 * KM, i: 55, planes: 6, color: 0x9fe09f},
      {label: 'Molniya', text: 'Molniya: 12 h, apogee 39,400 km over the north', a: 26554 * KM, e: 0.722, i: 63.4, w: 270, node: 0,
        color: 0xff9f9f},
      {label: 'Tundra', text: 'Tundra: 24 h, apogee over the north', a: 42164 * KM, e: 0.268, i: 63.4, w: 270, node: 120,
        color: 0xffc07f},
      {label: 'sun-synchronous', text: 'sun-synchronous, 700 km, dawn–dusk', sunSync: true, altitude: 700 * KM, ltan: 18, color: 0xfff07f},
    ],
  },
  mars: {
    gm: 4.282837e13,
    j2: 1.96045e-3,
    equatorialRadius: 3396190,
    shells: [],
    spheres: [],
    orbits: [
      // Mars Reconnaissance Orbiter's: about 300 km up, 3 pm.
      {label: 'sun-synchronous', text: 'sun-synchronous, 300 km, 3 pm (as MRO\'s)', sunSync: true, altitude: 300 * KM, ltan: 15,
        color: 0xfff07f},
    ],
  },
  // Near the Moon (Lagrange.md, near the Moon).  Altitudes are over the
  // lunar reference sphere, 1,737.4 km, which LRO's are given over.  The
  // nodes are illustrative, spread so the labels part.
  moon: {
    gm: 4.9028e12,
    equatorialRadius: 1737400,
    shells: [
      {name: 'LLO', label: 'LLO', text: 'low lunar orbit (LLO)', from: 20 * KM, to: 100 * KM, color: 0x7fd0ff},
    ],
    spheres: [],
    orbits: [
      // The four frozen inclinations (Folta & Quinn 2006; NASA's 2006
      // account), drawn circular at 100 km: their eccentricities are small.
      ...[[27, 0], [50, 90], [76, 180], [86, 270]].map(([i, node]) => ({label: `frozen ${i}°`,
        text: `frozen low orbit, ${i}°: the mascons' tugs average out, and it lasts for years without burns`,
        altitude: 100 * KM, i, node, color: 0x8fe0c0})),
      {label: 'LRO 2009–11', text: 'LRO\'s mapping orbit, 2009–11: 50 km, polar, held by burns of 143 m/s a year',
        altitude: 50 * KM, i: 90, w: 90, node: 45, color: 0xfff07f},
      {label: 'LRO', text: 'LRO since December 2011: frozen and polar, under 5 m/s a year; ' +
        'drawn as in 2015, 20 km over the south pole and 165 km over the north',
      a: (1737.4 + ((20 + 165) / 2)) * KM, e: (165 - 20) / ((2 * 1737.4) + 20 + 165), i: 90, w: 270, node: 45,
      color: 0xffc07f},
      // The 30 h reference orbit of NASA's lunar relay and navigation
      // service (LCRNS): 1,750 by 17,400 km up.
      {label: 'ELFO', text: 'elliptical lunar frozen orbit (ELFO), 30 h: 1,750 by 17,400 km up, ' +
        'its apolune over the south pole; Earth\'s pull keeps it frozen',
      a: (1737.4 + ((1750 + 17400) / 2)) * KM, e: (17400 - 1750) / ((2 * 1737.4) + 1750 + 17400),
      i: 59.37, w: 92.49, node: 135, color: 0xff9f9f},
    ],
    notes: [
      'why most low lunar orbits don\'t last: the mascons, dense regions under the maria, pull unevenly, ' +
        'and with the Earth\'s pull they stretch the orbit until its low point meets the ground; ' +
        'Apollo 16\'s subsatellite crashed in 35 days',
    ],
  },
}


/**
 * The inclination at which J2's turning of an orbit's node keeps pace with
 * the Sun's mean motion about the body, so the plane keeps its angle to the
 * Sun: cos i = −(2/3) (n☉ / (J2 R²)) a^(7/2) (1 − e²)² / √GM.
 *
 * @param {object} body
 * @param {number} body.gm m³/s²
 * @param {number} body.j2
 * @param {number} body.equatorialRadius metres
 * @param {number} yearSecs the body's sidereal orbit period
 * @param {number} a semi-major axis, metres
 * @param {number} [e]
 * @returns {?number} degrees, or null where no inclination will do (too high)
 */
export function sunSyncInclination({gm, j2, equatorialRadius}, yearSecs, a, e = 0) {
  const sunRate = 2 * Math.PI / yearSecs
  const cos = -(2 / 3) * sunRate * (a ** 3.5) * ((1 - (e * e)) ** 2) / (j2 * (equatorialRadius ** 2) * Math.sqrt(gm))
  return cos >= -1 ? Math.acos(cos) / DEG : null
}


/**
 * The node of an orbit whose ascending node crosses at the given local
 * time: the Sun's right ascension in the equator plus 15° an hour from
 * noon.
 *
 * @param {{x: number, z: number}} sun the Sun's direction in the body's
 *     equator frame (+Y the pole, angles from +X toward −Z)
 * @param {number} ltanHours
 * @returns {number} degrees, in [0, 360)
 */
export function nodeForLocalTime(sun, ltanHours) {
  const ra = Math.atan2(-sun.z, sun.x) / DEG
  return ((((ra + ((ltanHours - 12) * 15)) % 360) + 360) % 360)
}


/**
 * @param {number} gm m³/s²
 * @param {number} a metres
 * @returns {number} the period, seconds
 */
export function periodOf(gm, a) {
  return 2 * Math.PI * Math.sqrt((a ** 3) / gm)
}


/**
 * A regime orbit's semi-major axis.
 *
 * @param {object} body REGIMES' entry
 * @param {object} orbit one of its orbits
 * @returns {number} metres
 */
export function semiMajorAxisOf(body, orbit) {
  return orbit.a ?? (body.equatorialRadius + orbit.altitude)
}


/**
 * The inclination at which the Earth's pull leaves an elliptical lunar
 * orbit frozen, ω at 90° or 270°: e² + (5/3) cos² i = 1, the doubly
 * averaged quadrupole of a distant third body (Ely 2005; Kozai's critical
 * inclination, 39.23°, as e goes to 0).  The Moon's own field moves it a
 * few degrees (the 30 h ELFO's 59.4° against 56.0° here).
 *
 * @param {number} e
 * @returns {number} degrees, prograde
 */
export function elfoInclination(e) {
  return Math.acos(Math.sqrt(0.6 * (1 - (e * e)))) / DEG
}
