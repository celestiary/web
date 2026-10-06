/**
 * A star's surface noise seed (star-shaders.js), so each star has its own
 * granulation and spots, the same on every load and in the app and the guide.
 *
 * The seed is the star's Hipparcos id where it has one (Sol is 0), else a hash
 * of its name; the Sun by either name is 0 too.  Seed 0 is the unshifted
 * noise field.
 */

// The noise coordinates span up to ~+/-800 across a disc (granules); an offset up to this
// puts a star's patch well away from every other's, and is small enough for
// float32 to keep the noise's fine octaves (at 1e3, a step of 6e-5).
const OFFSET_RANGE = 1e3
// The active regions' threshold's base (star-shaders.js) and how far a seed moves it:
// a little more or less of the disc in spots, within what the Sun's own
// activity varies, not the type-dependent activity of a real star (#166).
export const SPOT_BIAS_BASE = 1.9
export const SPOT_BIAS_RANGE = 0.3


/**
 * @param {string} s
 * @returns {number} FNV-1a, 32 bit unsigned
 */
export function hashString(s) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}


/**
 * @param {number} x
 * @returns {number} A well-mixed 32 bit unsigned integer from x (lowbias32)
 */
function mix32(x) {
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d)
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b)
  return (x ^ (x >>> 16)) >>> 0
}


/**
 * @param {{hipId?: number, name?: string}} props A star's props
 * @returns {number} Its seed, an unsigned integer; 0 for the Sun
 */
export function starSeed(props) {
  const hip = props?.hipId
  if (Number.isInteger(hip) && hip >= 0) {
    return hip
  }
  const name = String(props?.name ?? '').trim().toLowerCase()
  if (name === '' || name === 'sun' || name === 'sol') {
    return 0
  }
  // Past the Hipparcos ids (118322 at most), so a name never takes a star's.
  return 0x10000000 + (hashString(name) & 0x0fffffff)
}


/**
 * @param {number} seed
 * @returns {{offset: number[], spotBias: number}} The shader's uniforms: the
 *   noise domain's offset, and the sunspot threshold.  A seed of 0 is the
 *   unshifted noise and the base threshold.
 */
export function seedUniforms(seed) {
  if (!seed) {
    return {offset: [0, 0, 0], spotBias: SPOT_BIAS_BASE}
  }
  const unit = (salt) => mix32(Math.imul(seed, 0x9e3779b1) ^ salt) / 4294967296
  return {
    offset: [unit(0x1234567), unit(0x2345678), unit(0x3456789)].map((u) => u * OFFSET_RANGE),
    spotBias: SPOT_BIAS_BASE + ((unit(0x456789a) - 0.5) * 2 * SPOT_BIAS_RANGE),
  }
}
