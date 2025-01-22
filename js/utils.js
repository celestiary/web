/**
 * @param {any} x
 * @returns {any}
 */
export function assertNotNullOrUndefined(x) {
  try {
    if (x === null) {
      throw new Error('Variable may not be null')
    }
    if (x === undefined) {
      throw new Error('Variable may not be undefined')
    }
  } catch (e) {
    console.error(e)
    throw e
  }
  return x
}


/**
 * @param {Array.<any>} args
 */
export function assertArgs(...args) {
  let i
  try {
    for (i = 0; i < args.length; i++) {
      assertNotNullOrUndefined(args[i])
    }
  } catch (e) {
    if (i === undefined) {
      console.error(e)
    } else {
      console.error(`Arg ${i}: ${e}`)
    }
    throw e
  }
}


/**
 * @param {number} x
 * @returns {number} x
 * @throws Error if !Number.isFinite(x)
 */
export function assertFinite(x) {
  if (!Number.isFinite(x)) {
    throw new Error('Number not finite')
  }
  return x
}


/**
 * @param {any} expected
 * @param {any} actual
 * @returns {any} The actual value
 * @throws Error if expected !== value
 */
export function assertEquals(expected, actual) {
  if (expected !== actual) {
    throw new Error(`Expected: ${expected} === actual: ${actual}`)
  }
  return actual
}


/**
 * Recursively visit child members of {@param elt}'s "children" property.
 *
 * @param {Element} elt Element to visit.
 * @param {Function} cb1 The pre-order callback.  Called with the current element.
 * @param {Function} [cb2] The in-order callback.  Called with the parent and current element.
 * @param {Function} [cb3] The post-order callback.  Called with the current element.
 * @param {number} [level] is incremented on the way down recursivey and probably
 * should not be set by caller, but will be passed to the callbacks to
 * allow indent formatting.
 */
export function visit(elt, cb1, cb2, cb3, level = 1) {
  if (!cb1) {
    throw new Error('cb1 required')
  }
  cb1(elt, level)
  if (elt.children) {
    Array.from(elt.children).forEach((child) => {
      if (cb2) {
        cb2(elt, child, level)
      }
      visit(child, cb1, cb2, cb3, level + 1)
    })
  }
  if (cb3) {
    cb3(elt, level)
  }
}


/**
 * Preorder visit.
 *
 * @param {Element} elt Element to visit.
 * @param {string} propName
 * @param {object} propValue
 * @param {Function} cb
 */
export function visitFilterProperty(elt, propName, propValue, cb) {
  visit(
    elt,
    /** @param {Object<string, any>} child */
    (child) => {
      if (child[propName] === propValue) {
        cb(child)
      }
    })
}


/**
 * Preorder visit.
 *
 * @param {Element} elt Element to visit.
 * @param {string} filterPropName
 * @param {object} filterPropValue
 * @param {string} togglePropName
 */
export function visitToggleProperty(elt, filterPropName, filterPropValue, togglePropName) {
  visitFilterProperty(elt, filterPropName, filterPropValue, /** @param {Object<string, any>} child */ (child) => {
    if (!(Object.prototype.hasOwnProperty.call(child, togglePropName) &&
          typeof child[togglePropName] === 'boolean')) {
      throw new Error(`Found child invalid toggle property(${togglePropName}): ${child}`)
    }
    child[togglePropName] = !child[togglePropName]
  })
}


/**
 * @param {string} text
 * @returns {string}
 */
export function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.substring(1)
}


// https://stackoverflow.com/questions/8609289/convert-a-binary-nodejs-buffer-to-javascript-arraybuffer
/**
 * @param {Uint8Array} buf
 * @returns {ArrayBuffer}
 */
export function toArrayBuffer(buf) {
  const ab = new ArrayBuffer(buf.length)
  const view = new Uint8Array(ab)
  for (let i = 0; i < buf.length; ++i) {
    view[i] = buf[i]
  }
  return ab
}


// DOM
/**
 * @param {string} id
 * @returns {HTMLElement|null}
 */
export function elt(id) {
  return document.getElementById(id)
}


/**
 * @param {string} tagName
 * @param {string} inner
 * @returns {Element}
 */
export const newElt = (tagName, inner) => {
  const e = document.createElement(tagName)
  e.innerHTML = inner
  return e
}


/**
 * @param {string} id
 */
export const remove = (id) => {
  const e = elt(id)
  if (e && e.parentNode) {
    e.parentNode.removeChild(e)
  } else {
    console.warn('Cannot remove element', e)
  }
}


/**
 * @param {string} location
 * @param {string} prefix
 */
export function setTitleFromLocation(location, prefix) {
  /*
  let path = location.pathname.length > 1 ? location.pathname : location.hash
  if (path.startsWith('#')) {
    path = path.substring(1)
  }
  const parts = path.split('/')
  document.title = capitalize(parts[parts.length - 1])
  */
  document.title = location
}


/**
 * @returns {Element}
 */
export function createCanvas() {
  const canvas = document.createElement('canvas')
  canvas.setAttribute('style', 'border: solid 1px red; display: none')
  document.body.appendChild(canvas)
  return canvas
}


/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {string} fontStyle
 * @returns {object}
 */
export function measureText(ctx, text, fontStyle) {
  if (fontStyle) {
    ctx.font = fontStyle
  }
  const m = ctx.measureText(text)
  const width = Math.ceil(m.width)
  const height = Math.ceil(m.actualBoundingBoxAscent + m.actualBoundingBoxDescent)
  // console.log(`text: ${text}, width: ${width}, height: ${height}`, m);
  return {width, height}
}


// Celestiary
/**
 * @param {Object<any, any>} obj
 * @param {string} name
 * @returns {object}
 */
export function named(obj, name) {
  if (!(typeof name === 'string' && name.length > 0)) {
    throw new Error('Name must be provided')
  }
  obj.name = name
  return obj
}
