import {describe, expect, it} from 'bun:test'
import {Object3D, Quaternion, Vector3} from 'three'
import Animation from './Animation.js'
import {J2000_JD, precessionQuaternion, utcToTtJulianDay} from './celestialFrame.js'
import {moonArguments, moonOrientation, moonScenePosition} from './lunarTheory.js'
import {bodyQuaternion, poleVector, rotationModel} from './iauRotation.js'
import {meanElements, orbitAt} from './meanElements.js'
import io from '../../public/data/io.json'
import jupiter from '../../public/data/jupiter.json'
import mars from '../../public/data/mars.json'
import pluto from '../../public/data/pluto.json'
import saturn from '../../public/data/saturn.json'
import titan from '../../public/data/titan.json'
import triton from '../../public/data/triton.json'


const toRad = Math.PI / 180
// 2026-09-29 14:25 UTC, issue #87's example.
const JD = 2461313.1007


/**
 * Mirror Planet.load's scene graph for a moon: orbitPosition (with orbit
 * and orbitShape) → planetTilt (rotateX(-axialInclination)) → the 'new
 * planet' group → 'planet LOD' → planet, the node Animation spins
 * (Planet.newPlanet).  The spun node is not planetTilt's child.  As in
 * Planet, every body with an IAU model but Earth gets it.
 *
 * @param {string} name
 * @param {number} axialInclinationDeg
 * @returns {{root: Object3D, orbitPosition: Object3D, orbitShape: Object3D, planetTilt: Object3D,
 *     planet: Object3D}}
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
  const wrapper = new Object3D
  wrapper.name = 'new planet'
  planetTilt.add(wrapper)
  const lod = new Object3D
  lod.name = 'planet LOD'
  wrapper.add(lod)
  const planet = new Object3D
  planet.name = name
  planet.props = {name}
  planet.siderealRotationPeriod = 1
  planet.orbitPosition = orbitPosition
  lod.add(planet)
  const model = name === 'earth' ? null : rotationModel(name)
  if (model) {
    planetTilt.poleModel = model
    planet.meridianModel = model
  }
  return {root, orbitPosition, orbitShape, planetTilt, planet}
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


  it('orients the Moon by the IAU model, as Cassini\'s laws did to 0.04°', () => {
    const {root, planet} = moonGraph('moon', 1.543)
    new Animation(stubTime).animateAtJD(root, JD)
    root.updateMatrixWorld(true)
    const got = planet.getWorldQuaternion(new Quaternion)
    const jde = utcToTtJulianDay(JD)
    const want = bodyQuaternion(rotationModel('moon'), jde).premultiply(precessionQuaternion(J2000_JD, jde))
    expect(Math.abs(got.dot(want))).toBeCloseTo(1, 12)
    // Its orientation before #96 (Meeus 53, no physical libration).
    const cassini = moonOrientation(moonArguments(jde))
    expect(2 * Math.acos(Math.min(1, Math.abs(got.dot(cassini)))) / toRad).toBeLessThan(0.04)
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


  it('keeps a body without elements on a flat ellipse in the ecliptic', () => {
    const {root, orbitPosition} = moonGraph('earth-as-moon', 0)
    new Animation(stubTime).animateAtJD(root, JD)
    expect(orbitPosition.position.y).toBe(0)
    expect(orbitPosition.position.length()).toBeGreaterThan(3.6E8)
  })
})


/**
 * moonGraph with what Planet.load adds for a body with mean elements and
 * an IAU rotation model.
 *
 * @param {string} name
 * @param {object} props the body's JSON descriptor
 * @returns {object} moonGraph's nodes
 */
function bodyGraph(name, props) {
  const g = moonGraph(name, props.axialInclination)
  g.orbitPosition.orbit = props.orbit
  g.orbitPosition.elements = meanElements(props.orbit)
  g.planet.props = props
  return g
}


describe('Animation, bodies with mean elements', () => {
  it('places Titan by its elements, precessed to date, at TT', () => {
    const {root, orbitPosition} = bodyGraph('titan', titan)
    new Animation(stubTime).animateAtJD(root, JD)
    const jde = utcToTtJulianDay(JD)
    const want = new Vector3
    orbitAt(meanElements(titan.orbit), jde, new Quaternion, want)
    want.applyQuaternion(precessionQuaternion(J2000_JD, jde))
    expect(orbitPosition.position.distanceTo(want)).toBeLessThan(1)
    // Out of the ecliptic, as the old flat ellipse (y = 0) never was.
    expect(Math.abs(orbitPosition.position.y)).toBeGreaterThan(1e7)
  })


  it('lays the orbit line through the body, in its plane', () => {
    for (const [name, props] of [['titan', titan], ['io', io], ['triton', triton], ['pluto', pluto]]) {
      const {root, orbitPosition, orbitShape} = bodyGraph(name, props)
      new Animation(stubTime).animateAtJD(root, JD)
      // In the shape's frame (the flat unit ellipse, centred, in its XZ
      // plane, scaled by a): in the plane, and on the ellipse.
      const local = orbitPosition.position.clone().sub(orbitShape.position)
          .applyQuaternion(orbitShape.quaternion.clone().invert()).divideScalar(orbitShape.scale.x)
      const e = props.orbit.eccentricity
      const b = Math.sqrt(1 - (e * e))
      expect(Math.abs(local.y)).toBeLessThan(1e-9)
      expect((local.x ** 2) + ((local.z / b) ** 2)).toBeCloseTo(1, 3)
    }
  })


  it('points a planet\'s pole at its IAU pole, of date', () => {
    const {root, planetTilt} = bodyGraph('saturn', saturn)
    new Animation(stubTime).animateAtJD(root, JD)
    const jde = utcToTtJulianDay(JD)
    const want = poleVector(rotationModel('saturn'), jde).applyQuaternion(precessionQuaternion(J2000_JD, jde))
    const got = new Vector3(0, 1, 0).applyQuaternion(planetTilt.quaternion)
    expect(got.distanceTo(want)).toBeLessThan(1e-9)
    // 28.05° from the ecliptic pole (26.73° is to Saturn's own orbit).
    expect(got.angleTo(new Vector3(0, 1, 0)) / toRad).toBeCloseTo(28.05, 1)
  })


  it('leaves Earth\'s tilt alone', () => {
    const {root, planetTilt} = moonGraph('earth', 23.4392811)
    const before = planetTilt.quaternion.clone()
    new Animation(stubTime).animateAtJD(root, JD)
    expect(planetTilt.quaternion.equals(before)).toBe(true)
  })
})


describe('Animation, IAU prime meridians (#96)', () => {
  it('turns a body to its whole IAU orientation, of date', () => {
    for (const [name, props] of [['mars', mars], ['jupiter', jupiter], ['io', io], ['titan', titan],
      ['triton', triton], ['pluto', pluto]]) {
      const {root, planet} = bodyGraph(name, props)
      new Animation(stubTime).animateAtJD(root, JD)
      root.updateMatrixWorld(true)
      const jde = utcToTtJulianDay(JD)
      const want = bodyQuaternion(rotationModel(name), jde).premultiply(precessionQuaternion(J2000_JD, jde))
      const got = planet.getWorldQuaternion(new Quaternion)
      expect(Math.abs(got.dot(want))).toBeCloseTo(1, 12)
    }
  })


  it('turns at the body\'s own rate, not once a day', () => {
    const at = (jd) => {
      const time = {...stubTime, simTimeJulianDay: () => jd}
      const {root, planet} = bodyGraph('jupiter', jupiter)
      new Animation(time).animateAtJD(root, jd)
      root.updateMatrixWorld(true)
      return planet.getWorldQuaternion(new Quaternion)
    }
    // Jupiter's System III day is 9h 55m 29.7s: a quarter of it later the
    // prime meridian has turned 90°.
    const day = 360 / 870.536
    const a = at(JD)
    const b = at(JD + (day / 4))
    const x = new Vector3(1, 0, 0)
    expect(x.clone().applyQuaternion(a).angleTo(x.clone().applyQuaternion(b)) / toRad).toBeCloseTo(90, 1)
  })
})
