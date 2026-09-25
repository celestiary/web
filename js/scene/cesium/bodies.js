/**
 * Bodies the Cesium layer can render, and how.  See CESIUM.md.
 *
 * `radii` are Cesium's ellipsoid radii [x, y, z] in ECEF (z = polar).  The
 * stencil shell that marks where Cesium's pixels go is this ellipsoid,
 * scaled out by ATMOSPHERE_SHELL_SCALE to include Cesium's sky atmosphere.
 */


/** Cesium's SkyAtmosphere outer shell is the ellipsoid scaled by 1.025. */
export const ATMOSPHERE_SHELL_SCALE = 1.025


/**
 * Show the layer control (and render an active Cesium layer) only within
 * this many body radii of the target body's centre.  At 20 radii the Earth
 * spans about 6° of a 45° field of view.
 */
export const LAYER_NEAR_RADII = 20


export const CESIUM_BODIES = {
  earth: {
    ellipsoid: 'WGS84',
    radii: [6378137, 6378137, 6356752.314245179],
    atmosphere: true,
  },
}


/**
 * @param {string} name Body name, e.g. 'earth'
 * @returns {boolean}
 */
export function isCesiumBody(name) {
  return Object.hasOwn(CESIUM_BODIES, name)
}
