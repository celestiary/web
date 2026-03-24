import {asymptoticZoomDist, dynamicNear} from './zoom.js'
import {SMALLEST_SIZE_METER} from './shared.js'


describe('asymptoticZoomDist', () => {
  const EARTH_R = 6.371e6

  it('returns distAfter unchanged when no zoom occurred', () => {
    expect(asymptoticZoomDist(1e7, 1e7, EARTH_R)).toBe(1e7)
  })

  it('slows zoom-in relative to linear when above surface', () => {
    // Linear zoom: dist 10r → 5r (factor 0.5)
    // Asymptotic:  alt  9r → 4.5r  → dist = r + 4.5r = 5.5r  (farther than 5r)
    const surfaceR = 1e6
    const distBefore = 10 * surfaceR
    const distAfter = 5 * surfaceR // what linear zoom would give
    const result = asymptoticZoomDist(distBefore, distAfter, surfaceR)
    expect(result).toBeGreaterThan(distAfter) // slowed down
    expect(result).toBeLessThan(distBefore) // but still moving in
    expect(result).toBeCloseTo(surfaceR + (4.5 * surfaceR), 0)
  })

  it('clamps to surfaceR when zooming deep inside the body', () => {
    // Extreme zoom: controls would put camera at r/100 (inside planet)
    const surfaceR = 6.371e6
    const distBefore = 7e6
    const distAfter = 100 // controls tried to go far inside
    const result = asymptoticZoomDist(distBefore, distAfter, surfaceR)
    expect(result).toBeGreaterThanOrEqual(surfaceR)
  })

  it('clamps to surfaceR when already at surface and zooming in more', () => {
    const surfaceR = 6.371e6
    const result = asymptoticZoomDist(surfaceR, surfaceR * 0.5, surfaceR)
    expect(result).toBe(surfaceR)
  })

  it('allows zoom-out without distortion', () => {
    // Zooming out: distAfter > distBefore, altitude grows proportionally
    const surfaceR = 1e6
    const distBefore = 2 * surfaceR // alt = r
    const distAfter = 4 * surfaceR // linear doubles distance
    const result = asymptoticZoomDist(distBefore, distAfter, surfaceR)
    // alt goes from r to 2r → result = r + 2r = 3r
    expect(result).toBeCloseTo(3 * surfaceR, 0)
  })

  it('handles camera already below surface (altBefore clamped to 0)', () => {
    // If somehow camera is inside the body, result should be exactly surfaceR
    const surfaceR = 1e6
    const result = asymptoticZoomDist(surfaceR * 0.5, surfaceR * 0.1, surfaceR)
    expect(result).toBe(surfaceR)
  })
})


describe('dynamicNear', () => {
  it('returns SMALLEST_SIZE_METER when altitude is far (above threshold)', () => {
    // altitude * 0.1 > SMALLEST_SIZE_METER → capped
    const farAlt = SMALLEST_SIZE_METER * 20
    expect(dynamicNear(farAlt)).toBe(SMALLEST_SIZE_METER)
  })

  it('scales at 10% of altitude when close', () => {
    const alt = 100e3 // 100 km
    expect(dynamicNear(alt)).toBeCloseTo(10e3) // 10 km near plane
  })

  it('clamps to 100m minimum at very low altitude', () => {
    expect(dynamicNear(0)).toBe(1e2)
    expect(dynamicNear(500)).toBe(1e2) // 500 * 0.1 = 50 < 100m min
  })

  it('is at minimum boundary at exactly 1 km altitude', () => {
    // 1000 * 0.1 = 100 = exactly the minimum
    expect(dynamicNear(1000)).toBe(1e2)
  })

  it('transitions smoothly just above surface (not a hard jump)', () => {
    const nearA = dynamicNear(10e3) // 10 km
    const nearB = dynamicNear(50e3) // 50 km
    const nearC = dynamicNear(100e3) // 100 km
    expect(nearA).toBeLessThan(nearB)
    expect(nearB).toBeLessThan(nearC)
  })
})
