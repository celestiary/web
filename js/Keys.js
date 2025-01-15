/** */
export default class Keys {
  /** */
  constructor(useStore) {
    this.keymap = {}
    this.msgs = {}
    this.bindToWindow(useStore)
  }


  /** */
  bindToWindow(useStore) {
    window.addEventListener('keydown', (e) => {
      const is = useStore.getState().isDatePickerVisible
      if (!is) {
        this.onKeyDown(e)
      }
    })
  }


  /** @param {object} event */
  onKeyDown(event) {
    const charStr = event.key
    if (charStr && typeof charStr == 'string') {
      const f = this.keymap[charStr.toUpperCase()]
      if (f) {
        f()
      }
    }
  }


  /**
   * @param {string} c Shortcut key
   * @param {Function} fn
   * @param {string} msg
   */
  map(c, fn, msg) {
    this.keymap[c.toUpperCase()] = fn
    this.msgs[c] = msg
  }
}
