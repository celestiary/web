'use strict';

const THREE = require('three');
const Material = require('./material.js');

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
  const matr = new THREE.MeshBasicMaterial(opts);
  return new THREE.Mesh(geom, matr);
}

function sphere(opts) {
  opts = opts || {};
  opts.radius = opts.radius || 1;
  opts.segmentSize = opts.segmentSize || 128;
  const matrOpts = opts.matr || {
    color: 0xffffff,
    transparent: false
  };
  const geom = new THREE.SphereGeometry(opts.radius, opts.segmentSize, opts.segmentSize / 2);
  const matr = new THREE.MeshBasicMaterial(matrOpts);
  return new THREE.Mesh(geom, matr);
}

// Lod Sphere.
function lodSphere(radius, material) {
  radius = radius || 1;
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

function line(vec1, vec2) {
  const geom = new THREE.Geometry();
  geom.vertices.push(vec1);
  geom.vertices.push(vec2);
  return new THREE.Line(geom, Material.lineMaterial());
}

// GRID

function grid(params) {
  if (!params) {
    params = {};
  }
  if (!params.stepSize) {
    params['stepSize'] = 1;
  }
  if (!params.numSteps) {
    params['numSteps'] = 1E2;
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

  const size = params.stepSize * params.numSteps;

  const mat = Material.lineMaterial(params);

  const xyGrid = new THREE.Line(gridGeometry(params), mat);
  xyGrid.position.x -= size / 2;
  xyGrid.position.y -= size / 2;

  const xzGrid = new THREE.Line(gridGeometry(params), mat);
  xzGrid.rotation.x = Math.PI / 2;
  xzGrid.position.x -= size / 2;
  xzGrid.position.z -= size / 2;

  const yzGrid = new THREE.Line(gridGeometry(params), mat);
  yzGrid.rotation.y = Math.PI / 2;
  yzGrid.position.z += size / 2;
  yzGrid.position.y -= size / 2;

  grids.add(xzGrid);
  grids.add(yzGrid);

  grids.add(xyGrid);

  return grids;
}

function gridGeometry(params) {
  if (!params) params = {}
  if (!params.stepSize) params.stepSize = 1
  if (!params.numSteps) params.numSteps = 10;
  const gridGeom = new THREE.Geometry();
  const size = params.stepSize * params.numSteps;
  for (let x = 0; x < params.numSteps; x += 2) {
    const xOff = x * params.stepSize;
    gridGeom.vertices.push(new THREE.Vector3(new THREE.Vector3(xOff, 0, 0)));
    gridGeom.vertices.push(new THREE.Vector3(new THREE.Vector3(xOff, size, 0)));
    gridGeom.vertices.push(new THREE.Vector3(new THREE.Vector3(xOff + params.stepSize, size, 0)));
    gridGeom.vertices.push(new THREE.Vector3(new THREE.Vector3(xOff + params.stepSize, 0, 0)));
  }
  for (let y = 0; y < params.numSteps; y += 2) {
    const yOff = y * params.stepSize;
    gridGeom.vertices.push(new THREE.Vector3(new THREE.Vector3(0, yOff, 0, 0)));
    gridGeom.vertices.push(new THREE.Vector3(new THREE.Vector3(size, yOff, 0)));
    gridGeom.vertices.push(new THREE.Vector3(new THREE.Vector3(size, yOff + params.stepSize, 0)));
    gridGeom.vertices.push(new THREE.Vector3(new THREE.Vector3(0, yOff + params.stepSize, 0)));
  }
  if (params.numSteps % 2 == 0) {
    gridGeom.vertices.push(new THREE.Vector3(new THREE.Vector3(0, size, 0)));
    gridGeom.vertices.push(new THREE.Vector3(new THREE.Vector3(size, size, 0)));
    gridGeom.vertices.push(new THREE.Vector3(new THREE.Vector3(size, 0, 0)));
  }
  return gridGeom;
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

// Ellipse
function port(rad, height, startAngle, angle) {
  const curveGen = new THREE.EllipseCurve(0, 0, rad, 0, startAngle, angle);
  const path = new THREE.CurvePath();
  path.add(curveGen);
  const geom = path.createPointsGeometry(100);
  geom.computeTangents();
  const mat = new THREE.LineBasicMaterial({
      color: 0xc0c0c0,
      blending: THREE.AdditiveBlending,
      depthTest: true,
      depthWrite: false,
      transparent: false
    });
  
  const portTop = new THREE.Line(geom, mat);
  const portBottom = new THREE.Line(geom, mat);
  portTop.position.z += height / 2;
  portBottom.position.z -= height / 2;
  
  const shape = new THREE.Object3D();
  shape.add(portTop);
  shape.add(portBottom);

  shape.rotation.z = Math.PI * 0.5 + startAngle * deg;
  shape.rotation.x = Math.PI * 0.5;
  return shape;
}

THREE.EllipseCurve = function(aX, aY, aRadius, eccentricity,
                             aStartAngle, aEndAngle,
                             aClockwise) {

  aX = aX || 0;
  aY = aY || 0;
  aRadius = aRadius || 1;
  eccentricity = eccentricity || 0;
  aStartAngle = aStartAngle || 0;
  aEndAngle = aEndAngle || Math.PI * 2.0;
  aClockwise = aClockwise || true;

  this.aX = aX;
  this.aY = aY;
  this.aRadius = aRadius;
  this.bRadius = aRadius * Math.sqrt(1.0 - Math.pow(eccentricity, 2.0));
  this.aStartAngle = aStartAngle;
  this.aEndAngle = aEndAngle;
  this.aClockwise = aClockwise;
};

THREE.EllipseCurve.prototype = new THREE.Curve();
THREE.EllipseCurve.prototype.constructor = THREE.EllipseCurve;
THREE.EllipseCurve.prototype.getPoint = function (t) {

  const deltaAngle = this.aEndAngle - this.aStartAngle;

  if (!this.aClockwise) {
    t = 1 - t;
  }

  const angle = this.aStartAngle + t * deltaAngle;

  const tx = this.aX + this.aRadius * Math.cos(angle);
  const ty = this.aY + this.bRadius * Math.sin(angle);

  return new THREE.Vector2(tx, ty);
};


module.exports = {
  cube: cube,
  box: box,
  grid: grid,
  line: line,
  lineGrid: lineGrid,
  lodSphere: lodSphere,
  point: point,
  sphere: sphere,
};