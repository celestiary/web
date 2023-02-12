/** */
export default class Keys {
  /** */
  constructor() {
    this.keymap = {}
    this.msgs = {}
    this.bindToWindow()
  }


  /** */
  bindToWindow() {
    window.addEventListener('keydown', (e) => {
      this.onKeyDown(e)
    })
  }


  /** @param {object} event */
  onKeyDown(event) {
    const charStr = event.key
    const f = this.keymap[charStr]
    if (f) {
      f()
    }
  }


  /**
   * @param {string} c Shortcut key
   * @param {Function} fn
   * @param {string} msg
   */
  map(c, fn, msg) {
    this.keymap[c] = fn
    this.msgs[c] = msg
  }
}
