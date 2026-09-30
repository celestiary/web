/* global __CESIUM_ION_TOKEN__ */
/**
 * Bodies the Cesium layer can render, and how.  See CESIUM.md.
 *
 * `radii` are Cesium's ellipsoid radii [x, y, z] in ECEF (z = polar).  The
 * stencil shell that marks where Cesium's pixels go is this ellipsoid,
 * scaled by `shellScale`: out to Cesium's sky atmosphere for a body that draws
 * it (`atmosphere`), and just past the highest terrain otherwise.
 *
 * `atmosphere`: Cesium draws the body's atmosphere (its sky and ground
 * atmosphere), so celestiary's atmosphere pass stands down.  When false and
 * the body has an atmosphere in celestiary's data (Earth, Mars),
 * celestiary's pass runs over the Cesium layer instead: one atmosphere, in
 * celestiary's units, on both sides of the swap (js/scene/HDR.md).
 *
 * `ionTileset` bodies are Cesium ion 3D-tiles datasets rendered without
 * Cesium's globe; they need an ion access token, and without one they
 * aren't offered.
 */


/**
 * Cesium's SkyAtmosphere outer shell is the ellipsoid scaled by 1.025: the
 * shell for a body with `atmosphere: true`.
 */
export const ATMOSPHERE_SHELL_SCALE = 1.025


// Past the terrain: 1% of radius clears Everest (~9 km), the Moon's highlands (~11 km) and
// Olympus Mons (~22 km above Mars's datum).
const TERRAIN_SHELL_SCALE = 1.01

export const CESIUM_BODIES = {
  earth: {
    ellipsoid: 'WGS84',
    radii: [6378137, 6378137, 6356752.314245179],
    // Celestiary's atmosphere pass, over Cesium's lit surface (cesiumOutput).
    atmosphere: false,
    shellScale: TERRAIN_SHELL_SCALE,
    // The globe's base imagery, the simulation date's month: tiles cut from
    // the Blue Marble mosaics celestiary's own Earth texture is from
    // (earth.json texture_monthly), so the two match across the swap.
    // Geographic tiling, 512 px tiles, levels 0-3 (8192 x 4096 at 3).
    monthlyImagery: {
      url: 'textures/earth/blue-marble/2004-{MM}/{z}/{x}/{y}.jpg',
      tileSize: 512,
      maximumLevel: 3,
      credit: 'Blue Marble Next Generation: NASA Earth Observatory',
    },
    // ion's world imagery (Bing) takes over from this globe tile level,
    // where the base's ~5 km texels would show (an 8192-texel-wide base is
    // sharp through level 4 of 256-texel tiles).
    detailFromLevel: 5,
  },
  moon: {
    ellipsoid: 'MOON',
    radii: [1737400, 1737400, 1737400],
    atmosphere: false,
    shellScale: TERRAIN_SHELL_SCALE,
    // Cesium Moon Terrain (ion).
    ionTileset: 2684829,
    // moon.json's texture_gain: celestiary's Moon is the same LRO WAC
    // mosaic, scaled (Planet.md).
    textureGain: 1.3,
    // ion's copy of the mosaic is stored darker than NASA Trek's, which
    // celestiary's texture is from: 0.82× (median over the lit disk, both
    // rendered alike; Mars's two copies measure 0.99×).
    imageryScale: 0.82,
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
 * What a body's Cesium frame holds, for CesiumLayers to bring into its
 * scene buffer (js/scene/HDR.md, "Cesium in the same units"):
 *
 * - 'display': display values, PBR Neutral applied.  The ion tilesets (Moon,
 *   Mars), lit by sunlitShader, and a globe that draws its own atmosphere
 *   (Cesium's own look).
 * - 'albedo': a globe under celestiary's atmosphere (Earth): lit imagery,
 *   stored value × Lambert, which is at most 1, before DISPLAY_GAIN.
 *
 * @param {string} name
 * @returns {string} 'display' or 'albedo'
 */
export function cesiumOutput(name) {
  const config = CESIUM_BODIES[name]
  return config && !config.ionTileset && !config.atmosphere ? 'albedo' : 'display'
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
