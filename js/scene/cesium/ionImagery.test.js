import {CESIUM_BODIES} from './bodies.js'
import {MIN_PIXEL_ANGLE, pixelAngle} from './detail.js'
import {MAX_BASE_TEXEL_PX, baseTexelMeters, ionImageryAltitude} from './ionImagery.js'


const rad = (deg) => deg * Math.PI / 180
const {monthlyImagery, radii} = CESIUM_BODIES.earth
const texel = baseTexelMeters(monthlyImagery, radii[0])
const EARTH_RADIUS = 6371e3
const MOON_DISTANCE = 384400e3
const CANVAS_HEIGHTS = [300, 800, 2160]


describe('baseTexelMeters', () => {
  it('is the equator over the finest level\'s texels across', () => {
    // Level 3 of 512 px tiles, two tiles across at level 0: 8192 texels
    // around the equator.
    expect(texel).toBeCloseTo(2 * Math.PI * 6378137 / 8192, 6)
    expect(texel).toBeGreaterThan(4800)
    expect(texel).toBeLessThan(5000)
  })

  it('halves with each level', () => {
    const level = (maximumLevel) => baseTexelMeters({tileSize: 512, maximumLevel}, radii[0])
    expect(level(4)).toBeCloseTo(level(3) / 2, 6)
  })
})


describe('ionImageryAltitude', () => {
  it('is where a base texel spans MAX_BASE_TEXEL_PX pixels', () => {
    const fov = rad(45)
    const height = 800
    const altitude = ionImageryAltitude(texel, fov, height)
    // At that altitude the nearest ground's pixel spans a texel over MAX_BASE_TEXEL_PX.
    expect(altitude * pixelAngle(fov, height)).toBeCloseTo(texel / MAX_BASE_TEXEL_PX, 6)
    // A couple of thousand km at 45° on a small canvas.
    expect(altitude).toBeGreaterThan(1e6)
    expect(altitude).toBeLessThan(4e6)
  })

  it('is not met by the default landing view or an orbit view', () => {
    for (const distance of [5 * EARTH_RADIUS, 20000e3 + EARTH_RADIUS, 1e8]) {
      for (const height of CANVAS_HEIGHTS) {
        expect(distance - EARTH_RADIUS).toBeGreaterThan(ionImageryAltitude(texel, rad(45), height))
      }
    }
  })

  it('is met landed or low', () => {
    for (const height of CANVAS_HEIGHTS) {
      expect(10e3).toBeLessThan(ionImageryAltitude(texel, rad(45), height))
      expect(300e3).toBeLessThan(ionImageryAltitude(texel, rad(45), height))
    }
  })

  it('rises with the canvas and narrows with the field of view', () => {
    expect(ionImageryAltitude(texel, rad(45), 1600)).toBeCloseTo(2 * ionImageryAltitude(texel, rad(45), 800), 6)
    expect(ionImageryAltitude(texel, rad(20), 800)).toBeGreaterThan(ionImageryAltitude(texel, rad(45), 800))
    expect(ionImageryAltitude(texel, rad(120), 800)).toBeLessThan(ionImageryAltitude(texel, rad(45), 800))
  })

  it('is capped at a telescope\'s, by the detail floor', () => {
    // Narrower than the floor, the pixel's ground is the floor's, whatever
    // the field: the altitude stops rising.
    const cap = texel / (MAX_BASE_TEXEL_PX * MIN_PIXEL_ANGLE)
    expect(ionImageryAltitude(texel, rad(0.01), 800)).toBeCloseTo(cap, 6)
    expect(ionImageryAltitude(texel, rad(0.0001), 800)).toBeCloseTo(cap, 6)
    expect(ionImageryAltitude(texel, rad(0.5), 800)).toBeLessThanOrEqual(cap)
  })

  it('is not met by a telescope on Earth from the Moon', () => {
    // 21" a pixel at 384,400 km spans ~38 km: Blue Marble is plenty.
    expect(MOON_DISTANCE * MIN_PIXEL_ANGLE).toBeGreaterThan(30e3)
    for (const deg of [45, 5, 0.5, 0.1, 0.01, 0.001]) {
      for (const height of CANVAS_HEIGHTS) {
        expect(MOON_DISTANCE - EARTH_RADIUS).toBeGreaterThan(ionImageryAltitude(texel, rad(deg), height))
      }
    }
  })

  it('is met by a telescope near Earth', () => {
    expect(10e3).toBeLessThan(ionImageryAltitude(texel, rad(0.01), 800))
    expect(5000e3).toBeLessThan(ionImageryAltitude(texel, rad(0.01), 800))
  })

  it('is never met for a degenerate view', () => {
    expect(ionImageryAltitude(texel, rad(45), 0)).toBe(0)
    expect(ionImageryAltitude(texel, NaN, 800)).toBe(0)
  })
})
