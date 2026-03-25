import {Quaternion, Vector3} from 'three'
import {worldToLatLngAlt, latLngAltToLocal} from './coords.js'


const EARTH_RADIUS = 6371000 // meters


/**
 * Compute camera world position from platform-local position.
 * Assumes platform world position equals planetWorldPos (zero translation offset).
 */
function camWorldPosFrom(camLocalPos, planetWorldPos, platformWorldQuat) {
  return camLocalPos.clone().applyQuaternion(platformWorldQuat).add(planetWorldPos)
}


describe('worldToLatLngAlt — known positions', () => {
  it('camera directly above north pole → lat=90', () => {
    const {lat, alt} = worldToLatLngAlt(
        new Vector3(0, EARTH_RADIUS * 2, 0),
        new Vector3(0, 0, 0),
        new Quaternion(),
        EARTH_RADIUS,
    )
    expect(lat).toBeCloseTo(90, 4)
    expect(alt).toBeCloseTo(EARTH_RADIUS, 0)
  })

  it('camera directly below south pole → lat=-90', () => {
    const {lat, alt} = worldToLatLngAlt(
        new Vector3(0, -EARTH_RADIUS * 3, 0),
        new Vector3(0, 0, 0),
        new Quaternion(),
        EARTH_RADIUS,
    )
    expect(lat).toBeCloseTo(-90, 4)
    expect(alt).toBeCloseTo(EARTH_RADIUS * 2, 0)
  })

  it('camera at equator, prime meridian (+Z) → lat=0, lng=0', () => {
    const {lat, lng, alt} = worldToLatLngAlt(
        new Vector3(0, 0, EARTH_RADIUS * 2),
        new Vector3(0, 0, 0),
        new Quaternion(),
        EARTH_RADIUS,
    )
    expect(lat).toBeCloseTo(0, 4)
    expect(lng).toBeCloseTo(0, 4)
    expect(alt).toBeCloseTo(EARTH_RADIUS, 0)
  })

  it('camera at equator, 90° east (+X) → lat=0, lng=90', () => {
    const {lat, lng} = worldToLatLngAlt(
        new Vector3(EARTH_RADIUS * 2, 0, 0),
        new Vector3(0, 0, 0),
        new Quaternion(),
        EARTH_RADIUS,
    )
    expect(lat).toBeCloseTo(0, 4)
    expect(lng).toBeCloseTo(90, 4)
  })

  it('camera at equator, 90° west (−X) → lat=0, lng=−90', () => {
    const {lat, lng} = worldToLatLngAlt(
        new Vector3(-EARTH_RADIUS * 2, 0, 0),
        new Vector3(0, 0, 0),
        new Quaternion(),
        EARTH_RADIUS,
    )
    expect(lat).toBeCloseTo(0, 4)
    expect(lng).toBeCloseTo(-90, 4)
  })

  it('planet offset from origin: relative position is what matters', () => {
    const offset = new Vector3(1e11, 5e10, 3e10)
    const {lat, alt} = worldToLatLngAlt(
        new Vector3(0, EARTH_RADIUS * 2, 0).add(offset),
        offset,
        new Quaternion(),
        EARTH_RADIUS,
    )
    expect(lat).toBeCloseTo(90, 4)
    expect(alt).toBeCloseTo(EARTH_RADIUS, 0)
  })

  it('planet with axial tilt: rotates body-fixed frame', () => {
    // 90° tilt around Z: body Y-axis → world X-axis
    // Camera at world (EARTH_RADIUS*2, 0, 0) is in the body -Y direction after tilt:
    //   body-fixed rel = R_z(-90°) * (R,0,0) = (0,-R,0) → lat = -90°
    const planetQ = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2)
    const {lat} = worldToLatLngAlt(
        new Vector3(EARTH_RADIUS * 2, 0, 0),
        new Vector3(0, 0, 0),
        planetQ,
        EARTH_RADIUS,
    )
    expect(lat).toBeCloseTo(-90, 4)
  })
})


describe('worldToLatLngAlt / latLngAltToLocal round-trip', () => {
  function roundTrip(camLocalPos, planetWorldPos, planetQ, platformQ) {
    const camWorldPos = camWorldPosFrom(camLocalPos, planetWorldPos, platformQ)
    const {lat, lng, alt} = worldToLatLngAlt(
        camWorldPos, planetWorldPos, planetQ, EARTH_RADIUS,
    )
    return latLngAltToLocal(lat, lng, alt, EARTH_RADIUS, planetQ, platformQ)
  }

  it('identity quaternions, camera above north pole', () => {
    const camLocalPos = new Vector3(0, EARTH_RADIUS * 2, 0)
    const result = roundTrip(
        camLocalPos, new Vector3(1e11, 0, 0), new Quaternion(), new Quaternion(),
    )
    expect(result.x).toBeCloseTo(camLocalPos.x, 0)
    expect(result.y).toBeCloseTo(camLocalPos.y, 0)
    expect(result.z).toBeCloseTo(camLocalPos.z, 0)
  })

  it('identity quaternions, arbitrary off-axis camera position', () => {
    const camLocalPos = new Vector3(3e6, 7e6, -5e6)
    const result = roundTrip(
        camLocalPos, new Vector3(0, 0, 0), new Quaternion(), new Quaternion(),
    )
    expect(result.x).toBeCloseTo(camLocalPos.x, 0)
    expect(result.y).toBeCloseTo(camLocalPos.y, 0)
    expect(result.z).toBeCloseTo(camLocalPos.z, 0)
  })

  it('planet with 23.5° axial tilt (Earth-like), identity platform', () => {
    const tilt = 23.5 * Math.PI / 180
    const planetQ = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), tilt)
    const camLocalPos = new Vector3(1e7, 2e7, 3e7)
    const result = roundTrip(
        camLocalPos, new Vector3(0, 0, 0), planetQ, new Quaternion(),
    )
    expect(result.x).toBeCloseTo(camLocalPos.x, 0)
    expect(result.y).toBeCloseTo(camLocalPos.y, 0)
    expect(result.z).toBeCloseTo(camLocalPos.z, 0)
  })

  it('non-trivial platform quaternion (platform rotated 60° around Y)', () => {
    const platformQ = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 3)
    const camLocalPos = new Vector3(0, 0, -EARTH_RADIUS * 5)
    const result = roundTrip(
        camLocalPos, new Vector3(1e11, 0, 0), new Quaternion(), platformQ,
    )
    expect(result.x).toBeCloseTo(camLocalPos.x, 0)
    expect(result.y).toBeCloseTo(camLocalPos.y, 0)
    expect(result.z).toBeCloseTo(camLocalPos.z, 0)
  })

  it('both planet tilt and platform rotation, off-axis camera', () => {
    const planetQ = new Quaternion()
        .setFromAxisAngle(new Vector3(0, 0, 1), 23.5 * Math.PI / 180)
    const platformQ = new Quaternion()
        .setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 4)
        .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 6))
    const camLocalPos = new Vector3(5e6, -3e6, 1e7)
    const result = roundTrip(
        camLocalPos, new Vector3(3e11, 1e10, 2e11), planetQ, platformQ,
    )
    expect(result.x).toBeCloseTo(camLocalPos.x, 0)
    expect(result.y).toBeCloseTo(camLocalPos.y, 0)
    expect(result.z).toBeCloseTo(camLocalPos.z, 0)
  })

  it('southern hemisphere, west longitude (negative lat/lng)', () => {
    // Sydney: lat=-33.87, lng=151.21
    const lat = -33.8688
    const lng = 151.2093
    const alt = 10000
    const r = EARTH_RADIUS + alt
    const latRad = lat * Math.PI / 180
    const lngRad = lng * Math.PI / 180
    const bodyFixed = new Vector3(
        r * Math.cos(latRad) * Math.sin(lngRad),
        r * Math.sin(latRad),
        r * Math.cos(latRad) * Math.cos(lngRad),
    )
    // With identity quaternions, body-fixed = world-relative = camera world pos (planet at origin)
    const {lat: dl, lng: dg, alt: da} = worldToLatLngAlt(
        bodyFixed, new Vector3(0, 0, 0), new Quaternion(), EARTH_RADIUS,
    )
    expect(dl).toBeCloseTo(lat, 4)
    expect(dg).toBeCloseTo(lng, 4)
    expect(da).toBeCloseTo(alt, 0)
  })

  it('large interplanetary distance (1 Tm)', () => {
    const camLocalPos = new Vector3(5e11, 2e11, 3e11)
    const result = roundTrip(
        camLocalPos, new Vector3(1e11, 0, 0), new Quaternion(), new Quaternion(),
    )
    // Absolute error at this scale should be well under 1 m
    expect(result.x).toBeCloseTo(camLocalPos.x, 0)
    expect(result.y).toBeCloseTo(camLocalPos.y, 0)
    expect(result.z).toBeCloseTo(camLocalPos.z, 0)
  })

  it('camera very close to surface (1 m altitude)', () => {
    const alt = 1
    const camLocalPos = new Vector3(0, EARTH_RADIUS + alt, 0)
    const result = roundTrip(
        camLocalPos, new Vector3(0, 0, 0), new Quaternion(), new Quaternion(),
    )
    expect(result.x).toBeCloseTo(camLocalPos.x, 0)
    expect(result.y).toBeCloseTo(camLocalPos.y, 0)
    expect(result.z).toBeCloseTo(camLocalPos.z, 0)
  })
})


describe('latLngAltToLocal produces expected body-fixed directions', () => {
  it('lat=90 places camera directly above north pole in body-fixed +Y', () => {
    // With identity quaternions, platform-local = world-relative = body-fixed
    const result = latLngAltToLocal(90, 0, EARTH_RADIUS, EARTH_RADIUS, new Quaternion(), new Quaternion())
    // Expect (0, 2*R, 0)
    expect(result.x).toBeCloseTo(0, 0)
    expect(result.y).toBeCloseTo(EARTH_RADIUS * 2, 0)
    expect(result.z).toBeCloseTo(0, 0)
  })

  it('lat=0, lng=0 places camera along +Z (prime meridian)', () => {
    const result = latLngAltToLocal(0, 0, EARTH_RADIUS, EARTH_RADIUS, new Quaternion(), new Quaternion())
    expect(result.x).toBeCloseTo(0, 0)
    expect(result.y).toBeCloseTo(0, 0)
    expect(result.z).toBeCloseTo(EARTH_RADIUS * 2, 0)
  })

  it('lat=0, lng=90 places camera along +X', () => {
    const result = latLngAltToLocal(0, 90, EARTH_RADIUS, EARTH_RADIUS, new Quaternion(), new Quaternion())
    expect(result.x).toBeCloseTo(EARTH_RADIUS * 2, 0)
    expect(result.y).toBeCloseTo(0, 0)
    expect(result.z).toBeCloseTo(0, 0)
  })
})
