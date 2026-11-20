import {Box3, Group, Matrix4, Quaternion, Vector3} from 'three'


// The Suntan flight system's model on the craft (Suntan.md, "The model on
// the craft"): design/suntan/cad/'s STEP assembly as Bldrs Share exports it
// to GLB, public/large/models/suntan/suntan.glb.  Metres, and STEP's +Z (the
// heat shield's normal, toward the Sun) is glTF's +Y; the sling wheel's axle
// is glTF's Z.

const _box = new Box3()
const _centre = new Vector3()
const _size = new Vector3()
const _pos = new Vector3()
const _x = new Vector3()
const _y = new Vector3()
const _z = new Vector3()
const _h = new Vector3()
const _basis = new Matrix4()


/**
 * The relay's model and the lander's from the assembly: the whole stack for
 * the relay, and a copy of the lander the wheel releases (the one on the
 * rim nearest the Sun) to fly on its own, each centred on its box so the
 * craft's node is its middle.
 *
 * @param {object} model loadModel's clone of the assembly
 * @returns {{relay: Group, lander: ?Group, released: ?object}} each Group
 *   with a `radius` (half its box's diagonal, metres); `released` is the
 *   relay model's own lander, hidden once the copy flies
 */
export function prepareCraftModels(model) {
  model.updateMatrixWorld(true)
  const landers = []
  model.traverse((o) => {
    if (o.name === 'Lander') {
      landers.push(o)
    }
  })
  let released = null
  let nearest = -Infinity
  for (const lander of landers) {
    lander.getWorldPosition(_pos)
    if (_pos.y > nearest) {
      nearest = _pos.y
      released = lander
    }
  }
  let lander = null
  if (released) {
    const copy = released.clone()
    // The lander in the assembly's axes: its place on the wheel dropped,
    // its turn there kept, so it faces the Sun as the stack does.
    released.getWorldQuaternion(copy.quaternion)
    copy.position.set(0, 0, 0)
    lander = centred(copy)
  }
  return {relay: centred(model), lander, released}
}


/**
 * @param {object} obj Without a parent
 * @returns {Group} obj inside a group, shifted so its box's centre is the
 *   group's origin; `radius` half the box's diagonal
 */
function centred(obj) {
  obj.updateMatrixWorld(true)
  _box.setFromObject(obj, true)
  _box.getCenter(_centre)
  obj.position.sub(_centre)
  const group = new Group()
  group.name = `${obj.name || 'model'}.centred`
  group.add(obj)
  group.radius = _box.getSize(_size).length() / 2
  return group
}


/**
 * The craft's attitude: its +Y (the heat shield's normal) at the Sun, and
 * its Z (the sling wheel's axle) along the orbit's normal, so the wheel
 * turns in the plane of the motion, rolling along the orbit as the concept
 * has it.
 *
 * @param {Array<number>} r The craft's place, scene axes, the Sun at the origin
 * @param {Array<number>} v Its velocity, scene axes
 * @param {Quaternion} [out]
 * @returns {Quaternion}
 */
export function craftQuaternion(r, v, out = new Quaternion()) {
  _y.set(-r[0], -r[1], -r[2]).normalize()
  _h.set(r[0], r[1], r[2]).cross(_z.set(v[0], v[1], v[2]))
  // Z: the orbit's normal, made square to Y.
  _z.copy(_h).addScaledVector(_y, -_h.dot(_y))
  if (_z.lengthSq() === 0) {
    _z.set(0, 0, 1).addScaledVector(_y, -_y.z)
  }
  _z.normalize()
  _x.crossVectors(_y, _z)
  return out.setFromRotationMatrix(_basis.makeBasis(_x, _y, _z))
}
