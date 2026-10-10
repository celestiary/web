/**
 * IEEE 754 half precision (binary16), for the tiles' velocities
 * (tileFormat.js): 1 sign bit, 5 exponent bits, 10 mantissa bits, so a
 * relative precision of 2^-11 (0.05%) from 6.1e-5 to 65,504.  A star's
 * space velocity in km/s, 1 to 1,000, sits well inside that, and the GPU
 * reads the array as it is (three's Float16BufferAttribute).
 */


const F32 = new Float32Array(1)
const U32 = new Uint32Array(F32.buffer)


/**
 * Round to nearest even.
 *
 * @param {number} value
 * @returns {number} The half's bits, 0..65535
 */
export function toHalf(value) {
  F32[0] = value
  const x = U32[0]
  const sign = (x >>> 16) & 0x8000
  const exp = (x >>> 23) & 0xff
  let mant = x & 0x7fffff
  if (exp === 0xff) {
    // Inf or NaN.
    return sign | 0x7c00 | (mant ? 0x200 : 0)
  }
  const e = exp - 127 + 15
  if (e >= 0x1f) {
    return sign | 0x7c00
  }
  if (e <= 0) {
    if (e < -10) {
      return sign
    }
    // Subnormal: shift the mantissa, with its hidden bit, into place.
    mant |= 0x800000
    const shift = 14 - e
    const half = mant >>> shift
    const rem = mant & ((1 << shift) - 1)
    const mid = 1 << (shift - 1)
    const rounded = (rem > mid || (rem === mid && (half & 1))) ? half + 1 : half
    return sign | rounded
  }
  const half = mant >>> 13
  const rem = mant & 0x1fff
  let out = (e << 10) | half
  if (rem > 0x1000 || (rem === 0x1000 && (half & 1))) {
    // A carry out of the mantissa steps the exponent, to Inf at the top.
    out += 1
  }
  return sign | out
}


/**
 * @param {number} bits 0..65535
 * @returns {number}
 */
export function fromHalf(bits) {
  const sign = (bits & 0x8000) ? -1 : 1
  const exp = (bits >>> 10) & 0x1f
  const mant = bits & 0x3ff
  if (exp === 0) {
    return sign * mant * (2 ** -24)
  }
  if (exp === 0x1f) {
    return mant ? NaN : sign * Infinity
  }
  return sign * (1 + (mant / 1024)) * (2 ** (exp - 15))
}
