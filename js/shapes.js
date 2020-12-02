import CustomPoints from './lib/three-custom/points.js';
import Label from './label.js';
import * as THREE from './lib/three.module.js';
import * as Material from './material.js';
import * as Shared from './shared.js';
import * as Utils from './utils.js';

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
  const geom = new THREE.CubeGeometry(width, height, depth);
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
  opts = opts || {};
  const ellipsePath = new THREE.Shape();
  const semiMajorAxisLength = 1;
  ellipsePath.absellipse(
    0, 0, // center
    1, ellipseSemiMinorAxisCurve(eccentricity), // xRadius, yRadius
    0, Math.PI * 2, // start and finish angles
    true, 0); // clockwise, offset rotation
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
function point(radius) {
  const opts = {
    color: 0xffffff,
    size: radius || 4,
    sizeAttenuation: false,
    blending: THREE.AdditiveBlending,
    depthTest: true,
    transparent: true
  };
  const geom = new THREE.Geometry();
  geom.vertices.push(new THREE.Vector3());
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
  const geom = new THREE.Geometry();
  geom.vertices.push(new THREE.Vector3());
  const pointMaterial = new THREE.PointsMaterial(opts);
  const anchorPoints = new THREE.Points(geom, pointMaterial);
  anchorPoints.isAnchor = true;
  return anchorPoints;
}

/**
 * line(vec1, vec2); // vec1 may be null for zero.
 * line(x, y, z); // from zero.
 * line(x1, y1, z1, x2, y2, z3);
 */
function line(vec1, vec2) {
  const args = Array.prototype.slice.call(arguments);
  const lastArg = args[args.length - 1];
  let material;
  if (typeof(lastArg) == 'object') {
    const materialOrOpts = args.pop();
    material = materialOrOpts instanceof THREE.LineBasicMaterial
      ? materialOrOpts : new THREE.LineBasicMaterial(materialOrOpts);
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
  const geom = new THREE.Geometry();
  geom.vertices.push(vec1);
  geom.vertices.push(vec2);
  return new THREE.Line(geom, material);
}


/**
 * Angle.  Material properties of arrow head and text are derived from
 * given {@param material}.
 * @param material An instance of LineBasicMaterial.
 * @param addLabel Boolean controlling the display of text angle label.
 */
function angle(vec1, vec2, materialOrOpts, container, addLabel) {
  const material = materialOrOpts instanceof THREE.LineBasicMaterial
      ? materialOrOpts : new THREE.LineBasicMaterial(materialOrOpts);
  Utils.assertNotNullOrUndefined(container);
  let angleInRadians;
  if (arguments.length == 1 || vec2 === null || typeof vec2 === 'undefined') {
    angleInRadians = vec1;
  } else if (arguments.length == 2) {
    angleInRadians = vec1.angleTo(vec2);
  }

  const angle = new THREE.Object3D;
  angle.name = `angle(${angleInRadians * Shared.toDeg})`;
  angle.material = material || new THREE.LineBasicMaterial;

  // Arc
  const arrowArc = arc(1, 0, angleInRadians, angle.material);
  arrowArc.name = angle.name + '.arc';

  // Cone
  const coneHeight = 0.1;
  const coneGeometry = new THREE.ConeGeometry(coneHeight / 3, coneHeight, 10);
  const coneMaterial = new THREE.MeshBasicMaterial;
  coneMaterial.color = angle.material.color;
  const cone = new THREE.Mesh(coneGeometry, coneMaterial);
  cone.name = angle.name + '.cone';
  cone.position.x = 1;
  cone.position.y = coneHeight / -2;

  angle.add(arrowArc);
  angle.add(cone);

  if (addLabel) {
    const labelObj = point();
    labelObj.name = angle.name + '.label';
    labelObj.position.x = 1;
    //labelObj.position.set(Math.cos(angleInRadians * 0.1), -Math.sin(angleInRadians * 0.1), 0);
    const label = new Label((angleInRadians * Shared.toDeg) + '˚', container, labelObj);
    labelObj.onBeforeRender = (renderer, scene, camera) => {
      label.updatePosition(camera);
    };
    angle.label = label;
    angle.add(labelObj);
  }

  angle.rotation.z = angleInRadians;
  return angle;
}

function getCanvasTextSprite(text, color) {
  color = color || 0xffffff;
  const canvasEltId = 'text-canvas';
  let textCanvas = document.getElementById(canvasEltId);
  if (textCanvas == null) {
    // TODO(pablo): Find a safer way to do this.
    textCanvas = document.createElement('canvas');
    document.querySelector('body').appendChild(textCanvas);
    console.log('getCanvasTextSprite: creating canvas... ', textCanvas);
  } else {
    console.log('getCanvasTextSprite: reusing existing canvas: ', textCanvas);
  }
  const ctx = textCanvas.getContext('2d');
  ctx.font = '1em Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const metrics = ctx.measureText(text);
  const charSize = metrics.width / text.length;
  // WebGL requires power of 2 width, so round up.
  textCanvas.width = Math.pow(2, Math.floor(Math.log2(metrics.width + charSize)));
  textCanvas.height = 32;

  const texture = new THREE.CanvasTexture(textCanvas);
  const label = new THREE.Sprite(new THREE.SpriteMaterial({
        map: texture,
        alphaTest: 0.5,
      }));
  const scale = 0.2;
  setCanvasText(textCanvas, ctx, text, color);
  label.scale.set(textCanvas.width / textCanvas.height * scale, scale, 1.0);
  textCanvas.parentNode.removeChild(textCanvas);
  return label;
}

// TODO: use for above?
function measureText(ctx, text) {
  const m = ctx.measureText(text);
  const left = -m.actualBoundingBoxLeft;
  const top = -m.actualBoundingBoxAscent;
  const right = m.actualBoundingBoxRight;
  const descent = m.actualBoundingBoxDescent;
  console.log(`text(text), bounds: `
      + `left(${left}), top(${top}), right(${right}), descent(${descent})`);
  const width = left + right;
  const height = descent + top;
  return [left, top, width, height];
}

function setCanvasText(textCanvas, ctx, text, color) {
  ctx.save();
  ctx.fillStyle = 'rgba(255, 255, 255, 0)';
  ctx.fillRect(0, 0, textCanvas.width, textCanvas.height);
  ctx.fillStyle = `rgba(${color.r * 255}, ${color.g * 255}, ${color.b * 255}, 1)`;
  ctx.fillText(text, 0, textCanvas.height / 2);
  ctx.restore();
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

function arc(rad, startAngle, angle, material) {
  const curveGen = new THREE.EllipseCurve(
    0, 0, // ax, aY
    rad, rad, // xRadius, yRadius
    startAngle, angle,
    false, // clockwise
    -angle
  );
  const points = curveGen.getPoints(100);
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  material = material || new THREE.LineBasicMaterial;
  return new THREE.Line(geometry, material);
}

export {
  angle,
  box,
  cube,
  ellipseSemiMinorAxisCurve,
  getCanvasTextSprite,
  grid,
  labelAnchor,
  line,
  lineGrid,
  lodSphere,
  point,
  solidEllipse,
  sphere,
};