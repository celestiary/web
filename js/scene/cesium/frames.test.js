import {Euler, Matrix4, PerspectiveCamera, Quaternion, Vector3} from 'three'
import {latLngAltToBodyFixed} from '../../coords.js'
import {toRad} from '../../shared.js'
import {bodyToEcef, cameraToEcefView, cesiumFov, ecefToBody, ellipsoidCameraPosition, sunLightDirectionEcef} from './frames.js'


const R = 6378137


/**
 * Cesium's Cartesian3.fromDegrees on a sphere of radius r.
 *
 * @returns {Array<number>}
 */
function sphereFromDegrees(lngDeg, latDeg, r) {
  const lng = lngDeg * toRad
  const lat = latDeg * toRad
  return [r * Math.cos(lat) * Math.cos(lng), r * Math.cos(lat) * Math.sin(lng), r * Math.sin(lat)]
}


/** Asserts two 3-vectors are within tol of each other. */
function expectClose(a, b, tol = 1e-6) {
  for (let i = 0; i < 3; i++) {
    expect(Math.abs(a[i] - b[i])).toBeLessThan(tol)
  }
}


describe('bodyToEcef', () => {
  it('maps celestiary lat/lng to the same point as Cesium fromDegrees', () => {
    for (const [lat, lng] of [[0, 0], [0, 90], [45, -60], [-33.9, 18.4], [89, 170]]) {
      const ecef = bodyToEcef(latLngAltToBodyFixed(lat, lng, 0, R))
      expectClose(ecef, sphereFromDegrees(lng, lat, R), 1e-3)
    }
  })

  it('is a proper rotation (right-handed axes stay right-handed)', () => {
    const x = bodyToEcef(new Vector3(1, 0, 0))
    const y = bodyToEcef(new Vector3(0, 1, 0))
    const z = bodyToEcef(new Vector3(0, 0, 1))
    const cross = new Vector3(...x).cross(new Vector3(...y))
    expectClose(cross.toArray(), z)
  })

  it('round-trips through ecefToBody', () => {
    const v = new Vector3(1.5, -2.25, 3.125)
    expectClose(ecefToBody(bodyToEcef(v)).toArray(), v.toArray())
  })
})


describe('cameraToEcefView', () => {
  it('a camera above 0°N 0°E looking down sees the planet centre', () => {
    const body = new Matrix4() // identity: body frame == world
    const cam = new PerspectiveCamera()
    cam.position.set(2 * R, 0, 0)
    cam.lookAt(0, 0, 0)
    cam.updateMatrixWorld()
    const view = cameraToEcefView(cam.matrixWorld, body)
    expectClose(view.position, [2 * R, 0, 0], 1e-3)
    expectClose(view.direction, [-1, 0, 0])
    expectClose(view.up, [0, 0, 1]) // three's default up (+Y body) is north
  })

  it('undoes the body\'s tilt, spin and heliocentric offset', () => {
    const q = new Quaternion().setFromEuler(new Euler(0.41, 1.3, 0.2))
    const body = new Matrix4().compose(new Vector3(1.5e11, -2e10, 3e9), q, new Vector3(1, 1, 1))
    // Camera 3R above 45°N 60°W, in the body frame, then carried into world.
    const local = latLngAltToBodyFixed(45, -60, 2 * R, R)
    const cam = new PerspectiveCamera()
    cam.position.copy(local).applyMatrix4(body)
    cam.up.set(0, 1, 0).applyQuaternion(q)
    cam.lookAt(new Vector3().setFromMatrixPosition(body))
    cam.updateMatrixWorld()
    const view = cameraToEcefView(cam.matrixWorld, body)
    expectClose(view.position, sphereFromDegrees(-60, 45, 3 * R), 1)
    const toCentre = new Vector3(...view.position).negate().normalize()
    expectClose(view.direction, toCentre.toArray(), 1e-6)
  })
})


describe('sunLightDirectionEcef', () => {
  it('points from the Sun (world origin) toward the body, in ECEF', () => {
    // Body on the world +X axis, unrotated: light travels +X world = +X ECEF.
    const body = new Matrix4().makeTranslation(1.5e11, 0, 0)
    expectClose(sunLightDirectionEcef(body, new Vector3()), [1, 0, 0])
  })
})


describe('cesiumFov', () => {
  it('passes vertical fov through for portrait canvases', () => {
    expect(cesiumFov(0.8, 0.5)).toBe(0.8)
  })

  it('widens to the horizontal fov for landscape canvases', () => {
    const fov = cesiumFov(2 * Math.atan(1), 2)
    expect(Math.tan(fov / 2)).toBeCloseTo(2, 10)
  })
})


describe('ellipsoidCameraPosition', () => {
  const mars = 3389500
  const marsRadii = [3396190, 3396190, 3376200]

  it('keeps the camera on the same ray from the body centre', () => {
    // 30,000 km over Mars at 25° S: where lat/lng/alt placement erred.
    const cam = bodyToEcef(latLngAltToBodyFixed(-25, -160, 3e7, mars))
    const out = ellipsoidCameraPosition(cam, mars, marsRadii)
    const r0 = Math.hypot(...cam)
    const r1 = Math.hypot(...out)
    for (let i = 0; i < 3; i++) {
      expect(out[i] / r1).toBeCloseTo(cam[i] / r0, 12)
    }
  })

  it('keeps the height over the ellipsoid, along the ray', () => {
    const cam = bodyToEcef(latLngAltToBodyFixed(-33.9, 18.4, 5000, 6371010))
    const out = ellipsoidCameraPosition(cam, 6371010, [R, R, 6356752.314245179])
    const r = Math.hypot(...out)
    const [x, y, z] = out.map((v) => v / r)
    const surface = 1 / Math.hypot(x / R, y / R, z / 6356752.314245179)
    expect(r - surface).toBeCloseTo(5000, 6)
  })

  it('puts an equatorial camera over the equatorial radius', () => {
    const out = ellipsoidCameraPosition([6371010 + 5000, 0, 0], 6371010, [R, R, 6356752.314245179])
    expect(out[0]).toBeCloseTo(R + 5000, 6)
    expect(out[1]).toBe(0)
    expect(out[2]).toBe(0)
  })
})
