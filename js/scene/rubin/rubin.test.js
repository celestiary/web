import {describe, expect, it} from 'bun:test'
import {Euler, Quaternion, Vector3} from 'three'
import {latLngAltToBodyFixed} from '../../coords.js'
import {
  RUBIN_MIN_EL_DEG, RUBIN_RUN_END_MS, RUBIN_RUN_START_MS, RUBIN_SITE, RUBIN_TARGET,
} from '../../store/rubinApp.js'
import {
  DOME_OPENS_SUN_EL_DEG, MAX_EL_DEG, MIN_EL_DEG, RUN_END_MS, RUN_START_MS, SITE, TARGET, altAz, canObserve,
  localFrameQuaternion, mountAngles, pointingState,
} from './rubin.js'


const toRad = Math.PI / 180
const near = (v, x, y, z, digits = 6) => {
  expect(v.x).toBeCloseTo(x, digits)
  expect(v.y).toBeCloseTo(y, digits)
  expect(v.z).toBeCloseTo(z, digits)
}


/**
 * Where the model's tube points for a mount's angles: the azimuth group
 * turned about +Y, the elevation group about its +X, the tube along +Y.
 *
 * @param {{azimuthY: number, elevationX: number}} angles
 * @returns {Vector3} unit, local frame
 */
function tubeDirection({azimuthY, elevationX}) {
  const q = new Quaternion().setFromEuler(new Euler(0, azimuthY, 0))
  q.multiply(new Quaternion().setFromEuler(new Euler(elevationX, 0, 0)))
  return new Vector3(0, 1, 0).applyQuaternion(q)
}


describe('what the panel repeats (store/rubinApp.js)', () => {
  it('is the feature\'s own', () => {
    expect(RUBIN_TARGET).toBe(TARGET)
    expect(RUBIN_SITE).toEqual({lat: SITE.lat, lng: SITE.lng})
    expect(RUBIN_RUN_START_MS).toBe(RUN_START_MS)
    expect(RUBIN_RUN_END_MS).toBe(RUN_END_MS)
    expect(RUBIN_MIN_EL_DEG).toBe(MIN_EL_DEG)
  })
})


describe('the local frame at a site', () => {
  it('at latitude 0, longitude 0: up is +X, north the pole, east toward −Z', () => {
    const q = localFrameQuaternion(0, 0)
    near(new Vector3(0, 1, 0).applyQuaternion(q), 1, 0, 0)
    near(new Vector3(0, 0, -1).applyQuaternion(q), 0, 1, 0)
    near(new Vector3(1, 0, 0).applyQuaternion(q), 0, 0, -1)
  })

  it('at Cerro Pachón: up is the radial, north leans to the pole, east is level', () => {
    const q = localFrameQuaternion(SITE.lat, SITE.lng)
    const up = new Vector3(0, 1, 0).applyQuaternion(q)
    const radial = latLngAltToBodyFixed(SITE.lat, SITE.lng, 0, 1)
    near(up, radial.x, radial.y, radial.z)
    const north = new Vector3(0, 0, -1).applyQuaternion(q)
    expect(north.dot(new Vector3(0, 1, 0))).toBeCloseTo(Math.cos(SITE.lat * toRad), 6)
    expect(north.dot(up)).toBeCloseTo(0, 6)
    const east = new Vector3(1, 0, 0).applyQuaternion(q)
    expect(east.y).toBeCloseTo(0, 6)
    expect(east.dot(up)).toBeCloseTo(0, 6)
    // Right-handed: east × north = up.
    near(east.clone().cross(north), up.x, up.y, up.z)
  })
})


describe('altitude and azimuth', () => {
  it('reads the zenith, the horizon\'s points of the compass, and an elevation', () => {
    expect(altAz(new Vector3(0, 5, 0))).toEqual({el: 90, az: 0})
    expect(altAz(new Vector3(0, 0, -1)).az).toBeCloseTo(0, 9)
    expect(altAz(new Vector3(1, 0, 0)).az).toBeCloseTo(90, 9)
    expect(altAz(new Vector3(0, 0, 1)).az).toBeCloseTo(180, 9)
    expect(altAz(new Vector3(-1, 0, 0)).az).toBeCloseTo(270, 9)
    const {el, az} = altAz(new Vector3(1, 1, -1))
    expect(el).toBeCloseTo(35.264, 3)
    expect(az).toBeCloseTo(45, 9)
    expect(altAz(new Vector3(0, 0, 0))).toEqual({el: 0, az: 0})
  })

  it('observes a body over 20° by night only', () => {
    expect(canObserve(50, -30)).toBe(true)
    expect(canObserve(MIN_EL_DEG, DOME_OPENS_SUN_EL_DEG)).toBe(true)
    expect(canObserve(19, -30)).toBe(false)
    expect(canObserve(50, -11)).toBe(false)
    expect(canObserve(50, 40)).toBe(false)
  })
})


describe('the mount', () => {
  it('turns the tube to the pointing', () => {
    for (const [el, az] of [[30, 90], [45, 0], [60, 200], [20, 315], [80, 135]]) {
      const dir = tubeDirection(mountAngles(el, az))
      const back = altAz(dir)
      expect(back.el).toBeCloseTo(el, 6)
      expect(back.az).toBeCloseTo(az, 6)
    }
  })

  it('holds within its range: 20° up to 86.5°, short of the zenith', () => {
    expect(altAz(tubeDirection(mountAngles(5, 10))).el).toBeCloseTo(MIN_EL_DEG, 6)
    expect(altAz(tubeDirection(mountAngles(89, 10))).el).toBeCloseTo(MAX_EL_DEG, 6)
  })

  it('follows a body up by night, and parks at the zenith with the dome shut by day or with the body down', () => {
    const night = pointingState(new Vector3(1, 1, 0), new Vector3(0, -1, 0))
    expect(night.tracking).toBe(true)
    expect(night.open).toBe(true)
    expect(night.el).toBeCloseTo(45, 6)
    expect(night.az).toBeCloseTo(90, 6)
    expect(night.sunEl).toBe(-90)
    const dusk = pointingState(new Vector3(1, 1, 0), new Vector3(-1, -0.5, 0))
    expect(dusk.sunAz).toBeCloseTo(270, 6)
    const dir = tubeDirection(night)
    near(dir, Math.SQRT1_2, Math.SQRT1_2, 0)

    const day = pointingState(new Vector3(1, 1, 0), new Vector3(0, 1, 1))
    expect(day.tracking).toBe(false)
    expect(day.open).toBe(false)
    expect(day.el).toBe(90)
    expect(day.bodyEl).toBeCloseTo(45, 6)
    near(tubeDirection(day), 0, 1, 0)

    const low = pointingState(new Vector3(1, 0.1, 0), new Vector3(0, -1, 0))
    expect(low.tracking).toBe(false)
    expect(low.bodyEl).toBeCloseTo(5.71, 2)
  })
})
