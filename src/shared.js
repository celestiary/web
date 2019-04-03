import * as THREE from './lib/three.module.js';

// This size is chosen to allow for the maximum object and distance
// size range in the scene.  The smallest object in the scene is
// Mars's moon Deimos, which is 6.2E3 m.  The smallest size I found
// that three/webgl supports is 1E-4.  So rounding Deimos down to 1E3,
// and then dividing it down to the smallest size.

// Deimos size in meters.
const SMALLEST_REAL_SIZE = 1E3;
// Smallest renderable size.
const SMALLEST_RENDER_SIZE = 1E-4;
// SMALLEST_RENDER_SIZE / SMALLEST_REAL_SIZE = 1E-7, but can't use the
// calculation since it actually yields 1.0000000000000001e-7.
const LENGTH_SCALE = 1E-7;

// Additionally, when I hardcode LENGTH_SCALE to 1E-5, LOD starts to
// flake out when zoomed to small sizes, supporting the 1E-4 minimum.

export const
  twoPi = Math.PI * 2.0,
  halfPi = Math.PI / 2.0,
  toDeg = 180.0 / Math.PI,
  toRad = Math.PI / 180.0,

  lengthScale = LENGTH_SCALE,

  targetRefs = {
    targetObj: null,
    targetPos: new THREE.Vector3(),
    trackObj: null,
    followObj: null
  }
