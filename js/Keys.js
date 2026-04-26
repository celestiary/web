/** */
export default class Keys {
  /** */
  constructor(win = window, useStore = null) {
    this.window = win
    this.keymap = {}
    this.msgs = {}
    // Click-only actions: items the user can toggle from Settings but which
    // don't have a keyboard shortcut.  Each entry: {fn, msg}.  Listed in
    // Settings after the keyed shortcuts.
    this.actions = []
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
    // Suppress app shortcuts when the user is typing — otherwise letters
    // bound as hotkeys (e.g. 'g', 'h') would fire while entering a query
    // into the search bar or any other text input.
    const doc = this.window && this.window.document
    const active = doc && doc.activeElement
    if (active) {
      const tag = active.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
          active.isContentEditable) {
        return
      }
    }
    const charStr = event.key
    // Case-sensitive lookup so 'v' (plain) and 'V' (Shift+v) can be bound
    // to different actions — the browser already distinguishes them in
    // event.key for letters with Shift held.  Non-letter keys (' ', ';',
    // 'ArrowUp', etc.) are unaffected since their event.key is the same
    // either way.
    if (charStr && typeof charStr === 'string') {
      const f = this.keymap[charStr]
      if (f) {
        f()
      }
    }
  }


  /**
   * @param {string} c Shortcut key (case-sensitive — 'v' and 'V' bind to
   *   different handlers).
   * @param {Function} fn
   * @param {string} msg
   */
  map(c, fn, msg) {
    this.keymap[c] = fn
    this.msgs[c] = msg
  }


  /**
   * Register a click-only action — listed in Settings without a key shortcut.
   *
   * @param {Function} fn
   * @param {string} msg
   */
  addAction(fn, msg) {
    this.actions.push({fn, msg})
  }
}
