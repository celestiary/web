export default class Keys {
  constructor() {
    this.keymap = {};
    this.msgs = {};
    this.domDone = false;
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


  appendHelp(container) {
    if (this.domDone) {
      return;
    }
    this.domDone = true;
    const list = document.createElement('ul');
    for (let i in this.keymap) {
      let keyStr = i;
      if (keyStr == ' ') {
        keyStr = 'space';
      }
      const msg = this.msgs[i];
      let li;
      list.appendChild(li = document.createElement('li'));
      li.innerHTML = `<span>${keyStr}</span>  ${msg}`;
    }
    container.appendChild(document.createTextNode('Controls:'));
    container.appendChild(list);
  }
}
