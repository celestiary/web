import {readFileSync} from 'fs'
import {LIGHTYEAR_METER} from '../shared.js'
import {toArrayBuffer} from '../utils.js'
import {FLOAT32_SQRT_MAX, starClipPosition} from './exposure.js'
import StarsCatalog from './StarsCatalog.js'


// The float32 arithmetic of a star's clip coordinates, replayed with
// Math.fround (js/scene/HDR.md, "Physical stars": nor past 2^64 m).
describe('a star past 2^64 m (1,950 ly)', () => {
  // The camera as ThreeUi.configLargeScene sets it, and the catalogue's
  // light-year (StarsCatalog).
  const near = 6e5
  const far = 9.461e15 * 5e4 * 6
  const ly = LIGHTYEAR_METER
  const f32 = Math.fround
  const deg = Math.PI / 180
  // Alnilam's distance in stars.dat, and its lumens.
  const alnilam = 1976.826 * ly
  const alnilamLumens = 1.98e33

  it('sqrt(FLT_MAX) is 2^64 m, 1,950 ly: a float32 square past it is Inf', () => {
    expect(FLOAT32_SQRT_MAX / (2 ** 64)).toBeCloseTo(1, 6)
    expect(FLOAT32_SQRT_MAX / 9.4607e15).toBeCloseTo(1949.8, 1)
    const under = f32(0.999 * FLOAT32_SQRT_MAX)
    const over = f32(1.001 * FLOAT32_SQRT_MAX)
    expect(f32(under * under)).toBeLessThan(Infinity)
    expect(f32(over * over)).toBe(Infinity)
    expect(f32(alnilam * alnilam)).toBe(Infinity)
  })

  it('was handed to the GPU with a clip w whose square is Inf within 9.4° of the view axis: Alnilam at the centre', () => {
    // w = d·cos θ, so the cone where w² overflows is acos(2^64 / d) wide.
    const cone = Math.acos(FLOAT32_SQRT_MAX / alnilam) / deg
    expect(cone).toBeGreaterThan(9.2)
    expect(cone).toBeLessThan(9.6)
    for (const theta of [0, 3, 6, 9]) {
      expect(starClipPosition(alnilam, theta * deg, near, far).clipMaxSquare).toBe(Infinity)
    }
    // A small yaw out of the cone: finite.
    for (const theta of [9.8, 12, 20]) {
      expect(starClipPosition(alnilam, theta * deg, near, far).clipMaxSquare).toBeLessThan(Infinity)
    }
  })

  it('is handed on at w = 1 by stars.vert: every component and its square finite, the same point and depth', () => {
    for (const theta of [0, 5, 9.4, 15, 22]) {
      const {clip, position, positionMaxSquare, culled} = starClipPosition(alnilam, theta * deg, near, far)
      expect(culled).toBe(false)
      expect(position[3]).toBe(1)
      expect(positionMaxSquare).toBeLessThan(Infinity)
      // The same NDC as the GPU's divide of the old clip coordinates.
      expect(position[1]).toBe(f32(clip[1] / clip[3]))
      expect(position[2]).toBeLessThan(1)
      expect(position[2]).toBeCloseTo(clip[2] / clip[3], 6)
    }
    // And a star behind the eye is culled, as the clipper had it: z > w.
    const behind = starClipPosition(alnilam, Math.PI, near, far)
    expect(behind.culled).toBe(true)
    expect(behind.position[2]).toBeGreaterThan(behind.position[3])
  })

  it('had its inverse square in metres overflow with it (#153), and in Gm it stays finite', () => {
    // stars.vert's illuminance, d the distance along the view axis (-mvPosition.z).
    const fourPi = f32(4 * Math.PI)
    const inMetres = (d) => f32(f32(alnilamLumens) / f32(fourPi * f32(f32(d) * f32(d))))
    const inGm = (d) => {
      const distGm = f32(f32(d) * f32(1e-9))
      return f32(f32(f32(alnilamLumens) * f32(1e-18)) / f32(f32(fourPi * distGm) * distGm))
    }
    // 4π·d² passed FLT_MAX at 550 ly, so Rigel (863) and Deneb (1,412) were zeroed too.
    expect(inMetres(alnilam)).toBe(0)
    expect(inMetres(1412 * ly)).toBe(0)
    expect(inMetres(540 * ly)).toBeGreaterThan(0)
    for (const d of [4.2 * ly, 1412 * ly, alnilam, 11649 * ly]) {
      expect(inGm(d)).toBeGreaterThan(0)
    }
    const exact = alnilamLumens / (4 * Math.PI * alnilam * alnilam)
    expect(inGm(alnilam) / exact).toBeCloseTo(1, 5)
  })

  it('is 7,002 of the catalogue\'s 106,748 stars, to 11,649 ly, each finite through stars.vert on the view axis', () => {
    const catalog = new StarsCatalog().read(toArrayBuffer(readFileSync('./public/data/stars.dat')))
    let past = 0
    let farthest = 0
    let worst = 0
    catalog.starByHip.forEach((star) => {
      const d = Math.hypot(star.x, star.y, star.z)
      farthest = Math.max(farthest, d)
      if (d > FLOAT32_SQRT_MAX) {
        past++
      }
      if (d > 0) { // Not the Sun, at the catalogue's origin
        const {positionMaxSquare, culled} = starClipPosition(d, 0, near, far)
        expect(culled).toBe(false)
        worst = Math.max(worst, positionMaxSquare)
      }
    })
    expect(catalog.starByHip.size).toBe(106748)
    expect(past).toBe(7002)
    expect(farthest / ly).toBeCloseTo(11649, 0)
    expect(starClipPosition(farthest, 0, near, far).clipMaxSquare).toBe(Infinity)
    expect(worst).toBeLessThanOrEqual(1)
  })
})
