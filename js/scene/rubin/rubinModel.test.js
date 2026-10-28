import {describe, expect, it} from 'bun:test'
import {Mesh, MeshStandardMaterial, Object3D, Vector3} from 'three'
import {
  AXIS_HEIGHT_M, MODEL_AXIS_Y, MODEL_POSE_EL_DEG, MODEL_TUBE_TOP_M, assembleTelescope, newRubinModel,
} from './rubinModel.js'
import {newWideLineStrip} from '../wideLines.js'


const toRad = Math.PI / 180


/** NOIRLab's model as build.sh groups it, reduced to a point a part. */
function fakeModel() {
  const root = new Object3D
  const mat = new MeshStandardMaterial
  for (const name of ['pier', 'azimuth', 'elevation']) {
    const g = new Object3D
    g.name = name
    root.add(g)
  }
  const s = Math.sin(MODEL_POSE_EL_DEG * toRad)
  const c = Math.cos(MODEL_POSE_EL_DEG * toRad)
  // The tube's top, out along the pose from the axis; a point on the fork.
  const top = new Mesh(undefined, mat)
  top.name = 'top'
  top.position.set(0, MODEL_AXIS_Y + (MODEL_TUBE_TOP_M * s), MODEL_TUBE_TOP_M * c)
  root.getObjectByName('elevation').add(top)
  const fork = new Mesh(undefined, mat)
  fork.name = 'fork'
  fork.position.set(1, MODEL_AXIS_Y, 2)
  root.getObjectByName('azimuth').add(fork)
  const foot = new Mesh(undefined, mat)
  foot.name = 'foot'
  foot.position.set(0, -20, 0)
  root.getObjectByName('pier').add(foot)
  return root
}


const worldOf = (o) => {
  o.updateWorldMatrix(true, false)
  return o.getWorldPosition(new Vector3)
}


describe('assembleTelescope', () => {
  it('puts the elevation axis at the origin, the tube along +Y, and the fork turned to face north', () => {
    const {pier, azimuth, tube, materials} = assembleTelescope(fakeModel())
    const scene = new Object3D
    scene.add(pier, azimuth, tube)
    const top = worldOf(tube.getObjectByName('top'))
    expect(top.x).toBeCloseTo(0, 6)
    expect(top.y).toBeCloseTo(MODEL_TUBE_TOP_M, 6)
    expect(top.z).toBeCloseTo(0, 6)
    const fork = worldOf(azimuth.getObjectByName('fork'))
    expect([fork.x, fork.y, fork.z].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([-1, 0, -2])
    const foot = worldOf(pier.getObjectByName('foot'))
    expect(foot.y).toBeCloseTo(-20 - MODEL_AXIS_Y, 6)
    expect(materials).toHaveLength(1)
  })

  it('refuses a model without the three groups', () => {
    expect(() => assembleTelescope(new Object3D)).toThrow('pier, azimuth and elevation')
  })
})


describe('newRubinModel', () => {
  it('hangs the loaded telescope on the mount, the pier at the axis\'s height, its materials with the dome\'s', async () => {
    const model = newRubinModel({newWideLineStrip, loadModel: () => Promise.resolve(fakeModel())})
    expect(model.materials).toHaveLength(3)
    const parts = await model.ready
    expect(parts).not.toBe(null)
    expect(model.telescope).toBe(parts)
    expect(model.materials).toHaveLength(4)
    expect(parts.tube.parent).toBe(model.elevation)
    expect(parts.azimuth.parent).toBe(model.azimuth)
    expect(model.azimuth.position.y).toBe(AXIS_HEIGHT_M)
    const top = worldOf(parts.tube.getObjectByName('top'))
    expect(top.y).toBeCloseTo(AXIS_HEIGHT_M + MODEL_TUBE_TOP_M, 6)
    expect(parts.pier.parent).toBe(null)
  })

  it('stands without the telescope when the model fails, or no loader is given', async () => {
    const failing = newRubinModel({newWideLineStrip, loadModel: () => Promise.reject(new Error('404'))})
    expect(await failing.ready).toBe(null)
    expect(failing.telescope).toBe(null)
    const none = newRubinModel({newWideLineStrip})
    expect(await none.ready).toBe(null)
    expect(none.dome.getObjectByName('shutter')).toBeDefined()
  })
})
