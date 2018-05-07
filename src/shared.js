'use strict';

const THREE = require('three');

const LENGTH_SCALE = 1E-5;

module.exports = {
  twoPi: Math.PI * 2.0,
  halfPi: Math.PI / 2.0,
  toDeg: 180.0 / Math.PI,
  toRad: Math.PI / 180.0,

  orbitScale: LENGTH_SCALE,
  radiusScale: LENGTH_SCALE,

  targetObj: null,
  targetObjLoc: new THREE.Matrix4,
  targetPos: new THREE.Vector3(),
};
