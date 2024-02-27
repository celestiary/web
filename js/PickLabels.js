import createTree from '@pablo-mayrgundter/yaot2'
import SpriteSheet from './SpriteSheet.js'
import {queryPoints} from './Picker'
import {marker as createMarker} from './shapes'
import {assertDefined} from './assert'


/** */
export default class PickLabels {
  constructor(ui, stars) {
    assertDefined(ui, stars)
    this.ui = ui
    this.stars = stars
    this.marker = createMarker()
    this.marker.visible = true
    this.ui.scene.add(this.marker)
    this.pickedStarLabels = {}
    this.curPickedLabel = null
    this.tree = createTree()
    this.tree.init(stars.geom.coords)
    this.mcb = null
    this.tcb = null
  }

  /** Add dblclick calls mark, mousemove calls trace */
  addPickListeners() {
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
  }

  /** Mark and label current star */
  traceCb(e) {
    queryPoints(this.ui, e, this.tree, this.stars, (pick) => {
      this.marker.position.copy(pick)
      if (this.curPickedLabel) {
        this.curPickedLabel.removeFromParent()
      }
      this.curPickedLabel = this.labelStar(pick)
    })
  }

  /** Leave a label on star */
  markCb(e) {
    queryPoints(this.ui, e, this.tree, this.stars, (pick) => {
      const curLabel = this.curPickedLabel
      this.pickedStarLabels[name] = curLabel
      this.curPickedLabel = null
    })
  }

  /**
   * Add star's name as label at its position
   *
   * @returns {object} The label
   */
  labelStar(pick) {
    const starName = `${this.stars.catalog.getNameOrId(pick.star.hipId)}`
    const labelSheet = new SpriteSheet(1, starName, undefined, [0, 1e5])
    labelSheet.add(pick.x, pick.y, pick.z, starName)
    const label = labelSheet.compile()
    this.ui.scene.add(label)
    return label
  }
}
