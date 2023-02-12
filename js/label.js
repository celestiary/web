import {Object3D} from 'three'

import SpriteSheet from './SpriteSheet.js'


/**
 * TODO: use shared SpriteSheet.
 */
export default class Label extends Object3D {
  /**
   */
  constructor(labelText, opts) {
    super()
    this.opts = {
      font: (opts && opts.font) ? opts.font : SpriteSheet.defaultFont,
      fillStyle: (opts && opts.fillStyle) ? opts.fillStyle : 'white',
    }
    const ss = new SpriteSheet(1, labelText, this.opts.font, [0, 0])
    ss.add(0, 0, 0, labelText, this.opts.fillStyle)
    this.add(ss.compile())
  }
}
