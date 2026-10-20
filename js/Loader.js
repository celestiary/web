import {assert} from './assert'
import {loadBodyBundle} from './bodyBundle'


/**
 * The Loader fetches the scene resource descriptions and reifies
 * their data.
 *
 * TODO(pablo): There are currently a few ways of loading around the
 * code, should consolidate.
 */
export default class Loader {
  /**
   * @param {Function} [bundle] Resolves to the bodies' bundle (bodyBundle.js),
   *   or null for none
   */
  constructor(bundle = loadBodyBundle) {
    this.loaded = {}
    this.pathByName = {}
    this._bundle = bundle
  }


  /**
   * @param {!string} path The path, e.g. 'a/b/c'.
   * @param {Function} onLoadCb Called when the object is loaded.
   * This will only happen the first time this path prefix is
   * encountered.
   * @param {Function} onDoneCb Called when the object is loaded.
   * This will happen once whether or not the path has previously been
   * loaded.
   */
  loadPath(path, onLoadCb, onDoneCb, onErrCb) {
    if (path.length === 0) {
      throw new Error('empty target path')
    }
    const partsToLoad = path.split('/')
    const targetName = partsToLoad[partsToLoad.length - 1]
    if (typeof this.loaded[targetName] === 'object') {
      onDoneCb(path, this.loaded[targetName])
    }
    this.loadPathRecursive(partsToLoad, (name, obj) => {
      onLoadCb(name, obj)
      if (name === targetName) {
        onDoneCb(path, obj)
      }
    }, onErrCb)
  }


  /**
   * @param {!Array} partsToLoad The path to the object, e.g. ['a','b','c'].
   * @param {Function} onLoadCb Called when the object is loaded.
   * @param {Function} onErrCb
   * @param {Array} [partsLoaded]
   */
  loadPathRecursive(partsToLoad, onLoadCb, onErrCb, partsLoaded = []) {
    assert(partsToLoad.length > 0, 'Must provide an array of names to load')
    const name = partsToLoad.shift()
    this.loadObj(partsLoaded.join('/'), name, (loadedName, obj) => {
      onLoadCb(loadedName, obj)
      partsLoaded.push(loadedName)
      if (partsToLoad.length > 0) {
        this.loadPathRecursive(partsToLoad, onLoadCb, onErrCb, partsLoaded)
      }
    }, true, onErrCb)
  }


  /**
   * Loads the given object; optionally expanding if it has as system.
   *
   * @param {Function} onLoadCb Called when the object is loaded.
   * This will only happen once per path.
   * @param {!boolean} expand Whether to also load the children of the
   *     given node.
   */
  loadObj(prefix, name, onLoadCb, expand, onErrCb) {
    const loadedObj = this.loaded[name]
    if (loadedObj) {
      if (loadedObj === 'pending') {
        return
      }
      if (expand && loadedObj.system) {
        const path = prefix ? `${prefix}/${name}` : name
        for (let i = 0; i < loadedObj.system.length; i++) {
          this.loadObj(path, loadedObj.system[i], onLoadCb, true, onErrCb)
        }
      }
    } else {
      this.loaded[name] = 'pending'
      const arrived = (obj) => {
        this.loaded[name] = obj
        const path = prefix ? `${prefix}/${name}` : name
        this.pathByName[name] = path
        if (onLoadCb) {
          onLoadCb(name, obj)
        }
        this.loadObj(prefix, name, onLoadCb, expand, onErrCb)
      }
      // From the bodies' bundle (one request for the scene), else its own
      // file: a body the bundle doesn't have, or no bundle.
      this._bundle().then((bodies) => {
        const obj = bodies?.[name]
        if (obj && typeof obj === 'object') {
          // A copy: the scene keeps and changes what it's given, and every
          // Loader shares the bundle.
          arrived(structuredClone(obj))
          return
        }
        fetch(`data/${name}.json`)
            .then((rsp) => (rsp.ok ? rsp.json() : Promise.reject(new Error(`data/${name}.json: ${rsp.status}`))))
            .then(arrived, (err) => onErrCb?.(err))
      })
    }
  }


  /**
   * @param {object} shaderConfig
   * @param {Function} doneCb
   */
  loadShaders(shaderConfig, doneCb) {
    let vertDone = false; let fragDone = false
    const checkDone = () => {
      if (vertDone && fragDone) {
        doneCb()
      }
    }
    fetch(shaderConfig.vertexShader).then((rsp) => {
      rsp.text().then((text) => {
        shaderConfig.vertexShader = text
        vertDone = true
        checkDone()
      })
    })
    fetch(shaderConfig.fragmentShader).then((rsp) => {
      rsp.text().then((text) => {
        shaderConfig.fragmentShader = text
        fragDone = true
        checkDone()
      })
    })
  }
}
