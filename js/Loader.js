import {FileLoader} from 'three'


/**
 * The Loader fetches the scene resource descriptions and reifies
 * their data.
 *
 * TODO(pablo): There are currently a few ways of loading around the
 * code, should consolidate.
 */
export default class Loader {
  /** */
  constructor() {
    this.loaded = {}
    this.pathByName = {}
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
    const parts = path.split('/')
    const targetName = parts[parts.length - 1]
    if (typeof this.loaded[targetName] === 'object') {
      onDoneCb(path, this.loaded[targetName])
    }
    this.loadPathRecursive(parts, (name, obj) => {
      onLoadCb(name, obj)
      if (name === targetName) {
        onDoneCb(path, obj)
      }
    }, onErrCb)
  }


  /**
   * @param {!Array} pathParts The path to the object, e.g. ['a','b','c'].
   * @param {Function} onLoadCb Called when the object is loaded.
   * This will only happen once per path.
   */
  loadPathRecursive(pathParts, onLoadCb, onErrCb) {
    if (pathParts.length === 0) {
      return
    }
    const name = pathParts.pop()
    this.loadPathRecursive(pathParts, onLoadCb, onErrCb)
    this.loadObj(pathParts.join('/'), name, onLoadCb, true, onErrCb)
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
          this.loadObj(path, loadedObj.system[i], onLoadCb, false, onErrCb)
        }
      }
    } else {
      this.loaded[name] = 'pending'
      const fileLoader = new FileLoader()
      fileLoader.setResponseType('json')
      fileLoader.load(`/data/${ name }.json`, (obj) => {
        this.loaded[name] = obj
        const path = prefix ? `${prefix}/${name}` : name
        this.pathByName[name] = path
        if (onLoadCb) {
          onLoadCb(name, obj)
        }
        this.loadObj(prefix, name, onLoadCb, expand, onErrCb)
      }, null, onErrCb)
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
