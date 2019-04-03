import * as Shapes from './shapes.js';

/**
 * Recursively visit child members of {@param elt}'s "children" property.
 * @param cb1 The pre-order callback.  Called with the current element.
 * @param cb2 The in-order callback.  Called with the parent and current element.
 * @param cb3 The post-order callback.  Called with the current element.
 * @param level is incremented on the way down recursivey and probably
 * should not be set by caller, but will be passed to the callbacks to
 * allow indent formatting.
 */
function visitChildren(elt, cb1, cb2, cb3, level) {
  level = level || 1;
  if (cb1) {
    cb1(elt, level);
  }
  if (elt.children) {
    for (let ndx in elt.children) {
      const child = elt.children[ndx];
      if (cb2) {
        cb2(elt, child, level);
      }
      visitChildren(child, cb1, cb2, cb3, level + 1);
    }
  }
  if (cb3) {
    cb3(elt, level);
  }
}

function lineTraceScene(root) {
  visitChildren(root, null, (parent, elt, level) => {
      if (root.position.equals(elt.position)) {
        console.log(`${elt.name} is at root`);
        return;
      }
      console.log(new Array(level + 1).join(' ') + elt.name);
      const line = Shapes.line(root.position, elt.position);
      console.log('lineTraceScene: ', line);
      root.add(line);
    });
}

export {
  lineTraceScene,
  visitChildren
};
