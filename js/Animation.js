import {Object3D, Vector3} from 'three'
import vsop87cLoader from 'vsop87/dist/vsop87c-wasm'
import * as Shared from './shared.js'


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
vsop87cLoader.then((v) => {
  console.log('VSOP Loaded!')
  vsop87c = v
})


// TODO: move this to scene.
/** */
export default class Animation {
  /** @param {object} time */
  constructor(time) {
    this.time = time
    this.vsopCoords = vsop87c('ignored')
    this.Y_AXIS = new Vector3(0, 1, 0)
  }


  /** @param {object} scene */
  animate(scene) {
    this.time.updateTime()
    // https://en.wikipedia.org/wiki/Julian_day
    // unixTimeSecs = (JD − 2440587.5) × 86400
    // unixTimeSecs / 86400 + 2440587.5 = JD
    const unixTimeSecs = this.time.simTime / 1000
    const JD = (unixTimeSecs / 86400) + 2440587.5
    // console.log(jTime)
    this.vsopCoords = vsop87c(JD)
    this.animateSystem(scene, JD)
  }


  /**
   * Recursive animation of orbits and rotations at the current time.
   *
   * @param {!Object3D} system
   */
  animateSystem(system, simTimeSecs) {
    if (system.preAnimCb) {
      system.preAnimCb(this.time)
    }
    if (system.siderealRotationPeriod) {
      // TODO(pablo): this is hand-calibrated for Earth and so is
      // incorrect for the other planets.  Earth Orientation Parameters
      // are here:
      //
      //   http://hpiers.obspm.fr/eop-pc/index.php?index=orientation
      //
      // and also would also need them for the other planets.
      const angle = (1.5 * Math.PI) + ((simTimeSecs / 86400) * Shared.twoPi)
      system.setRotationFromAxisAngle(this.Y_AXIS, angle)
    }

    // This is referred to by a comment in scene.js#addOrbitingPlanet.
    if (system.orbit) {
      // Get an object with the (x,y,z) coordinates of each planet.
      // console.log('LOOKUP vsop for, in', sysName, vsopCoords)
      const sysName = system.name.split('.')[0]
      const vCoord = this.vsopCoords[sysName]
      let x, y, z
      if (vCoord === undefined) {
        const eccentricity = system.orbit.eccentricity
        const aRadius = system.orbit.semiMajorAxis.scalar * Shared.LENGTH_SCALE
        const bRadius = aRadius * Math.sqrt(1.0 - Math.pow(eccentricity, 2.0))
        // -1.0 because orbits are counter-clockwise when viewed from above North of Earth.
        const angle = -1.0 * simTimeSecs / system.orbit.siderealOrbitPeriod.scalar * Shared.twoPi
        // console.log(`${eccentricity} ${aRadius} ${bRadius} ${simTimeSecs} ${system.orbit.siderealOrbitPeriod}`);
        x = aRadius * Math.cos(angle)
        y = 0
        z = bRadius * Math.sin(angle)
      } else {
        const scale = 14959.789999 // TODO: Earth's semiMajorAxis * LENGTH_SCALE
        x = vCoord.x * scale
        y = vCoord.z * scale
        z = vCoord.y * scale
      }
      system.position.set(x, y, z)
      if (sysName === 'earth') {
        // console.log('SMA: ', system.orbit.semiMajorAxis.scalar, 'syspos: ', system.position, 'vCoord: ', vCoord, 'delta: ', vCoord.x - x, vCoord.y - y, vCoord.z - z)
      }
      // console.log(sysName, ': ', system.position)
      if (system.postAnimCb) {
        system.postAnimCb(system)
      }
    }

    for (const ndx in system.children) {
      if (!Object.prototype.hasOwnProperty.call(system.children, ndx)) {
        continue
      }
      const child = system.children[ndx]
      this.animateSystem(child, simTimeSecs)
    }
  }
}
