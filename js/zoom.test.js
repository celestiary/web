import {
  MIN_ROTATE_SCALE, asymptoticZoomDist, dynamicNear, fovTurnScale, groundRadius, homeBody, rotateScale,
} from './zoom.js'
import {INITIAL_FOV, SMALLEST_SIZE_METER, toRad} from './shared.js'


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


describe('groundRadius', () => {
  it('is the radius raised by the terrain, or the radius where the terrain is unknown', () => {
    expect(groundRadius(3389500, 21000)).toBe(3410500)
    expect(groundRadius(3389500, -7000)).toBe(3382500)
    expect(groundRadius(3389500, null)).toBe(3389500)
  })

  it('is what zoom approaches: over a mountain, never into it', () => {
    const floor = groundRadius(3389500, 21000)
    let dist = floor + 1e6
    for (let i = 0; i < 200; i++) {
      dist = asymptoticZoomDist(dist, dist * 0.8, floor)
    }
    expect(dist).toBeGreaterThanOrEqual(floor)
    expect(dist - floor).toBeLessThan(1)
  })
})


describe('homeBody', () => {
  const earthOrbit = {}
  const earth = {orbitPosition: earthOrbit}
  const moon = {orbitPosition: {}}

  it('is the body the camera was landed on or went to, not the one it looks at', () => {
    expect(homeBody(earth, earth, moon)).toBe(earth) // landed: platform on the body
    expect(homeBody(earthOrbit, earth, moon)).toBe(earth) // went to: platform on its orbit position
  })

  it('is the target when the camera is at no body', () => {
    const starAnchor = {}
    expect(homeBody(starAnchor, earth, moon)).toBe(moon)
    expect(homeBody(earth, null, moon)).toBe(moon)
  })
})


describe('rotateScale', () => {
  const EARTH_R = 6.371e6

  it('is 1 (rotation as before) from a few radii out and beyond', () => {
    expect(rotateScale(5 * EARTH_R, EARTH_R)).toBeGreaterThan(0.99)
    expect(rotateScale(3 * EARTH_R, EARTH_R)).toBeGreaterThan(0.94)
    expect(rotateScale(1e3 * EARTH_R, EARTH_R)).toBe(1)
    expect(rotateScale(Infinity, EARTH_R)).toBe(1)
  })

  it('goes with altitude over radius close in (a drag worth the same part of the view)', () => {
    // The ground a radian sweeps is scale * (R + alt); that over alt is ~1.
    for (const alt of [200, 5e3, 4e5]) {
      expect(rotateScale(alt, EARTH_R) * (EARTH_R + alt) / alt).toBeGreaterThan(0.99)
      expect(rotateScale(alt, EARTH_R) * (EARTH_R + alt) / alt).toBeLessThan(1.3)
    }
  })

  it('never goes up as the camera nears the ground', () => {
    let prev = 1
    for (let alt = 1e9; alt >= 1; alt /= 1.5) {
      const s = rotateScale(alt, EARTH_R)
      expect(s).toBeLessThanOrEqual(prev)
      prev = s
    }
    expect(rotateScale(1e6, EARTH_R)).toBeLessThan(rotateScale(2e6, EARTH_R))
  })

  it('is never zero or above 1, whatever the altitude', () => {
    for (const alt of [1e12, EARTH_R, 1e3, 1, 1e-9, 0, -5, NaN]) {
      const s = rotateScale(alt, EARTH_R)
      expect(s).toBeGreaterThanOrEqual(MIN_ROTATE_SCALE)
      expect(s).toBeLessThanOrEqual(1)
    }
    expect(rotateScale(0, EARTH_R)).toBe(MIN_ROTATE_SCALE)
    expect(rotateScale(-5, EARTH_R)).toBe(MIN_ROTATE_SCALE)
  })

  it('falls back to 1 when the body has no usable radius', () => {
    expect(rotateScale(1e3, 0)).toBe(1)
    expect(rotateScale(1e3, undefined)).toBe(1)
  })

  it('scales with the body: the same altitude is nearer the ground of a larger body', () => {
    expect(rotateScale(5e3, 7e7)).toBeLessThan(rotateScale(5e3, 3.4e6))
    expect(rotateScale(5e3, 1e4)).toBeGreaterThan(0.39)
  })
})


describe('fovTurnScale', () => {
  // Pixels the view moves, at the middle of the screen, for a pixel dragged:
  // the rate over the angle a pixel spans there (2 tan(fov / 2) / heightPx).
  const HEIGHT_PX = 600
  const RATE = 0.005
  const pixelAngle = (fov) => 2 * Math.tan(fov * toRad / 2) / HEIGHT_PX
  const pxPerPx = (fov) => RATE * fovTurnScale(fov) / pixelAngle(fov)
  const HALF_TAN = Math.tan(INITIAL_FOV * toRad / 2)

  it('is exactly 1 at the default FOV, so that view turns as it always did', () => {
    expect(fovTurnScale(INITIAL_FOV)).toBe(1)
  })

  it('is 1 for any wider field, however wide', () => {
    for (const fov of [46, 60, 90, 120, 170, 179.9, 180, 200]) {
      expect(fovTurnScale(fov)).toBe(1)
    }
  })

  it('goes with the field at narrow FOVs: a tenth of the field, a tenth of the speed', () => {
    // Relative to the default's tangent, so 5% under the plain ratio.
    expect(fovTurnScale(4.5)).toBeCloseTo(Math.tan(2.25 * toRad) / HALF_TAN, 12)
    expect(fovTurnScale(0.07)).toBeCloseTo(0.07 * toRad / 2 / HALF_TAN, 8)
    expect(fovTurnScale(0.07) / fovTurnScale(0.007)).toBeCloseTo(10, 4)
  })

  it('never goes up as the field narrows', () => {
    let prev = 1
    for (let fov = 90; fov > 1e-3; fov /= 1.1) {
      const s = fovTurnScale(fov)
      expect(s).toBeLessThanOrEqual(prev)
      prev = s
    }
  })

  it('keeps the view\'s travel per pixel dragged what it is at the default, from 45° to 0.01°', () => {
    const base = pxPerPx(INITIAL_FOV)
    expect(base).toBeCloseTo(0.005 * 600 / (2 * HALF_TAN), 9)
    for (const fov of [45, 20, 5, 1, 0.07, 0.01]) {
      expect(pxPerPx(fov) / base).toBeCloseTo(1, 6)
    }
    // Unscaled, the telescope's pixel swings the view 600 times further.
    expect(RATE / pixelAngle(0.07) / base).toBeGreaterThan(500)
  })

  it('is never zero or above 1, whatever it is given', () => {
    for (const fov of [1e-12, 1e-3, 0.07, 45, 179, NaN, 0, -3, Infinity, undefined]) {
      const s = fovTurnScale(fov)
      expect(s).toBeGreaterThanOrEqual(MIN_ROTATE_SCALE)
      expect(s).toBeLessThanOrEqual(1)
    }
    expect(fovTurnScale(1e-12)).toBe(MIN_ROTATE_SCALE)
  })

  it('is 1 when the FOV is no number or not positive (nothing to scale by)', () => {
    expect(fovTurnScale(NaN)).toBe(1)
    expect(fovTurnScale(0)).toBe(1)
    expect(fovTurnScale(-3)).toBe(1)
    expect(fovTurnScale(undefined)).toBe(1)
  })
})
