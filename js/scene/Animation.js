import {Object3D, Vector3} from 'three'
import {gmstRad} from './celestialFrame.js'
import {loadVsop87c} from '../vsop'
import * as Shared from '../shared'
import debug from '../debug'


/**
 * Animate scene, currently just orbits.  For major planets Uses vsop87. For
 * Pluto and moons, uses a (very incorrect) elliptical orbit based on orbital
 * params.
 */
export default class Animation {
  /** @param {object} time */
  constructor(time) {
    this.time = time
    this.curVsopCoords = vsop87c('ignored')
    this.Y_AXIS = new Vector3(0, 1, 0)
  }


  /** @param {object} scene */
  animate(scene) {
    this.time.updateTime()
    const jd = this.time.simTimeJulianDay()
    this.curVsopCoords = vsop87c(jd)
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
    this.curVsopCoords = vsop87c(jd)
    this.animateSystem(scene)
  }


  /**
   * Recursive animation of orbits and rotations at the current time.
   *
   * @param {!Object3D} system
   */
  animateSystem(system) {
    if (system.preAnimCb) {
      system.preAnimCb(this.time)
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
      let angle
      if (system.props && system.props.name === 'earth') {
        angle = gmstRad(this.time.simTimeJulianDay())
      } else {
        angle = Math.PI + (this.time.simTimeDays() * Shared.twoPi)
      }
      system.setRotationFromAxisAngle(this.Y_AXIS, angle)
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
      if (vsopCoord === undefined) {
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
