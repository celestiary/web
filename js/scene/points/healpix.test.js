import {describe, expect, it} from 'bun:test'
import {
  ang2pixNest,
  locToVec,
  nest2xyf,
  npix,
  parentPixel,
  pix2loc,
  pixelCone,
  xyf2nest,
} from './healpix.js'


/**
 * A small deterministic PRNG (mulberry32), so the sampled tests repeat.
 *
 * @param {number} seed
 * @returns {Function} () => [0, 1)
 */
function rng(seed) {
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
 * @param {Function} r
 * @returns {{z: number, phi: number}} A uniform direction
 */
function randomLoc(r) {
  return {z: (2 * r()) - 1, phi: 2 * Math.PI * r()}
}


describe('healpix', () => {
  it('has 12 × 4^order pixels', () => {
    expect(npix(0)).toBe(12)
    expect(npix(3)).toBe(768)
  })

  it('puts the base pixels where HEALPix has them', () => {
    // Pixel 0: the north cap's first, centred at z = 2/3, φ = 45°; 4 on the
    // equator at φ = 0; 8 in the south at z = -2/3, φ = 45°.
    const p0 = pix2loc(0, 0)
    expect(p0.z).toBeCloseTo(2 / 3, 12)
    expect(p0.phi).toBeCloseTo(Math.PI / 4, 12)
    const p4 = pix2loc(0, 4)
    expect(p4.z).toBeCloseTo(0, 12)
    expect(p4.phi).toBeCloseTo(0, 12)
    const p8 = pix2loc(0, 8)
    expect(p8.z).toBeCloseTo(-2 / 3, 12)
    expect(p8.phi).toBeCloseTo(Math.PI / 4, 12)
    // The poles are in base pixels 0-3 and 8-11.
    expect(ang2pixNest(0, 1, 0)).toBeLessThan(4)
    expect(ang2pixNest(0, -1, 0)).toBeGreaterThanOrEqual(8)
  })

  it('finds every pixel from its own centre, orders 0 to 6', () => {
    for (let order = 0; order <= 6; order++) {
      for (let pix = 0; pix < npix(order); pix++) {
        const {z, phi} = pix2loc(order, pix)
        if (ang2pixNest(order, z, phi) !== pix) {
          throw new Error(`order ${order} pixel ${pix} came back ${ang2pixNest(order, z, phi)}`)
        }
      }
    }
  })

  it('numbers a pixel\'s children 4p to 4p + 3', () => {
    const r = rng(1)
    for (let i = 0; i < 2000; i++) {
      const {z, phi} = randomLoc(r)
      const fine = ang2pixNest(9, z, phi)
      for (const order of [0, 3, 8]) {
        expect(parentPixel(fine, 9, order)).toBe(ang2pixNest(order, z, phi))
      }
    }
  })

  it('round-trips (x, y, face)', () => {
    for (const order of [0, 4, 13]) {
      const nside = 2 ** order
      for (const [ix, iy, face] of [[0, 0, 0], [nside - 1, 0, 5], [nside >> 1, nside - 1, 11]]) {
        expect(nest2xyf(xyf2nest(ix, iy, face, order), order)).toEqual({ix, iy, face})
      }
    }
  })

  it('cuts the sphere into pixels of equal area', () => {
    // 192 pixels at order 2; 192,000 uniform points: 1,000 each, σ ≈ 32.
    const r = rng(2)
    const counts = new Array(npix(2)).fill(0)
    for (let i = 0; i < 192000; i++) {
      const {z, phi} = randomLoc(r)
      counts[ang2pixNest(2, z, phi)]++
    }
    expect(Math.min(...counts)).toBeGreaterThan(850)
    expect(Math.max(...counts)).toBeLessThan(1150)
  })

  it('bounds each pixel by its cone', () => {
    const r = rng(3)
    for (const order of [0, 1, 3, 6]) {
      const cones = new Map()
      for (let i = 0; i < 20000; i++) {
        const {z, phi} = randomLoc(r)
        const pix = ang2pixNest(order, z, phi)
        if (!cones.has(pix)) {
          cones.set(pix, pixelCone(order, pix))
        }
        const {centre, radius} = cones.get(pix)
        const v = locToVec(z, phi)
        const angle = Math.acos(Math.min(1, (v[0] * centre[0]) + (v[1] * centre[1]) + (v[2] * centre[2])))
        expect(angle).toBeLessThanOrEqual(radius)
      }
      // And not loosely: a polar base pixel reaches 48.2° from its centre (the pole).
      if (order === 0) {
        expect(Math.max(...[...cones.values()].map((c) => c.radius))).toBeLessThan(50 * Math.PI / 180)
      }
    }
  })
})
