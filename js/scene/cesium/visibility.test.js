import {Vector3} from 'three'
import {groundInView, halfDiagonal, hiddenBehind} from './visibility.js'


describe('hiddenBehind', () => {
  const R = 6371e3
  const moonR = 1737.4e3 * 1.01
  const earth = new Vector3(0, 0, 0)
  // 7.5 km over the north pole of a sphere at the origin.
  const eye = new Vector3(0, R + 7500, 0)
  const moonAt = (elevationDeg) => {
    const e = elevationDeg * Math.PI / 180
    return eye.clone().add(new Vector3(Math.cos(e), Math.sin(e), 0).multiplyScalar(3.844e8))
  }

  it('hides the Moon well under the horizon from the ground', () => {
    expect(hiddenBehind(eye, moonAt(-90), moonR, earth, R)).toBe(true)
    expect(hiddenBehind(eye, moonAt(-10), moonR, earth, R)).toBe(true)
  })

  it('does not hide it over the horizon, nor rising or setting across it', () => {
    expect(hiddenBehind(eye, moonAt(30), moonR, earth, R)).toBe(false)
    // The horizon dips 2.8 degrees from 7.5 km; the Moon is half a degree.
    expect(hiddenBehind(eye, moonAt(-2.8), moonR, earth, R)).toBe(false)
    expect(hiddenBehind(eye, moonAt(-2.6), moonR, earth, R)).toBe(false)
  })

  it('is conservative with a smaller occluder ground', () => {
    // At 0.994 R the horizon is 6.9 degrees down, not 2.8.
    expect(hiddenBehind(eye, moonAt(-6.5), moonR, earth, R * 0.994)).toBe(false)
    expect(hiddenBehind(eye, moonAt(-8), moonR, earth, R * 0.994)).toBe(true)
  })

  it('does not hide a body in front of the occluder', () => {
    // A body between the eye and the ground, in the occluder's cone.
    const near = eye.clone().add(new Vector3(0, -3000, 0))
    expect(hiddenBehind(eye, near, 100, earth, R)).toBe(false)
  })

  it('hides nothing from an eye inside the occluder or the body', () => {
    expect(hiddenBehind(new Vector3(0, R - 10, 0), moonAt(-90), moonR, earth, R)).toBe(false)
    expect(hiddenBehind(eye, eye.clone(), moonR, earth, R)).toBe(false)
  })

  it('hides Earth behind the Moon, from the far side', () => {
    const moon = new Vector3(3.844e8, 0, 0)
    const farSide = new Vector3(3.844e8 + 1737.4e3 + 1e5, 0, 0)
    expect(hiddenBehind(farSide, earth, R * 1.01, moon, 1737.4e3 * 0.994)).toBe(true)
    // Not from beside it.
    expect(hiddenBehind(new Vector3(3.844e8, 1737.4e3 + 1e5, 0), earth, R * 1.01, moon, 1737.4e3 * 0.994)).toBe(false)
  })
})


describe('groundInView', () => {
  const R = 6371e3
  const earth = new Vector3(0, 0, 0)
  // 2.5 km over the north pole: up is +Y, the horizon dips 1.6 degrees.
  const eye = new Vector3(0, R + 2500, 0)
  const looking = (elevationDeg) => {
    const e = elevationDeg * Math.PI / 180
    return new Vector3(Math.cos(e), Math.sin(e), 0)
  }
  // A 45 degree vertical field on a 16:9 frame: 40.2 degrees to a corner.
  const half = halfDiagonal(45, 16 / 9)

  it('measures a frame to its corners', () => {
    expect(half * 180 / Math.PI).toBeCloseTo(40.2, 1)
    expect(halfDiagonal(45, 1) * 180 / Math.PI).toBeCloseTo(30.4, 1)
  })

  it('sees no ground looking up into the sky from the surface', () => {
    expect(groundInView(eye, looking(90), half, earth, R)).toBe(false)
    expect(groundInView(eye, looking(55), half, earth, R)).toBe(false)
  })

  it('sees the ground with the horizon, or near it, in the frame', () => {
    // The frame's corners reach 40.2 degrees from its centre: at 30 up,
    // 10.2 under the horizontal.
    expect(groundInView(eye, looking(30), half, earth, R)).toBe(true)
    // At 45 up, 6.4 over the horizon: within the land's margin.
    expect(groundInView(eye, looking(45), half, earth, R)).toBe(true)
    expect(groundInView(eye, looking(0), half, earth, R)).toBe(true)
    expect(groundInView(eye, looking(-90), half, earth, R)).toBe(true)
  })

  it('takes a level horizon from under the mean surface', () => {
    const low = new Vector3(0, R - 400, 0)
    expect(groundInView(low, looking(90), half, earth, R)).toBe(false)
    expect(groundInView(low, looking(40), half, earth, R)).toBe(true)
  })

  it('sees the Earth from space when it\'s in the frame, and not when it\'s behind', () => {
    const far = new Vector3(0, 0, 4e8)
    expect(groundInView(far, new Vector3(0, 0, -1), half, earth, R)).toBe(true)
    expect(groundInView(far, new Vector3(0, 0, 1), half, earth, R)).toBe(false)
  })
})
