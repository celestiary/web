/**
 * Deterministic randomness for the Sun's events (js/scene/Sun.md): each
 * time bin's events come from a generator seeded by the bin's index and
 * the star's seed, so any date's Sun is the same in every session and a
 * permalink reproduces it, with no history to replay.
 */


/**
 * A 32-bit integer hash of two integers (the murmur3 finaliser over a
 * mix of both).
 *
 * @param {number} a
 * @param {number} b
 * @returns {number} unsigned 32-bit
 */
export function hash2(a, b) {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x7f4a7c15, 0x85ebca77)) >>> 0
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}


/**
 * Mulberry32: a small, fast generator of uniform numbers in [0, 1).
 *
 * @param {number} seed unsigned 32-bit
 * @returns {function(): number}
 */
export function generator(seed) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}


/**
 * @param {number} bin A time bin's index
 * @param {number} seed The star's
 * @param {number} stream Which kind of event (regions, flares, ...)
 * @returns {function(): number}
 */
export function binGenerator(bin, seed, stream) {
  return generator(hash2(hash2(bin, stream), seed))
}


/**
 * A Poisson draw (Knuth's, for the small means here; a normal
 * approximation past 30).
 *
 * @param {number} mean
 * @param {function(): number} rng
 * @returns {number}
 */
export function poisson(mean, rng) {
  if (!(mean > 0)) {
    return 0
  }
  if (mean > 30) {
    return Math.max(0, Math.round(mean + (Math.sqrt(mean) * gaussian(rng))))
  }
  const limit = Math.exp(-mean)
  let k = 0
  let p = rng()
  while (p > limit) {
    k++
    p *= rng()
  }
  return k
}


/**
 * @param {function(): number} rng
 * @returns {number} A standard normal draw (Box-Muller)
 */
export function gaussian(rng) {
  const u = Math.max(rng(), 1e-12)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng())
}


/**
 * @param {number} median
 * @param {number} sigma of the log
 * @param {function(): number} rng
 * @returns {number} A log-normal draw
 */
export function logNormal(median, sigma, rng) {
  return median * Math.exp(sigma * gaussian(rng))
}
