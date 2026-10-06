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


// What a fast-math compiler (Metal's) may legally make of stars.vert's
// inverse square, replayed in float32: it may reassociate and cancel the
// constant scales, so (z·1e-9)² against the 1e-18 becomes z² in metres.
// SwiftShader computes the source as written.  stars.vert now takes the
// inverse square in logs, past a max(): no algebra makes a square of d.
describe('a star\'s light under fast math', () => {
  const ly = LIGHTYEAR_METER
  const f32 = Math.fround
  const deg = Math.PI / 180
  const fourPi = f32(4 * Math.PI)
  const alnilam = 1976.826 * ly
  const alnilamLumens = 1.98e33
  // main's source, as written and as folded; the fixed source, in logs.
  const asWritten = (lumens, z) => {
    const distGm = f32(f32(z) * f32(1e-9))
    return f32(f32(f32(lumens) * f32(1e-18)) / f32(f32(fourPi * distGm) * distGm))
  }
  const foldedOld = (lumens, z) => f32(f32(f32(lumens) / f32(f32(z) * f32(z))) / fourPi)
  const inLogs = (lumens, z) => {
    const distGm = Math.max(f32(f32(z) * f32(1e-9)), f32(1e-30))
    const logE = f32(f32(Math.log2(f32(f32(lumens) * f32(1e-18 / (4 * Math.PI))))) - f32(2 * f32(Math.log2(distGm))))
    return f32(2 ** logE)
  }

  it('folded, main\'s source zeroes Alnilam within 9.4° of the view axis, as the user\'s M2 did, and not past it', () => {
    for (const theta of [0, 3, 6, 9]) {
      const z = alnilam * Math.cos(theta * deg)
      expect(asWritten(alnilamLumens, z)).toBeGreaterThan(0)
      expect(foldedOld(alnilamLumens, z)).toBe(0)
    }
    for (const theta of [9.8, 12, 20]) {
      expect(foldedOld(alnilamLumens, alnilam * Math.cos(theta * deg))).toBeGreaterThan(0)
    }
  })

  it('the fixed source, in logs, keeps every star\'s light from cameras out to 100 ly', () => {
    const catalog = new StarsCatalog().read(toArrayBuffer(readFileSync('./public/data/stars.dat')))
    const stars = []
    catalog.starByHip.forEach((star) => stars.push(star))
    const cameras = [[0, 0, 0]]
    for (const r of [10, 100]) {
      for (const axis of [0, 1, 2]) {
        for (const sign of [1, -1]) {
          const c = [0, 0, 0]
          c[axis] = sign * r * ly
          cameras.push(c)
        }
      }
    }
    let zeroedOld = 0
    let worstNew = 0
    for (const [cx, cy, cz] of cameras) {
      for (const star of stars) {
        // On the view axis, the worst case: z is the whole distance.
        const z = Math.hypot(star.x - cx, star.y - cy, star.z - cz)
        if (z < 1e9) {
          continue // The camera at the Sun's centre
        }
        if (foldedOld(star.lumens, z) === 0) {
          zeroedOld++
        }
        const exact = star.lumens / (4 * Math.PI * z * z)
        const got = inLogs(star.lumens, z)
        expect(got).toBeGreaterThan(0)
        worstNew = Math.max(worstNew, Math.abs((got / exact) - 1))
      }
    }
    // main's, folded, lost thousands per camera; the fix none, to float32's precision.
    expect(zeroedOld).toBeGreaterThan(cameras.length * 6000)
    expect(worstNew).toBeLessThan(1e-5)
  })

  // The user's sequence on #162's preview (an M2, ANGLE on Metal): the
  // camera backing toward the Sun along the line to Orion, its orientation
  // fixed.  Thabit vanished between the first two, Na'ir al Saif between
  // the last two.  Camera and view direction in the catalogue's frame
  // (the StarsPoints' local frame), read from the app at each permalink.
  const STEPS = [
    {permalink: 'sun@-11.5262,78.8431,9766718.302289Tm;t=9774.6146jd;cq=-0.3224,0.0069,0.0162,0.9464;fov=45deg',
      camera: [1.912928135e18, -1.952126589e18, -9.376496901e18], gone: []},
    {permalink: 'sun@-9.9144,78.2679,9252405.953885Tm;t=9774.6153jd;cq=-0.3224,0.0069,0.0162,0.9464;fov=45deg',
      camera: [1.911432136e18, -1.593600198e18, -8.911446658e18], gone: ['Thabit']},
    {permalink: 'sun@12.6651,70.3926,5697611.579685Tm;t=9774.6159jd;cq=-0.3224,0.0069,0.0162,0.9464;fov=45deg',
      camera: [1.899582068e18, 1.248884719e18, -5.224428451e18], gone: ['Thabit']},
    {permalink: 'sun@14.373,69.7694,5570594.138746Tm;t=9774.6165jd;cq=-0.3224,0.0069,0.0162,0.9464;fov=45deg',
      camera: [1.8990224e18, 1.382490484e18, -5.051133838e18], gone: ['Thabit', 'Na\'ir al Saif']},
  ]
  const VIEW_DIR = [0.00254997, -0.61055631, -0.79196874]

  it('replays the user\'s sequence: each star goes as the camera passes 2^64 m from it, folded, and stays in logs', () => {
    const catalog = new StarsCatalog().read(toArrayBuffer(readFileSync('./public/data/stars.dat')))
    catalog.readNames(readFileSync('./public/data/starnames.dat', 'utf-8'))
    for (const {camera, gone} of STEPS) {
      for (const name of ['Alnilam', 'Thabit', 'Na\'ir al Saif']) {
        const star = catalog.starByHip.get(catalog.hipByName.get(name))
        const v = [star.x - camera[0], star.y - camera[1], star.z - camera[2]]
        // z: the distance along the view axis, as stars.vert has it.
        const z = (v[0] * VIEW_DIR[0]) + (v[1] * VIEW_DIR[1]) + (v[2] * VIEW_DIR[2])
        const past = z > FLOAT32_SQRT_MAX
        expect(past).toBe(gone.includes(name))
        expect(foldedOld(star.lumens, z) === 0).toBe(past)
        expect(asWritten(star.lumens, z)).toBeGreaterThan(0)
        expect(inLogs(star.lumens, z) / (star.lumens / (4 * Math.PI * z * z))).toBeCloseTo(1, 5)
      }
    }
  })

  it('a length in metres through safeLength (rte.js) is finite where length() overflows', () => {
    // safeLength: the largest component out, through clamp(), then length().
    const safeLength = (v) => {
      const a = v.map((x) => Math.abs(f32(x)))
      const m = Math.max(a[0], a[1], a[2], f32(1e-30))
      const u = v.map((x) => Math.min(Math.max(f32(f32(x) / m), -1), 1))
      return f32(m * f32(Math.sqrt(f32(f32(f32(u[0] * u[0]) + f32(u[1] * u[1])) + f32(u[2] * u[2])))))
    }
    const naiveLength = (v) => f32(Math.sqrt(f32(f32(f32(v[0] * v[0]) + f32(v[1] * v[1])) + f32(v[2] * v[2]))))
    for (const v of [[alnilam, 0, 0], [3e3 * ly, -4e3 * ly, 12e3 * ly], [1.2e4 * ly, 1.2e4 * ly, 1.2e4 * ly]]) {
      const exact = Math.hypot(...v)
      expect(naiveLength(v)).toBe(Infinity)
      expect(safeLength(v) / exact).toBeCloseTo(1, 6)
    }
    expect(safeLength([1, 2, 2])).toBeCloseTo(3, 6)
  })
})
