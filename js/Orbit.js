import {Object3D, Vector3} from './lib/three.js/three.module.js';

import * as Shapes from './shapes.js';
import {toRad} from './shared.js';
import {named} from './utils.js';
import {addAndOrient} from './scene_utils.js';


export default class Orbit extends Object3D {
  constructor(props) {
    super();
    /** The passed props. */
    this.props = props;
    this.propsReified = {
      siderealOrbitPeriod: props.siderealOrbitPeriod.scalar,
      ecc: props.eccentricity,
      inc: props.inclination * toRad,
      loan: props.longitudeOfAscendingNode * toRad,
      lop: props.longitudeOfPericenter * toRad,
      meanLon: props.meanLongitude * toRad,
      radius: props.semiMajorAxis.scalar
    };
    this.init(this.propsReified);
  }


  init(orbit) {
    const referencePlane = addFrame(this, 'referencePlane');
    referencePlane.rotation.x = -Math.PI / 2; // Flat on XZ

    const eclipticPlane = addFrame(referencePlane, 'eclipticPlane');
    eclipticPlane.rotation.z = orbit.loan;

    const orbitalPlane = addFrame(eclipticPlane, 'orbitalPlane');
    orbitalPlane.rotation.x = orbit.inc;

    // TODO: redundant plane of orbitalPlane
    const periPlane = addFrame(orbitalPlane, 'periPlane');
    periPlane.rotation.z = orbit.lop;

    /*
    const meanAnomaly = orbit.meanLongitude - orbit.longitudeOfPericenter - loan;
    let anomaly;
    orbitalPlane.add(anomaly = Shapes.angle(meanAnomaly, null, null, true));
    */
    this.orbiterCenter = periPlane;
  }


  addOrbiter(obj) {
    this.orbiterCenter.add(obj);
  }
}


function addFrame(parent, name) {
  const frame = named(new Object3D(), name);
  parent.add(frame);
  return frame;
}
