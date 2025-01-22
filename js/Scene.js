import {
  Object3D,
  Raycaster,
  Vector2,
  Vector3,
} from 'three'
import Asterisms from './Asterisms.js'
import Planet from './Planet.js'
import Star from './Star.js'
import Stars from './Stars.js'
import * as Shared from './shared.js'
import * as Utils from './utils.js'


const INITIAL_STEP_BACK_MULT = 10


/** */
export default class Scene {
  /**
   * @param {Function} useStore Accessor to zustand store for shared application state
   * @param {object} ui
   */
  constructor(ui) {
    this.ui = ui
    this.objects = {}
    this.mouse = new Vector2
    this.raycaster = new Raycaster
    // this.raycaster = new CustomRaycaster;
    this.raycaster.params.Points.threshold = 3
    ui.addClickCb((click) => {
      this.onClick(click)
    })
    // Loaded later
    this.stars = null
    this.asterisms = null
  }


  /**
   * Add an object to the scene.
   *
   * @param {!object} props object properties, must include type.
   * @returns {Object3D}
   */
  add(props) {
    const name = props.name
    let parentObj = this.objects[props.parent]
    let parentOrbitPosition = this.objects[`${props.parent }.orbitPosition`]
    if (props.name === 'milkyway' || props.name === 'sun') {
      parentObj = parentOrbitPosition = this.ui.scene
    }
    if (!parentObj || !parentOrbitPosition) {
      throw new Error(`No parent obj: ${parentObj} or pos: ${parentOrbitPosition} for ${name}`)
    }
    const obj3d = this.objectFactory(props)
    // Add to scene in reference frame of parent's orbit position,
    // e.g. moons orbit planets, so they have to be added to the
    // planet's orbital center.
    parentOrbitPosition.add(obj3d)
    return obj3d
  }


  /**
   * @param {object} props
   * @returns {object}
   */
  objectFactory(props) {
    switch (props.type) {
      case 'galaxy': return this.newGalaxy(props)
      case 'stars': return this.stars = new Stars(props, this.ui)
      case 'star': return new Star(props, this.objects, this.ui)
      case 'planet': return new Planet(this, props)
      case 'moon': return new Planet(this, props, true)
      default:
    }
    throw new Error(`Object has unknown type: ${props.type}`)
  }


  /**
   * A primary scene object composed.
   *
   * @param {string} name
   * @param {object} props
   * @param {Function} onClick
   * @returns {Object3D}
   */
  newObject(name, props, onClick) {
    const obj = this.newGroup(name, props)
    if (!onClick) {
      throw new Error('Must provide an onClick handler')
    }
    obj.onClick = onClick
    return obj
  }


  /**
   * A secondary grouping of scene objects.
   *
   * @param name Prefix, attached to .frame suffix.
   * @param props Optional props to attach to a .props field on the frame.
   * @returns {object}
   */
  newGroup(name, props) {
    const obj = new Object3D
    this.objects[name] = obj
    obj.name = name
    if (props) {
      obj.props = props
    }
    return obj
  }


  /** @param {string} name */
  targetNamed(name) {
    this.setTarget(name)
    this.lookAtTarget()
  }


  /** */
  targetParent() {
    const cObj = Shared.targets.cur
    if (cObj && cObj.props && cObj.props.parent) {
      this.setTarget(cObj.props.parent)
    }
  }


  /** */
  targetNode(index) {
    const cObj = Shared.targets.cur
    if (cObj && cObj.props && cObj.props.system && cObj.props.system) {
      const sys = cObj.props.system
      if (sys[index - 1]) {
        this.setTarget(sys[index - 1])
      }
    }
  }


  /** */
  targetCurNode() {
    const cObj = Shared.targets.cur
    if (cObj && cObj.props && cObj.props.name) {
      this.setTarget(cObj.props.name)
    }
  }


  /** */
  setTarget(name) {
    const obj = this.objects[name]
    if (!obj) {
      throw new Error(`scene#setTarget: no matching target: ${name}`)
    }
    Shared.targets.obj = obj
  }


  /** */
  lookAtTarget() {
    if (!Shared.targets.obj) {
      console.error('scene.js#lookAtTarget: no target obj to look at.')
      return
    }
    const obj = Shared.targets.obj
    const tPos = Shared.targets.pos
    this.ui.scene.updateMatrixWorld()
    tPos.setFromMatrixPosition(obj.matrixWorld)
    this.ui.camera.lookAt(tPos)
  }


  /** */
  goTo() {
    if (!Shared.targets.obj) {
      console.error('Scene.goTo called with no target obj.')
      return
    }
    const obj = Shared.targets.obj
    const tPos = Shared.targets.pos
    this.ui.scene.updateMatrixWorld()
    tPos.setFromMatrixPosition(obj.matrixWorld)
    const pPos = new Vector3
    const cPos = new Vector3
    const surfaceAltitude = obj.props.radius.scalar
    pPos.set(0, 0, 0) // TODO(pablo): maybe put platform at surfaceAltitude
    const camDist = obj.initialCameraDistance || (surfaceAltitude * INITIAL_STEP_BACK_MULT)
    const elevationAngleRad = 15 / 360 * Math.PI * 2
    const y = Math.atan(elevationAngleRad) * camDist
    cPos.set(0, y, camDist)
    obj.orbitPosition.add(this.ui.camera.platform)
    this.ui.camera.platform.position.copy(pPos)
    this.ui.camera.platform.lookAt(Shared.targets.origin)
    this.ui.camera.position.copy(cPos)
    this.ui.camera.lookAt(tPos)
    Shared.targets.track = Shared.targets.cur = Shared.targets.obj
    this.ui.controls.update()
  }


  track() {
    console.trace('Scene#track, Shared.targets.track:', Shared.targets.track, Shared.targets.obj)
    if (Shared.targets.track) {
      delete Shared.targets.track.postAnimCb
      Shared.targets.track = null
    } else {
      Shared.targets.track = Shared.targets.obj
      const tracked = Shared.targets.track
      tracked.postAnimCb = (obj) => {
        this.ui.camera.lookAt(Shared.targets.tracked)
      }
    }
  }


  follow() {
    console.trace('Scene#follow, Shared.targets.follow:', Shared.targets.follow, Shared.targets.obj)
    if (Shared.targets.follow) {
      delete Shared.targets.follow.postAnimCb
      Shared.targets.follow = null
    } else if (Shared.targets.obj) {
      if (Shared.targets.obj.orbitPosition) {
        // Follow the orbit position for less jitter.
        const followed = Shared.targets.obj.orbitPosition
        Shared.targets.follow = followed

        followed.postAnimCb = (obj) => {
          this.ui.camera.platform.lookAt(Shared.targets.origin)
        }

        followed.postAnimCb(followed)
      } else {
        console.error('Target to follow has no orbitPosition property.')
      }
    } else {
      console.error('No target object to follow.')
    }
  }


  /** @param {object} mouse */
  onClick(mouse) {
    const enable = false
    if (enable) {
      return
    } // Disable picking for now.
    this.ui.scene.updateMatrixWorld()
    this.raycaster.setFromCamera(mouse, this.ui.camera)
    const t = Date.now()
    const intersects = this.raycaster.intersectObjects(this.ui.scene.children, true)
    const elapsedSeconds = (Date.now() - t) / 1000
    if (elapsedSeconds > 0.1) {
      console.error('Scene picking taking a long time (seconds): ', elapsedSeconds)
    }
    if (intersects.length === 0) {
      return
    }
    // console.log('checking all the things');
    let nearestMeshIntersect; let nearestPointIntersect
    let nearestStarPointIntersect; let nearestDefaultIntersect
    // TODO: this is looping through all 8k asterisms.. that right?
    for (let i = 0; i < intersects.length; i++) {
      const intersect = intersects[i]
      const dist = intersect.distance
      const obj = intersect.object
      if (obj.isAnchor) {
        console.log('raycast skipping anchor')
        continue
      }
      if (obj.type === 'Line') {
        continue
      }
      // console.log(`intersect ${i} dist: ${dist}, type: ${obj.type}, obj: `, obj);
      switch (obj.type) {
        case 'Mesh': {
          if (nearestMeshIntersect &&
              nearestMeshIntersect.distance < dist) {
            continue
          }
          nearestMeshIntersect = intersect
          break
        }
        case 'Points': {
          if (obj.isStarPoints) {
            if (nearestStarPointIntersect &&
                nearestStarPointIntersect.distanceToRay < intersect.distanceToRay) {
              continue
            }
            // console.log('New nearest star point: ', intersect);
            nearestStarPointIntersect = intersect
          } else {
            if (nearestPointIntersect &&
                nearestPointIntersect.distance < dist) {
              continue
            }
            // console.log('New nearest point: ', intersect);
            nearestPointIntersect = intersect
          }
          break
        }
        default: {
          // console.log('Raycasting default handler for object type: ', obj.type);
          if (nearestDefaultIntersect &&
              nearestDefaultIntersect.distance < dist) {
            continue
          }
          // console.log('New nearest default: ', intersect);
          nearestDefaultIntersect = intersect
        }
      }
    }
    const nearestIntersect = nearestMeshIntersect ? nearestMeshIntersect :
      nearestPointIntersect ? nearestPointIntersect :
      nearestStarPointIntersect ? nearestStarPointIntersect :
      nearestDefaultIntersect ? nearestDefaultIntersect :
      null
    if (!nearestIntersect) {
      throw new Error('Picking did not yield an intersect.  Intersects: ', intersects)
    }
    let obj = nearestIntersect.object
    // console.log('Nearest object type: ', obj.isStarPoints ? '<star points>' : obj.type);
    let firstName
    do {
      if (obj.name || ((obj.props && obj.props.name) && !firstName)) {
        firstName = obj.name || (obj.props && obj.props.name)
      }
      if (obj.onClick) {
        obj.onClick(mouse, nearestIntersect, obj)
        break
      }
      if (obj === obj.parent) {
        console.error('no clickable object found in path to root.')
        break
      }
    } while ((obj = obj.parent))
  }


  /** */
  toggleAsterisms() {
    if (this.asterisms === null) {
      const asterisms = new Asterisms(this.ui, this.stars, () => {
        this.stars.add(asterisms)
        this.asterisms = asterisms
      })
    }
    if (this.asterisms) {
      this.asterisms.visible = !this.asterisms.visible
    }
  }


  /** */
  toggleOrbits() {
    Utils.visitToggleProperty(this.objects['sun'], 'name', 'orbit', 'visible')
  }


  /** */
  togglePlanetLabels() {
    Utils.visitToggleProperty(this.objects['sun'], 'name', 'label LOD', 'visible')
  }


  /** */
  toggleStarLabels() {
    this.stars.labelLOD.visible = !this.stars.labelLOD.visible
  }


  /**
   * @param {object} galaxyProps
   * @returns {object}
   */
  newGalaxy(galaxyProps) {
    const group = this.newObject(galaxyProps.name, galaxyProps, (click) => {
      // console.log('Well done, you found the galaxy!');
    })
    this.objects[`${galaxyProps.name }.orbitPosition`] = group
    return group
  }
}
