import * as THREE from 'three';
import CustomPoints from './lib/three-custom/points.js';

import SpriteSheet from './SpriteSheet.js';
import * as Material from './material.js';
import * as Shared from './shared.js';
import {named} from './utils.js';


// Simple cube for testing.
function cube(size) {
  size = size || 1;
  return box(size, size, size);
}


function box(width, height, depth, opts) {
  width = width || 1;
  height = height || 1;
  depth = depth || 1;
  opts = opts || {};
  opts.color = opts.color || 0xff0000;
  const geom = new THREE.BoxGeometry(width, height, depth);
  const matr = new THREE.MeshPhongMaterial(opts);
  return new THREE.Mesh(geom, matr);
}


function sphere(opts) {
  opts = opts || {};
  opts.radius = opts.radius || 1;
  opts.resolution = opts.resolution || 64;
  const geom = new THREE.SphereGeometry(opts.radius, opts.resolution, opts.resolution / 2);
  opts.matr = opts.matr || new THREE.MeshPhongMaterial({flatShading: true});
  return new THREE.Mesh(geom, opts.matr);
}


// Lod Sphere.
function lodSphere(radius, material) {
  const lod = new THREE.LOD();
  const geoms =
    [[getSphereGeom(128), radius],
     [getSphereGeom(32), radius * 10],
     [getSphereGeom(16), radius * 100],
     [getSphereGeom(8), radius * 300]];
  for (let i = 0; i < geoms.length; i++) {
    const mesh = new THREE.Mesh(geoms[i][0], material);
    mesh.scale.set(radius, radius, radius);
    lod.addLevel(mesh, geoms[i][1]);
  }
  const obj = new THREE.Object3D;
  obj.add(lod);
  return obj;
}


const _sphereGeoms = new Array();
function getSphereGeom(segmentSize) {
  let geom = _sphereGeoms[segmentSize];
  if (!geom) {
    geom = _sphereGeoms[segmentSize] = new THREE.SphereGeometry(1, segmentSize, segmentSize / 2);
  }
  return geom;
}


/** https://en.wikipedia.org/wiki/Semi-major_and_semi-minor_axes */
function ellipseSemiMinorAxisCurve(eccentricity, semiMajorAxisLength) {
  eccentricity = eccentricity || 0; // Circle
  semiMajorAxisLength = semiMajorAxisLength || 1;
  return semiMajorAxisLength * Math.sqrt(1 - Math.pow(eccentricity, 2))
}


function solidEllipse(eccentricity, opts) {
  opts = opts || {
    from: 0,
    to: Math.PI * 2
  };
  console.log(opts);
  const ellipsePath = new THREE.Shape();
  const semiMajorAxisLength = 1;
  ellipsePath.absellipse(
    0, 0, // center
    1, ellipseSemiMinorAxisCurve(eccentricity), // xRadius, yRadius
    0, Math.PI / 2, // start and finish angles
    false, 0); // clockwise, offset rotation
  const material = new THREE.MeshBasicMaterial({
      color: opts.color || 0x888888,
      opacity: opts.opacity || 1,
      transparent: opts.opacity < 1 ? true : false,
      side: THREE.DoubleSide
    });
  return new THREE.Mesh(
    new THREE.ShapeBufferGeometry(ellipsePath),
    material);
}


function solidArc(opts) {
  opts = opts || {
    from: 0,
    to: Math.PI * 2,
    opacity: 0.1,
  };
  const shape = new THREE.Mesh(
      new THREE.CircleBufferGeometry(1, 32, opts.from, opts.to),
      new THREE.MeshLambertMaterial({
        color: opts.color || 0x888888,
        opacity: opts.opacity || 1,
        transparent: opts.opacity < 1 ? true : false,
        side: THREE.DoubleSide
      }));
  return shape;
}


function atmos(radius) {
  // from http://data-arts.appspot.com/globe/globe.js
  const Shaders = {
    'atmosphere' : {
      uniforms: {},
      vertexShader: ['varying vec3 vNormal;',
                     'void main() {',
                     'vNormal = normalize(normalMatrix * normal);',
                     'gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
        '}'].join('\n'),
      fragmentShader: ['varying vec3 vNormal;',
                       'void main() {',
                       'float intensity = pow(1.1 + dot(vNormal, vec3(0, 0, 1)), 8.0);',
                       'gl_FragColor = vec4(0.5, 0.5, 1.0, 0.01) * intensity;',
        '}'].join('\n')
    }
  };

  const sceneAtmosphere = new THREE.Object3D();
  const geometry = new THREE.SphereGeometry(1, 128, 64);

  const shader = Shaders['atmosphere'];
  const uniforms = THREE.UniformsUtils.clone(shader.uniforms);

  const material = new THREE.ShaderMaterial({
      uniforms: uniforms,
      vertexShader: shader.vertexShader,
      fragmentShader: shader.fragmentShader
    });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.scale.x = mesh.scale.y = mesh.scale.z = radius;
  mesh.flipSided = true;
  sceneAtmosphere.add(mesh);
  return sceneAtmosphere;
}


// TODO(pmy): Convert to shared BufferGeometry.
function point(optsOrRadius) {
  const opts = optsOrRadius || {
    color: 0xffffff,
    size: optsOrRadius || 4,
    sizeAttenuation: false,
    blending: THREE.AdditiveBlending,
    depthTest: true,
    transparent: true
  };
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
  const pointMaterial = new THREE.PointsMaterial(opts);
  //return new CustomPoints(geom, pointMaterial);
  return new THREE.Points(geom, pointMaterial);
}


function labelAnchor() {
  const opts = {
    color: 0x000000,
    size: 3,
    sizeAttenuation: false,
    blending: THREE.AdditiveBlending,
    depthTest: true,
    transparent: true
  };
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
  const pointMaterial = new THREE.PointsMaterial(opts);
  const anchorPoints = new THREE.Points(geom, pointMaterial);
  anchorPoints.isAnchor = true;
  return anchorPoints;
}


/**
 * line(vec1, vec2); // vec1 may be null for zero.
 * line(x, y, z); // from zero.
 * line(x1, y1, z1, x2, y2, z3);
 * @param {rest} If the last arg is an object, it will be queried for
 * an object property of {color}.
 */
function line(vec1, vec2, ...rest) {
  const args = Array.prototype.slice.call(arguments);
  const lastArg = args[args.length - 1];
  let opts = {color: 'white'};
  if (typeof(lastArg) == 'object') {
    const materialOrOpts = args.pop();
    opts.color = materialOrOpts.color || opts.color;
  }
  if (args.length == 2) {
    vec1 = vec1 || new THREE.Vector3;
  } else if (args.length == 3) {
    vec1 = new THREE.Vector3;
    vec2 = new THREE.Vector3(args[0], args[1], args[2]);
  } else if (args.length == 6) {
    vec1 = new THREE.Vector3(args[0], args[1], args[2]);
    vec2 = new THREE.Vector3(args[3], args[4], args[5]);
  } else {
    throw new Error('Can only be called with 2, 3 or 6 arguments.');
  }
  if (vec1.equals(vec2)) {
    throw new Error('Vectors may not be equal: ' + JSON.stringify([vec1, vec2]));
  }
  const points = [];
  points.push(vec1);
  points.push(vec2);
  const geom = new THREE.BufferGeometry().setFromPoints(points);
  return new THREE.Line(geom, new THREE.LineBasicMaterial(opts));
}


function cone(height, materialOrOpts = {color: 0xffffff}) {
  const opts = {
    color: materialOrOpts.color || 'white',
  };
  const coneHeight = height;
  const coneGeometry = new THREE.ConeGeometry(coneHeight / 3, coneHeight, 10);
  const coneMaterial = new THREE.MeshBasicMaterial(opts);
  return named(new THREE.Mesh(coneGeometry, coneMaterial), 'cone');
}


/**
 * Straight arrow.  Material properties of arrow head and text are derived from
 * given {@param material}.
 * @param material An instance of LineBasicMaterial.
 * @param addLabel Boolean Optional controlling the display of text angle label.
 * @param addSolidArc Boolean Optional controlling the display of text angle label.
 */
function arrow(to = new THREE.Vector3(1, 0, 0), origin = new Vector3, hexColor = 0xffffff, labelText) {
  const dirVec = new THREE.Vector3();
  dirVec.copy(to);
  dirVec.normalize();
  // TODO: make my own arrow that works like arc.
  const arrow = new THREE.ArrowHelper(dirVec, origin, to.length(), hexColor, 0.1, 0.1);

  if (labelText) {
    const labelSheet = new SpriteSheet(1, labelText, undefined, [0, 0.1]);
    const r = hexColor & 0xff0000, g = hexColor & 0x00ff00, b = hexColor & 0x0000ff;
    labelSheet.add(0, 0, 0, labelText, `rgb(${r}, ${g}, ${b})`);
    const label = named(labelSheet.compile(), angle.name + '.label');
    // Arrow first points up and is then rotated.
    label.position.setY(to.length());
    arrow.add(label);
  }

  return arrow;
}


/**
 * Angle in the XY, clockwise from 3 o'clock (the x-axis).  Material
 * properties of arrow head and text are derived from given {@param material}.
 * @param material An instance of LineBasicMaterial.
 * @param addLabelOrOpts {Boolean|Object} If false, no label.  If
 *   true, then display the angle in degrees, else set opts for:
 *   {text, color, font, padding}.  Color string is parsed as a CSS
 *   color value, e.g. 'red' or 'rgb(1, 0, 0, 0)'.
 * @param addSolidArc Boolean Optional controlling the display of text angle label.
 */
function angle(vec1, vec2, materialOrOpts, addLabelOrOpts = true, addSolidArc = true) {
  let angleInRadians;
  if (arguments.length == 1 || vec2 === null || typeof vec2 === 'undefined') {
    angleInRadians = vec1;
  } else if (arguments.length == 2) {
    angleInRadians = vec1.angleTo(vec2);
  }

  const angle = named(new THREE.Object3D, `angle(${angleInRadians * Shared.toDeg})`);

  // TODO: move this into help, maybe redundant with arc.
  const radius = 1;
  const headHeight = 0.1;
  const arrowArc = arc(radius, 0, angleInRadians, materialOrOpts);
  const coneHead = cone(headHeight, materialOrOpts);
  coneHead.position.x = radius;
  coneHead.position.y = headHeight / -2;
  arrowArc.add(coneHead);
  angle.add(arrowArc);

  if (addSolidArc) {
    const arc = named(solidArc({radius: 1, from: 0, to: angleInRadians, opacity: 0.2 }), '.solidArc');
    arc.rotation.z = -angleInRadians;
    angle.add(arc);
  }

  if (addLabelOrOpts) {
    let labelText, color = 'white', font = SpriteSheet.defaultFont, padding = [0, 0.1];
    if (typeof addLabelOrOpts == 'object') {
      labelText = addLabelOrOpts.text || '';
      color = addLabelOrOpts.color || color;
      font = addLabelOrOpts.font || font;
      padding = addLabelOrOpts.padding || padding;
    } else {
      labelText = (angleInRadians * Shared.toDeg).toPrecision(4) + '˚';
    }
    //console.log('label opts:', labelText, color, font, padding)
    const labelSheet = new SpriteSheet(1, labelText, font, padding);
    labelSheet.add(0, 0, 0, labelText, color);
    const label = named(labelSheet.compile(), angle.name + '.label');
    label.position.copy(coneHead.position);
    angle.add(label);
  }

  angle.rotation.z = angleInRadians;
  return angle;
}


// Grid
function grid(params) {
  if (!params) {
    params = {};
  }
  if (!params.stepSize) {
    params.stepSize = 1;
  }
  if (!params.numSteps) {
    params.numSteps = 1E2;
  }
  return lineGrid(params);
}


/**
 * Creates a shape with 3 reference grids, xy, xz and yz.
 *
 * TODO(pablo): each grid has its own geometry.
 */
function lineGrid(params) {
  const grids = new THREE.Object3D();
  const size = params.stepSize * params.numSteps || 1;
  const divisions = params.numSteps || 10;
  const color = params.color || 0x0000af;

  grids.material = new THREE.LineBasicMaterial({color: color});

  const xzGrid = new THREE.GridHelper(size, divisions, color, color);
  xzGrid.material = grids.material;
  grids.add(xzGrid);

  const xyGrid = new THREE.GridHelper(size, divisions, color, color);
  xyGrid.rotation.x = Math.PI / 2;
  xyGrid.material = grids.material;
  grids.add(xyGrid);

  const yzGrid = new THREE.GridHelper(size, divisions, color, color);
  yzGrid.rotation.z = Math.PI / 2;
  yzGrid.material = grids.material;
  grids.add(yzGrid);

  return grids;
}


function imgGrid(params) {
  const imageCanvas = document.createElement('canvas'),
    context = imageCanvas.getContext('2d');

  imageCanvas.width = imageCanvas.height = 32;

  context.strokeStyle = '#' + params.color.toString(16);
  context.lineWidth = params.lineWidth;
  context.strokeRect(0, 0, 32, 32);

  const textureCanvas =
    new THREE.Texture(imageCanvas, THREE.UVMapping, THREE.RepeatWrapping, THREE.RepeatWrapping);
  materialCanvas = new THREE.MeshBasicMaterial({map: textureCanvas});

  const span = params.stepSize * params.numSteps;

  textureCanvas.needsUpdate = true;
  textureCanvas.repeat.set(params.numSteps, params.numSteps);

  const geometry = new THREE.PlaneGeometry(1, 1);
  const meshCanvas = new THREE.Mesh(geometry, materialCanvas);
  meshCanvas.scale.set(span, span, span);
  meshCanvas.doubleSided = true;

  return meshCanvas;
}


function arc(rad, startAngle, angle, materialOrOpts) {
  const opts = {
    color: (materialOrOpts ? (materialOrOpts.color || 'red') : 'white'),
  };
  const curveGen = new THREE.EllipseCurve(
    0, 0, // ax, aY
    rad, rad, // xRadius, yRadius
    startAngle, angle,
    false, // clockwise
    -angle
  );
  const points = curveGen.getPoints(100);
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial(opts);
  return new THREE.Line(geometry, material);
}


/** Just Saturn for now. */
function rings(name = 'saturn', shadows = false, side = THREE.FrontSide) {
  const geometry = new THREE.RingBufferGeometry(3, 6, 64);
  const textureMap = Material.pathTexture(name + 'ringcolor', '.png');
  const alphaMap = Material.pathTexture(name + 'ringalpha', '.png');
  const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      side: shadows ? side : THREE.DoubleSide,
      map: textureMap,
      alphaMap: alphaMap,
      transparent: true
    });
  // I still don't understand UVs.
  // https://discourse.threejs.org/t/applying-a-texture-to-a-ringgeometry/9990/3
  const pos = geometry.attributes.position;
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(pos.count * 4), 4));
  const v3 = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++){
    v3.fromBufferAttribute(pos, i);
    geometry.attributes.uv.setXY(i, v3.length() < 4 ? 1 : 0, 1);
  }
  const rings = new THREE.Mesh(geometry, material);
  if (shadows) {
    rings.castShadow = true;
    //rings.receiveShadow = true;
  }
  rings.scale.setScalar(0.4);
  rings.rotateY(Math.PI / 2);
  rings.rotateX(Math.PI / 2);
  return rings;
}


export {
  angle,
  arrow,
  box,
  cube,
  ellipseSemiMinorAxisCurve,
  grid,
  labelAnchor,
  line,
  lineGrid,
  lodSphere,
  point,
  rings,
  solidArc,
  solidEllipse,
  sphere,
};
