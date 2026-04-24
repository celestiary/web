import {Vector3} from 'three'
import createTree from '@pablo-mayrgundter/yaot2'
import {assertDefined} from '../assert'
import {queryPoints} from './Picker'
import SpriteSheet from './SpriteSheet.js'
import {marker as createMarker} from './shapes'


/** */
export default class PickLabels {
  constructor(ui, stars) {
    assertDefined(ui, stars)
    this.ui = ui
    this.stars = stars
    this.pickedStarLabels = {}
    this.marker = null
    this.tree = null
    this.traceLabel = null
    this.mcb = null
    this.tcb = null

    // Activate when UI button clicked for star marking.
    // Use prevState comparison so we only act when this flag actually changes,
    // not on every unrelated store update (which would pile up markers/listeners).
    this.ui.useStore.subscribe((state, prevState) => {
      if (state.isStarsSelectActive === prevState.isStarsSelectActive) {
        return
      }
      if (state.isStarsSelectActive) {
        this.addPickListeners()
      } else {
        this.removePickListeners()
        this.clearTrace()
      }
    })
  }

  /** Add dblclick calls mark, mousemove calls trace */
  addPickListeners() {
    // First time
    if (!this.tree) {
      this.tree = createTree()
      this.tree.init(this.stars.geom.coords)
    }
    this.marker = createMarker()
    this.ui.scene.add(this.marker)
    const me = this
    this.mcb = (e) => me.markCb(e)
    this.tcb = (e) => me.traceCb(e)
    document.body.addEventListener('dblclick', this.mcb)
    document.body.addEventListener('mousemove', this.tcb)
  }

  /** Remove dblclick and mousemove listeners */
  removePickListeners() {
    document.body.removeEventListener('dblclick', this.mcb)
    document.body.removeEventListener('mousemove', this.tcb)
    this.ui.scene.remove(this.marker)
  }

  /** Mark and label current star */
  traceCb(e) {
    queryPoints(this.ui, e, this.tree, this.stars, (pick) => {
      // pick.x/y/z are catalog coords; marker lives in world space.
      const wg = this.ui.scene.getObjectByName('WorldGroup')
      const wgPos = wg ? wg.position : {x: 0, y: 0, z: 0}
      this.marker.position.set(pick.x + wgPos.x, pick.y + wgPos.y, pick.z + wgPos.z)
      this.clearTrace()
      const name = this.stars.catalog.getNameOrId(pick.star.hipId)
      if (!this.stars.labelCenterPosByName[name]) {
        this.traceLabel = this.labelStar(pick)
      }
    })
  }

  /** Leave a label on star and navigate there */
  markCb(e) {
    queryPoints(this.ui, e, this.tree, this.stars, (pick) => {
      this.pickedStarLabels[pick.star.hipId] = this.traceLabel
      this.traceLabel = null
      this.ui.sceneManager.goTo(pick.star)
    })
  }

  /** If there's a current trace label, remove it from scene */
  clearTrace() {
    if (this.traceLabel) {
      this.traceLabel.removeFromParent()
    }
  }

  /**
   * Add star's name as label at its position
   *
   * @returns {object} The label
   */
  labelStar(pick) {
    const starName = `${this.stars.catalog.getNameOrId(pick.star.hipId)}`
    const labelSheet = new SpriteSheet(1, starName, undefined, [0, 1e5], true)
    // Use pick.star.xyz (float32_LY * LIGHTYEAR_METER) so SpriteSheet's high/low
    // split produces the same positionLow as StarsBufferGeometry — without this,
    // Math.fround(pick.x) === pick.x so positionLow=0 and the label jumps each
    // time the camera's float32 camHigh steps by one ULP (~5e11 m).
    labelSheet.add(pick.star.x, pick.star.y, pick.star.z, starName)
    const label = labelSheet.compile()
    const rtePos = new Vector3()
    label.onBeforeRender = (renderer, scene, camera) => {
      camera.getWorldPosition(rtePos)
      const wg = scene.getObjectByName('WorldGroup')
      if (wg) {
        rtePos.sub(wg.position)
      }
      const hx = Math.fround(rtePos.x)
      const hy = Math.fround(rtePos.y)
      const hz = Math.fround(rtePos.z)
      label.material.uniforms.uCamPosWorldHigh.value.set(hx, hy, hz)
      label.material.uniforms.uCamPosWorldLow.value.set(rtePos.x - hx, rtePos.y - hy, rtePos.z - hz)
    }
    this.ui.scene.add(label)
    return label
  }
}
