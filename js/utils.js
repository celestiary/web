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

function createCanvas() {
  const canvas = document.createElement('canvas');
  canvas.style = 'border: solid 1px red';
  document.body.appendChild(canvas);
  return canvas;
}

function measureText(ctx, text, fontStyle) {
  if (fontStyle) {
    ctx.font = fontStyle;
  }
  const m = ctx.measureText(text);
  const width = Math.ceil(m.width);
  const height = Math.ceil(m.actualBoundingBoxAscent + m.actualBoundingBoxDescent);
  //console.log(`text: ${text}, width: ${width}, height: ${height}`);
  return {width, height};
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


function testPlanet(planetName) {
  switch (planetName) {
  case 'earth': return {
    name: (location.hash || '#earth').substring(1),
    radius: {scalar: 1},
    texture_atmosphere: true,
    texture_hydrosphere: true,
    texture_terrain: true,
    type: 'planet'
  };
  }
}


function rotateEuler(obj, opts) {
  opts = opts || { x: 0, rotY: 0, rotZ: 0 };
  obj.applyEuler(new THREE.Euler(opts.x || 0, opts.y || 0))
}


function rotate(obj, opts) {
  opts = opts || { x: 0, y: 0, z: 0 };
  if (opts.x) { obj.rotateX(opts.x); }
  if (opts.y) { obj.rotateY(opts.y); }
  if (opts.z) { obj.rotateZ(opts.z); }
}


function addAndOrient(parent, child, opts) {
  parent.add(child);
  rotate(child, {x: opts.rotX || 0, y: opts.rotY || 0, z: opts.rotZ || 0});
  return child;
}


export {
  addAndOrient,
  createCanvas,
  elt,
  assertNotNullOrUndefined,
  assertArgs,
  lineTraceScene,
  measureText,
  rotate,
  sampleStarCatalog,
  testPlanet,
  testStarCube,
  visitChildren
};
