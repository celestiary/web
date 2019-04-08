import Resource from './rest.js';
import Measure from './measure.js';


/**
 * The Loader fetches the scene resource descriptions and reifies their data.
 */
export default class Loader {
  constructor() {
    this.loaded = {};
    this.pathByName = {};
  }


  /**
   * @param {!string} path The path, e.g. 'a/b/c'.
   * @param {function} onLoadCb Called when the object is loaded.
   * This will only happen the first time this path prefix is
   * encountered.
   * @param {function} onDoneCb Called when the object is loaded.
   * This will happen once whether or not the path has previously been
   * loaded.
   */
  loadPath(path, onLoadCb, onDoneCb) {
    if (path.length == 0) {
      throw new Error('empty target path');
    }
    const parts = path.split('/');
    const targetName = parts[parts.length - 1];
    if (typeof this.loaded[targetName] == 'object') {
      onDoneCb(path, this.loaded[targetName]);
    }
    this.loadPathRecursive(parts, (name, obj) => {
        onLoadCb(name, obj);
        if (name == targetName) {
          onDoneCb(path, obj);
        }
      });
  }


  /**
   * @param {!Array} pathParts The path to the object, e.g. ['a','b','c'].
   * @param {function} onLoadCb Called when the object is loaded.
   * This will only happen once per path.
   */
  loadPathRecursive(pathParts, onLoadCb) {
    if (pathParts.length == 0) {
      return;
    }
    const name = pathParts.pop();
    this.loadPathRecursive(pathParts, onLoadCb);
    this.loadObj(pathParts.join('/'), name, onLoadCb, true);
  }


  /**
   * Loads the given object; optionally expanding if it has as system.
   * @param {function} onLoadCb Called when the object is loaded.
   * This will only happen once per path.
   * @param {!boolean} expand Whether to also load the children of the
   *     given node.
   */
  loadObj(prefix, name, onLoadCb, expand) {
    const loadedObj = this.loaded[name];
    if (loadedObj) {
      if (loadedObj == 'pending') {
        return;
      }
      if (expand && loadedObj.system) {
        const path = prefix ? `${prefix}/${name}` : name;
        for (let i = 0; i < loadedObj.system.length; i++) {
          this.loadObj(path, loadedObj.system[i], onLoadCb, false);
        }
      }
    } else {
      this.loaded[name] = 'pending';
      new Resource(name).get((obj) => {
          this.loaded[name] = obj;
          this.reifyMeasures(obj);
          const path = prefix ? `${prefix}/${name}` : name;
          this.pathByName[name] = path;
          if (onLoadCb) {
            onLoadCb(name, obj);
          }
          this.loadObj(prefix, name, onLoadCb, expand);
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
