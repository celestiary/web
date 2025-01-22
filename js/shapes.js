import {
  AdditiveBlending,
  ArrowHelper,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  ConeGeometry,
  DoubleSide,
  EllipseCurve,
  FrontSide,
  GridHelper,
  LOD,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhongMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Points,
  PointsMaterial,
  RepeatWrapping,
  RingGeometry,
  ShaderMaterial,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Texture,
  TextureLoader,
  UVMapping,
  UniformsUtils,
  Vector3,
} from 'three'
import SpriteSheet from './SpriteSheet.js'
import * as Material from './material.js'
import * as Shared from './shared.js'
import {named} from './utils.js'


/** @returns {Mesh} */
export function cube(size) {
  size = size || 1
  return box(size, size, size)
}


/** @returns {Mesh} */
export function box(width, height, depth, opts) {
  width = width || 1
  height = height || 1
  depth = depth || 1
  opts = opts || {}
  opts.color = opts.color || 0xff0000
  const geom = new BoxGeometry(width, height, depth)
  const matr = new MeshPhongMaterial(opts)
  // const matr = new MeshBasicMaterial(opts)
  return new Mesh(geom, matr)
}


/** @returns {Mesh} */
export function sphere(opts) {
  opts = opts || {}
  opts.radius = opts.radius || 1
  opts.resolution = opts.resolution || 128
  const geom = new SphereGeometry(opts.radius, opts.resolution, opts.resolution / 2)
  if (opts.matr === undefined) {
    opts.matr = opts.wireframe ?
      new MeshBasicMaterial({
        color: opts.color || 0x808080,
        wireframe: true,
        depthTest: true,
        depthWrite: false,
        toneMapped: false,
        transparent: false,
        side: BackSide,
      }) :
      new MeshPhongMaterial({
        flatShading: true,
        color: 0xffffff,
        wireframe: false,
        transparent: false,
      })
  }
  return new Mesh(geom, opts.matr)
}


/** @returns {Sprite} */
export function marker() {
  const map = new TextureLoader().load('/textures/crosshairs.png')
  const m = new Sprite(new SpriteMaterial({
    map: map,
    sizeAttenuation: false,
    transparent: true,
    color: 0xffffff,
    blending: AdditiveBlending,
    depthTest: false,
  }))
  m.scale.set(0.03, 0.03, 0.03)
  return m
}


/** @returns {Object3D} */
export function lodSphere(radius, material) {
  const lod = new LOD()
  const geoms =
    [[getSphereGeom(128), radius],
      [getSphereGeom(32), radius * 10],
      [getSphereGeom(16), radius * 100],
      [getSphereGeom(8), radius * 300]]
  for (let i = 0; i < geoms.length; i++) {
    const mesh = new Mesh(geoms[i][0], material)
    mesh.scale.set(radius, radius, radius)
    lod.addLevel(mesh, geoms[i][1])
  }
  const obj = new Object3D
  obj.add(lod)
  return obj
}


const _sphereGeoms = []
/** @returns {SphereGeometry} */
function getSphereGeom(segmentSize) {
  let geom = _sphereGeoms[segmentSize]
  if (!geom) {
    geom = _sphereGeoms[segmentSize] = new SphereGeometry(1, segmentSize, segmentSize / 2)
  }
  return geom
}


/**
 * https://en.wikipedia.org/wiki/Semi-major_and_semi-minor_axes
 *
 * @returns {number}
 */
export function ellipseSemiMinorAxisCurve(eccentricity, semiMajorAxisLength) {
  eccentricity = eccentricity || 0 // Circle
  semiMajorAxisLength = semiMajorAxisLength || 1
  return semiMajorAxisLength * Math.sqrt(1 - Math.pow(eccentricity, 2))
}


/** @returns {Mesh} */
export function solidEllipse(eccentricity, opts) {
  opts = opts || {
    from: 0,
    to: Math.PI * 2,
  }
  console.log(opts)
  const ellipsePath = new Shape()
  const semiMajorAxisLength = 1
  ellipsePath.absellipse(
      0, 0, // center
      semiMajorAxisLength, ellipseSemiMinorAxisCurve(eccentricity), // xRadius, yRadius
      0, Math.PI / 2, // start and finish angles
      false, 0) // clockwise, offset rotation
  const material = new MeshBasicMaterial({
    color: opts.color || 0x888888,
    opacity: opts.opacity || 1,
    transparent: opts.opacity < 1,
    side: DoubleSide,
    toneMapped: false,
  })
  return new Mesh(
      new ShapeGeometry(ellipsePath),
      material)
}


/** @returns {Mesh} */
export function solidArc(opts) {
  opts = opts || {
    from: 0,
    to: Math.PI * 2,
    opacity: 0.1,
  }
  const shape = new Mesh(
      new CircleGeometry(1, 32, opts.from, opts.to),
      new MeshLambertMaterial({
        color: opts.color || 0x888888,
        opacity: opts.opacity || 1,
        transparent: opts.opacity < 1,
        side: DoubleSide,
        toneMapped: false,
      }))
  return shape
}


/** @returns {Mesh} */
export function atmos(radius) {
  // from http://data-arts.appspot.com/globe/globe.js
  const Shaders = {
    atmosphere: {
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
        '}'].join('\n'),
    },
  }

  const sceneAtmosphere = new Object3D()
  const geometry = new SphereGeometry(1, 128, 64)

  const shader = Shaders['atmosphere']
  const uniforms = UniformsUtils.clone(shader.uniforms)

  const material = new ShaderMaterial({
    uniforms: uniforms,
    vertexShader: shader.vertexShader,
    fragmentShader: shader.fragmentShader,
  })

  const mesh = new Mesh(geometry, material)
  mesh.scale.x = mesh.scale.y = mesh.scale.z = radius
  mesh.flipSided = true
  sceneAtmosphere.add(mesh)
  return sceneAtmosphere
}


// TODO(pmy): Convert to shared BufferGeometry.
/** @returns {Points} */
export function point(optsOrRadius) {
  const opts = optsOrRadius || {
    color: 0xffffff,
    size: optsOrRadius || 4,
    sizeAttenuation: false,
    blending: AdditiveBlending,
    depthTest: true,
    transparent: true,
  }
  const geom = new BufferGeometry()
  geom.setAttribute('position', new BufferAttribute(new Float32Array(3), 3))
  const pointMaterial = new PointsMaterial(opts)
  // return new CustomPoints(geom, pointMaterial);
  return new Points(geom, pointMaterial)
}


/** @returns {Points} */
export function labelAnchor() {
  const opts = {
    color: 0x000000,
    size: 3,
    sizeAttenuation: false,
    blending: AdditiveBlending,
    depthTest: true,
    transparent: true,
  }
  const geom = new BufferGeometry()
  geom.setAttribute('position', new BufferAttribute(new Float32Array(3), 3))
  const pointMaterial = new PointsMaterial(opts)
  const anchorPoints = new Points(geom, pointMaterial)
  anchorPoints.isAnchor = true
  return anchorPoints
}


/**
 * line(vec1, vec2); // vec1 may be null for zero.
 * line(x, y, z); // from zero.
 * line(x1, y1, z1, x2, y2, z3);
 *
 * @param {Array} rest If the last arg is an object, it will be queried for
 * an object property of {color}.
 * @returns {Line}
 */
export function line(vec1, vec2, ...rest) {
  const args = Array.prototype.slice.call(arguments)
  const lastArg = args[args.length - 1]
  const opts = {color: 'white'}
  if (typeof(lastArg) === 'object') {
    const materialOrOpts = args.pop()
    opts.color = materialOrOpts.color || opts.color
  }
  if (args.length === 2) {
    vec1 = vec1 || new Vector3
  } else if (args.length === 3) {
    vec1 = new Vector3
    vec2 = new Vector3(args[0], args[1], args[2])
  } else if (args.length === 6) {
    vec1 = new Vector3(args[0], args[1], args[2])
    vec2 = new Vector3(args[3], args[4], args[5])
  } else {
    throw new Error('Can only be called with 2, 3 or 6 arguments.')
  }
  if (vec1.equals(vec2)) {
    throw new Error(`Vectors may not be equal: ${ JSON.stringify([vec1, vec2])}`)
  }
  const points = []
  points.push(vec1)
  points.push(vec2)
  const geom = new BufferGeometry().setFromPoints(points)
  return new Line(geom, new LineBasicMaterial(opts))
}


/** @returns {Object3D} */
function cone(height, materialOrOpts = {color: 0xffffff}) {
  const opts = {
    color: materialOrOpts.color || 'white',
  }
  const coneHeight = height
  const coneGeometry = new ConeGeometry(coneHeight / 3, coneHeight, 10)
  const coneMaterial = new MeshBasicMaterial(opts)
  return named(new Mesh(coneGeometry, coneMaterial), 'cone')
}


/**
 * Straight arrow.  Material properties of arrow head and text are derived from
 * given {@param material}.
 *
 * @param {Vector3} to
 * @param {Vector3} origin
 * @param {number} hexColor
 * @param {string} labelText
 * @returns {ArrowHelper}
 */
export function arrow(
    to = new Vector3(1, 0, 0),
    origin = new Vector3,
    hexColor = 0xffffff,
    labelText = '') {
  const dirVec = new Vector3()
  dirVec.copy(to)
  dirVec.normalize()
  // TODO: make my own arrow that works like arc.
  const a = new ArrowHelper(dirVec, origin, to.length(), hexColor, 0.1, 0.1)
  if (labelText) {
    const labelSheet = new SpriteSheet(1, labelText, undefined, [0, 0.1])
    const r = hexColor & 0xff0000; const g = hexColor & 0x00ff00; const b = hexColor & 0x0000ff
    labelSheet.add(0, 0, 0, labelText, `rgb(${r}, ${g}, ${b})`)
    const label = named(labelSheet.compile(), `${angle.name }.label`)
    // Arrow first points up and is then rotated.
    label.position.setY(to.length())
    a.add(label)
  }
  return a
}


/**
 * Angle in the XY, clockwise from 3 o'clock (the x-axis).  Material
 * properties of arrow head and text are derived from given {@param material}.
 *
 * @param material An instance of LineBasicMaterial.
 * @param addLabelOrOpts {Boolean|Object} If false, no label.  If
 *   true, then display the angle in degrees, else set opts for:
 *   {text, color, font, padding}.  Color string is parsed as a CSS
 *   color value, e.g. 'red' or 'rgb(1, 0, 0, 0)'.
 * @param addSolidArc Boolean Optional controlling the display of text angle label.
 * @returns {Object3D}
 */
export function angle(vec1, vec2, materialOrOpts, addLabelOrOpts = true, addSolidArc = true) {
  let angleInRadians
  if (arguments.length === 1 || vec2 === null || typeof vec2 === 'undefined') {
    angleInRadians = vec1
  } else if (arguments.length === 2) {
    angleInRadians = vec1.angleTo(vec2)
  }

  const ang = named(new Object3D, `angle(${angleInRadians * Shared.toDeg})`)

  // TODO: move this into help, maybe redundant with arc.
  const radius = 1
  const headHeight = 0.1
  const arrowArc = arc(radius, 0, angleInRadians, materialOrOpts)
  const coneHead = cone(headHeight, materialOrOpts)
  coneHead.position.x = radius
  coneHead.position.y = headHeight / -2
  arrowArc.add(coneHead)
  ang.add(arrowArc)

  if (addSolidArc) {
    const sArc = named(solidArc({radius: 1, from: 0, to: angleInRadians, opacity: 0.2}), '.solidArc')
    sArc.rotation.z = -angleInRadians
    ang.add(sArc)
  }

  if (addLabelOrOpts) {
    let labelText; let color = 'white'; let font = SpriteSheet.defaultFont; let padding = [0, 0.1]
    if (typeof addLabelOrOpts === 'object') {
      labelText = addLabelOrOpts.text || ''
      color = addLabelOrOpts.color || color
      font = addLabelOrOpts.font || font
      padding = addLabelOrOpts.padding || padding
    } else {
      labelText = `${(angleInRadians * Shared.toDeg).toPrecision(4) }˚`
    }
    // console.log('label opts:', labelText, color, font, padding)
    const labelSheet = new SpriteSheet(1, labelText, font, padding)
    labelSheet.add(0, 0, 0, labelText, color)
    const label = named(labelSheet.compile(), `${angle.name }.label`)
    label.position.copy(coneHead.position)
    ang.add(label)
  }

  ang.rotation.z = angleInRadians
  return ang
}


// Grid
/** @returns {Object3D} */
export function grid(params) {
  if (!params) {
    params = {}
  }
  if (!params.stepSize) {
    params.stepSize = 1
  }
  if (!params.numSteps) {
    params.numSteps = 1E2
  }
  return lineGrid(params)
}


/**
 * Creates a shape with 3 reference grids, xy, xz and yz.
 * TODO(pablo): each grid has its own geometry.
 *
 * @returns {Object3D}
 */
export function lineGrid(params) {
  const grids = new Object3D()
  const size = params.stepSize * params.numSteps || 1
  const divisions = params.numSteps || 10
  const color = params.color || 0x0000af

  grids.material = new LineBasicMaterial({color: color, toneMapped: false})

  const xzGrid = new GridHelper(size, divisions, color, color)
  xzGrid.material = grids.material
  grids.add(xzGrid)

  const xyGrid = new GridHelper(size, divisions, color, color)
  xyGrid.rotation.x = Math.PI / 2
  xyGrid.material = grids.material
  grids.add(xyGrid)

  const yzGrid = new GridHelper(size, divisions, color, color)
  yzGrid.rotation.z = Math.PI / 2
  yzGrid.material = grids.material
  grids.add(yzGrid)

  return grids
}


/** @returns {Mesh} */
export function imgGrid(params) {
  const imageCanvas = document.createElement('canvas')
  const context = imageCanvas.getContext('2d')

  imageCanvas.width = imageCanvas.height = 32

  context.strokeStyle = `#${ params.color.toString(16)}`
  context.lineWidth = params.lineWidth
  context.strokeRect(0, 0, 32, 32)

  const textureCanvas =
    new Texture(imageCanvas, UVMapping, RepeatWrapping, RepeatWrapping)
  const materialCanvas = new MeshBasicMaterial({map: textureCanvas})

  const span = params.stepSize * params.numSteps

  textureCanvas.needsUpdate = true
  textureCanvas.repeat.set(params.numSteps, params.numSteps)

  const geometry = new PlaneGeometry(1, 1)
  const meshCanvas = new Mesh(geometry, materialCanvas)
  meshCanvas.scale.set(span, span, span)
  meshCanvas.doubleSided = true

  return meshCanvas
}


/** @returns {Line} */
function arc(rad, startAngle, arcAngle, materialOrOpts) {
  const opts = {
    color: (materialOrOpts ? (materialOrOpts.color || 'red') : 'white'),
  }
  const curveGen = new EllipseCurve(
      0, 0, // ax, aY
      rad, rad, // xRadius, yRadius
      startAngle, arcAngle,
      false, // clockwise
      -arcAngle,
  )
  const points = curveGen.getPoints(100)
  const geometry = new BufferGeometry().setFromPoints(points)
  const material = new LineBasicMaterial(opts)
  return new Line(geometry, material)
}


/**
 * Just Saturn for now.
 *
 * @returns {Mesh}
 */
export function rings(name = 'saturn', shadows = true, side = FrontSide) {
  const geometry = new RingGeometry(3, 6, 64)
  const textureMap = Material.pathTexture(`${name}ringcolor`, '.png')
  const alphaMap = Material.pathTexture(`${name}ringalpha`, '.png')
  const material = new MeshStandardMaterial({
    color: 0xffffff,
    side: shadows ? side : DoubleSide,
    map: textureMap,
    alphaMap: alphaMap,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  })
  // I still don't understand UVs.
  // https://discourse.threejs.org/t/applying-a-texture-to-a-ringgeometry/9990/3
  const pos = geometry.attributes.position
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(pos.count * 4), 4))
  const v3 = new Vector3()
  for (let i = 0; i < pos.count; i++) {
    v3.fromBufferAttribute(pos, i)
    geometry.attributes.uv.setXY(i, v3.length() < 4 ? 1 : 0, 1)
  }
  const r = new Mesh(geometry, material)
  /* if (shadows) {
    r.castShadow = true
    r.receiveShadow = true
  } */
  r.scale.setScalar(0.4)
  r.rotateY(Math.PI / 2)
  r.rotateX(Math.PI / 2)
  return r
}
