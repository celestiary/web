import {describe, expect, it} from 'bun:test'
import {Object3D, PerspectiveCamera} from 'three'
import {latLngAltToBodyFixed} from '../coords.js'
import {MAX_PICK_PX, queryPlaces} from './Picker.js'


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
