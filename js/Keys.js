export default class Keys {
  constructor() {
    this.keymap = {};
    this.msgs = {};
    this.bindToWindow();
  }


  bindToWindow() {
    window.addEventListener('keydown', e => {
      this.onKeyDown(e);
    });
  }


  onKeyDown(event) {
    const charStr = event.key;
    const f = this.keymap[charStr];
    if (f) {
      f();
    }
  }


  map(c, fn, msg) {
    this.keymap[c] = fn;
    this.msgs[c] = msg;
  }
}
