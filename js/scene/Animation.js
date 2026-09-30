import {Object3D, Quaternion, Vector3} from 'three'
import {loadVsop87c} from '../vsop'
import * as Shared from '../shared'
import debug from '../debug'
import {J2000_JD, gmstRad, precessionQuaternion, utcToTtJulianDay} from './celestialFrame.js'
import {moonArguments, moonOrientation, moonScenePosition} from './lunarTheory.js'
import {orbitAt, poleAt} from './meanElements.js'
import {
  JUPITER_SATURN_SAMPLES,
  OrbitPath,
  OrbitPaths,
  SUN_GM_M3_PER_DAY2,
  unitEllipse,
} from './orbitPath.js'


const SECONDS_PER_DAY = 86400

// The Moon's share of the Earth-Moon mass, 1 / (1 + M_Earth / M_Moon):
// Earth's wobble about the barycentre is this much of the Moon's position.
const MOON_MASS_FRACTION = 1 / (1 + 81.30056)

// A mean-element line's ellipse is redrawn when the eccentricity has
// drifted this much (Pluto's, by Standish's rates): b moves by e·Δe.
const ECCENTRICITY_REDRAW = 1e-6


/**
 * Animate scene, currently just orbits.  For major planets uses VSOP87C, and
 * for the Moon the truncated ELP-2000/82 of Meeus 47 (lunarTheory.js), both
 * in the mean ecliptic and equinox of date.  Pluto and the other moons
 * follow published mean elements (meanElements.js), referred to J2000 and
 * precessed to date here.  Bodies with a `pole` (IAU) are tilted to it.
 * The planets' and the Moon's orbit lines are their paths, sampled from
 * the same ephemerides (orbitPath.js); the other bodies' are their
 * mean-element ellipses of date.
 */
export default class Animation {
  /**
   * @param {object} time
   * @param {Function} [vsop] a VSOP87C function to use in place of the
   *     wasm one this module loads (tests)
   */
  constructor(time, vsop = null) {
    this.time = time
    this.vsop = vsop
    this.curVsopCoords = this.vsopAt(J2000_JD)
    this.Y_AXIS = new Vector3(0, 1, 0)
    // Per-frame Moon state, from updateMoon.
    this.moonPos = new Vector3
    this.moonQuat = new Quaternion
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
    // Orbit line rebuilds, run within a per-frame budget.
    this.orbitPaths = new OrbitPaths
  }


  /**
   * @param {number} jd Julian Day (UTC)
   * @returns {object} VSOP87C's heliocentric (x, y, z) of each planet, AU
   */
  vsopAt(jd) {
    return (this.vsop || vsop87c)(jd)
  }


  /** @returns {boolean} whether vsopAt gives real positions yet */
  vsopReady() {
    return this.vsop !== null || vsopLoaded
  }


  /** @param {object} scene */
  animate(scene) {
    this.time.updateTime()
    const jd = this.time.simTimeJulianDay()
    this.setDate(jd)
    this.animateSystem(scene)
    this.orbitPaths.pump()
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
    this.orbitPaths.pump()
  }


  /**
   * Everything animateSystem needs for a date, computed once per frame.
   *
   * @param {number} jd Julian Day (UTC)
   */
  setDate(jd) {
    this.jd = jd
    this.curVsopCoords = this.vsopAt(jd)
    this.jde = utcToTtJulianDay(jd)
    precessionQuaternion(J2000_JD, this.jde, this.precession)
    this.updateMoon(jd)
  }


  /**
   * The Moon's geocentric position and orientation for this frame.
   * Meeus's series is in TT; the simulation clock is UTC.
   *
   * @param {number} jd Julian Day (UTC)
   */
  updateMoon(jd) {
    const jde = utcToTtJulianDay(jd)
    const args = moonArguments(jde)
    moonScenePosition(jde, this.moonPos)
    moonOrientation(args, this.moonQuat)
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
        this.followPath(system)
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
        ({x, y, z} = vsopScene(vsopCoord, this._tmpVec))
        this.followPath(system)
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
   * Keep a planet's or the Moon's orbit line on its path: turn it from
   * J2000 to the date, show it only while its window holds the body, and
   * ask for a rebuild when the date has moved on (orbitPath.js).  Cheap
   * unless a rebuild is due, and the rebuild itself is left to
   * orbitPaths.pump.
   *
   * @param {Object3D} orbitPosition
   */
  followPath(orbitPosition) {
    const shape = orbitPosition.orbitShape
    if (!shape) {
      return
    }
    if (orbitPosition.orbitPath === undefined) {
      orbitPosition.orbitPath = this.newOrbitPath(orbitPosition)
    }
    const path = orbitPosition.orbitPath
    if (!path) {
      return
    }
    shape.quaternion.copy(this.precession)
    path.line.visible = path.covers(this.jd)
    if (path.isStale(this.jd) && (!path.usesVsop || this.vsopReady())) {
      this.orbitPaths.request(path, this.jd)
    }
  }


  /**
   * The OrbitPath for a planet's or the Moon's orbit line, sampling the
   * ephemeris its body is placed by.
   *
   * @param {Object3D} orbitPosition
   * @returns {OrbitPath|null} null if its orbit line isn't Planet.newOrbit's
   */
  newOrbitPath(orbitPosition) {
    const shape = orbitPosition.orbitShape
    const line = shape.line
    if (!line) {
      return null
    }
    // The samples are in metres, in the ecliptic of J2000, around the primary.
    shape.scale.setScalar(1)
    shape.position.set(0, 0, 0)
    line.visible = false
    const name = orbitPosition.name.split('.')[0]
    const periodDays = orbitPosition.orbit.siderealOrbitPeriod.scalar / SECONDS_PER_DAY
    const moonAt = (jd, target) => moonScenePosition(utcToTtJulianDay(jd), target)
    if (name === 'moon') {
      return new OrbitPath(line, {positionAt: moonAt, periodDays})
    }
    const planetAt = (jd, target) => vsopScene(this.vsopAt(jd)[name], target)
    const opts = {positionAt: planetAt, periodDays, mu: SUN_GM_M3_PER_DAY2}
    if (name === 'jupiter' || name === 'saturn') {
      opts.samples = JUPITER_SATURN_SAMPLES
    }
    if (name === 'earth') {
      // Earth's path is the Earth-Moon barycentre's, smooth enough for the
      // sparse samples, and its monthly wobble about it, per vertex.
      const moon = new Vector3
      opts.positionAt = (jd, target) => planetAt(jd, target).addScaledVector(moonAt(jd, moon), MOON_MASS_FRACTION)
      opts.offsetAt = (jd, target) => moonAt(jd, target).multiplyScalar(-MOON_MASS_FRACTION)
    }
    const path = new OrbitPath(line, opts)
    path.usesVsop = true
    return path
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
   * quat, scaled to a, and shifted so the primary is at the focus.  The
   * ellipse is redrawn if e has drifted from the one it was drawn for.
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
    const line = shape.line
    if (line && !(Math.abs(e - line.userData.e) < ECCENTRICITY_REDRAW)) {
      const attr = line.geometry.attributes.position
      unitEllipse(e, attr.array)
      attr.needsUpdate = true
      line.geometry.computeBoundingSphere()
      line.userData.e = e
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


/**
 * A VSOP87C position (heliocentric ecliptic of date, AU) in the scene's
 * axes, metres: scene (x, z, -y).
 *
 * @param {{x: number, y: number, z: number}} c
 * @param {Vector3} target
 * @returns {Vector3}
 */
function vsopScene(c, target) {
  const au = Shared.ASTRO_UNIT_METER
  return target.set(c.x * au, c.z * au, -c.y * au)
}


// Hack: initial vals until vsop loads
const ival = {x: 0, y: 0, z: 0}
let vsopLoaded = false
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
  vsopLoaded = true
})
