import {Vector3} from 'three'
import {hiddenBehind} from './visibility.js'


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
