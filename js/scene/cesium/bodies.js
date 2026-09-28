/* global __CESIUM_ION_TOKEN__ */
/**
 * Bodies the Cesium layer can render, and how.  See CESIUM.md.
 *
 * `radii` are Cesium's ellipsoid radii [x, y, z] in ECEF (z = polar).  The
 * stencil shell that marks where Cesium's pixels go is this ellipsoid,
 * scaled by `shellScale`: out to Cesium's sky atmosphere for Earth, and just
 * past the highest terrain for airless bodies.
 *
 * `atmosphere`: Cesium draws the body's atmosphere (Earth: its sky and
 * ground atmosphere), so celestiary's atmosphere pass stands down.  When
 * false and the body has an atmosphere in celestiary's data (Mars),
 * celestiary's pass runs over the Cesium layer instead.
 *
 * `ionTileset` bodies are Cesium ion 3D-tiles datasets rendered without
 * Cesium's globe; they need an ion access token, and without one they
 * aren't offered.
 */


/** Cesium's SkyAtmosphere outer shell is the ellipsoid scaled by 1.025. */
export const ATMOSPHERE_SHELL_SCALE = 1.025


/**
 * Show the layer control (and render an active Cesium layer) only within
 * this many body radii of the target body's centre.  At 20 radii the Earth
 * spans about 6° of a 45° field of view.
 */
export const LAYER_NEAR_RADII = 20


// Airless bodies: 1% of radius clears the Moon's highlands (~11 km) and
// Olympus Mons (~22 km above Mars's datum).
const TERRAIN_SHELL_SCALE = 1.01

export const CESIUM_BODIES = {
  earth: {
    ellipsoid: 'WGS84',
    radii: [6378137, 6378137, 6356752.314245179],
    atmosphere: true,
    shellScale: ATMOSPHERE_SHELL_SCALE,
  },
  moon: {
    ellipsoid: 'MOON',
    radii: [1737400, 1737400, 1737400],
    atmosphere: false,
    shellScale: TERRAIN_SHELL_SCALE,
    // Cesium Moon Terrain (ion).
    ionTileset: 2684829,
  },
  mars: {
    ellipsoid: 'MARS',
    radii: [3396190, 3396190, 3376200],
    atmosphere: false,
    shellScale: TERRAIN_SHELL_SCALE,
    // Cesium Mars (ion).
    ionTileset: 3644333,
  },
}


/**
 * The Cesium ion access token, from the build-time CESIUM_ION_TOKEN env var
 * (esbuild/common.js).  Empty when unset.
 *
 * @returns {string}
 */
export function ionToken() {
  return typeof __CESIUM_ION_TOKEN__ === 'string' ? __CESIUM_ION_TOKEN__ : ''
}


/**
 * @param {string} name Body name, e.g. 'earth'
 * @returns {boolean} Whether a Cesium layer can be offered for the body
 */
export function isCesiumBody(name) {
  if (!Object.hasOwn(CESIUM_BODIES, name)) {
    return false
  }
  return !CESIUM_BODIES[name].ionTileset || ionToken() !== ''
}
