import {describe, expect, it} from 'bun:test'
import {Quaternion, Vector3} from 'three'
import {J2000_JD, J2000_OBLIQUITY_DEG, precessEcliptic, precessionQuaternion} from './celestialFrame.js'
import {poleVector, rotationModel} from './iauRotation.js'
import {eclipticToScene} from './lunarTheory.js'
import {icrfToScene, meanElements, orbitAt, referencePlaneQuaternion} from './meanElements.js'
import horizons from './meanElements.horizons.json'
import callisto from '../../public/data/callisto.json'
import charon from '../../public/data/charon.json'
import deimos from '../../public/data/deimos.json'
import dione from '../../public/data/dione.json'
import europa from '../../public/data/europa.json'
import ganymede from '../../public/data/ganymede.json'
import hyperion from '../../public/data/hyperion.json'
import iapetus from '../../public/data/iapetus.json'
import io from '../../public/data/io.json'
import janus from '../../public/data/janus.json'
import jupiter from '../../public/data/jupiter.json'
import mars from '../../public/data/mars.json'
import neptune from '../../public/data/neptune.json'
import oberon from '../../public/data/oberon.json'
import phobos from '../../public/data/phobos.json'
import pluto from '../../public/data/pluto.json'
import proteus from '../../public/data/proteus.json'
import rhea from '../../public/data/rhea.json'
import saturn from '../../public/data/saturn.json'
import tethys from '../../public/data/tethys.json'
import titan from '../../public/data/titan.json'
import titania from '../../public/data/titania.json'
import triton from '../../public/data/triton.json'
import uranus from '../../public/data/uranus.json'


const toDeg = 180 / Math.PI
const toRad = Math.PI / 180
const BODIES = {
  callisto, charon, deimos, dione, europa, ganymede, hyperion, iapetus, io, janus,
  oberon, phobos, pluto, proteus, rhea, tethys, titan, titania, triton,
}
const SCENE_Y = new Vector3(0, 1, 0)


/**
 * A scene-axes vector of one ecliptic frame, as ecliptic (x, y, z).
 *
 * @param {Vector3} v
 * @returns {Vector3}
 */
function sceneToEcliptic(v) {
  return new Vector3(v.x, -v.z, v.y)
}


/**
 * Precess a scene-axes vector from the ecliptic of jdeFrom to jdeTo's with
 * precessEcliptic (Meeus 21.5 on longitude and latitude), independently of
 * precessionQuaternion.
 *
 * @param {Vector3} v
 * @param {number} jdeFrom
 * @param {number} jdeTo
 * @returns {Vector3}
 */
function precessVector(v, jdeFrom, jdeTo) {
  const e = sceneToEcliptic(v)
  const r = e.length()
  const lambda = Math.atan2(e.y, e.x) * toDeg
  const beta = Math.asin(e.z / r) * toDeg
  const p = precessEcliptic(lambda, beta, jdeFrom, jdeTo)
  return eclipticToScene(p.lambda, p.beta, r)
}


/**
 * A body's position and orbit normal as the scene has them (of date, as
 * Animation computes them), taken back to the ecliptic of J2000 with
 * precessEcliptic, as for the Moon's Horizons test.
 *
 * @param {object} orbit a body's JSON orbit block
 * @param {number} jde
 * @returns {{pos: Vector3, normal: Vector3}} ecliptic J2000, km and unit
 */
function modelJ2000(orbit, jde) {
  const q = new Quaternion
  const pos = new Vector3
  orbitAt(meanElements(orbit), jde, q, pos)
  const precession = precessionQuaternion(J2000_JD, jde)
  const posOfDate = pos.applyQuaternion(precession)
  const normalOfDate = SCENE_Y.clone().applyQuaternion(q).applyQuaternion(precession)
  return {
    pos: sceneToEcliptic(precessVector(posOfDate, jde, J2000_JD)).multiplyScalar(1e-3),
    normal: sceneToEcliptic(precessVector(normalOfDate, jde, J2000_JD)),
  }
}


/**
 * Errors against a Horizons position: out of the model's orbit plane
 * (plane), along the orbit (phase, signed: Horizons ahead is positive) and
 * in distance.
 *
 * @param {string} name
 * @param {Array<number>} row [jde, x, y, z], km, ecliptic J2000
 * @returns {{plane: number, phase: number, dr: number}} degrees, km
 */
function errors(name, [jde, x, y, z]) {
  const {pos, normal} = modelJ2000(BODIES[name].orbit, jde)
  const h = new Vector3(x, y, z)
  const plane = Math.asin(h.dot(normal) / h.length()) * toDeg
  const phase = Math.atan2(pos.clone().cross(h).dot(normal), pos.dot(h)) * toDeg
  return {plane, phase, dr: pos.length() - h.length()}
}


describe('icrfToScene and referencePlaneQuaternion', () => {
  it('puts the equinox on +X and the ecliptic pole on +Y', () => {
    expect(icrfToScene(0, 0).distanceTo(new Vector3(1, 0, 0))).toBeLessThan(1e-12)
    expect(icrfToScene(270, 90 - J2000_OBLIQUITY_DEG).distanceTo(SCENE_Y)).toBeLessThan(1e-12)
  })


  it('takes a plane\'s +Y to its pole, and its +X to the node on the equator', () => {
    const pole = {ra: 268.1, dec: 64.5}
    const q = referencePlaneQuaternion(pole)
    expect(SCENE_Y.clone().applyQuaternion(q).angleTo(icrfToScene(pole.ra, pole.dec))).toBeLessThan(1e-12)
    expect(new Vector3(1, 0, 0).applyQuaternion(q).angleTo(icrfToScene(pole.ra + 90, 0))).toBeLessThan(1e-12)
  })
})


describe('mean elements against JPL Horizons', () => {
  // Geometric vectors relative to the primary's centre, ecliptic J2000, from
  // meanElements.horizons.json (the query is recorded there; offline).  The
  // scene is of date, so the model is precessed back to J2000 first.
  // Measured 2026-09-30, 2000-2050, in degrees (plane: out of the model's
  // orbit plane; phase: along it):
  // - Galileans, JPL SSD table (JUP365) as published: plane ≤ 0.09;
  //   phase Io 1.42, Europa 3.08 (both by 2050), Ganymede 0.09, Callisto
  //   0.16.  Mean elements can't follow the moons' mutual perturbations,
  //   so Io's and Europa's phase error grows away from the epoch.
  // - Titan (plane and rates SAT441, epoch state from Horizons' osculating
  //   elements): plane ≤ 0.29, phase ≤ 0.02, distance ≤ 203 km.
  // - Pluto (Standish's elements): plane ≤ 0.004, phase ≤ 0.010, distance
  //   ≤ 1.06e6 km.
  // - The other Saturnian moons with the same treatment: plane ≤ 0.64
  //   (Rhea), 1.49 (Iapetus), 0.22 (Tethys), 0.04 (Dione); phase ≤ 2.9
  //   (Tethys), 0.35 (Dione), 0.09 (Rhea), 0.07 (Iapetus).  Charon ≤ 0.08
  //   in both, Proteus plane 0.29, phase 3.0.
  // Tolerances are about twice the measured errors.
  const TOLERANCES = {
    io: {plane: 0.1, phase: 3},
    europa: {plane: 0.1, phase: 6},
    ganymede: {plane: 0.15, phase: 0.2},
    callisto: {plane: 0.2, phase: 0.35},
    titan: {plane: 0.6, phase: 0.05},
    pluto: {plane: 0.01, phase: 0.02},
    tethys: {plane: 0.5, phase: 6},
    dione: {plane: 0.1, phase: 0.7},
    rhea: {plane: 1.3, phase: 0.2},
    iapetus: {plane: 3, phase: 0.15},
    charon: {plane: 0.15, phase: 0.1},
    proteus: {plane: 0.6, phase: 6},
  }
  for (const [name, tol] of Object.entries(TOLERANCES)) {
    for (const row of horizons.bodies[name].rows) {
      it(`${name} at ${horizons.epochs[row[0]]}`, () => {
        const {plane, phase} = errors(name, row)
        expect(Math.abs(plane)).toBeLessThan(tol.plane)
        expect(Math.abs(phase)).toBeLessThan(tol.phase)
      })
    }
  }


  it('puts Titan within 400 km, and Pluto within 2.2e6 km, of Horizons\' distance', () => {
    for (const row of horizons.bodies.titan.rows) {
      expect(Math.abs(errors('titan', row).dr)).toBeLessThan(400)
    }
    for (const row of horizons.bodies.pluto.rows) {
      expect(Math.abs(errors('pluto', row).dr)).toBeLessThan(2.2e6)
    }
  })


  // The rest are spot checks of the plane only.  Their phase is off by up
  // to 180°: the table's periods are too coarse for Phobos, Deimos and
  // Triton over decades, URA182's angles don't match Horizons at their own
  // epoch, Janus swaps orbits with Epimetheus every four years, and
  // Hyperion is chaotic (≤ 26°).  Measured out-of-plane errors: Phobos
  // 1.64 (the table's node period, 2.3 yr, is rounded, and 50 years is 22
  // turns), Hyperion 1.51, Deimos 0.30, Triton 0.26 (with the IAU nodal
  // rate; 3.5 with the table's), the others ≤ 0.18.
  const PLANE_SPOT_CHECK = {
    phobos: 3, deimos: 0.6, hyperion: 3, janus: 0.15, titania: 0.4, oberon: 0.3, triton: 0.5,
  }
  for (const [name, tol] of Object.entries(PLANE_SPOT_CHECK)) {
    it(`keeps ${name} in its plane`, () => {
      for (const row of horizons.bodies[name].rows) {
        expect(Math.abs(errors(name, row).plane)).toBeLessThan(tol)
      }
    })
  }
})


describe('Saturn\'s moons\' epoch state', () => {
  // SAT441's tabulated ω and M put the Saturnian moons 60-160° from
  // Horizons at their own epoch, J2000, while the plane and the rates
  // agree.  So each body JSON takes e, ω and M from Horizons' osculating
  // elements at J2000 (the fixture's osculatingElements), re-referred to the
  // table's mean plane: the pericentre and the body's direction projected
  // onto it, the mean anomaly as it is.  This is that recipe, and a check
  // that the JSON still matches it.
  for (const name of ['tethys', 'dione', 'rhea', 'titan', 'hyperion', 'iapetus']) {
    it(`${name}.json holds Horizons' osculating state`, () => {
      const [, ec, , inc, om, w, , , ma, ta] = horizons.osculatingElements.bodies[name].row
      const osc = new Quaternion().setFromAxisAngle(SCENE_Y, om * toRad)
          .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), inc * toRad))
          .multiply(new Quaternion().setFromAxisAngle(SCENE_Y, w * toRad))
      // The body's direction at the epoch, true anomaly TA along the orbit.
      const r = new Vector3(Math.cos(ta * toRad), 0, -Math.sin(ta * toRad)).applyQuaternion(osc)
      const orbit = BODIES[name].orbit
      const node = referencePlaneQuaternion(orbit.referencePole)
          .multiply(new Quaternion().setFromAxisAngle(SCENE_Y, orbit.longitudeOfAscendingNode * toRad))
          .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), orbit.inclination * toRad))
      const local = r.applyQuaternion(node.invert())
      const u = Math.atan2(-local.z, local.x) * toDeg
      const wantW = (((u - ta) % 360) + 360) % 360
      expect(Math.abs((((orbit.argumentOfPericenter - wantW) + 540) % 360) - 180)).toBeLessThan(0.01)
      expect(orbit.meanAnomaly).toBeCloseTo(ma, 2)
      expect(orbit.eccentricity / ec).toBeCloseTo(1, 3)
    })
  }
})


/**
 * Angle between a moon's orbit normal and its planet's pole, both of date.
 *
 * @param {object} moon JSON
 * @param {object} planet JSON
 * @param {number} jde
 * @returns {number} degrees
 */
function tiltToEquator(moon, planet, jde) {
  const q = new Quaternion
  orbitAt(meanElements(moon.orbit), jde, q, new Vector3)
  return SCENE_Y.clone().applyQuaternion(q).angleTo(poleVector(rotationModel(planet.name), jde)) * toDeg
}


describe('orbital planes against the planets\' equators', () => {
  const JDE = 2461313.1
  it('keeps the Galilean moons within 0.6° of Jupiter\'s equator', () => {
    for (const moon of [io, europa, ganymede, callisto]) {
      expect(tiltToEquator(moon, jupiter, JDE)).toBeLessThan(0.6)
    }
  })


  it('puts Titan\'s orbit within 1° of Saturn\'s equator, the rings\' plane', () => {
    expect(tiltToEquator(titan, saturn, JDE)).toBeLessThan(1)
    // And 28° from the ecliptic, as Saturn's equator is.
    const q = new Quaternion
    orbitAt(meanElements(titan.orbit), JDE, q, new Vector3)
    expect(SCENE_Y.clone().applyQuaternion(q).angleTo(SCENE_Y) * toDeg).toBeCloseTo(28, 0)
  })


  it('keeps Phobos and Deimos near Mars\'s equator', () => {
    expect(tiltToEquator(phobos, mars, JDE)).toBeLessThan(1.5)
    expect(tiltToEquator(deimos, mars, JDE)).toBeLessThan(3)
  })


  it('runs Triton retrograde, ~157° from Neptune\'s pole', () => {
    expect(tiltToEquator(triton, neptune, JDE)).toBeGreaterThan(150)
    expect(tiltToEquator(triton, neptune, JDE)).toBeLessThan(162)
  })


  it('keeps Uranus\'s moons in its equator, 98° from the ecliptic', () => {
    for (const moon of [titania, oberon]) {
      expect(tiltToEquator(moon, uranus, JDE)).toBeLessThan(0.5)
    }
  })


  it('keeps Charon in Pluto\'s equator', () => {
    expect(tiltToEquator(charon, pluto, JDE)).toBeLessThan(0.5)
  })
})


describe('orbitAt', () => {
  it('moves a moon prograde, and Triton retrograde, about the planet\'s pole', () => {
    const at = (moon, jde) => {
      const p = new Vector3
      orbitAt(meanElements(moon.orbit), jde, new Quaternion, p)
      return p
    }
    const JDE = 2461313.1
    for (const [moon, planet, sign] of [[io, jupiter, 1], [titan, saturn, 1], [triton, neptune, -1]]) {
      const a = at(moon, JDE)
      const b = at(moon, JDE + 0.01)
      const h = a.clone().cross(b)
      expect(Math.sign(h.dot(poleVector(rotationModel(planet.name), JDE)))).toBe(sign)
    }
  })


  it('keeps the body on the orbit line: the ellipse, focus at the primary', () => {
    const el = meanElements(titan.orbit)
    const q = new Quaternion
    const p = new Vector3
    const {a, e} = orbitAt(el, 2461313.1, q, p)
    // Back in the flat ellipse's frame, centred: (x/a)² + (z/b)² = 1.
    const local = p.clone().applyQuaternion(q.clone().invert())
    local.x += a * e
    const b = a * Math.sqrt(1 - (e * e))
    expect(((local.x / a) ** 2) + ((local.z / b) ** 2)).toBeCloseTo(1, 9)
    expect(Math.abs(local.y)).toBeLessThan(1e-6)
  })
})
