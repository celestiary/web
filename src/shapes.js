import * as THREE from './lib/three.module.js';
import * as Material from './material.js';
import * as Shared from './shared.js';

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
  opts.resolution = opts.resolution || 4;
  const geom = new THREE.IcosahedronGeometry(opts.radius, opts.resolution);
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
    mesh.updateMatrix();
    mesh.matrixAutoUpdate = false;
    lod.addLevel(mesh, geoms[i][1]);
  }
  lod.updateMatrix();
  lod.matrixAutoUpdate = false;
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

function solidEllipse(eccentricity) {
  const ellipsePath = new THREE.Shape();
  const semiMajorAxisLength = 1;
  ellipsePath.absellipse(
    0, 0, // center
    1, ellipseSemiMinorAxisCurve(eccentricity), // xRadius, yRadius
    0, Math.PI * 2, // start and finish angles
    true, 0); // clockwise, offset rotation
  const material = new THREE.MeshBasicMaterial({
      color: 0x888888,
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
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  sceneAtmosphere.add(mesh);
  return sceneAtmosphere;
}

// TODO(pmy): is there a simpler way to draw a point?
function point() {
  const geom = new THREE.Geometry();
  geom.vertices.push(new THREE.Vector3());

  const pointMaterial =
    new THREE.PointsMaterial({ color: 0xffffff,
                               size: 3,
                               sizeAttenuation: false,
                               blending: THREE.AdditiveBlending,
                               depthTest: true,
                               transparent: true });

  return new THREE.Points(geom, pointMaterial);
}

/**
 * line(vec1, vec2); // vec1 may be null for zero.
 * line(x, y, z); // from zero.
 * line(x1, y1, z1, x2, y2, z3);
 */
function line(vec1, vec2) {
  if (arguments.length == 2) {
    vec1 = vec1 == null ? new THREE.Vector3 : vec1;
  } else if (arguments.length == 3) {
    vec1 = new THREE.Vector3;
    vec2 = new THREE.Vector3(arguments[0], arguments[1], arguments[2]);
  } else if (arguments.length == 6) {
    vec1 = new THREE.Vector3(arguments[0], arguments[1], arguments[2]);
    vec2 = new THREE.Vector3(arguments[3], arguments[4], arguments[5]);
  } else {
    throw new Error('Can only be called with 2, 3 or 6 arguments.');
  }
  if (vec1.equals(vec2)) {
    throw new Error('Vectors may not be equal: ' + JSON.stringify([vec1, vec2]));
  }
  const geom = new THREE.Geometry();
  geom.vertices.push(vec1);
  geom.vertices.push(vec2);
  return new THREE.Line(geom);
}


/**
 * Angle.  Material properties of arrow head and text are derived from
 * given {@param material}.
 * @param material An instance of LineBasicMaterial.
 */
function angle(vec1, vec2, material) {
  let angleInRadians;
  if (arguments.length == 1 || vec2 === null || typeof vec2 === 'undefined') {
    angleInRadians = vec1;
  } else if (arguments.length == 2) {
    angleInRadians = vec1.angleTo(vec2);
  }

  const angle = new THREE.Object3D;
  angle.name = `angle(${angleInRadians * Shared.toDeg})`;
  angle.material = material || new THREE.LineBasicMaterial;
  const arrowArc = arc(1, 0, angleInRadians, angle.material);
  arrowArc.name = angle.name + '.arc';
  const up = new THREE.Vector3(0, 1, 0);
  const zero = new THREE.Vector3(0, 0, 0);

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

  if (true) {
    const label = getCanvasTextSprite((angleInRadians * Shared.toDeg) + '˚', angle.material.color);
    label.name = angle.name + '.label';
    label.position.set(Math.cos(angleInRadians * 0.1), -Math.sin(angleInRadians * 0.1), 0);
    label.center.set(0, 0);
    angle.add(label);
  }
  angle.rotation.z = angleInRadians;
  return angle;
}

function getCanvasTextSprite(text, color) {
  const canvas = document.createElement('canvas');
  // TODO(pablo): Find a safer way to do this.
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  ctx.font = '1em Arial';
  const metrics = ctx.measureText(text);
  // WebGL requires power of 2 width, so round up.
  canvas.width = Math.pow(2, Math.ceil(Math.log2(metrics.width)));
  canvas.height = 32;

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const label = new THREE.Sprite(new THREE.SpriteMaterial({
        map: texture,
        alphaTest: 0.5,
      }));
  const scale = 0.2;
  setCanvasText(canvas, ctx, text, color);
  label.scale.set(canvas.width / canvas.height * scale, scale, 1.0);
  document.body.removeChild(canvas);
  return label;
}

function setCanvasText(canvas, ctx, text, color) {
  ctx.save();
  ctx.font = '1em Arial';
  ctx.fillStyle = 'rgba(255, 255, 255, 0)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = `rgba(${color.r * 255}, ${color.g * 255}, ${color.b * 255}, 1)`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, canvas.height / 2);
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

  grids.material = new THREE.LineBasicMaterial;

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
  grid,
  line,
  lineGrid,
  lodSphere,
  point,
  solidEllipse,
  sphere,
};