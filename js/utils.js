import {line} from './shapes.js';


const elt = (id) => { return document.getElementById(id); }

function assertNotNullOrUndefined(x) {
  try {
    if (x == null) {
      throw 'Variable may not be null';
    }
    if (x == undefined) {
      throw 'Variable may not be undefined';
    }
  } catch (e) {
    console.error(e);
    throw e;
  }
}


function assertArgs(args, length) {
  let i;
  try {
    if (args.length != length) {
      throw `Not enough arguments; expected ${length} got ${args.length}`;
    }
    for (i = 0; i < args.length; i++) {
      assertNotNullOrUndefined(args[i]);
    }
  } catch (e) {
    if (i == undefined) {
      console.error(e);
    } else {
      console.error(`Arg ${i}: ${e}`)
    }
    throw e;
  }
}

function testStarCube(fullCatalog, scale) {
  const cube = {
    count: 27,
    index: {},
    stars: [],
    minMag: -8.25390625,
    maxMag: 15.4453125
  };
  const m = 4.83, ki = 0, t = 4, s = 2, l = 6, r = 6.957E8
  for (let i = -1; i <= 1; i++)
    for (let j = -1; j <= 1; j++)
      for (let k = -1; k <= 1; k++)
        cube.stars.push({
            x: i*scale, y: j*scale, z: k*scale,
              mag: m, kind: ki, type: t, sub: s, lum: l, radiusMeters: r });
  return cube;
}


function sampleStarCatalog(fullCatalog, n) {
  const sampled = {
    count: n,
    index: {},
    stars: [],
    minMag: -8.25390625,
    maxMag: 15.4453125
  };
  sampled.stars.push(fullCatalog.stars[0]); // the sun
  for (let i = 1; i < n; i++) {
    const star = fullCatalog.stars[Math.floor(Math.random() * fullCatalog.stars.length)];
    if (!star) {
      throw new Error();
    }
    sampled.stars.push(star);
  }
  return sampled;
}


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
      const line = line(root.position, elt.position);
      console.log('lineTraceScene: ', line);
      root.add(line);
    });
}

export {
  elt,
  assertNotNullOrUndefined,
  assertArgs,
  lineTraceScene,
  testStarCube,
  sampleStarCatalog,
  visitChildren
};
