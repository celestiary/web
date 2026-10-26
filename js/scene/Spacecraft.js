import {Box3, Euler, Group, Object3D, Quaternion, Vector3} from 'three'
import Object from './object.js'
import SpriteSheet from './SpriteSheet.js'
import {FovLOD, newFarPoint, pointSwitchDistance} from './farPoint.js'
import {bodyProminenceRank, bodyRank} from './labelDeclutter.js'
import {BODY_LABELS, labelFont} from './labelStyle.js'
import {loadModel} from './model.js'
import {buildOccluder, sunBlocked} from './modelOccluder.js'
import {point} from './shapes.js'
import {Trajectory} from './trajectory.js'
import {FAR_OBJ, OVERLAY_LAYER, labelTextColor, toRad} from '../shared.js'
import {capitalize, named} from '../utils.js'


// The name shows from this near (in radii, as a planet's) out to its
// descriptor's `labelDistance`, or this: far enough to see JWST's name
// beside the Earth from a few million km.
const LABEL_NEAR_RADII = 30
const LABEL_FAR_M = 1e10
// A label's depth, in radii toward the eye, as a planet's.
const LABEL_LIFT = 1.1
// The occluder's build waits at most this for an idle moment.
const IDLE_TIMEOUT_MS = 2000


/**
 * A spacecraft: a 3D model (model.js) at its place along a trajectory
 * table (trajectory.js), relative to its parent body, turned to the Sun.
 * See js/scene/models.md.
 *
 * Its descriptor (public/data/<parent's dir>/spacecraft/<name>/index.json):
 *
 *   type: 'spacecraft', parent, radius (its model's bounding sphere about
 *   its centre, with units: "17 m"), model: {path, scale?, rotation? (degrees,
 *   XYZ Euler), doubleSided?} (model.js loadModel),
 *   trajectory: a path under data/ (its own directory's trajectory.json,
 *   earth/spacecraft/webb/trajectory.json),
 *   attitude: {sun: [x, y, z]}, the model's axis kept toward the Sun
 *
 * The scene graph, as a planet's down to the body's node:
 *
 *   <parent>.orbitPosition
 *     └── Spacecraft
 *           └── <name>.group
 *                 └── <name>.orbitPosition  ← Animation.placeOnTrajectory
 *                       └── <name> (scene.objects[name]; hidden off its table's span)
 *                             ├── model LOD
 *                             │     ├── [near] attitude ← turned to the Sun
 *                             │     │           └── model (centred, loaded when first drawn or targeted)
 *                             │     ├── [far]  far point
 *                             │     └── [very far] FAR_OBJ
 *                             └── label LOD
 */
export default class Spacecraft extends Object {
  /**
   * @param {object} scene The Scene
   * @param {object} props The descriptor, reified (radius a Measure)
   */
  constructor(scene, props) {
    super(props.name, props)
    this.scene = scene
    const radius = props.radius?.scalar
    if (!(radius > 0)) {
      throw new Error(`${props.name}: a spacecraft needs a radius, with units`)
    }
    const group = scene.newGroup(`${this.name}.group`)
    const orbitPosition = scene.newGroup(`${this.name}.orbitPosition`)
    group.add(orbitPosition)
    // Animation places it each frame while the table is in, and loads the
    // table once the scene is revealed (loadTrajectory).
    orbitPosition.trajectory = null
    orbitPosition.loadTrajectory = () => this.loadTrajectory()
    orbitPosition.bodyRadius = radius

    const node = this.newNode(scene, orbitPosition, radius)
    orbitPosition.add(node)
    orbitPosition.body = node
    this.add(group)
  }


  /**
   * Fetch the trajectory table, once.
   *
   * @returns {Promise<Trajectory|null>}
   */
  loadTrajectory() {
    const orbitPosition = this.scene.objects[`${this.name}.orbitPosition`]
    this._trajectory ??= fetch(`data/${this.props.trajectory}`)
        .then((res) => {
          if (!res.ok) {
            throw new Error(`${res.status}`)
          }
          return res.json()
        })
        .then((table) => {
          orbitPosition.trajectory = new Trajectory(table)
          return orbitPosition.trajectory
        })
        .catch((err) => {
          console.warn(`${this.name}: no trajectory (${this.props.trajectory}): ${err.message}`)
          // Asked for again by the next need.
          this._trajectory = null
          return null
        })
    return this._trajectory
  }


  /**
   * The body's node: the model's LOD and the label's.
   *
   * @param {object} scene
   * @param {Object3D} orbitPosition
   * @param {number} radius
   * @returns {Object3D}
   */
  newNode(scene, orbitPosition, radius) {
    const node = new Object3D
    node.name = this.name
    node.props = this.props
    node.orbitPosition = orbitPosition
    // Off its table's span (before launch, past the prediction), and until
    // the table is in.
    node.visible = false
    scene.objects[this.name] = node

    // Turned so the model's sun axis faces the Sun (Animation.turnToSun).
    const attitude = named(new Group, 'attitude')
    const sunAxis = this.props.attitude?.sun
    if (sunAxis) {
      attitude.sunAxis = new Vector3(...sunAxis).normalize()
    }
    node.attitude = attitude

    // Loaded the first time it's drawn, or when it's targeted
    // (Scene.setTarget calls preloadNear): on the next animation frame, so
    // targeting doesn't start a download synchronously.
    let state = 'none'
    let occluder = null
    let occluderModel = null
    const buildNear = () => {
      if (state === 'loading' || state === 'loaded') {
        return
      }
      state = 'loading'
      const {path, scale = 1, rotation, doubleSided = false} = this.props.model
      loadModel(path, {scale, doubleSided}).then((model) => {
        if (rotation) {
          model.quaternion.multiplyQuaternions(
              new Quaternion().setFromEuler(new Euler(...rotation.map((deg) => deg * toRad))), model.quaternion)
        }
        // Centred on its bounding box: the body's place is the craft's
        // middle, not wherever its modeller put the origin.
        model.updateMatrixWorld(true)
        const centre = new Box3().setFromObject(model, true).getCenter(new Vector3())
        model.position.sub(centre)
        attitude.add(model)
        // Its silhouette, for the Sun's disc behind it (modelOccluder.js): a
        // third of a second for JWST's grid, so when the page is idle.
        const build = () => {
          occluder = buildOccluder(model)
          occluderModel = model
        }
        if (typeof requestIdleCallback === 'function') {
          requestIdleCallback(build, {timeout: IDLE_TIMEOUT_MS})
        } else {
          build()
        }
        state = 'loaded'
      }, (err) => {
        console.warn(`${this.name}: model ${this.props.model.path} didn't load: ${err.message}`)
        // The next target or approach asks again.
        state = 'failed'
      })
    }
    node.preloadNear = () => {
      node.preAnimCb = () => {
        buildNear()
        this.loadTrajectory()
        node.preAnimCb = null
      }
    }
    // The share of the Sun's disc the model hides from the camera, or null
    // when it can't hide any (SunLayers._occlusion): the planets and moons
    // occult as spheres, a spacecraft by its triangles.
    const centre = new Vector3()
    node.sunBlocked = (cam, sun, discRadius) => {
      if (!occluder || !node.visible) {
        return null
      }
      node.getWorldPosition(centre)
      const d = centre.distanceTo(cam)
      if (!(d > 0) || d > sun.distanceTo(cam)) {
        return null
      }
      const toCraft = centre.sub(cam).divideScalar(d)
      const toSun = tmpSun.subVectors(sun, cam).normalize()
      if (toCraft.angleTo(toSun) > discRadius + Math.asin(Math.min(1, radius / d))) {
        return null
      }
      return sunBlocked(occluder, occluderModel, cam, sun, discRadius)
    }
    // Ready once the model is in (a link's first frame waits on it,
    // ThreeUI.sceneReady), or it failed: nothing more is coming for now.
    node.surfaceReady = () => state === 'loaded' || state === 'failed'
    // An object must have a mesh to have onBeforeRender called.
    const placeholder = point({opacity: 0, depthTest: false, depthWrite: false, transparent: true})
    placeholder.onBeforeRender = () => {
      buildNear()
      // Back to three's own (a no-op): null would be called.
      delete placeholder.onBeforeRender
    }
    attitude.add(placeholder)

    // The model while it's over a couple of pixels (FovLOD scales these to
    // the field and the canvas, as a planet's), then a moon's dim marker,
    // then nothing past the label's reach.
    const labelFar = this.props.labelDistance?.scalar ?? LABEL_FAR_M
    const modelLOD = new FovLOD({drawnSize: true})
    modelLOD.addLevel(attitude, 0)
    modelLOD.addLevel(newFarPoint(true), pointSwitchDistance(radius))
    modelLOD.addLevel(FAR_OBJ, labelFar)
    node.add(named(modelLOD, 'model LOD'))
    node.add(this.newLabel(scene, radius, labelFar))
    return node
  }


  /**
   * The name, as a planet's: a double click or tap on it goes there.
   *
   * @param {object} scene
   * @param {number} radius
   * @param {number} far
   * @returns {Object3D}
   */
  newLabel(scene, radius, far) {
    const name = this.props.label ?? capitalize(this.name)
    const sheet = named(new SpriteSheet(1, name, labelFont(BODY_LABELS), [0, 0], false, false, {scalable: true}), 'label')
    sheet.add(0, 0, 0, name, labelTextColor)
    const sprites = sheet.compile()
    sprites.layers.set(OVERLAY_LAYER)
    sprites.userData.labelTargets = [{kind: 'body', name: this.name}]
    sprites.userData.declutter = true
    sprites.userData.labelRank = [bodyRank(radius)]
    // As a body's (Planet.js): by how large it looks.
    sprites.userData.labelStyle = BODY_LABELS
    sprites.userData.labelMeasure = (i, cam, at) => cam.distanceTo(at) / radius
    sprites.userData.labelRankOf = bodyProminenceRank
    sheet.setTowardEye(radius * LABEL_LIFT)
    const near = radius * LABEL_NEAR_RADII
    const labelLOD = new FovLOD()
    labelLOD.addLevel(FAR_OBJ, 0)
    labelLOD.addLevel(sprites, near)
    labelLOD.addLevel(FAR_OBJ, far)
    labelLOD.visible = scene.overlayShown ? scene.overlayShown('p') : true
    return named(labelLOD, 'label LOD')
  }
}


const tmpSun = new Vector3
