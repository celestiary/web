/** */
export default class Keys {
  /** */
  constructor(win = window, useStore = null) {
    this.window = win
    this.keymap = {}
    this.msgs = {}
    // Per-key state getter for boolean toggles: the Settings UI renders
    // these as checkboxes (with current state) instead of plain buttons.
    // Pure read-side — caller is responsible for passing the same fn on
    // every refresh.  Absent for one-shot action keys ('h', 'g', etc.).
    this.toggleStates = {}
    // Per-key group label, drives the Settings panel section grouping.
    // Entries without a group land in `MISC_GROUP_NAME` at the bottom.
    this.groups = {}
    // Click-only actions: items the user can toggle from Settings but which
    // don't have a keyboard shortcut.  Each entry: {fn, msg, getState?, group?}.
    // Listed in Settings after the keyed shortcuts.
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
   * @param {Function} [getState] Optional zero-arg boolean getter; when
   *   supplied, Settings renders this entry as a checkbox reflecting the
   *   current state instead of a click-only button.
   * @param {string} [group] Optional Settings-panel section heading.
   */
  map(c, fn, msg, getState, group) {
    this.keymap[c] = fn
    this.msgs[c] = msg
    if (typeof getState === 'function') {
      this.toggleStates[c] = getState
    }
    if (typeof group === 'string') {
      this.groups[c] = group
    }
  }


  /**
   * Register a click-only action — listed in Settings without a key shortcut.
   *
   * @param {Function} fn
   * @param {string} msg
   * @param {Function} [getState] Optional zero-arg boolean getter; when
   *   supplied, Settings renders this action as a checkbox reflecting the
   *   current state instead of a click-only button.
   * @param {string} [group] Optional Settings-panel section heading.
   */
  addAction(fn, msg, getState, group) {
    const entry = {fn, msg}
    if (typeof getState === 'function') {
      entry.getState = getState
    }
    if (typeof group === 'string') {
      entry.group = group
    }
    this.actions.push(entry)
  }
}
