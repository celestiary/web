import * as THREE from './lib/three.js/three.module.js';


export default class Object extends THREE.Object3D {

  static registry = [];

  /**
   * @param name Prefix, attached to .frame suffix.
   * @param props Optional props to attach to a .props field on the frame.
   * @param onClick Optional callback to handle click.  Leaving
   * undefined will pass click to parent.
   */
  constructor(name, props, onClick) {
    super();
    this.name = name;
    this.props = props || {name: name};
    this.onClick = onClick;
    Object.registry[name] = this;
  }
}