import {Object3D, Quaternion, Vector3} from 'three'
import {loadVsop87c} from '../vsop'
import * as Shared from '../shared'
import debug from '../debug'
import {J2000_JD, gmstRad, precessionQuaternion, utcToTtJulianDay} from './celestialFrame.js'
import {moonScenePosition} from './lunarTheory.js'
import {BodyLine, fineSteps} from './bodyLine.js'
import {equatorQuaternion, poleAndMeridian, textureTurn} from './iauRotation.js'
import {orbitAt} from './meanElements.js'
import {
  JUPITER_SATURN_SAMPLES,
  ORBIT_LINE_POINTS,
  OrbitPath,
  OrbitPaths,
  SUN_GM_M3_PER_DAY2,
  unitEllipse,
} from './orbitPath.js'


const SECONDS_PER_DAY = 86400

// The Moon's share of the Earth-Moon mass, 1 / (1 + M_Earth / M_Moon):
// Earth's wobble about the barycentre is this much of the Moon's position.
const MOON_MASS_FRACTION = 1 / (1 + 81.30056)

// A mean-element line's ellipse is redrawn when its eccentricity has
// drifted (Pluto's, by Standish's rates) enough to move it by this much of
// the body's radius: b moves by a·e·Δe.
const ECCENTRICITY_REDRAW_RADII = 1e-4
const TWO_PI = 2 * Math.PI


/**
 * Animate scene, currently just orbits.  For major planets uses VSOP87C, and
 * for the Moon the truncated ELP-2000/82 of Meeus 47 (lunarTheory.js), both
 * in the mean ecliptic and equinox of date.  Pluto and the other moons
 * follow published mean elements (meanElements.js), referred to J2000 and
 * precessed to date here.  Every body but Earth (GMST) is turned to its IAU
 * WGCCRE pole and prime meridian (iauRotation.js).
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
    // Per-frame Moon position, from updateMoon.
    this.moonPos = new Vector3
    this._tmpVec = new Vector3
    // Per-frame date state, from setDate: the Julian Day of the last
    // animate / animateAtJD, the same in TT, and the rotation from the
    // ecliptic of J2000 (mean elements, IAU poles) to the scene's, of date.
    this.jd = null
    this.jde = J2000_JD
    this.precession = new Quaternion
    this._orbitQuat = new Quaternion
    this._orbitPos = new Vector3
    this._lineBody = new Vector3
    this._invQuat = new Quaternion
    // A body's pole and meridian, from poleAndMeridian.
    this._pm = {ra: 0, dec: 0, w: 0}
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
    // Time clamps the date to where the ephemerides hold; this is a
    // second line of defence, so nothing is placed at NaN.
    if (!Number.isFinite(jd)) {
      return
    }
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
    if (!Number.isFinite(jd)) {
      return
    }
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
   * The Moon's geocentric position for this frame.  Meeus's series is in
   * TT; the simulation clock is UTC.  Its orientation is the IAU model's,
   * like every body's but Earth's.
   *
   * @param {number} jd Julian Day (UTC)
   */
  updateMoon(jd) {
    moonScenePosition(utcToTtJulianDay(jd), this.moonPos)
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

    if (system.poleModel) {
      this.orientPole(system)
    }

    if (system.siderealRotationPeriod || system.meridianModel) {
      // Spin about the body's local +Y, its pole as planetTilt has it, so
      // that +X, the prime meridian, is where its rotation model says.
      const name = system.props && system.props.name
      if (name === 'earth') {
        // Greenwich Mean Sidereal Time: planetTilt's rotateX(-ε) leaves +X
        // at the equinox of date on the equator, so a turn by GMST puts
        // Greenwich at its right ascension (iauRotation.test.js checks it
        // against the IAU model and Horizons).
        system.setRotationFromAxisAngle(this.Y_AXIS, gmstRad(this.time.simTimeJulianDay()))
      } else if (system.meridianModel) {
        // The IAU prime meridian W, measured from the equator's node,
        // which planetTilt's +X points at (orientPole).
        const w = poleAndMeridian(system.meridianModel, this.jde, this._pm).w
        system.setRotationFromAxisAngle(this.Y_AXIS, w * Shared.toRad)
        if (system.surface && system.textureRotation) {
          system.surface.rotation.y = textureTurn(system.textureRotation, this.jde, w) * Shared.toRad
        }
      } else {
        // No model (only the demo descriptors): a turn per sidereal
        // period, from an arbitrary meridian.
        const period = system.siderealRotationPeriod.scalar ?? system.siderealRotationPeriod
        system.setRotationFromAxisAngle(this.Y_AXIS, Shared.twoPi * ((this.time.simTimeSecs() / period) % 1))
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
      // Never a non-finite position: keep the last good one.
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        system.position.set(x, y, z)
        this.lineThroughBody(system)
      }
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
   * J2000 to the date, and ask for a rebuild when the date has moved on
   * (orbitPath.js).  The line stays drawn meanwhile, even when its window
   * no longer holds the body: an orbit's shape changes slowly, and hiding
   * it made it flicker at high time rates.  Cheap unless a rebuild is due,
   * and the rebuild itself is left to orbitPaths.pump.
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
    if (path.isStale(this.jd) && (!path.usesVsop || this.vsopReady())) {
      this.orbitPaths.request(path, this.jd)
    }
  }


  /**
   * Keep a body's orbit line through its centre close up: the fine arc and
   * origin around the body (bodyLine.js).  For a sampled path, in the
   * line's frame (the ecliptic of J2000, turned by this.precession); for a
   * mean-element ellipse, in its unit ellipse's.
   *
   * @param {Object3D} orbitPosition just placed
   */
  lineThroughBody(orbitPosition) {
    const radius = orbitPosition.bodyRadius
    const shape = orbitPosition.orbitShape
    if (!(radius > 0) || !shape) {
      return
    }
    const body = this._lineBody.copy(orbitPosition.position)
    const path = orbitPosition.orbitPath
    if (path) {
      path.follow(this.jd, body.applyQuaternion(this._invQuat.copy(this.precession).invert()))
      return
    }
    const bodyLine = shape.bodyLine
    if (bodyLine) {
      // Into the unit ellipse's frame: undo layOrbitShape's shift,
      // rotation and scale.
      const a = shape.scale.x
      body.sub(shape.position).applyQuaternion(this._invQuat.copy(shape.quaternion).invert()).divideScalar(a)
      const e = bodyLine.e
      const E = Math.atan2(body.z / Math.sqrt(1 - (e * e)), body.x)
      bodyLine.follow(body, (((E / TWO_PI) + 1) % 1) * (bodyLine.n - 1), radius / a)
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
    // Until its first build: the unit ellipse isn't this path.
    line.visible = false
    const name = orbitPosition.name.split('.')[0]
    const periodDays = orbitPosition.orbit.siderealOrbitPeriod.scalar / SECONDS_PER_DAY
    const moonAt = (jd, target) => moonScenePosition(utcToTtJulianDay(jd), target)
    // For the fine arc around the body.
    const size = {
      a: orbitPosition.orbit.semiMajorAxis.scalar,
      e: orbitPosition.orbit.eccentricity || 0,
      radius: orbitPosition.bodyRadius || 0,
    }
    if (name === 'moon') {
      return new OrbitPath(line, {positionAt: moonAt, periodDays, ...size})
    }
    const planetAt = (jd, target) => vsopScene(this.vsopAt(jd)[name], target)
    const opts = {positionAt: planetAt, periodDays, mu: SUN_GM_M3_PER_DAY2, ...size}
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
    this.layOrbitShape(orbitPosition.orbitShape, q, a, e, orbitPosition.bodyRadius)
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
   * @param {number} [radius] the body's, metres: the line is drawn through
   *     its centre to a small fraction of it (bodyLine.js)
   */
  layOrbitShape(shape, quat, a, e, radius = 0) {
    if (!shape) {
      return
    }
    const line = shape.line
    if (line) {
      if (!shape.bodyLine) {
        shape.bodyLine = new BodyLine(line, {n: ORBIT_LINE_POINTS, closed: true})
        shape.bodyLine.e = NaN
      }
      const bodyLine = shape.bodyLine
      const redraw = radius > 0 ? ECCENTRICITY_REDRAW_RADII * radius / (a * Math.max(e, 1e-3)) : 1e-6
      if (!(Math.abs(e - bodyLine.e) < redraw)) {
        const b = Math.sqrt(1 - (e * e))
        const curve = {
          at: (u, target) => {
            const E = TWO_PI * u / (ORBIT_LINE_POINTS - 1)
            return target.set(Math.cos(E), 0, b * Math.sin(E))
          },
          correct: false,
        }
        const steps = radius > 0 ? fineSteps(a, e, radius, ORBIT_LINE_POINTS) : 1
        bodyLine.setCoarse(unitEllipse(e, new Float64Array(3 * ORBIT_LINE_POINTS)), curve, steps, bodyLine.origin)
        bodyLine.e = e
      }
    }
    shape.quaternion.copy(quat)
    shape.scale.setScalar(a)
    // Ellipse centre = focus - a·e toward pericentre.
    shape.position.copy(this._tmpVec.set(1, 0, 0).applyQuaternion(quat)).multiplyScalar(-a * e)
  }


  /**
   * Turn a planetTilt node to the plane of the body's equator: +Y, the
   * body's north pole, at its IAU pole, and +X at the ascending node of its
   * equator on the ICRF equator, where the prime meridian W is measured
   * from; both of date.  Replaces Planet.load's rotateX(-obliquity), which
   * could only lean a pole toward ecliptic longitude 90°.  The spun node
   * below it turns by W.
   *
   * @param {Object3D} planetTilt with `poleModel` (iauRotation.js)
   */
  orientPole(planetTilt) {
    const pm = poleAndMeridian(planetTilt.poleModel, this.jde, this._pm)
    equatorQuaternion(pm, planetTilt.quaternion).premultiply(this.precession)
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
