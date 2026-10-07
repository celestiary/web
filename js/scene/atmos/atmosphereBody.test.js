import {
  ATMOSPHERE_MAX_RADII,
  atmosphereBody,
  atmosphereResolvable,
} from './atmosphereBody.js'
import {raySphere} from './rayEnd.js'


const f32 = Math.fround


/**
 * @returns {object} A body node as atmosphereBody reads it
 */
function body(name, radius, height, dist) {
  return {
    name,
    dist,
    props: {radius: {scalar: radius}, atmosphere: height ? {height: {scalar: height}} : undefined},
  }
}

const distanceTo = (b) => b.dist


/**
 * Whether the pass's rsi, in float32 (rayEnd.js raySphere), puts a ray from
 * `eye` along the unit `dir` on the sphere of radius `r`, ahead.
 *
 * @returns {boolean}
 */
function rsiHitsF32(eye, dir, r) {
  const [t0, t1] = raySphere(eye, dir, r)
  return t0 > 0 && t0 <= t1
}


/**
 * The share of rays across a body's disc, from `radii` of its radius away
 * on a skewed axis, that rsi in float32 classes right (on the disc or off
 * it, in a band from the centre to 1.5 radii out).
 *
 * @returns {number} 0..1
 */
function rsiAccuracy(radii) {
  const R = 6.9911e7
  const D = R * radii
  // A skewed axis, so the components aren't round numbers.
  const axis = [0.2851, 0.5044, -0.8150]
  const n = Math.hypot(...axis)
  const eye = axis.map((v) => f32(v / n * D))
  const toCentre = eye.map((v) => -v / D)
  // A perpendicular to it.
  const side = [toCentre[1], -toCentre[0], 0]
  const sn = Math.hypot(...side)
  let right = 0
  const N = 301
  for (let i = 0; i < N; i++) {
    const off = (i / (N - 1)) * 1.5 * R
    const dir = toCentre.map((v, k) => (v * D) + (side[k] / sn * off))
    const len = Math.hypot(...dir)
    const unit = dir.map((v) => f32(v / len))
    const truth = off < R
    if (Math.abs(off - R) < 0.02 * R) {
      right++ // the limb's own pixels: either answer
      continue
    }
    if (rsiHitsF32(eye, unit, R) === truth) {
      right++
    }
  }
  return right / N
}


describe('atmosphereBody', () => {
  const earth = body('earth', 6.371e6, 8e4, 6.371e6 + 169)
  const jupiter = body('jupiter', 6.9911e7, 3e5, 8.76e11)
  const sun = {name: 'sun', props: {radius: {scalar: 6.957e8}}, dist: 1.5e11}

  it('is the air the camera is in, whatever is targeted (Jupiter from Earth\'s ground)', () => {
    expect(atmosphereBody({home: earth, target: jupiter, last: null, distanceTo})).toBe(earth)
    expect(atmosphereBody({home: earth, target: jupiter, last: jupiter, distanceTo})).toBe(earth)
  })

  it('is the target\'s when the camera is near it', () => {
    const near = body('jupiter', 6.9911e7, 3e5, 1e9)
    expect(atmosphereBody({home: near, target: near, last: earth, distanceTo})).toBe(near)
  })

  it('keeps the last body\'s for a far target', () => {
    const far = {...earth, dist: 1e10}
    expect(atmosphereBody({home: far, target: jupiter, last: earth, distanceTo})).toBe(earth)
  })

  it('takes the target\'s when none has been drawn yet', () => {
    const far = {...earth, dist: 1e10}
    expect(atmosphereBody({home: far, target: jupiter, last: null, distanceTo})).toBe(jupiter)
  })

  it('keeps the last for a target with no air (the Sun)', () => {
    const far = {...earth, dist: 1e10}
    expect(atmosphereBody({home: far, target: sun, last: earth, distanceTo})).toBe(earth)
    expect(atmosphereBody({home: null, target: sun, last: null, distanceTo})).toBe(null)
  })
})


describe('atmosphereResolvable', () => {
  it('draws the air out to ATMOSPHERE_MAX_RADII', () => {
    expect(atmosphereResolvable(6.4e6, 6.371e6)).toBe(true)
    expect(atmosphereResolvable(6.9911e7 * ATMOSPHERE_MAX_RADII, 6.9911e7)).toBe(true)
  })

  it('not Jupiter from Earth', () => {
    expect(atmosphereResolvable(8.76e11, 6.9911e7)).toBe(false)
  })

  // Why: the pass's sphere test in float32 classes a disc right to 400
  // radii, all but a ray at the limb at 500, and not at 12,500 (Jupiter
  // from Earth).
  it('matches where float32 rsi holds', () => {
    expect(rsiAccuracy(100)).toBe(1)
    expect(rsiAccuracy(400)).toBe(1)
    expect(rsiAccuracy(ATMOSPHERE_MAX_RADII)).toBeGreaterThan(0.99)
    expect(rsiAccuracy(12500)).toBeLessThan(0.95)
  })
})
