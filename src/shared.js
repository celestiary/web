'use strict';

const THREE = require('three');

const ORBIT_SCALE_NORMAL = 1E-7;

module.exports = {
  twoPi: Math.PI * 2.0,
  halfPi: Math.PI / 2.0,
  toDeg: 180.0 / Math.PI,
  toRad: Math.PI / 180.0,

  orbitScale: ORBIT_SCALE_NORMAL,

  targetObj: null,
  targetObjLoc: new THREE.Matrix4,
  targetPos: new THREE.Vector3(),
};
