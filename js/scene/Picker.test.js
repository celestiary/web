import {describe, expect, it} from 'bun:test'
import {Object3D, PerspectiveCamera, Quaternion} from 'three'
import {latLngAltToBodyFixed} from '../coords.js'
import {MAX_PICK_PX, pickSurfaceLatLng, queryPlaces} from './Picker.js'


// Synthetic body & UI helpers — no WebGL, no DOM.
const EARTH_R = 6.371e6


function makeBody(name = 'earth') {
  const body = new Object3D()
  body.name = name
  body.props = {name, radius: {scalar: EARTH_R}, has_locations: true}
  return body
}


function makeUI(width = 1280, height = 720) {
  const camera = new PerspectiveCamera(45, width / height, 1, 1e12)
  // Look at the body from +X so lat=0,lng=0 (the prime-meridian point at
  // +X body-local under the texture-aligned convention) sits dead-centre
  // on screen.  Camera position must be > radius for the body to subtend
  // a sensible solid angle.
  camera.position.set(EARTH_R * 5, 0, 0)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld(true)
  return {
    renderer: {domElement: {clientWidth: width, clientHeight: height}},
    camera,
  }
}


/** Project a body-fixed XYZ to {clientX, clientY} for a given body+ui. */
function project(ui, body, lat, lng) {
  const local = latLngAltToBodyFixed(lat, lng, 0, body.props.radius.scalar)
  body.updateMatrixWorld(true)
  const world = local.applyMatrix4(body.matrixWorld)
  const ndc = world.project(ui.camera)
  return {
    clientX: ((ndc.x + 1) / 2) * ui.renderer.domElement.clientWidth,
    clientY: ((1 - ndc.y) / 2) * ui.renderer.domElement.clientHeight,
  }
}


describe('queryPlaces', () => {
  it('picks the entry directly under the cursor', () => {
    const ui = makeUI()
    const body = makeBody()
    const entries = [
      {n: 'A', lat: 0, lng: 0}, // dead centre when camera at +Z
      {n: 'B', lat: 0, lng: 30},
      {n: 'C', lat: 30, lng: 0},
    ]
    const center = project(ui, body, 0, 0)
    let picked = null
    queryPlaces(ui, center, body, entries, (e) => {
      picked = e
    })
    expect(picked?.n).toBe('A')
  })

  it('rejects picks beyond MAX_PICK_PX from any entry', () => {
    const ui = makeUI()
    const body = makeBody()
    const entries = [{n: 'A', lat: 0, lng: 0}]
    const center = project(ui, body, 0, 0)
    let picked = null
    queryPlaces(ui, {clientX: center.clientX + MAX_PICK_PX + 50, clientY: center.clientY},
        body, entries, (e) => {
          picked = e
        })
    expect(picked).toBeNull()
  })

  it('does not pick entries on the back hemisphere', () => {
    const ui = makeUI()
    const body = makeBody()
    // Camera at +X; lng=180 puts the entry on the far side (−X body-fixed).
    const entries = [{n: 'BackSide', lat: 0, lng: 180}]
    // Even clicking dead-centre of viewport (where the back-side entry would
    // project through the body) shouldn't pick it.
    queryPlaces(ui, {clientX: 640, clientY: 360}, body, entries, (e) => {
      expect.unreachable(`Should not pick back-side entry: ${e.n}`)
    })
  })

  it('is a no-op for empty entries', () => {
    const ui = makeUI()
    const body = makeBody()
    queryPlaces(ui, {clientX: 100, clientY: 100}, body, [], () => {
      expect.unreachable('callback should not fire')
    })
    queryPlaces(ui, {clientX: 100, clientY: 100}, body, null, () => {
      expect.unreachable('callback should not fire')
    })
  })

  it('is a no-op when body has no radius', () => {
    const ui = makeUI()
    const noRadiusBody = new Object3D()
    noRadiusBody.props = {name: 'broken'}
    queryPlaces(ui, {clientX: 100, clientY: 100}, noRadiusBody, [{n: 'X', lat: 0, lng: 0}], () => {
      expect.unreachable('callback should not fire')
    })
  })

  it('selects the closer entry when two are near the cursor', () => {
    const ui = makeUI()
    const body = makeBody()
    const entries = [
      {n: 'Near', lat: 0, lng: 1},
      {n: 'Far', lat: 0, lng: 5},
    ]
    const cursor = project(ui, body, 0, 1.1) // slightly off Near, much further from Far
    let picked = null
    queryPlaces(ui, cursor, body, entries, (e) => {
      picked = e
    })
    expect(picked?.n).toBe('Near')
  })
})


describe('pickSurfaceLatLng', () => {
  it('returns the lat/lng under the cursor for a body at origin', () => {
    const ui = makeUI()
    const body = makeBody()
    // Cursor over the centre of the disc; with camera at +X looking at
    // origin, the centre projects through (lat=0, lng=0) — the prime
    // meridian point at +X body-fixed.
    const center = project(ui, body, 0, 0)
    const hit = pickSurfaceLatLng(ui, center, body)
    expect(hit).not.toBeNull()
    expect(hit.lat).toBeCloseTo(0, 3)
    expect(hit.lng).toBeCloseTo(0, 3)
    // Surface hit: alt ≈ 0 (within float precision of the radius).
    expect(Math.abs(hit.alt)).toBeLessThan(1) // sub-metre
  })

  it('returns lat=45 at the equator-NE point on the visible disc', () => {
    const ui = makeUI()
    const body = makeBody()
    const cursor = project(ui, body, 45, 0)
    const hit = pickSurfaceLatLng(ui, cursor, body)
    expect(hit).not.toBeNull()
    expect(hit.lat).toBeCloseTo(45, 1)
    expect(hit.lng).toBeCloseTo(0, 1)
  })

  it('respects the body world quaternion (rotated body)', () => {
    // Rotate body 90° around Y.  The body-fixed +X axis now points to
    // world −Z, so the disc centre (from a +X-looking camera) corresponds
    // to a different lat/lng than the unrotated case.
    const ui = makeUI()
    const body = makeBody()
    body.quaternion.setFromAxisAngle({x: 0, y: 1, z: 0}, Math.PI / 2)
    body.updateMatrixWorld(true)
    // Disc centre.
    const hit = pickSurfaceLatLng(ui, {clientX: 640, clientY: 360}, body)
    expect(hit).not.toBeNull()
    // After the rotation, the camera-facing point on the surface is
    // lng=−90° body-fixed (where +X-world now lives in the rotated frame).
    expect(hit.lat).toBeCloseTo(0, 1)
    expect(Math.abs(hit.lng + 90)).toBeLessThan(2) // |lng − (−90)| small
  })

  it('returns null when the click misses the sphere', () => {
    const ui = makeUI()
    const body = makeBody()
    // Far-corner pixel — well off the disc with the camera at +X 5R.
    const hit = pickSurfaceLatLng(ui, {clientX: 10, clientY: 10}, body)
    expect(hit).toBeNull()
  })

  it('returns null when the body has no radius', () => {
    const ui = makeUI()
    const noRadius = new Object3D()
    noRadius.props = {name: 'bad'}
    expect(pickSurfaceLatLng(ui, {clientX: 640, clientY: 360}, noRadius)).toBeNull()
  })

  it('returns null when the body is missing props entirely', () => {
    const ui = makeUI()
    expect(pickSurfaceLatLng(ui, {clientX: 640, clientY: 360}, new Object3D())).toBeNull()
  })

  it('returns null when the sphere is behind the camera', () => {
    const ui = makeUI()
    const body = makeBody()
    // Move the body behind the camera (camera looks at −X from +X·5R).
    body.position.set(EARTH_R * 20, 0, 0)
    body.updateMatrixWorld(true)
    // Look the other way so the body sits in the rear hemisphere.
    ui.camera.lookAt(-1e9, 0, 0)
    ui.camera.updateMatrixWorld(true)
    // Click anywhere in the viewport — the body's behind us, no hit.
    expect(pickSurfaceLatLng(ui, {clientX: 640, clientY: 360}, body)).toBeNull()
  })

  it('preserves body world position offset', () => {
    // The picker uses body world position from getWorldPosition, so a
    // translated body must still resolve a sensible lat/lng.
    const ui = makeUI()
    const body = makeBody()
    body.position.set(EARTH_R * 100, 0, 0)
    body.updateMatrixWorld(true)
    ui.camera.position.set(EARTH_R * 105, 0, 0) // 5R in front of the body
    ui.camera.lookAt(EARTH_R * 100, 0, 0)
    ui.camera.updateMatrixWorld(true)
    const hit = pickSurfaceLatLng(ui, {clientX: 640, clientY: 360}, body)
    expect(hit).not.toBeNull()
    expect(hit.lat).toBeCloseTo(0, 1)
    expect(hit.lng).toBeCloseTo(0, 1)
  })

  it('round-trips through latLngAltToBodyFixed for many points on the visible disc', () => {
    // A regression smoke test that the ray-sphere math and the body-fixed
    // conversion are consistent: pick a known body-fixed point, project it
    // to screen, pick it back, and check we recover the same lat/lng.
    const ui = makeUI()
    const body = makeBody()
    body.quaternion.copy(new Quaternion()) // identity
    body.updateMatrixWorld(true)
    const samples = [
      [0, 0], [10, 0], [0, 10], [-15, 20], [30, -30], [45, 45], [-45, -45],
    ]
    for (const [lat, lng] of samples) {
      const cursor = project(ui, body, lat, lng)
      const hit = pickSurfaceLatLng(ui, cursor, body)
      expect(hit).not.toBeNull()
      // 1 deg tolerance: the projection→pick→recover chain has small
      // floating-point error, and the test isn't trying to measure that.
      expect(Math.abs(hit.lat - lat)).toBeLessThan(1)
      expect(Math.abs(hit.lng - lng)).toBeLessThan(1)
    }
  })
})
