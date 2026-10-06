import {depthDistance, depthOf, rayEnd} from './rayEnd.js'


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
