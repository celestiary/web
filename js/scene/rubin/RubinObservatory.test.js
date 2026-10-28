import {describe, expect, it} from 'bun:test'
import {Mesh, MeshStandardMaterial, Object3D, Vector3} from 'three'
import RubinObservatory, {NIGHT_GLOW} from './RubinObservatory.js'
import {SITE} from './rubin.js'
import {SHUTTER_SLIDE_RAD} from './rubinModel.js'
import {latLngAltToBodyFixed} from '../../coords.js'
import {newWideLineStrip} from '../wideLines.js'


const EARTH_RADIUS = 6371010
const AU = 1.496e11
const FAR = 1e13
const deps = {latLngAltToBodyFixed, newWideLineStrip}


/** A model with the parts the observatory turns, and no geometry. */
function stubModel() {
  const group = new Object3D
  const azimuth = new Object3D
  const elevation = new Object3D
  const dome = new Object3D
  dome.position.y = 14
  const shutter = new Object3D
  const beam = new Object3D
  const seat = new Object3D
  seat.position.set(0, 2.8, 7.3)
  const materials = [new MeshStandardMaterial({color: 0x808080})]
  const building = new Mesh(undefined, materials[0])
  building.name = 'building'
  group.add(building, azimuth, dome)
  azimuth.add(elevation)
  dome.add(shutter)
  elevation.add(beam, seat)
  return {group, azimuth, elevation, dome, shutter, beam, seat, building, materials}
}


/**
 * Earth a sun-distance out along +X (the Sun at the origin), its spun node
 * turned so the site faces away from or toward the Sun, and a body.
 *
 * @param {number} spin Radians about Earth's pole
 * @returns {object}
 */
function world(spin) {
  const orbit = new Object3D
  orbit.position.set(AU, 0, 0)
  const earth = new Object3D
  earth.props = {radius: {scalar: EARTH_RADIUS}}
  earth.rotation.y = spin
  orbit.add(earth)
  const body = new Object3D
  orbit.add(body)
  const root = new Object3D
  root.add(orbit)
  return {root, earth, body}
}


/**
 * @param {RubinObservatory} obs
 * @param {Vector3} localDir In the site's frame
 * @returns {Vector3} A world point far out along it
 */
function farAlong(obs, localDir) {
  obs.updateWorldMatrix(true, false)
  return obs.localToWorld(localDir.clone().normalize().multiplyScalar(FAR))
}


describe('RubinObservatory', () => {
  it('stands at the site on Earth\'s spun node, in the local frame, at the site\'s height until the terrain is known', () => {
    const {earth, body} = world(0)
    const obs = new RubinObservatory({earth, deps, body: () => body, newModel: stubModel})
    expect(obs.parent).toBe(earth)
    expect(obs.position.length()).toBeCloseTo(EARTH_RADIUS + SITE.alt, 3)
    const up = new Vector3(0, 1, 0).applyQuaternion(obs.quaternion)
    expect(up.angleTo(obs.position)).toBeCloseTo(0, 9)
    expect(obs.groundKnown).toBe(false)
  })

  it('takes the terrain\'s height when a layer knows it, asking about once a second, and follows finer tiles', () => {
    const {earth, body} = world(0)
    let height = null
    let asked = 0
    let ms = 0
    const obs = new RubinObservatory({earth, deps, body: () => body, newModel: stubModel, nowMs: () => ms,
      groundHeight: () => {
        asked++
        return height
      }})
    obs.update()
    ms = 500
    obs.update()
    expect(asked).toBe(1)
    height = 2500
    ms = 2000
    obs.update()
    expect(asked).toBe(2)
    expect(obs.groundKnown).toBe(true)
    expect(obs.position.length()).toBeCloseTo(EARTH_RADIUS + 2500, 3)
    ms = 10000
    obs.update()
    expect(asked).toBe(3)
    expect(obs.position.length()).toBeCloseTo(EARTH_RADIUS + 2500, 3)
    height = 2520
    ms = 11000
    obs.update()
    expect(obs.position.length()).toBeCloseTo(EARTH_RADIUS + 2520, 3)
  })

  it('by night, turns the telescope to the body and opens the dome; the beam shows', () => {
    const {earth, body} = world(0)
    const obs = new RubinObservatory({earth, deps, body: () => body, newModel: stubModel})
    // The site's up has a +X part at spin 0: the Sun, at −X, is 16° down.
    body.position.copy(farAlong(obs, new Vector3(1, 1, -1)))
    body.position.sub(new Vector3(AU, 0, 0))
    obs.update()
    expect(obs.state.sunEl).toBeLessThan(-12)
    expect(obs.state.tracking).toBe(true)
    expect(obs.state.el).toBeCloseTo(35.26, 1)
    expect(obs.state.az).toBeCloseTo(45, 3)
    expect(obs.model.beam.visible).toBe(true)
    expect(obs.model.dome.rotation.y).toBeCloseTo(obs.model.azimuth.rotation.y, 9)
    // The tube's +Y, in world space, points at the body.
    obs.updateWorldMatrix(true, true)
    const tube = new Vector3(0, 1, 0).transformDirection(obs.model.elevation.matrixWorld)
    const toBody = body.getWorldPosition(new Vector3).sub(obs.getWorldPosition(new Vector3)).normalize()
    expect(tube.angleTo(toBody)).toBeLessThan(1e-6)
  })

  it('by day, parks at the zenith with the dome shut', () => {
    const {earth, body} = world(Math.PI)
    const obs = new RubinObservatory({earth, deps, body: () => body, newModel: stubModel})
    body.position.copy(farAlong(obs, new Vector3(1, 1, -1))).sub(new Vector3(AU, 0, 0))
    obs.update()
    expect(obs.state.sunEl).toBeGreaterThan(0)
    expect(obs.state.tracking).toBe(false)
    expect(obs.state.el).toBe(90)
    expect(obs.model.beam.visible).toBe(false)
    expect(obs.model.elevation.rotation.x).toBe(0)
    expect(obs.shutterSlide).toBe(0)
  })

  it('slides the shutter open over a couple of seconds when the dome opens, and back', () => {
    const {earth, body} = world(0)
    let ms = 0
    const obs = new RubinObservatory({earth, deps, body: () => body, newModel: stubModel, nowMs: () => ms})
    body.position.copy(farAlong(obs, new Vector3(1, 1, -1))).sub(new Vector3(AU, 0, 0))
    obs.update()
    expect(obs.state.open).toBe(true)
    expect(obs.shutterSlide).toBe(0)
    for (ms = 100; ms <= 2000; ms += 100) {
      obs.update()
    }
    expect(obs.shutterSlide).toBeGreaterThan(0.5)
    expect(obs.shutterSlide).toBeLessThan(0.8)
    for (; ms <= 20000; ms += 100) {
      obs.update()
    }
    expect(obs.shutterSlide).toBe(1)
    expect(obs.model.shutter.rotation.y).toBeCloseTo((-Math.PI / 2) + SHUTTER_SLIDE_RAD, 9)
    // Day: it shuts again.
    earth.rotation.y = Math.PI
    for (; ms <= 40000; ms += 100) {
      obs.update()
    }
    expect(obs.state.open).toBe(false)
    expect(obs.shutterSlide).toBe(0)
  })

  it('wears unlit twins of its materials by night, glowing in exposure units at the keyed exposure; its own by day', () => {
    const {earth, body} = world(0)
    const obs = new RubinObservatory({earth, deps, body: () => body, newModel: stubModel, exposure: () => 0.25})
    obs.update()
    const building = obs.model.group.getObjectByName('building')
    const lit = obs.model.materials[0]
    expect(obs.state.sunEl).toBeLessThan(-1)
    expect(building.material).not.toBe(lit)
    expect(building.material.isMeshBasicMaterial).toBe(true)
    expect(building.material.color.r).toBeCloseTo(lit.color.r * NIGHT_GLOW / 0.25, 12)
    expect(lit.color.getHex()).toBe(0x808080)
    earth.rotation.y = Math.PI
    obs.update()
    expect(obs.state.sunEl).toBeGreaterThan(0)
    expect(building.material).toBe(lit)
    earth.rotation.y = 0
    obs.update()
    expect(building.material.isMeshBasicMaterial).toBe(true)
    expect(obs._twins.size).toBe(1)
  })

  it('does nothing without the body, and leaves the scene on dispose', () => {
    const {earth} = world(0)
    const obs = new RubinObservatory({earth, deps, body: () => null, newModel: stubModel})
    obs.update()
    expect(obs.state).toBe(null)
    obs.dispose()
    expect(obs.parent).toBe(null)
    expect(earth.children).toHaveLength(0)
    expect(new Mesh().isMesh).toBe(true)
  })

  it('hides the shell, the building and the dome, on setShell(false), leaving the mount; the seat is the model\'s', () => {
    const {earth} = world(0)
    const obs = new RubinObservatory({earth, deps, body: () => null, newModel: stubModel})
    expect(obs.shell).toBe(true)
    expect(obs.seat).toBe(obs.model.seat)
    expect(obs.seat.parent).toBe(obs.model.elevation)
    obs.setShell(false)
    expect(obs.shell).toBe(false)
    expect(obs.model.building.visible).toBe(false)
    expect(obs.model.dome.visible).toBe(false)
    expect(obs.model.azimuth.visible).toBe(true)
    obs.setShell(true)
    expect(obs.model.building.visible).toBe(true)
    expect(obs.model.dome.visible).toBe(true)
  })
})
