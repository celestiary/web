import {MAX_DISPLAY, START_COMPRESSION, TOE_END, TOE_OFFSET, neutral} from './neutral.js'
import {srgbDecode, srgbEncode} from './srgb.js'


/**
 * The output transform for a grey, scene value to screen value and back
 * (HDR.md, "Colour spaces", "Calibrated on the screen").  A screen value is
 * what the frame writes, sRGB-encoded, and so the light the display emits:
 * S(v) = srgbEncode(N(v)), N the tone map (PBR Neutral), v in exposure
 * units.  Every threshold the star field and the eye's response are
 * calibrated on is a screen value, named as one (instrument.js
 * LIMIT_SCREEN, eye.js SCREEN_STEP), and its scene value is derived here,
 * so a change of the output transform re-derives them all.  Until the
 * atmosphere pass encoded the frame (ccb58876) S was N alone.
 */


/** The screen's least step: one of 255. */
export const SCREEN_STEP = 1 / 255


/**
 * @param {number} v A grey's scene value, exposure units
 * @returns {number} Its screen value, 0 to 1
 */
export function screenOf(v) {
  return srgbEncode(neutral([v, v, v])[0])
}


/**
 * @param {number} screen A grey's screen value, 0 to 1
 * @returns {number} The scene value that shows as it (screenOf's inverse)
 */
export function sceneOfScreen(screen) {
  // neutralInverse for a grey, which its shoulder's mix toward white leaves
  // grey: shorter, and the first load needs no more of it.
  const n = srgbDecode(Math.min(Math.max(screen, 0), 1))
  const d = 1 - START_COMPRESSION
  const c = n < START_COMPRESSION ? n : START_COMPRESSION - d + (d * d / (1 - Math.min(n, MAX_DISPLAY)))
  return c + (c >= TOE_OFFSET ? TOE_OFFSET : (0.4 * Math.sqrt(c)) - c)
}


/**
 * @param {number} v A grey's scene value, exposure units
 * @returns {number} dS/dv there, the screen's change per unit of scene value
 */
export function screenSlope(v) {
  const x = Math.max(v, 0)
  let dn
  if (x < TOE_END) {
    // N = x - (x - 6.25x²) = 6.25x²
    dn = 2 * (TOE_OFFSET / (TOE_END * TOE_END)) * x
  } else if (x - TOE_OFFSET < START_COMPRESSION) {
    dn = 1
  } else {
    // A grey's shoulder: N = 1 - d² / (p + d - s), p = x - 0.04
    const d = 1 - START_COMPRESSION
    const q = x - TOE_OFFSET + d - START_COMPRESSION
    dn = d * d / (q * q)
  }
  const n = neutral([x, x, x])[0]
  const de = n <= 0.0031308 ? 12.92 : 1.055 / 2.4 * Math.pow(n, (1 / 2.4) - 1)
  return de * dn
}
