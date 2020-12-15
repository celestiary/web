import {Euler} from './lib/three.js/three.module.mjs';

import {LENGTH_SCALE} from './shared.mjs';


function testPlanetProps(planetName) {
  const props = {
    type: 'planet',
    name: planetName,
    radius: {scalar: 1 / LENGTH_SCALE},
    axialInclination: 0,
    texture_atmosphere: true,
    texture_hydrosphere: true,
    texture_terrain: true,
    orbit: {
      eccentricity: 0,
      inclination: 0,
      longitudeOfPerihelion: 0,
      semiMajorAxis: 1 / LENGTH_SCALE,
    }
  };
  return props;
}


function rotateEuler(obj, opts) {
  opts = opts || { x: 0, rotY: 0, rotZ: 0 };
  obj.applyEuler(new Euler(opts.x || 0, opts.y || 0))
}


function rotate(obj, opts) {
  opts = opts || { x: 0, y: 0, z: 0 };
  if (opts.x) { obj.rotateX(opts.x); }
  if (opts.y) { obj.rotateY(opts.y); }
  if (opts.z) { obj.rotateZ(opts.z); }
}


function addAndOrient(parent, child, opts) {
  parent.add(child);
  rotate(child, {x: opts.rotX || 0, y: opts.rotY || 0, z: opts.rotZ || 0});
  return child;
}


export {
  addAndOrient,
  rotate,
  rotateEuler,
  testPlanetProps,
}
