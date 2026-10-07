import {readFileSync} from 'fs'
import {depthDistance, depthOf, rayEnd, raySphere, shellAhead} from './rayEnd.js'


// The camera's far plane: six galaxy radii (ThreeUI.configLargeScene).
const FAR = 2.8383e21
const EARTH_R = 6.371e6
const ATM_TOP = EARTH_R + 1e5


/**
 * Where a ray from a camera `alt` metres over a sphere leaves the shell of
 * radius `top`, at elevation `elevDeg` over the local horizontal.
 *
 * @returns {number} metres
 */
function exitDistance(alt, elevDeg, top = ATM_TOP) {
  const r = EARTH_R + alt
  const mu = Math.sin(elevDeg * Math.PI / 180)
  return (-r * mu) + Math.sqrt((r * r * ((mu * mu) - 1)) + (top * top))
}


describe('rayEnd', () => {
  describe('Jupiter from Earth\'s surface (near 100 m)', () => {
    const near = 100
    const d = 8.76e11
    const exit = exitDistance(156, 16)

    it('writes the far plane itself, or a step under it', () => {
      expect(depthOf(d, near, FAR)).toBe(1)
      const oneStep = 1 - (1 / ((2 ** 24) - 1))
      const {tMax, tMaxErr} = depthDistance(oneStep, near, FAR)
      // A step under far reads 1.5e9 m, with an error larger than itself:
      // noise, not Jupiter's 8.8e11.
      expect(tMax).toBeGreaterThan(1e9)
      expect(tMax).toBeLessThan(2e9)
      expect(tMaxErr).toBeGreaterThan(tMax)
    })

    it('treats every depth near the far plane as past the atmosphere', () => {
      for (let steps = 0; steps <= 64; steps++) {
        const depthSample = 1 - (steps / ((2 ** 24) - 1))
        const end = rayEnd({depthSample, near, far: FAR, exitDistance: exit, inside: true})
        expect(end === 'background' || end === 'past').toBe(true)
      }
    })

    it('was a short ray before (the dashes): its distance minus the error is inside the air', () => {
      const {tMax, tMaxErr} = depthDistance(1 - (1 / ((2 ** 24) - 1)), near, FAR)
      expect(tMax - tMaxErr).toBeLessThan(exit)
    })
  })

  it('takes the Moon from the ground as past the atmosphere', () => {
    const near = 100
    const depthSample = depthOf(3.84e8, near, FAR)
    expect(depthSample).toBeLessThan(1)
    expect(rayEnd({depthSample, near, far: FAR, exitDistance: exitDistance(156, 30), inside: true})).toBe('past')
  })

  describe('a surface inside the air, seen from inside it, stays a short ray', () => {
    const cases = [
      // [camera altitude, near, distance to the surface, elevation of the ray]
      ['ground 2 km off, from 156 m', 156, 100, 2e3, -5],
      ['terrain at the encoding\'s limit, 220 km, from the ground', 2, 100, 2.2e5, 0.2],
      ['a ridge 770 km off from 20 km up', 2e4, 2e3, 7.7e5, -2],
      ['the horizon from 99 km up', 9.9e4, 9.9e3, 1.12e6, -10],
    ]
    for (const [name, alt, near, d, elev] of cases) {
      it(name, () => {
        const depthSample = depthOf(d, near, FAR)
        expect(rayEnd({depthSample, near, far: FAR, exitDistance: exitDistance(alt, elev), inside: true})).toBe('short')
      })
    }
  })

  it('keeps the planet\'s limb ground from afar, where depth is coarser than the air', () => {
    // From 1.5e9 m with near 600 km: a step is ~200 km at the planet, more
    // than the air the limb's ray crosses past the ground.
    const near = 6e5
    const d = 1.5e9
    const depthSample = depthOf(d, near, FAR)
    const {tMaxErr} = depthDistance(depthSample, near, FAR)
    const exit = d + (tMaxErr / 2)
    expect(rayEnd({depthSample, near, far: FAR, exitDistance: exit, inside: false})).toBe('ground')
  })
})


describe('shellAhead', () => {
  /**
   * A ray from `dist` metres from the planet's centre, `offDeg` degrees off
   * the direction to its centre.
   *
   * @returns {Array<number>} The ray's interval through the atmosphere's shell
   */
  function shellInterval(dist, offDeg) {
    const off = offDeg * Math.PI / 180
    // The eye on +z, the centre at the origin: toward it is -z.
    return raySphere([0, 0, dist], [Math.sin(off), 0, -Math.cos(off)], ATM_TOP)
  }

  it('takes a planet ahead, seen from orbit, as a hit', () => {
    expect(shellAhead(shellInterval(EARTH_R + 4.6e6, 0))).toBe(true)
    expect(shellAhead(shellInterval(EARTH_R + 4.6e6, 30))).toBe(true)
  })

  it('takes every ray from inside the air as a hit', () => {
    for (const off of [0, 60, 90, 120, 180]) {
      expect(shellAhead(shellInterval(EARTH_R + 1e3, off))).toBe(true)
    }
  })

  it('takes a ray whose line misses the shell as a miss', () => {
    expect(shellAhead(shellInterval(EARTH_R + 4.6e6, 60))).toBe(false)
  })

  describe('the "blue Earth": the shell behind the eye is no hit', () => {
    // The user's views, looking toward the Sun from over Earth's day side
    // with Earth behind the camera: the pass drew Earth's atmosphere
    // mirrored through the eye, a flat blue disc.
    const cases = [
      // [name, eye's altitude, ray's angle off the direction to the centre]
      ['from 222 km, straight up', 2.22524e5, 180],
      ['from 222 km, 40° over the local horizontal', 2.22524e5, 130],
      ['from 4.6 Mm, the view\'s axis', 4.606397e6, 151],
      ['from 78 Mm, the disc\'s middle', 7.8475698e7, 178],
    ]
    for (const [name, alt, off] of cases) {
      it(name, () => {
        const interval = shellInterval(EARTH_R + alt, off)
        // Its line does meet the shell, both distances behind the eye: the
        // old test (near <= far) took it for a hit.
        expect(interval[0]).toBeLessThanOrEqual(interval[1])
        expect(interval[1]).toBeLessThan(0)
        expect(shellAhead(interval)).toBe(false)
      })
    }
  })

  it('is what the pass tests a ray\'s atmosphere with', () => {
    const source = readFileSync('./js/scene/atmos/Atmosphere.js', 'utf8')
    expect(source).toContain('${SHELL_AHEAD_GLSL}')
    expect(source).toContain('if (!shellAhead(pAtm))')
    expect(source).not.toContain('if (pAtm.x > pAtm.y)')
  })
})
