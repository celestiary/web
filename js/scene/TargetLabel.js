import SpriteSheet from './SpriteSheet.js'
import {overlay} from '../shared.js'
import {rteCameraLocal} from './rte.js'


/**
 * Whether the targeted star's own label is drawn.  The catalogue sheet
 * (`Stars.showLabels`) has only the named and the very luminous stars, so
 * a faint one such as HIP 46635 (V 8.4) has no label there at any
 * magnitude; and the toggle `l` can be off.  The target's name is the one
 * label that stays while any label group is on (`l` stars, `p` bodies and
 * places; `V` turns both off), so a view with the other stars' names hidden
 * still names the star under study.  When `l` is on and the catalogue
 * sheet already has the star, that label is the one drawn, not a second
 * on top of it.
 *
 * @param {object} p
 * @param {boolean} p.wanted A star is the target
 * @param {boolean} p.starLabels `l`: the catalogue's labels are on
 * @param {boolean} p.bodyLabels `p`: the bodies' and places' labels are on
 * @param {boolean} p.inCatalogue The catalogue's sheet labels this star
 * @returns {boolean}
 */
export function targetLabelShown({wanted, starLabels, bodyLabels, inCatalogue}) {
  if (!wanted) {
    return false
  }
  if (starLabels && inCatalogue) {
    return false
  }
  return starLabels || bodyLabels
}


/**
 * The name of the star that is the target, drawn at the star like a
 * catalogue label (a one-label sheet in the stars' frame, as
 * PickLabels.labelStar's).  `set` only records the star, so
 * `Scene.setTarget` does no DOM work (AGENTS.md); `update` runs each frame
 * (Stars' `preAnimCb`) and builds the sheet when the label is first wanted,
 * or drops it when the target moves on.
 */
export default class TargetLabel {
  /**
   * @param {object} parent The stars: the label is in their frame
   * @param {Function} [Sheet] The label sheet's class (SpriteSheet's
   *   constructor and `add`, `compile`), for a test with no canvas
   */
  constructor(parent, Sheet = SpriteSheet) {
    this.parent = parent
    this.Sheet = Sheet
    this.wanted = null
    this.built = null
  }


  /**
   * @param {?object} star StarProps entry (x, y, z, hipId); null for a
   *   target that isn't a star
   * @param {string} [name]
   */
  set(star, name) {
    this.wanted = star ? {star, name: String(name ?? `HIP ${star.hipId}`)} : null
  }


  /** @returns {?number} The wanted star's HIP number */
  get hipId() {
    return this.wanted ? this.wanted.star.hipId : null
  }


  /**
   * @param {boolean} show From targetLabelShown
   * @returns {?object} The label (a Points), built and shown or hidden as `show`
   *   says; null while there is none
   */
  update(show) {
    const wanted = this.wanted
    if (this.built && (!wanted || this.built.star !== wanted.star || this.built.name !== wanted.name)) {
      this._drop()
    }
    if (!wanted || (!this.built && !show)) {
      return null
    }
    if (!this.built) {
      this._build(wanted)
    }
    this.built.label.visible = show
    return this.built.label
  }


  /** @param {object} wanted {star, name} */
  _build({star, name}) {
    const sheet = new this.Sheet(1, name, undefined, [0, 1e5], true)
    // The catalogue's position split, as the catalogue labels do (SpriteSheet
    // RTE): a bare Math.fround would make the label step with the camera.
    sheet.add(star.x, star.y, star.z, name)
    const label = overlay(sheet.compile())
    label.name = 'TargetLabel'
    label.onBeforeRender = (renderer, scene, camera) => {
      const u = label.material.uniforms
      rteCameraLocal(label, camera, u.uCamPosWorldHigh.value, u.uCamPosWorldLow.value)
    }
    // A pick must see it only while it is drawn: labelPick takes visible
    // sheets, and a click on it targets the star it is already.
    label.userData.labelTargets = [{kind: 'star', star, name}]
    this.parent.add(label)
    this.built = {star, name, label, sheet}
  }


  /** Remove the label, and free its texture and canvas. */
  _drop() {
    const {label, sheet} = this.built
    this.built = null
    label.removeFromParent()
    label.geometry.dispose()
    label.material.uniforms.map.value.dispose()
    label.material.dispose()
    sheet.canvas.remove?.()
  }
}
