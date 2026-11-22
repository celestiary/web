/**
 * sRGB's transfer functions (IEC 61966-2-1), for colours computed on the
 * CPU (HDR.md, "Colour spaces"): the screen is sRGB, so a colour picked by
 * eye as it showed on the screen, or a texture's stored value, is decoded
 * to linear light before it lights or emits anything, and the atmosphere
 * pass encodes the frame at its end.
 */


/**
 * @param {number} linear
 * @returns {number} The sRGB value a display decodes back to it
 */
export function srgbEncode(linear) {
  const v = Math.max(linear, 0)
  return v <= 0.0031308 ? 12.92 * v : (1.055 * Math.pow(v, 1 / 2.4)) - 0.055
}


/**
 * @param {number} encoded An sRGB value, 0 to 1
 * @returns {number} Its linear light
 */
export function srgbDecode(encoded) {
  const v = Math.max(encoded, 0)
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}


/**
 * @param {Array<number>} rgb sRGB values
 * @returns {Array<number>} Linear
 */
export function decodeRgb(rgb) {
  return rgb.map(srgbDecode)
}
