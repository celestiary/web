/**
 * On a phone the info panel is a sheet from the bottom with three heights
 * (design/UI.md, "Phones: the bottom sheet"): peek, the panel's head; half,
 * its summary; full, most of the scene, a strip of sky kept.  Drag the head
 * (or its grabber) to change it, or tap to step.  The heights are CSS
 * (index.css, `[data-detent]`); this keeps which one, through the panel's
 * re-renders, and marks the page while the sheet is raised so the bottom
 * controls stand aside.
 */


/** The heights, low to high. */
export const DETENTS = ['peek', 'half', 'full']

/** As useIsMobile's. */
const PHONE_QUERY = '(max-width: 600px)'

/** A press that moves less than this is a tap, px. */
const TAP_SLOP_PX = 6


/**
 * @param {number} height the sheet's, px, where a drag left it
 * @param {number[]} heights each detent's, low to high, px
 * @returns {string} the detent nearest it
 */
export function nearestDetent(height, heights) {
  let best = 0
  for (let i = 1; i < heights.length; i++) {
    if (Math.abs(heights[i] - height) < Math.abs(heights[best] - height)) {
      best = i
    }
  }
  return DETENTS[best]
}


/**
 * @param {string} detent
 * @returns {string} where a tap on the head takes it: up from peek, back
 *     down to peek from half, and from full to half
 */
export function tapDetent(detent) {
  return {peek: 'half', half: 'peek', full: 'half'}[detent] ?? 'peek'
}


/** */
export default class InfoSheet {
  /** @param {HTMLElement} elt the panel's container, #nav-info-id */
  constructor(elt) {
    this.elt = elt
    this.detent = 'peek'
    this._drag = null
    this._query = globalThis.window?.matchMedia?.(PHONE_QUERY) ?? null
    this._query?.addEventListener?.('change', () => this.shown())
    elt.addEventListener('pointerdown', (ev) => this._onDown(ev))
    elt.addEventListener('pointermove', (ev) => this._onMove(ev))
    elt.addEventListener('pointerup', (ev) => this._onUp(ev))
    elt.addEventListener('pointercancel', () => this._endDrag(null))
  }


  /** @returns {boolean} whether the panel is a sheet now */
  get isSheet() {
    return Boolean(this._query?.matches)
  }


  /** After the panel is drawn, or the screen's width changes: lay it out. */
  shown() {
    const root = document.documentElement
    const sheet = this.isSheet
    root.classList.toggle('info-sheet', sheet)
    root.classList.toggle('info-raised', sheet && this.detent !== 'peek')
    // What the bottom controls and Cesium's credits stand above.
    root.style.setProperty('--info-sheet-bottom', sheet ? 'var(--sheet-peek)' : '0px')
    if (sheet) {
      this.elt.dataset.detent = this.detent
    } else {
      delete this.elt.dataset.detent
    }
  }


  /** @param {string} detent one of DETENTS */
  setDetent(detent) {
    this.detent = DETENTS.includes(detent) ? detent : 'peek'
    this.shown()
  }


  /** @param {PointerEvent} ev */
  _onDown(ev) {
    if (!this.isSheet || ev.button > 0 || !ev.target?.closest?.('.info-head, .info-grabber') ||
        ev.target.closest('button, a, input')) {
      return
    }
    this._drag = {id: ev.pointerId, y: ev.clientY, height: this.elt.getBoundingClientRect().height, moved: false}
    this.elt.setPointerCapture?.(ev.pointerId)
  }


  /** @param {PointerEvent} ev */
  _onMove(ev) {
    const drag = this._drag
    if (!drag || ev.pointerId !== drag.id) {
      return
    }
    const dy = drag.y - ev.clientY
    if (!drag.moved && Math.abs(dy) < TAP_SLOP_PX) {
      return
    }
    drag.moved = true
    this.elt.classList.add('dragging')
    this.elt.style.height = `${Math.max(0, drag.height + dy)}px`
  }


  /** @param {PointerEvent} ev */
  _onUp(ev) {
    const drag = this._drag
    if (!drag || ev.pointerId !== drag.id) {
      return
    }
    if (!drag.moved) {
      this._endDrag(tapDetent(this.detent))
      return
    }
    this._endDrag(nearestDetent(this.elt.getBoundingClientRect().height, this._heights()))
  }


  /** @param {?string} detent where the drag ends, or null to go back */
  _endDrag(detent) {
    this._drag = null
    this.elt.classList.remove('dragging')
    this.elt.style.height = ''
    this.setDetent(detent ?? this.detent)
  }


  /** @returns {number[]} each detent's height now, px, low to high */
  _heights() {
    const was = this.elt.dataset.detent
    const heights = DETENTS.map((d) => {
      this.elt.dataset.detent = d
      this.elt.style.height = ''
      return this.elt.getBoundingClientRect().height
    })
    this.elt.dataset.detent = was
    return heights
  }
}
