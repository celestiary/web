import {describe, expect, it} from 'bun:test'
import {latLngAltToBodyFixed} from '../../coords.js'
import {bodyToEcef} from './frames.js'
import {
  RELIEF_FADE_END,
  RELIEF_FADE_START,
  RELIEF_GLSL,
  imageUv,
  lonLat,
  perturbedNormal,
  reliefFrame,
  reliefStrength,
} from './relief.js'


const toRad = Math.PI / 180
const toDeg = 180 / Math.PI
const MOON_RADIUS = 1737400
const MAP_WIDTH = 2048
const MAP_HEIGHT = 1024


/**
 * @param {number} latDeg
 * @param {number} lonDeg East longitude
 * @param {number} [r]
 * @returns {Array<number>} The point in the Moon's ECEF frame, via celestiary's own body frame
 */
function ecefAt(latDeg, lonDeg, r = MOON_RADIUS) {
  return bodyToEcef(latLngAltToBodyFixed(latDeg, lonDeg, 0, r))
}


const dot = (a, b) => (a[0] * b[0]) + (a[1] * b[1]) + (a[2] * b[2])


describe('longitude and latitude of a point in the Moon\'s frame', () => {
  it('puts the axes where Cesium\'s Moon frame has them', () => {
    const at = (p) => {
      const {lon, lat} = lonLat(p)
      return [Math.round(lon * toDeg), Math.round(lat * toDeg)]
    }
    expect(at([1, 0, 0])).toEqual([0, 0])
    expect(at([0, 1, 0])).toEqual([90, 0])
    expect(at([-1, 0, 0].map((x, i) => (i === 1 ? 1e-9 : x)))).toEqual([180, 0])
    expect(at([0, -1, 0])).toEqual([-90, 0])
    expect(at([0, 0, 1])[1]).toBe(90)
    expect(at([0, 0, -1])[1]).toBe(-90)
  })

  it('agrees with celestiary\'s body frame, whatever the radius', () => {
    for (const [lat, lon] of [[-43.3, -11.2], [9.6, -20.1], [0, 0], [30, 179.5], [-60, 135]]) {
      for (const r of [MOON_RADIUS, MOON_RADIUS + 11000, MOON_RADIUS - 9000]) {
        const got = lonLat(ecefAt(lat, lon, r))
        expect(got.lat * toDeg).toBeCloseTo(lat, 9)
        expect(got.lon * toDeg).toBeCloseTo(lon, 9)
      }
    }
  })
})


describe('where a point falls in the normal map', () => {
  it('has -180 at the left edge, the prime meridian in the centre, north at the top', () => {
    expect(imageUv(-Math.PI, 0)).toEqual({u: 0, v: 0.5})
    expect(imageUv(0, 0)).toEqual({u: 0.5, v: 0.5})
    expect(imageUv(Math.PI / 2, 0).u).toBeCloseTo(0.75, 12)
    expect(imageUv(0, Math.PI / 2).v).toBeCloseTo(0, 12)
    expect(imageUv(0, -Math.PI / 2).v).toBeCloseTo(1, 12)
  })

  it('puts Tycho and Copernicus at their texels', () => {
    // Tycho 43.3°S, 11.2°W; Copernicus 9.6°N, 20.1°W (USGS Gazetteer).
    const tycho = lonLat(ecefAt(-43.3, -11.2))
    const {u, v} = imageUv(tycho.lon, tycho.lat)
    expect(Math.floor(u * MAP_WIDTH)).toBe(Math.floor(((180 - 11.2) / 360) * MAP_WIDTH))
    expect(Math.floor(u * MAP_WIDTH)).toBe(960)
    expect(Math.floor(v * MAP_HEIGHT)).toBe(758)
    const copernicus = lonLat(ecefAt(9.6, -20.1))
    const c = imageUv(copernicus.lon, copernicus.lat)
    expect(Math.floor(c.u * MAP_WIDTH)).toBe(909)
    expect(Math.floor(c.v * MAP_HEIGHT)).toBe(457)
  })
})


describe('the tangent frame', () => {
  it('is east, north and up at the equator on the prime meridian', () => {
    const {east, north, up} = reliefFrame([MOON_RADIUS, 0, 0])
    expect(up).toEqual([1, 0, 0])
    expect(east[0]).toBeCloseTo(0, 12)
    expect(east[1]).toBe(1)
    expect(east[2]).toBe(0)
    expect(north[2]).toBeCloseTo(1, 12)
    expect(Math.abs(north[0]) + Math.abs(north[1])).toBeCloseTo(0, 12)
  })

  it('is orthonormal and right-handed (east × north = up) at known points', () => {
    for (const [lat, lon] of [[-43.3, -11.2], [9.6, -20.1], [0, 90], [0, 180], [75, 40], [-89, 10]]) {
      const p = ecefAt(lat, lon)
      const {east, north, up} = reliefFrame(p)
      expect(Math.hypot(...east)).toBeCloseTo(1, 12)
      expect(Math.hypot(...north)).toBeCloseTo(1, 12)
      expect(Math.hypot(...up)).toBeCloseTo(1, 12)
      expect(dot(east, north)).toBeCloseTo(0, 12)
      expect(dot(east, up)).toBeCloseTo(0, 12)
      expect(dot(north, up)).toBeCloseTo(0, 12)
      const cross = [
        (east[1] * north[2]) - (east[2] * north[1]),
        (east[2] * north[0]) - (east[0] * north[2]),
        (east[0] * north[1]) - (east[1] * north[0]),
      ]
      for (let i = 0; i < 3; i++) {
        expect(cross[i]).toBeCloseTo(up[i], 12)
      }
    }
  })

  it('points east toward increasing longitude, and north toward the pole', () => {
    for (const [lat, lon] of [[-43.3, -11.2], [9.6, -20.1], [60, 100]]) {
      const p = ecefAt(lat, lon)
      const {east, north} = reliefFrame(p)
      const step = 1e-4
      const moved = (d) => lonLat(p.map((x, i) => x + (d[i] * MOON_RADIUS * step)))
      const e = moved(east)
      const n = moved(north)
      const here = lonLat(p)
      expect(e.lon).toBeGreaterThan(here.lon)
      expect(e.lat).toBeCloseTo(here.lat, 5)
      expect(n.lat).toBeGreaterThan(here.lat)
      expect(n.lon).toBeCloseTo(here.lon, 5)
    }
  })

  it('stays defined at the pole', () => {
    const {east, north, up} = reliefFrame([0, 0, MOON_RADIUS])
    expect(up).toEqual([0, 0, 1])
    for (const x of [...east, ...north]) {
      expect(Number.isFinite(x)).toBe(true)
    }
  })
})


describe('the perturbed normal', () => {
  const flat = [0.5, 0.5, 1]

  it('is the smooth normal where the map is flat, and at zero strength', () => {
    const p = ecefAt(-43.3, -11.2)
    const {up} = reliefFrame(p)
    const n = perturbedNormal(p, flat)
    const slanted = perturbedNormal(p, [0.9, 0.2, 0.7], 0)
    for (let i = 0; i < 3; i++) {
      expect(n[i]).toBeCloseTo(up[i], 12)
      expect(slanted[i]).toBeCloseTo(up[i], 12)
    }
  })

  it('tilts toward east where the map\'s x is positive, and north where its y is', () => {
    for (const [lat, lon] of [[-43.3, -11.2], [9.6, -20.1], [0, 0]]) {
      const p = ecefAt(lat, lon)
      const {east, north, up} = reliefFrame(p)
      // x = +0.5, y = 0, z = 0.866 (a 30° slope facing east)
      const toEast = perturbedNormal(p, [0.75, 0.5, (0.866 + 1) / 2])
      expect(dot(toEast, east)).toBeCloseTo(0.5, 3)
      expect(dot(toEast, north)).toBeCloseTo(0, 3)
      expect(dot(toEast, up)).toBeCloseTo(0.866, 3)
      const toNorth = perturbedNormal(p, [0.5, 0.75, (0.866 + 1) / 2])
      expect(dot(toNorth, north)).toBeCloseTo(0.5, 3)
      expect(dot(toNorth, east)).toBeCloseTo(0, 3)
    }
  })

  it('lights the Sun-facing wall of a crater with the Sun low in the east, and not the far one', () => {
    // A crater at Tycho's position; the Sun low over the eastern horizon
    // (elevation 5°).  The wall on the crater's west side slopes down
    // toward the east: its normal tilts east (x > 0).  The east wall's
    // tilts west.
    const p = ecefAt(-43.3, -11.2)
    const {east, up} = reliefFrame(p)
    const el = 5 * toRad
    const sun = up.map((x, i) => (x * Math.sin(el)) + (east[i] * Math.cos(el)))
    const westWall = perturbedNormal(p, [0.5 + 0.2, 0.5, 0.97])
    const eastWall = perturbedNormal(p, [0.5 - 0.2, 0.5, 0.97])
    expect(dot(westWall, sun)).toBeGreaterThan(Math.sin(el) + 0.1)
    expect(dot(eastWall, sun)).toBeLessThan(0)
    // And the smooth sphere is only just lit.
    expect(dot(up, sun)).toBeCloseTo(Math.sin(el), 12)
  })

  it('is a unit vector', () => {
    const n = perturbedNormal(ecefAt(30, 40), [0.9, 0.1, 0.8], 0.6)
    expect(Math.hypot(...n)).toBeCloseTo(1, 12)
  })
})


describe('where the map\'s detail fades', () => {
  it('is full where texels are as wide as a pixel or narrower, and down to 2 pixels a texel', () => {
    expect(reliefStrength(8)).toBe(1)
    expect(reliefStrength(1)).toBe(1)
    expect(reliefStrength(2 ** RELIEF_FADE_START)).toBeCloseTo(1, 12)
  })

  it('is gone at 8 pixels a texel and beyond, and falls monotonically between', () => {
    expect(reliefStrength(2 ** RELIEF_FADE_END)).toBeCloseTo(0, 12)
    expect(reliefStrength(1e-4)).toBe(0)
    let last = 0
    for (let lod = RELIEF_FADE_END; lod <= RELIEF_FADE_START; lod += 0.1) {
      const s = reliefStrength(2 ** lod)
      expect(s).toBeGreaterThanOrEqual(last)
      last = s
    }
  })

  it('is full at the user\'s telescope views (#192: a pixel is 4.6-6.7 km, a texel 5.3)', () => {
    const texelKm = (2 * Math.PI * MOON_RADIUS / 1000) / MAP_WIDTH
    expect(texelKm).toBeCloseTo(5.33, 2)
    expect(reliefStrength(4.6 / texelKm)).toBe(1)
    expect(reliefStrength(6.7 / texelKm)).toBe(1)
  })
})


describe('the shader', () => {
  it('samples the uniform map with gradients, and has the same fade edges as the JS', () => {
    expect(RELIEF_GLSL).toContain('textureGrad(u_reliefMap')
    expect(RELIEF_GLSL).toContain(`smoothstep(${RELIEF_FADE_END.toFixed(1)}, ${RELIEF_FADE_START.toFixed(1)}, lod)`)
    expect(RELIEF_GLSL).toContain('vec3 reliefNormal(vec3 p)')
  })
})
