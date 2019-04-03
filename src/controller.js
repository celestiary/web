import Resource from './rest.js';
import Measure from './measure.js';


/**
 * The Controller loads the scene.  The scene nodes are fetched from
 * the server, a mapping is created for navigation to current scene
 * node locations based on names, and information is displayed for
 * the selected node.
 */
export default class Controller {
  constructor(scene) {
    this.scene = scene;
    this.curPath = [];
    this.loaded = {};
  }


  /**
   * @param {!string} p The path, e.g. 'a/b/c'.
   * @param {function} cb Called when the path is loaded.
   */
  loadPath(reqPath, cb) {
    if (reqPath.length == 0) {
      console.log('empty target path');
      return;
    }
    this.curPath = reqPath.split('/');
    const targetElt = this.curPath[this.curPath.length - 1];
    this.loadPathRecursive([].concat(this.curPath), (loadedName) => {
        console.log(`loadedName: ${loadedName}, targetElt: ${targetElt}`);
        if (loadedName == targetElt) {
          if (cb) {
            cb(this.curPath, this.loaded);
          }
        }
      });
  }


  /**
   * @param {!Array} path The path to the scene target, e.g. ['a',
   * 'b', 'c'].
   * @param {cb} Will be passed to the loadObj method on the load call
   * for the last path element.
   */
  loadPathRecursive(path, cb) {
    if (path.length == 0) {
      return;
    }
    const systemName = path.shift();
    this.loadObj(systemName, true, path.length == 0 ? cb : null);
    this.loadPathRecursive(path, cb);
  }


  getPathTarget() {
    return this.curPath[this.curPath.length - 1];
  }


  /**
   * Loads the given object and adds it to the scene; optionally
   * expanding if it has as system.
   * @param {!boolean} expand Whether to also load the children of the
   *     given node.
   * @param {function} cb optional callback.
   */
  loadObj(name, expand, cb) {
    const loadedObj = this.loaded[name];
    if (loadedObj) {
      if (loadedObj == 'pending') {
        return;
      }
      if (expand && loadedObj.system) {
        for (let i = 0; i < loadedObj.system.length; i++) {
          this.loadObj(loadedObj.system[i], false);
        }
      }
      // Execute cb immediately even though children may not all be
      // loaded.  TODO(pablo): later selection of possibly unloaded
      // child should wait.
      if (cb) {
        cb(name);
      }
    } else {
      this.loaded[name] = 'pending';
      new Resource(name).get((obj) => {
          this.loaded[name] = obj;
          this.reifyMeasures(obj);
          this.scene.add(obj);
          if (expand && obj.system) {
            for (let i = 0; i < obj.system.length; i++) {
	      this.loadObj(obj.system[i], false);
            }
          }
          if (cb) {
            cb(name);
          }
        });
    }
  }


  /**
   * Most measures are just passed on for display.  Some are needed to
   * be reified, like radius and mass.
   */
  reifyMeasures(obj) {
    function reify(obj, prop, name) {
      if (obj[prop]) {
        if (typeof obj[prop] === 'string') {
          const m = Measure.parse(obj[prop]).convertToUnit();
          // The parse leaves small amount in the low-significant
          // decimals, meaningless for unit values in grams and meters
          // for celestial objects.
          m.scalar = Math.floor(m.scalar);
          obj[prop] = m;
        } else {
          console.log(`unnormalized ${prop} for ${name}`);
        }
      }
    }
    const name = obj.name;
    reify(obj, 'radius', name);
    reify(obj, 'mass', name);
  }
}
