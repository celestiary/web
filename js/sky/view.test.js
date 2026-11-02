import {describe, expect, it} from 'bun:test'
import {Vector3} from 'three'
import {METERED_GAIN, fieldOf, landedQuaternion, skyGain, sunAltitude} from './view.js'


// The sky guest's view (design/SkyGuest.md): a host's equator-of-date
// camera as celestiary's landed camera, the Sun's altitude, the exposure.


/**
 * A view matrix (column-major) whose eye looks along `f` with `up` up, in
 * the equator frame.
 *
 * @param {Array<number>} f
 * @param {Array<number>} up
 * @returns {Array<number>}
 */
function lookAlong(f, up) {
  const z = new Vector3(...f).negate().normalize()
  const x = new Vector3(...up).cross(z).normalize()
  const y = z.clone().cross(x)
  return [x.x, y.x, z.x, 0, x.y, y.y, z.y, 0, x.z, y.z, z.z, 0, 0, 0, 0, 1]
}
const forward = (q) => new Vector3(0, 0, -1).applyQuaternion(q)


describe('a host\'s view as the landed camera', () => {
  it('looks at the celestial pole along Earth\'s axis, whatever the time', () => {
    for (const g of [0, 1, 4]) {
      const f = forward(landedQuaternion(lookAlong([0, 0, 1], [0, 1, 0]), g))
      expect(f.distanceTo(new Vector3(0, 1, 0))).toBeLessThan(1e-9)
    }
  })

  it('finds the equinox west of Greenwich by GMST', () => {
    const g = 0.7
    // Body-fixed: +X Greenwich, east −Z, so a longitude −g is (cos g, 0, sin g).
    const f = forward(landedQuaternion(lookAlong([1, 0, 0], [0, 0, 1]), g))
    expect(f.distanceTo(new Vector3(Math.cos(g), 0, Math.sin(g)))).toBeLessThan(1e-9)
    // And its up is the pole's way.
    const up = new Vector3(0, 1, 0).applyQuaternion(landedQuaternion(lookAlong([1, 0, 0], [0, 0, 1]), g))
    expect(up.distanceTo(new Vector3(0, 1, 0))).toBeLessThan(1e-9)
  })

  it('reads a perspective\'s field and aspect', () => {
    const fov = 70
    const aspect = 16 / 9
    const f = 1 / Math.tan(fov * Math.PI / 360)
    const got = fieldOf([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, -1, -1, 0, 0, -2, 0])
    expect(got.fov).toBeCloseTo(fov, 9)
    expect(got.aspect).toBeCloseTo(aspect, 9)
  })
})


describe('the exposure from the Sun\'s altitude', () => {
  it('puts the Sun where the almanac does', () => {
    // The table's own samples, 55.62° N, 0° E, 2026-11-02.
    const at = (hm) => sunAltitude(Date.parse(`2026-11-02T${hm}:00Z`), 55.62, 0)
    expect(at('12:00')).toBeCloseTo(19.5, 0)
    expect(at('16:15')).toBeCloseTo(-0.4, 0)
    expect(at('18:30')).toBeCloseTo(-18.8, 0)
    // The June solstice's noon at 51.5° N: 90 − 51.5 + 23.44.
    expect(sunAltitude(Date.parse('2026-06-21T12:02:00Z'), 51.5, 0)).toBeCloseTo(61.9, 0)
  })

  it('gives the metered gain at its samples, and between them in its logarithm', () => {
    for (const [alt, gain] of METERED_GAIN) {
      expect(skyGain(alt)).toBeCloseTo(gain, 6)
    }
    expect(skyGain(60)).toBe(1)
    expect(skyGain(-80)).toBe(METERED_GAIN.at(-1)[1])
    const [[a0, g0], [a1, g1]] = [METERED_GAIN[4], METERED_GAIN[5]]
    expect(skyGain((a0 + a1) / 2)).toBeCloseTo(Math.sqrt(g0 * g1), 3)
    // Darker as the Sun sinks.
    let last = 0
    for (let a = 30; a > -60; a -= 0.5) {
      expect(skyGain(a)).toBeGreaterThanOrEqual(last)
      last = skyGain(a)
    }
  })
})
