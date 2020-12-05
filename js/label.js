// From https://codepen.io/dxinteractive/pen/reNpOR
import {Vector3} from './lib/three.js/three.module.js';
import * as Utils from './utils.js';

const labels = {};
let labelNdx = 0;

export default class Label {
  constructor(labelText, domContainer, threeParent) {
    Utils.assertArgs(arguments, 3);
    this.container = domContainer;
    const elt = document.createElement('div');
    elt.innerText = labelText;
    elt.className = 'text-label';
    this.elt = elt;
    this.threeParent = threeParent || false;
    this.position = new Vector3(0, 0, 0);
    this.tempPosition = new Vector3(0, 0, 0);
    this.container.appendChild(this.elt);
    this.id = labelNdx++;
    labels[this.id] = this;
  }


  static onAnimate(camera) {
    for (let l in labels) {
      const label = labels[l];
      label.updatePosition(camera);
    }
  }


  static remove(label) {
    if (labels[label.id]) {
      delete labels[label.id];
      label.elt.parentNode.removeChild(label.elt);
      label.threeParent = null;
    } else {
      throw new Error('Unknown label: ', label);
    }
  }


  setParent(threejsobj) {
    this.threeParent = threejsobj;
  }


  updatePosition(camera) {
    if (this.threeParent) {
      this.threeParent.updateMatrixWorld();
      this.tempPosition.setFromMatrixPosition(this.threeParent.matrixWorld);
      this.position.copy(this.tempPosition);
    }
    const coords2d = this.get2DCoords(this.position, camera);
    this.elt.style.left = coords2d.x + 'px';
    this.elt.style.top = coords2d.y + 'px';
  }


  get2DCoords(position, camera) {
    const vector = position.project(camera);
    vector.x = (vector.x + 1) / 2 * this.container.offsetWidth;
    vector.y = -(vector.y - 1) / 2 * this.container.offsetHeight;
    return vector;
  }

  remove() {
    this.container.removeChild(this.elt);
  }
}
