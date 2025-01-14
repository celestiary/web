import {Euler, Object3D} from 'three'
import Loader from './Loader.js'
import Planet from './Planet.js'
import reifyMeasures from './reify.js'


/**
 *
 */
function planetHelper(path, cb) {
  const createNamedObject = (name) => {
    const o = new Object3D
    o.name = name
    return o
  }

  const sceneGroups = {
    newObject: createNamedObject,
    newGroup: createNamedObject,
    orbitShapes: [],
  }

  const onLoadCb = (name, props) => {/**/}
  const onDoneCb = (name, props) => {
    reifyMeasures(props)
    cb(new Planet(sceneGroups, props, false, true))
  }

  new Loader().loadPath(path, onLoadCb, onDoneCb)
}


/**
 *
 */
function rotateEuler(obj, opts) {
  opts = opts || {x: 0, rotY: 0, rotZ: 0}
  obj.applyEuler(new Euler(opts.x || 0, opts.y || 0))
}


/**
 *
 */
function rotate(obj, opts) {
  opts = opts || {x: 0, y: 0, z: 0}
  if (opts.x) {
    obj.rotateX(opts.x)
  }
  if (opts.y) {
    obj.rotateY(opts.y)
  }
  if (opts.z) {
    obj.rotateZ(opts.z)
  }
}


/**
 * @returns {object}
 */
function addAndOrient(parent, child, opts) {
  parent.add(child)
  rotate(child, {x: opts.rotX || 0, y: opts.rotY || 0, z: opts.rotZ || 0})
  return child
}


export {
  addAndOrient,
  planetHelper,
  rotate,
  rotateEuler,
}
