/**
 * Modifies the DOM tree rooted at {@param elt} to make the
 * given {@param tagTypes} interactively collapsable/expandable.
 */
export function makeCollapsable(elt, tagTypes) {
  tagTypes = tagTypes || ['UL', 'OL']
  if (elt.nodeType !== 1) { // i.e. DOM Element
    return
  }
  const copyOfChildNodes = []
  const children = elt.childNodes
  for (const cndx in children) {
    if (Object.prototype.hasOwnProperty.call(children, cndx)) {
      copyOfChildNodes.push(children[cndx])
    }
  }
  if (tagTypes.indexOf(elt.nodeName) !== -1) {
    const toggleCtrl = document.createElement('button')
    toggleCtrl.setAttribute('class', 'collapsor')
    toggleCtrl.onclick = (e) => {
      collapse(toggleCtrl)
    }
    toggleCtrl.innerHTML =
      eltClass(elt, 'check', 'collapsed') ? '[+]' : '[-]'
    elt.parentNode.insertBefore(toggleCtrl, elt)
  }
  for (const cndx in copyOfChildNodes) {
    if (Object.prototype.hasOwnProperty.call(copyOfChildNodes, cndx)) {
      makeCollapsable(copyOfChildNodes[cndx], tagTypes)
    }
  }
}


/**
 * The click handler attached to collapsable nodes.
 *
 * @returns {boolean}
 */
export function collapse(ctrl) {
  const target = ctrl.nextSibling
  if (eltClass(target, 'check', 'collapsed')) {
    eltClass(target, 'remove', 'collapsed')
    ctrl.innerHTML = '[-]'
  } else {
    eltClass(target, 'add', 'collapsed')
    ctrl.innerHTML = '[+]'
  }
  return false
}


/**
 * Utility to 'check', 'add' or 'remove' a className attribute
 * for a given node.  If the action is 'check', true is returned
 * if the node has the class, or false otherwise.
 *
 * @returns {boolean}
 */
function eltClass(elt, action, className) {
  const classNames = elt.className.split(/ +/)
  if (action === 'check') {
    for (const i in classNames) {
      if (Object.prototype.hasOwnProperty.call(classNames, i)) {
        if (classNames[i] === className) {
          return true
        }
      }
    }
    return false
  } else if (action === 'add') {
    for (const i in classNames) {
      if (Object.prototype.hasOwnProperty.call(classNames, i)) {
        if (classNames[i] === className) {
          return true
        }
      }
    }
    elt.className += ` ${className}`
  } else if (action === 'remove') {
    let newClassNames = ''
    for (const i in classNames) {
      if (Object.prototype.hasOwnProperty.call(classNames, i)) {
        if (classNames[i] === className) {
          continue
        }
        newClassNames += ` ${classNames[i]}`
      }
    }
    elt.className = newClassNames
  }
  return true
}
