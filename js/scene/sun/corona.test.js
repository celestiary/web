import {describe, expect, it} from 'bun:test'
import {limbDarkening} from '../stellar.js'
import {
  THOMSON_FACTOR,
  baumbachK,
  cmeShellDensity,
  coronaDensity,
  dilution,
  saitoDensity,
  sheetAt,
  sheetSin,
  streamerFactor,
  thomsonBrightness,
} from './corona.js'


const SAMPLES = 96


/**
 * The K-corona at a point of the sky, as the shader integrates it (no
 * rays): the Sun's pole up in the sky, the line of sight along −z turned
 * by a longitude.
 *
 * @param {number} rho
 * @param {number} paRad from the equator, toward the north pole
 * @param {object} sheet sheetAt's
 * @param {number} viewLon radians
 * @returns {number} B/B☉
 */
function brightness(rho, paRad, sheet, viewLon) {
  const q = [rho * Math.cos(paRad), rho * Math.sin(paRad), 0]
  const c = Math.cos(viewLon)
  const s = Math.sin(viewLon)
  const turn = ([x, y, z]) => [(c * x) + (s * z), y, (-s * x) + (c * z)]
  const dTheta = Math.PI / SAMPLES
  let sum = 0
  for (let k = 0; k < SAMPLES; k++) {
    const th = (-Math.PI / 2) + ((k + 0.5) * dTheta)
    const r = rho / Math.cos(th)
    const x = turn([q[0], q[1], rho * Math.tan(th)]).map((v) => v / r)
    const sl = sheetSin(x, sheet)
    const st = Math.sin(th)
    sum += saitoDensity(r, sl) * streamerFactor(r, sl) * dilution(r) * (1 + (st * st))
  }
  return THOMSON_FACTOR * sum * dTheta / rho
}


/**
 * The isophote's radius at a position angle where the brightness is a
 * value, by bisection.
 *
 * @param {number} value
 * @param {number} paRad
 * @param {object} sheet
 * @param {Array<number>} lons the views averaged over
 * @returns {number}
 */
function isophote(value, paRad, sheet, lons) {
  const mean = (rho) => lons.reduce((a, l) => a + brightness(rho, paRad, sheet, l), 0) / lons.length
  let lo = 1.01
  let hi = 6
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (mean(mid) > value) {
      lo = mid
    } else {
      hi = mid
    }
  }
  return (lo + hi) / 2
}


describe('the K-corona', () => {
  it('from Saito\'s density through Thomson scattering is Baumbach\'s profile', () => {
    // Baumbach's law is in millionths of the disc centre's brightness; the
    // integral is over the disc's mean.
    const centreOverMean = 1 / limbDarkening(5772).mean[1]
    for (const rho of [1.05, 1.2, 1.5, 2]) {
      const b = thomsonBrightness(rho, (r) => saitoDensity(r, 0), -Math.PI / 2, Math.PI / 2, 512)
      expect(b / (baumbachK(rho) * centreOverMean)).toBeGreaterThan(0.85)
      expect(b / (baumbachK(rho) * centreOverMean)).toBeLessThan(1.15)
    }
    // About 1e-6 of the disc a tenth of a radius over the limb, falling
    // over a decade by 1.5 radii.
    expect(thomsonBrightness(1.1, (r) => coronaDensity(r, 0))).toBeGreaterThan(1e-6)
    expect(thomsonBrightness(1.5, (r) => coronaDensity(r, 0))).toBeLessThan(2e-7)
  })


  it('takes the shader\'s 24 samples to within 1% of a fine integral', () => {
    for (const rho of [1.02, 1.3, 3, 10]) {
      const fine = thomsonBrightness(rho, (r) => coronaDensity(r, 0.2), -Math.PI / 2, Math.PI / 2, 1024)
      expect(Math.abs((thomsonBrightness(rho, (r) => coronaDensity(r, 0.2)) / fine) - 1)).toBeLessThan(0.01)
    }
  })


  it('the coronal holes at the poles: Saito\'s pole is 4× thinner at 1.1 radii', () => {
    expect(saitoDensity(1.1, 0) / saitoDensity(1.1, 1)).toBeGreaterThan(3.5)
    expect(streamerFactor(1.5, 0)).toBeCloseTo(1, 9)
  })


  it('is flattened at minimum and round at maximum, as the Ludendorff index says', () => {
    // Ludendorff's ε = d_equator / d_pole − 1 of an isophote: up to ~0.3-0.4
    // at minimum, ~0 at maximum (e.g. Pishkalo 2011; 0.16 at 2 radii in
    // 2016).  The isophote through the equator's brightness at 2 radii,
    // averaged over the Sun's rotation.
    const lons = [0, 1, 2, 3, 4, 5].map((k) => k * Math.PI / 3)
    const flattening = (level) => {
      const sheet = sheetAt(level, 0.7, [0.4, 1.9])
      const value = lons.reduce((a, l) => a + brightness(2, 0, sheet, l), 0) / lons.length
      const polar = (isophote(value, Math.PI / 2, sheet, lons) + isophote(value, -Math.PI / 2, sheet, lons)) / 2
      return (2 / polar) - 1
    }
    const atMinimum = flattening(0)
    const atMaximum = flattening(1)
    expect(atMinimum).toBeGreaterThan(0.15)
    expect(atMinimum).toBeLessThan(0.6)
    expect(atMaximum).toBeLessThan(atMinimum / 2)
  })


  it('the sheet is the equator at a flat minimum and tilts at maximum', () => {
    const flat = {pole: [0, 1, 0], warp: 0, phase: [0, 0, 0]}
    expect(sheetSin([1, 0, 0], flat)).toBeCloseTo(0, 9)
    expect(sheetSin([0, 1, 0], flat)).toBeCloseTo(1, 9)
    const max = sheetAt(1, 0)
    expect(Math.acos(max.pole[1]) * 180 / Math.PI).toBeCloseTo(75, 6)
  })
})


describe('a CME\'s electrons', () => {
  it('spread over its front shell: a typical CME at 5 radii is the background\'s order', () => {
    const n = cmeShellDensity(1e15, 5, 25 * Math.PI / 180)
    const background = coronaDensity(5, 0)
    expect(n / background).toBeGreaterThan(0.3)
    expect(n / background).toBeLessThan(5)
    // Thinner as it expands: n ∝ r^−3.
    expect(cmeShellDensity(1e15, 10, 0.4) / cmeShellDensity(1e15, 5, 0.4)).toBeCloseTo(1 / 8, 9)
  })
})
