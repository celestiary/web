/**
 * How a tileset body's Cesium frame carries its light through Cesium's
 * 8-bit buffers (CESIUM.md, "Precision: a log encoding, and the Moon's
 * earthshine").
 *
 * A body's frame is its imagery's stored value × its light, 0 to 1, and
 * Cesium writes it to an 8-bit buffer (UNSIGNED_BYTE: its globe-depth
 * framebuffer with highDynamicRange off).  Linear, the dark side and the
 * terminator's last degrees of Sun got a few codes: the Moon's night side at
 * the old floor (0.02 × a stored value of ~0.3) was 1-2 of 255, and with
 * the crescent in frame the meter's gain and the decode lifted those codes
 * into flat, blotchy levels with black holes (#192, the user's screenshot
 * at 0.6°).  So a tileset's shader writes the log of the value instead,
 * over LOG_STOPS stops down from 1, with a dither of ±half a code, and the
 * decode inverts it: 12.75 codes a stop, a step of 5.6% at every level,
 * which the dither turns into noise under a display step.
 *
 * 20 stops: the floor, 2⁻²⁰ (9.5e-7), is under the darkest earthlit
 * maria (earthshine ~7e-5 of sunlight at this phase, over stored values of
 * 0.05-0.3, so 4e-6 to 2e-5).  A gamma or sRGB curve spends its codes at
 * the top: sqrt gives 1.5e-5 its first code, and sRGB's linear toe gives it
 * none.
 */


/** Stops from 1 down to the encoding's floor. */
export const LOG_STOPS = 20


/**
 * The encode, as the tileset's shader runs it (GLSL, for a Cesium
 * CustomShader): `cesiumLogEncode(value, gl_FragCoord.xy)` gives the 0-1
 * code to write; 0 stays 0.
 */
export const LOG_ENCODE_GLSL = `
float cesiumDither(vec2 p) {
  // Interleaved gradient noise (Jimenez 2014): -0.5 to 0.5.
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))) - 0.5;
}
vec3 cesiumLogEncode(vec3 v, vec2 fragCoord) {
  vec3 code = clamp(log2(max(v, vec3(1e-30))) / ${LOG_STOPS.toFixed(1)} + 1.0, 0.0, 1.0);
  code = code * 254.0 + 1.0 + cesiumDither(fragCoord);
  // 0 is black (under the floor); 1 to 255 the stops.
  return mix(clamp(code, 1.0, 255.0) / 255.0, vec3(0.0), vec3(lessThanEqual(v, vec3(0.0))));
}
`


/** The decode, in the composite's decode pass (GLSL): the code back to the value. */
export const LOG_DECODE_GLSL = `
vec3 cesiumLogDecode(vec3 code) {
  vec3 c = code * 255.0;
  vec3 v = exp2(((c - 1.0) / 254.0 - 1.0) * ${LOG_STOPS.toFixed(1)});
  return mix(v, vec3(0.0), vec3(lessThan(c, vec3(0.5))));
}
`


/**
 * The encode in JS, for tests: the 8-bit code a value is written as, with a
 * dither (−0.5 to 0.5).
 *
 * @param {number} v 0 to 1
 * @param {number} [dither]
 * @returns {number} 0 to 255
 */
export function logEncode(v, dither = 0) {
  if (!(v > 0)) {
    return 0
  }
  const code = Math.min(Math.max((Math.log2(v) / LOG_STOPS) + 1, 0), 1)
  return Math.round(Math.min(Math.max((code * 254) + 1 + dither, 1), 255))
}


/**
 * @param {number} code 0 to 255
 * @returns {number} The value
 */
export function logDecode(code) {
  if (code < 0.5) {
    return 0
  }
  return Math.pow(2, (((code - 1) / 254) - 1) * LOG_STOPS)
}


// Earthshine's level moved to the Moon's photometry, which both Moons' night
// sides go through; re-exported for the tileset's code.
export {EARTH_GEOMETRIC_ALBEDO, earthshineFraction} from '../lunarPhotometry.js'
