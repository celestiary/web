import {Object3D, Quaternion, Vector3} from 'three'
import {loadVsop87c} from '../vsop'
import * as Shared from '../shared'
import debug from '../debug'
import {J2000_JD, gmstRad, precessionQuaternion, utcToTtJulianDay} from './celestialFrame.js'
import {moonArguments, moonOrbitOrientation, moonOrientation, moonScenePosition} from './lunarTheory.js'
import {orbitAt, poleAt} from './meanElements.js'


/**
 * Animate scene, currently just orbits.  For major planets uses VSOP87C, and
 * for the Moon the truncated ELP-2000/82 of Meeus 47 (lunarTheory.js), both
 * in the mean ecliptic and equinox of date.  Pluto and the other moons
 * follow published mean elements (meanElements.js), referred to J2000 and
 * precessed to date here.  Bodies with a `pole` (IAU) are tilted to it.
 */
export default class Animation {
  /** @param {object} time */
  constructor(time) {
    this.time = time
    this.curVsopCoords = vsop87c('ignored')
    this.Y_AXIS = new Vector3(0, 1, 0)
    // Per-frame Moon state, from updateMoon.
    this.moonPos = new Vector3
    this.moonQuat = new Quaternion
    this.moonOrbitQuat = new Quaternion
    this._tmpQuat = new Quaternion
    this._tmpVec = new Vector3
    // Per-frame date state, from setDate: the Julian Day of the last
    // animate / animateAtJD, the same in TT, and the rotation from the
    // ecliptic of J2000 (mean elements, IAU poles) to the scene's, of date.
    this.jd = null
    this.jde = J2000_JD
    this.precession = new Quaternion
    this._orbitQuat = new Quaternion
    this._orbitPos = new Vector3
  }


  /** @param {object} scene */
  animate(scene) {
    this.time.updateTime()
    const jd = this.time.simTimeJulianDay()
    this.setDate(jd)
    this.animateSystem(scene)
  }


  /**
   * Animate the scene at a specific Julian Day without advancing the clock.
   * Used to position planets at a saved permalink time before camera restore.
   *
   * @param {object} scene Three.js scene
   * @param {number} jd Julian Day number
   */
  animateAtJD(scene, jd) {
    this.setDate(jd)
    this.animateSystem(scene)
  }


  /**
   * Everything animateSystem needs for a date, computed once per frame.
   *
   * @param {number} jd Julian Day (UTC)
   */
  setDate(jd) {
    this.jd = jd
    this.curVsopCoords = vsop87c(jd)
    this.jde = utcToTtJulianDay(jd)
    precessionQuaternion(J2000_JD, this.jde, this.precession)
    this.updateMoon(jd)
  }


  /**
   * The Moon's geocentric position, orientation and mean orbit for this
   * frame.  Meeus's series is in TT; the simulation clock is UTC.
   *
   * @param {number} jd Julian Day (UTC)
   */
  updateMoon(jd) {
    const jde = utcToTtJulianDay(jd)
    const args = moonArguments(jde)
    moonScenePosition(jde, this.moonPos)
    moonOrientation(args, this.moonQuat)
    moonOrbitOrientation(args, this.moonOrbitQuat)
  }


  /**
   * Recursive animation of orbits and rotations at the current time.
   *
   * @param {!Object3D} system
   */
  animateSystem(system) {
    if (system.preAnimCb) {
      // The Julian Day being animated, for callbacks that follow the date
      // (StellarFrame's precession); animateAtJD's needn't be the clock's.
      system.preAnimCb(this.time, this.jd)
    }

    if (system.pole) {
      this.orientPole(system)
    }

    if (system.siderealRotationPeriod) {
      // Spin around the body's local +Y axis (= rotational axis after
      // planetTilt's rotateX(-ε)).  For Earth we use Greenwich Mean
      // Sidereal Time directly: with the corrected tilt, rotation by
      // angle α around local +Y places the prime meridian at RA = α on
      // the celestial equator, so α = GMST puts Earth's geography in
      // the correct sky orientation at the given Julian day.
      //
      // For other bodies we don't have a per-planet "prime-meridian RA at
      // J2000" datum, so we fall back to the legacy hand-calibrated
      // formula — strictly no worse than before, but a candidate for
      // refinement (proper IAU WGCCRE rotation models per body).
      const name = system.props && system.props.name
      if (name === 'moon') {
        // The Moon's whole orientation (pole and spin, by Cassini's laws)
        // is in moonQuat, relative to the unrotated orbitPosition.  Undo
        // every rotation between the two: the node sits in its planet LOD,
        // in the 'new planet' group, under planetTilt (Planet.load).
        const parentRel = this._tmpQuat.identity()
        for (let o = system.parent; o && o !== system.orbitPosition && !o.orbit; o = o.parent) {
          parentRel.premultiply(o.quaternion)
        }
        system.quaternion.copy(parentRel.invert()).multiply(this.moonQuat)
      } else {
        let angle
        if (name === 'earth') {
          angle = gmstRad(this.time.simTimeJulianDay())
        } else {
          angle = Math.PI + (this.time.simTimeDays() * Shared.twoPi)
        }
        system.setRotationFromAxisAngle(this.Y_AXIS, angle)
      }
    }

    // This is referred to by a comment in scene.js#addOrbitingPlanet.
    if (system.orbit) {
      // Get an object with the (x,y,z) coordinates of each planet.
      // console.log('LOOKUP vsop for, in', sysName, vsopCoords)
      const sysName = system.name.split('.')[0]
      const vsopCoord = this.curVsopCoords[sysName]
      let x
      let y
      let z
      if (sysName === 'moon') {
        ({x, y, z} = this.moonPos)
        this.placeMoonOrbit(system)
      } else if (system.elements) {
        ({x, y, z} = this.placeByElements(system))
      } else if (vsopCoord === undefined) {
        // No elements: a flat ellipse in the ecliptic, centred on the
        // parent.  Only the demo descriptors (e.g. earth-as-moon.json) have
        // no elements now.
        const eccentricity = system.orbit.eccentricity
        const aRadius = system.orbit.semiMajorAxis.scalar
        const bRadius = aRadius * Math.sqrt(1.0 - Math.pow(eccentricity, 2.0))
        // -1.0 because orbits are counter-clockwise when viewed from above North of Earth.
        const angle = -1.0 * this.time.simTimeSecs() / system.orbit.siderealOrbitPeriod.scalar * Shared.twoPi
        x = aRadius * Math.cos(angle)
        y = 0
        z = bRadius * Math.sin(angle)
      } else {
        // TODO: double check scaling
        const scale = Shared.ASTRO_UNIT_METER
        x = vsopCoord.x * scale
        y = vsopCoord.z * scale
        z = -vsopCoord.y * scale
      }
      system.position.set(x, y, z)
      if (sysName === 'earth') {
        debug().log(`SMA: ${system.orbit.semiMajorAxis.scalar}, syspos: ${system.position}, ` +
                    `vsopCoord: ${vsopCoord}, delta: ${vsopCoord.x - x}, ${vsopCoord.y - y}, ${vsopCoord.z - z}`)
      }
      if (system.postAnimCb) {
        system.postAnimCb(system)
      }
    }

    system.children.forEach((child) => this.animateSystem(child))
  }


  /**
   * Lay the Moon's orbit line (Planet.newOrbit's flat ellipse, centred on
   * its parent) on its mean orbit of date: inclined about the node line,
   * the major axis toward the mean perigee, and shifted so Earth is at the
   * focus.  The Moon itself departs from this mean ellipse by up to a few
   * per cent (evection, variation).
   *
   * @param {Object3D} orbitPosition the Moon's orbitPosition
   */
  placeMoonOrbit(orbitPosition) {
    const {eccentricity, semiMajorAxis} = orbitPosition.orbit
    this.layOrbitShape(orbitPosition.orbitShape, this.moonOrbitQuat, semiMajorAxis.scalar, eccentricity)
  }


  /**
   * Place a body on its mean-element orbit (meanElements.js) at this
   * frame's date, relative to its primary, and lay its orbit line on the
   * same ellipse.  The elements are referred to J2000; the precession
   * rotation takes both to the scene's frame, of date.
   *
   * @param {Object3D} orbitPosition with `elements`
   * @returns {Vector3} the position, in the parent's (unrotated) frame
   */
  placeByElements(orbitPosition) {
    const q = this._orbitQuat
    const pos = this._orbitPos
    const {a, e} = orbitAt(orbitPosition.elements, this.jde, q, pos)
    q.premultiply(this.precession)
    pos.applyQuaternion(this.precession)
    this.layOrbitShape(orbitPosition.orbitShape, q, a, e)
    return pos
  }


  /**
   * Lay an orbit line (Planet.newOrbit's flat unit ellipse, centred on its
   * parent, major axis along +X, in the XZ plane) on an orbit: rotated by
   * quat, scaled to a, and shifted so the primary is at the focus.
   *
   * @param {Object3D} shape the orbit line's group, or undefined
   * @param {Quaternion} quat the orbit's orientation, pericentre along +X
   * @param {number} a semi-major axis, metres
   * @param {number} e eccentricity
   */
  layOrbitShape(shape, quat, a, e) {
    if (!shape) {
      return
    }
    shape.quaternion.copy(quat)
    shape.scale.setScalar(a)
    // Ellipse centre = focus - a·e toward pericentre.
    shape.position.copy(this._tmpVec.set(1, 0, 0).applyQuaternion(quat)).multiplyScalar(-a * e)
  }


  /**
   * Tilt a planetTilt node so its +Y, the body's north pole, points at the
   * body's IAU pole, of date.  Replaces Planet.load's rotateX(-obliquity),
   * which could only lean the pole toward ecliptic longitude 90°.  The
   * minimal rotation from +Y is used: the prime meridian is not modelled
   * yet (#96).
   *
   * @param {Object3D} planetTilt with `pole` ({ra, dec, raRate, decRate})
   */
  orientPole(planetTilt) {
    const pole = poleAt(planetTilt.pole, this.jde, this._tmpVec).applyQuaternion(this.precession)
    planetTilt.quaternion.setFromUnitVectors(this.Y_AXIS, pole)
  }
}


// Hack: initial vals until vsop loads
const ival = {x: 0, y: 0, z: 0}
let vsop87c = (_) => {
  return {
    mercury: ival,
    venus: ival,
    earth: ival,
    mars: ival,
    jupiter: ival,
    saturn: ival,
    uranus: ival,
    neptune: ival,
  }
}


loadVsop87c((v) => {
  vsop87c = v
})
