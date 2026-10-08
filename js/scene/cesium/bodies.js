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
 * aren't offered.  That fork, globe or tileset, is the data's; everything
 * after it is one path for every body (CESIUM.md, architecture): each draws
 * its stored values × Lambert with its distance in alpha, and differs only
 * by the data here:
 *
 * - `textureGain`, `imageryScale`: the decode's scale for the body's
 *   imagery against celestiary's texture (CesiumLayers bodyGain).
 * - `nightImagery`: a globe's city lights, an imagery layer drawn in a
 *   pass of its own on the night side (CesiumLayers, CESIUM.md "Night
 *   lights"), not through Cesium's lighting, which would multiply them away.
 * - `nightFloor`: a tileset's light on its night side, as a fraction of
 *   full sun (sunlitShader); a globe's lighting is Cesium's.
 * - `earthshine`: the tileset's night side is lit by Earth's reflected
 *   light, from Earth's direction, at its level for Earth's phase
 *   (CesiumLayers._setEarthshine): the Moon's.
 * - `photometry`: 'lunar' lights the tileset by the lunar photometric
 *   function (lunarPhotometry.js), sunlight and earthshine alike; otherwise
 *   Lambert's law.
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
    // Celestiary's atmosphere pass, over Cesium's lit surface.
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
    // City lights: NASA GIBS's VIIRS Black Marble (the 2016 composite, NASA
    // Earth Observatory / Suomi NPP; public domain), the product celestiary's
    // own earth_night.jpg is cut from (Planet.md), so the two sides of the
    // swap show the same data.  WMTS, Web Mercator, levels 0-8 of 256 px
    // tiles (~600 m a pixel at the equator).  The VIIRS_CityLights_2012
    // layer is a JPEG of the older 2012 composite in a different stretch (a
    // European tile's median 32 of 255 against the Black Marble's 20, which
    // is celestiary's texture's), so it wouldn't match across the swap.
    nightImagery: {
      url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/' +
        'GoogleMapsCompatible_Level8/{z}/{y}/{x}.png',
      tileSize: 256,
      maximumLevel: 8,
      credit: 'NASA GIBS, VIIRS Black Marble (Suomi NPP)',
    },
  },
  moon: {
    ellipsoid: 'MOON',
    radii: [1737400, 1737400, 1737400],
    atmosphere: false,
    shellScale: TERRAIN_SHELL_SCALE,
    // Cesium Moon Terrain (ion).
    ionTileset: 2684829,
    // Its night side is lit by earthshine (sunlitShader, encoding.js
    // earthshineFraction: ~7e-5 of sunlight at a crescent, 1e-4 at new
    // Moon), not a floor: the 2% floor it had was ~300× that.
    nightFloor: 0,
    earthshine: true,
    // Lit by the lunar photometric function, as celestiary's Moon is
    // (lunarPhotometry.js; sunlitShader), not Lambert's law.
    photometry: 'lunar',
    // moon.json's texture_gain: celestiary's Moon is the same LRO WAC
    // mosaic, whose stored values are a linear stretch of I/F, scaled to the
    // Moon's normal albedo (lunarPhotometry.js MOON_TEXTURE_GAIN; Planet.md).
    textureGain: 0.4448,
    // ion's copy of the mosaic is stored darker than NASA Trek's, which
    // celestiary's texture is from: 0.815× (median over the lit disk, both
    // rendered alike, parity's moon-quarter at 1.000; Mars's two copies
    // measure 0.99×).  It was 0.78 fitted against celestiary's Moon with its
    // specular sheen (4.5% over the lit disc), which the lunar photometric
    // function replaced; 0.82 before that with the 2% night floor.
    imageryScale: 0.815,
  },
  mars: {
    ellipsoid: 'MARS',
    radii: [3396190, 3396190, 3376200],
    atmosphere: false,
    shellScale: TERRAIN_SHELL_SCALE,
    // Cesium Mars (ion).
    ionTileset: 3644333,
    nightFloor: 0.02,
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
