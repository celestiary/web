import {Vector3} from './lib/three.js/three.module.js';
import * as Shared from './shared.js';


// TODO: move this to scene.
export default class Animation {
  constructor(time) {
    this.time = time;
    this.Y_AXIS = new Vector3(0, 1, 0);
  }


  animate(scene) {
    this.time.updateTime();
    this.animateSystem(scene, this.time.simTime / 1000);
  }


  /**
   * Recursive animation of orbits and rotations at the current time.
   * @param {!Object3D} system
   */
  animateSystem(system, simTimeSecs) {
    if (system.preAnimCb) {
      system.preAnimCb(this.time);
    }
    if (system.siderealRotationPeriod) {
      // TODO(pablo): this is hand-calibrated for Earth and so is
      // incorrect for the other planets.  Earth Orientation Parameters
      // are here:
      //
      //   http://hpiers.obspm.fr/eop-pc/index.php?index=orientation
      //
      // and also would also need them for the other planets.
      const angle = 1.5 * Math.PI + simTimeSecs / 86400 * Shared.twoPi;
      system.setRotationFromAxisAngle(this.Y_AXIS, angle);
    }

    // This is referred to by a comment in scene.js#addOrbitingPlanet.
    if (system.orbit) {
      const eccentricity = system.orbit.eccentricity;
      const aRadius = system.orbit.semiMajorAxis * Shared.LENGTH_SCALE;
      const bRadius = aRadius * Math.sqrt(1.0 - Math.pow(eccentricity, 2.0));
      // -1.0 because orbits are counter-clockwise when viewed from above North of Earth.
      const angle = -1.0 * simTimeSecs / system.orbit.siderealOrbitPeriod * Shared.twoPi;
      const x = aRadius * Math.cos(angle);
      const y = 0;
      const z = bRadius * Math.sin(angle);
      //console.log(`${eccentricity} ${aRadius} ${bRadius} ${simTimeSecs} ${system.orbit.siderealOrbitPeriod}`);
      system.position.set(x, y, z);
      if (system.postAnimCb) {
        system.postAnimCb(system);
      }
    }

    for (const ndx in system.children) {
      const child = system.children[ndx];
      this.animateSystem(child, simTimeSecs);
    }
  }
}
