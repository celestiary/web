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
    this.pickedStarLabels = {}
    this.marker = null
    this.tree = null
    this.traceLabel = null
    this.mcb = null
    this.tcb = null

    // Activate when UI button clicked for star marking
    this.ui.useStore.subscribe((state) => {
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
      this.marker.position.copy(pick)
      this.clearTrace()
      this.traceLabel = this.labelStar(pick)
    })
  }

  /** Leave a label on star */
  markCb(e) {
    queryPoints(this.ui, e, this.tree, this.stars, (pick) => {
      const curLabel = this.traceLabel
      this.pickedStarLabels[name] = curLabel
      this.traceLabel = null
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
    const labelSheet = new SpriteSheet(1, starName, undefined, [0, 1e5])
    labelSheet.add(pick.x, pick.y, pick.z, starName)
    const label = labelSheet.compile()
    this.ui.scene.add(label)
    return label
  }
}
