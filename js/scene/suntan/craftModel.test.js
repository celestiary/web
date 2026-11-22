import {describe, expect, it} from 'bun:test'
import {BoxGeometry, Group, Mesh, Vector3} from 'three'
import {craftQuaternion, prepareCraftModels} from './craftModel.js'


/** @returns {Group} An assembly like the GLB's: an orbiter and a wheel of four landers */
function assembly() {
  const root = new Group()
  root.name = 'Suntan'
  const shield = new Mesh(new BoxGeometry(2.3, 0.1, 2.3))
  shield.position.y = -0.05
  root.add(shield)
  const wheel = new Group()
  wheel.position.y = -7
  root.add(wheel)
  for (const [x, y] of [[4, 0], [-4, 0], [0, 4], [0, -4]]) {
    const lander = new Group()
    lander.name = 'Lander'
    lander.position.set(x, y, 0)
    lander.add(new Mesh(new BoxGeometry(1.2, 1.2, 1.2)))
    wheel.add(lander)
  }
  return root
}


describe('the craft\'s model', () => {
  it('splits off the rim lander nearest the Sun and centres each', () => {
    const {relay, lander, released} = prepareCraftModels(assembly())
    // The released one is on the wheel's sunward rim, +4 on the wheel.
    expect(released.position.y).toBe(4)
    expect(lander.radius).toBeCloseTo(Math.sqrt(3) * 0.6, 6)
    // The stack's box: from the shield's top (y 0) to the bottom lander (-11.6).
    expect(relay.radius).toBeGreaterThan(5)
    relay.updateMatrixWorld(true)
    const centre = new Vector3()
    relay.children[0].getWorldPosition(centre)
    expect(centre.y).toBeCloseTo(5.8, 6)
  })

  it('turns the heat shield to the Sun and the wheel\'s axle along the orbit\'s normal', () => {
    const r = [1e11, 2e10, -3e10]
    const v = [-5e3, 1e3, 3e4]
    const q = craftQuaternion(r, v)
    const up = new Vector3(0, 1, 0).applyQuaternion(q)
    const sunward = new Vector3(...r).negate().normalize()
    expect(up.dot(sunward)).toBeCloseTo(1, 9)
    const axle = new Vector3(0, 0, 1).applyQuaternion(q)
    const normal = new Vector3(...r).cross(new Vector3(...v)).normalize()
    expect(Math.abs(axle.dot(normal))).toBeGreaterThan(0.99)
    expect(Math.abs(axle.dot(up))).toBeLessThan(1e-9)
  })
})
