import {describe, expect, it} from 'bun:test'
import {Object3D, Quaternion, Vector3} from 'three'
import Animation from './Animation.js'
import {utcToTtJulianDay} from './celestialFrame.js'
import {moonArguments, moonOrientation, moonScenePosition} from './lunarTheory.js'


const toRad = Math.PI / 180
// 2026-09-29 14:25 UTC, issue #87's example.
const JD = 2461313.1007


/**
 * Mirror Planet.load's scene graph for a moon: orbitPosition (with orbit
 * and orbitShape) → planetTilt (rotateX(-axialInclination)) → planet.
 *
 * @param {string} name
 * @param {number} axialInclinationDeg
 * @returns {{root: Object3D, orbitPosition: Object3D, orbitShape: Object3D, planet: Object3D}}
 */
function moonGraph(name, axialInclinationDeg) {
  const root = new Object3D
  const orbitPlane = new Object3D
  root.add(orbitPlane)
  const orbitShape = new Object3D
  orbitPlane.add(orbitShape)
  const orbitPosition = new Object3D
  orbitPosition.name = `${name}.orbitPosition`
  orbitPosition.orbit = {
    eccentricity: 0.0554,
    semiMajorAxis: {scalar: 3.84467E8},
    siderealOrbitPeriod: {scalar: 2548108.8},
  }
  orbitPosition.orbitShape = orbitShape
  orbitPlane.add(orbitPosition)
  const planetTilt = new Object3D
  planetTilt.rotateX(-axialInclinationDeg * toRad)
  orbitPosition.add(planetTilt)
  const planet = new Object3D
  planet.name = name
  planet.props = {name}
  planet.siderealRotationPeriod = 1
  planetTilt.add(planet)
  return {root, orbitPosition, orbitShape, planet}
}


const stubTime = {
  simTimeJulianDay: () => JD,
  simTimeDays: () => JD - 2440587.5,
  simTimeSecs: () => (JD - 2440587.5) * 86400,
}


describe('Animation, the Moon', () => {
  it('places the Moon at the lunar theory\'s geocentric position, at TT', () => {
    const {root, orbitPosition} = moonGraph('moon', 1.543)
    new Animation(stubTime).animateAtJD(root, JD)
    const want = moonScenePosition(utcToTtJulianDay(JD))
    expect(orbitPosition.position.distanceTo(want)).toBeLessThan(1)
  })


  it('orients the Moon by Cassini\'s laws whatever its planetTilt', () => {
    const {root, planet} = moonGraph('moon', 1.543)
    new Animation(stubTime).animateAtJD(root, JD)
    root.updateMatrixWorld(true)
    const got = planet.getWorldQuaternion(new Quaternion)
    const want = moonOrientation(moonArguments(utcToTtJulianDay(JD)))
    expect(Math.abs(got.dot(want))).toBeCloseTo(1, 12)
  })


  it('turns its near side (+X, the prime meridian) toward Earth', () => {
    const {root, orbitPosition, planet} = moonGraph('moon', 1.543)
    new Animation(stubTime).animateAtJD(root, JD)
    root.updateMatrixWorld(true)
    const primeMeridian = new Vector3(1, 0, 0).applyQuaternion(planet.getWorldQuaternion(new Quaternion))
    const toEarth = orbitPosition.position.clone().negate().normalize()
    // Within the optical libration (≤ ~10°).
    expect(primeMeridian.angleTo(toEarth) / toRad).toBeLessThan(10)
  })


  it('lays the orbit line through the Moon', () => {
    const {root, orbitPosition, orbitShape} = moonGraph('moon', 1.543)
    new Animation(stubTime).animateAtJD(root, JD)
    // Moon in the orbit shape's frame (the flat unit ellipse scaled by a,
    // in its XZ plane): close to the plane.
    const local = orbitPosition.position.clone().sub(orbitShape.position)
        .applyQuaternion(orbitShape.quaternion.clone().invert())
    expect(Math.abs(local.y) / local.length()).toBeLessThan(0.01)
  })


  it('leaves other moons on their ellipse in the ecliptic', () => {
    const {root, orbitPosition} = moonGraph('phobos', 0)
    new Animation(stubTime).animateAtJD(root, JD)
    expect(orbitPosition.position.y).toBe(0)
    expect(orbitPosition.position.length()).toBeGreaterThan(3.6E8)
  })
})
