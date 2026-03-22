/** */
export default class Keys {
  /** */
  constructor(win = window, useStore = null) {
    this.window = win
    this.keymap = {}
    this.msgs = {}
    this.bindToWindow(useStore)
  }


  /** */
  bindToWindow(useStore) {
    this.window.addEventListener('keydown', (e) => {
      const is = useStore ? useStore.getState().isDatePickerVisible : false
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
    const key = c.toUpperCase()
    this.keymap[key] = fn
    this.msgs[key] = msg
  }
}
