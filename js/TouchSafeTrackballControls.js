import {Vector2} from 'three'
import {TrackballControls} from 'three/examples/jsm/controls/TrackballControls.js'


/**
 * three's TrackballControls, keeping its list of touching pointers right.
 *
 * It captures only the first pointer down, so a second finger lifted over
 * HTML (the widgets sheet, the info panel, a button) sends its pointerup
 * there, and the pointer stays in the list.  When a later touch reuses that
 * pointer ID (iOS does, as does devtools' touch emulation) the list holds it
 * twice; the touch's end deletes its position and one entry, leaving the
 * other with no position, and every touch move from then on throws reading
 * it (TrackballControls onTouchMove, onTouchEnd).
 *
 * So: every pointer is captured, so its up or cancel comes back here; a
 * pointer is listed once; and one with no position reads as where it went
 * down.
 */
export default class TouchSafeTrackballControls extends TrackballControls {
  /** Also capture every pointer down, after TrackballControls' own handler. */
  connect() {
    super.connect()
    // Set here, as the base constructor connects before this one's fields.
    this._captureEveryPointer ??= (event) => {
      if (this.enabled) {
        this.domElement.setPointerCapture?.(event.pointerId)
      }
    }
    this.domElement.addEventListener('pointerdown', this._captureEveryPointer)
  }


  /** */
  disconnect() {
    super.disconnect()
    this.domElement.removeEventListener('pointerdown', this._captureEveryPointer)
  }


  /** @param {PointerEvent} event */
  _addPointer(event) {
    this._pointers = this._pointers.filter((p) => p.pointerId !== event.pointerId)
    super._addPointer(event)
  }


  /** @param {PointerEvent} event */
  _removePointer(event) {
    delete this._pointerPositions[event.pointerId]
    this._pointers = this._pointers.filter((p) => p.pointerId !== event.pointerId)
  }


  /**
   * @param {PointerEvent} event
   * @returns {Vector2} The other pointer's position
   */
  _getSecondPointerPosition(event) {
    const other = this._pointers.find((p) => p.pointerId !== event.pointerId) ?? event
    return this._pointerPositions[other.pointerId] ?? new Vector2(other.pageX, other.pageY)
  }
}
