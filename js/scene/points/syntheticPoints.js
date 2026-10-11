/**
 * A synthetic point population for the engine's tests: random directions,
 * distances and magnitudes from a seeded generator.  Made up, and only for
 * testing the tiling and the selection's geometry; nothing here is any
 * catalogue's data.
 */


/**
 * mulberry32: a small deterministic PRNG, so tests repeat.
 *
 * @param {number} seed
 * @returns {Function} () => [0, 1)
 */
export function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}


/**
 * Points uniform over the sky, with a denser band (a stand-in for a
 * galactic plane, to make the tree uneven), distances from 2 to 2,000
 * light-years and apparent magnitudes rising as counts do (10^0.4 per mag).
 *
 * @param {number} n
 * @param {number} [seed]
 * @returns {Array<object>} {x, y, z (light-years), mag, absMag, teff, id}
 */
export function syntheticPoints(n, seed = 7) {
  const r = rng(seed)
  const out = []
  for (let i = 0; i < n; i++) {
    let z = (2 * r()) - 1
    if (r() < 0.4) {
      // The band: |z| < 0.1.
      z *= 0.1
    }
    const phi = 2 * Math.PI * r()
    const s = Math.sqrt(1 - (z * z))
    const d = 2 * (1000 ** r())
    // Magnitudes 0-12, more of them faint: the inverse of N(<m) ∝ 10^0.4m.
    const mag = 2.5 * Math.log10(1 + (r() * ((10 ** (0.4 * 12)) - 1)))
    out.push({
      x: d * s * Math.cos(phi), y: d * z, z: -d * s * Math.sin(phi),
      mag, absMag: mag - (5 * Math.log10(d / 32.6156)), teff: 3000 + Math.round(r() * 20000), id: BigInt(i + 1),
    })
  }
  return out
}
