/**
 * Modifies the DOM tree rooted at {@param elt} to make the
 * given {@param tagTypes} interactively collapsable/expandable.
 */
function makeCollapsable(elt, tagTypes) {
  tagTypes = tagTypes || ['UL', 'OL'];
  if (elt.nodeType != 1) { // i.e. DOM Element
    return;
  }
  var copyOfChildNodes = [];
  for (const cndx in elt.childNodes) {
    copyOfChildNodes.push(elt.childNodes[cndx]);
  }
  if (tagTypes.indexOf(elt.nodeName) != -1) {
    const toggleCtrl = document.createElement('button');
    toggleCtrl.setAttribute('class', 'collapsor');
    toggleCtrl.onclick = (e) => { collapse(toggleCtrl) };
    toggleCtrl.innerHTML =
      eltClass(elt, 'check', 'collapsed') ? '[+]' : '[-]';
    elt.parentNode.insertBefore(toggleCtrl, elt);
  }
  for (const cndx in copyOfChildNodes) {
    makeCollapsable(copyOfChildNodes[cndx], tagTypes);
  }
}


/**
 * The click handler attached to collapsable nodes.
 */
function collapse(ctrl) {
  var target = ctrl.nextSibling;
  if (eltClass(target, 'check', 'collapsed')) {
    eltClass(target, 'remove', 'collapsed');
    ctrl.innerHTML = '[-]';
  } else {
    eltClass(target, 'add', 'collapsed');
    ctrl.innerHTML = '[+]';
  }
  return false;
}


/**
 * Utility to 'check', 'add' or 'remove' a className attribute
 * for a given node.  If the action is 'check', true is returned
 * if the node has the class, or false otherwise.
 */
function eltClass(elt, action, className) {
  var classNames = elt.className.split(/ +/);
  if (action == 'check') {
    for (var i in classNames) {
      if (classNames[i] == className) {
        return true;
      }
    }
    return false;
  } else if (action == 'add') {
    for (var i in classNames) {
      if (classNames[i] == className) {
        return true;
      }
    }
    elt.className += ' ' + className;
  } else if (action == 'remove') {
    var newClassNames = '';
    for (var i in classNames) {
      if (classNames[i] == className) {
        continue;
      }
      newClassNames += ' ' + classNames[i];
    }
    elt.className = newClassNames;
  }
  return true;
}


export {
  makeCollapsable,
  collapse
}
