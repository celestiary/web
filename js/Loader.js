import {assert} from './assert'
import {descriptorUrl, loadBodyBundle} from './bodyBundle'


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
    // The bodies loaded whose parent this loader hasn't (_pathOf).
    this._roots = new Set()
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
        this.pathByName[name] = this._pathOf(prefix, name, obj)
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
        const url = descriptorUrl(name)
        fetch(url)
            .then((rsp) => (rsp.ok ? rsp.json() : Promise.reject(new Error(`${url}: ${rsp.status}`))))
            .then(arrived, (err) => onErrCb?.(err))
      })
    }
  }


  /**
   * A body's path, as the links name it (design/URLs.md): its parent's and
   * its name, from below the root ('sun/earth/moon', the root 'milkyway'),
   * however the load came to it, through the root's system or a path
   * ('sun/earth').  A body whose parent this loader doesn't have is a root,
   * named by the prefix it was loaded under: the milky way, or a body a
   * guide loads alone.
   *
   * @param {string} prefix The path it was loaded under
   * @param {string} name
   * @param {object} obj Its descriptor
   * @returns {string}
   */
  _pathOf(prefix, name, obj) {
    const parent = obj?.parent
    if (parent && typeof this.loaded[parent] === 'object' && this.pathByName[parent] !== undefined) {
      return this._roots.has(parent) ? name : `${this.pathByName[parent]}/${name}`
    }
    this._roots.add(name)
    return prefix ? `${prefix}/${name}` : name
  }


  /**
   * A body's path from below the root, its ancestors filled in from their
   * descriptors' `parent`: 'earth' is 'sun/earth' and 'moon' or 'earth/moon'
   * is 'sun/earth/moon', below 'milkyway'.  The scene adds a body to its
   * parent, so a path that starts below the root's own system has to load
   * the bodies above it first (#336): loadPath loads a path's segments in
   * order, but brings a body it's given alone before its parent, which
   * another load may have in flight or not have asked for at all.
   *
   * A path that starts at the root or in its system is given back as it
   * is, and so is one whose first body or its parent is nowhere (loadPath
   * then reports it).
   *
   * @param {string} path e.g. 'earth', 'earth/moon'
   * @param {string} root The scene's root, e.g. 'milkyway'
   * @returns {Promise<string>} e.g. 'sun/earth'
   */
  async fullPath(path, root) {
    const parts = path.split('/')
    for (;;) {
      if (parts[0] === root) {
        break
      }
      const parent = (await this._descriptor(parts[0]))?.parent
      if (!parent || parent === root || parts.includes(parent) || !(await this._descriptor(parent))) {
        break
      }
      parts.unshift(parent)
    }
    return parts.join('/')
  }


  /**
   * A body's descriptor, to read and not to keep: the one loaded, else the
   * bundle's, else its own file's.  Loading it is still loadObj's.
   *
   * @param {string} name
   * @returns {Promise<?object>} null if it's nowhere
   */
  async _descriptor(name) {
    const loaded = this.loaded[name]
    if (loaded && typeof loaded === 'object') {
      return loaded
    }
    const bodies = await this._bundle()
    const obj = bodies?.[name]
    if (obj && typeof obj === 'object') {
      return obj
    }
    try {
      const rsp = await fetch(descriptorUrl(name))
      return rsp.ok ? await rsp.json() : null
    } catch {
      return null
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
