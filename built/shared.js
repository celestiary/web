import { Object3D, Vector3, } from 'three';
import { named } from './utils.js';
// This size is chosen to allow for the maximum object and distance
// size range in the scene.  The smallest object in the scene is
// Mars's moon Deimos, which is 6.2E3 m.  The smallest size I found
// that three/webgl supports is 1E-4.  So rounding Deimos down to 1E3,
// and then dividing it down to the smallest size.
// Deimos size in meters.
const SMALLEST_REAL_SIZE = 1E3;
// Smallest renderable size.
const SMALLEST_RENDER_SIZE = 1E-4;
export const FAR_OBJ = named(new Object3D, 'LODFarObj'); // for invisible LOD.
export const twoPi = Math.PI * 2.0;
export const halfPi = Math.PI / 2.0;
export const toDeg = 180.0 / Math.PI;
export const toRad = Math.PI / 180.0;
// When I hardcode LENGTH_SCALE to 1E-5, LOD starts to flake out
// when zoomed to small sizes, supporting the 1E-4 minimum.
// SMALLEST_RENDER_SIZE / SMALLEST_REAL_SIZE = 1E-7, but can't use
// the calculation since it actually yields 1.0000000000000001e-7.
export const LENGTH_SCALE = 1E-7;
export const STARS_SCALE = 9.461E12 * 1E3 * LENGTH_SCALE;
export const INITIAL_FOV = 45;
export const targets = {
    origin: new Vector3,
    cur: null,
    obj: null,
    pos: new Vector3,
    track: null,
    follow: null,
};
// Colors
export const labelTextColor = '#7fa0e0';
export const labelTextFont = 'medium arial';
