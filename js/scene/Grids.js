import {
  BufferGeometry,
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  Group,
  LineSegments,
  LinearFilter,
  Matrix3,
  Points,
  ShaderMaterial,
  Vector3,
} from 'three'
import {named} from '../utils.js'
import {toRad} from '../shared.js'


// Earth's obliquity at J2000 — angle between the celestial equator (Earth's
// equatorial plane) and the ecliptic.  The scene's Y axis is the ecliptic
// pole (vsop's z-axis is mapped to scene-y in Animation.js), so a Z-rotation
// by the obliquity tilts the grid's pole into the celestial-pole direction
// matching Earth's planetTilt rotation in Planet.js.
const ECLIPTIC_TO_EQUATORIAL_DEG = 23.4392811

// Galactic north pole, J2000, in equatorial coords: α=192.85948°, δ=27.12825°.
// Converted to ecliptic (λ ≈ 180°, β ≈ 29.81°) — happens to lie in the X-Y
// plane of the scene frame, so a single Z-rotation suffices.  Sign matches
// the equatorial case: pole tilts toward -X.
const ECLIPTIC_TO_GALACTIC_DEG = 60.187

// Grid colors chosen for distinct fast identification, vaguely matching
// Celestia's defaults (warm amber for the rotating Earth frame, magenta for
// the orbital frame, cyan for the galactic frame).
const COLOR_EQUATORIAL = new Color(0xddaa44)
const COLOR_ECLIPTIC = new Color(0xff66cc)
const COLOR_GALACTIC = new Color(0x44ddee)

// Grid resolution.  13 parallels at 15° spacing matches 24 meridians at 15°
// (= 1h RA), giving a clean square grid with whole-number labels in both
// directions.
const NUM_PARALLELS = 13 // latitude small-circles including poles → 11 strictly between
const NUM_MERIDIANS = 24 // longitude great-circles (one every 15° = 1h RA)
const SEGMENTS = 96 // segments per circle

// Label spacing (degrees).  Driven by the grid spacing — one label per
// meridian and per parallel.
const PARALLEL_STEP_DEG = 15
const MERIDIAN_STEP_DEG = 15

// Label point-size (atlas tile is square; this is the pixel size on screen).
// Tuned for legibility without dominating the view.
const LABEL_FONT = '20px sans-serif'

// How many points to sample along each meridian / parallel circle when
// searching for the screen-edge intersection per frame.  64 is plenty for
// smooth, jitter-free label motion at typical FOVs and is cheap (a few
// thousand matrix-vector mults per grid per frame).
const EDGE_SAMPLES = 64


/**
 * Three reference-frame grids (Equatorial, Ecliptic, Galactic) wrapping the
 * camera as if at infinity.  Each grid is a wireframe sphere, oriented so
 * its pole points along the relevant celestial pole, and shaded with a
 * custom material that pins gl_Position.z to (just inside) the far plane —
 * so the grids never z-fight any nearer geometry and always render as a
 * background reference, regardless of camera position or zoom.
 *
 * @returns {{group: Group, equatorial: Group, ecliptic: Group, galactic: Group}}
 */
export default function newGrids() {
  const group = named(new Group(), 'Grids')

  // Built once, reused: a unit-sphere wireframe with poles along +Y.  Each
  // grid wraps it in its own Group with its own rotation and material so
  // visibility / color can be toggled independently.
  const sphereGeom = buildWireSphereGeometry()

  const equatorial = wrapWithMaterial(sphereGeom, COLOR_EQUATORIAL, 'EquatorialGrid')
  // Match Earth's planetTilt convention (Planet.js rotateZ by axialInclination).
  equatorial.rotation.z = ECLIPTIC_TO_EQUATORIAL_DEG * toRad
  attachLabels(equatorial, hourMeridianLabels(), degParallelLabels(), COLOR_EQUATORIAL)

  const ecliptic = wrapWithMaterial(sphereGeom, COLOR_ECLIPTIC, 'EclipticGrid')
  // identity rotation — the scene's Y axis IS the ecliptic pole
  attachLabels(ecliptic, degMeridianLabels(), degParallelLabels(), COLOR_ECLIPTIC)

  const galactic = wrapWithMaterial(sphereGeom, COLOR_GALACTIC, 'GalacticGrid')
  galactic.rotation.z = ECLIPTIC_TO_GALACTIC_DEG * toRad
  attachLabels(galactic, degMeridianLabels(), degParallelLabels(), COLOR_GALACTIC)

  group.add(equatorial)
  group.add(ecliptic)
  group.add(galactic)

  // Default: all hidden.  Toggled in by the user.
  equatorial.visible = false
  ecliptic.visible = false
  galactic.visible = false

  return {group, equatorial, ecliptic, galactic}
}


/**
 * Unit-sphere wireframe: NUM_MERIDIANS great-circle meridians (pole-to-pole)
 * + NUM_PARALLELS small-circle parallels.  Returned as a single
 * BufferGeometry of LineSegments-style position pairs.
 *
 * @returns {BufferGeometry}
 */
function buildWireSphereGeometry() {
  const positions = []
  // Parallels (latitude circles, excluding poles).
  for (let i = 1; i < NUM_PARALLELS - 1; i++) {
    const lat = (-Math.PI / 2) + ((Math.PI * i) / (NUM_PARALLELS - 1))
    const r = Math.cos(lat)
    const y = Math.sin(lat)
    for (let j = 0; j < SEGMENTS; j++) {
      const a1 = (2 * Math.PI * j) / SEGMENTS
      const a2 = (2 * Math.PI * (j + 1)) / SEGMENTS
      positions.push(r * Math.cos(a1), y, r * Math.sin(a1))
      positions.push(r * Math.cos(a2), y, r * Math.sin(a2))
    }
  }
  // Equator great-circle, drawn explicitly so it's a continuous loop even if
  // NUM_PARALLELS is even (the loop above only emits parallels strictly
  // between the poles).
  for (let j = 0; j < SEGMENTS; j++) {
    const a1 = (2 * Math.PI * j) / SEGMENTS
    const a2 = (2 * Math.PI * (j + 1)) / SEGMENTS
    positions.push(Math.cos(a1), 0, Math.sin(a1))
    positions.push(Math.cos(a2), 0, Math.sin(a2))
  }
  // Meridians (great-circles pole-to-pole).
  for (let j = 0; j < NUM_MERIDIANS; j++) {
    const lng = (2 * Math.PI * j) / NUM_MERIDIANS
    const cosL = Math.cos(lng)
    const sinL = Math.sin(lng)
    for (let i = 0; i < SEGMENTS; i++) {
      const a1 = (-Math.PI / 2) + ((Math.PI * i) / SEGMENTS)
      const a2 = (-Math.PI / 2) + ((Math.PI * (i + 1)) / SEGMENTS)
      const c1 = Math.cos(a1); const s1 = Math.sin(a1)
      const c2 = Math.cos(a2); const s2 = Math.sin(a2)
      positions.push(c1 * cosL, s1, c1 * sinL)
      positions.push(c2 * cosL, s2, c2 * sinL)
    }
  }
  const geom = new BufferGeometry()
  geom.setAttribute('position', new Float32BufferAttribute(positions, 3))
  return geom
}


/**
 * Wrap the shared sphere geometry in its own LineSegments + Group, with a
 * material whose vertex shader pins clip-space z to just inside the far
 * plane — so the grid feels "at infinity," depth-wise: it never wins a
 * depth comparison against any nearer object.
 *
 * @param {BufferGeometry} geom
 * @param {Color} color
 * @param {string} name
 * @returns {Group}
 */
function wrapWithMaterial(geom, color, name) {
  const mat = new ShaderMaterial({
    uniforms: {
      uColor: {value: color},
      uOpacity: {value: 0.45},
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    depthTest: true,
    depthWrite: false,
    transparent: true,
    toneMapped: false,
  })
  const lines = new LineSegments(geom, mat)
  lines.frustumCulled = false
  // Render after the milky way (-2) but before any opaque geometry would
  // claim the pixel; transparent ordering plus the z-pin handles the rest.
  lines.renderOrder = -1
  const wrap = named(new Group(), name)
  wrap.add(lines)
  return wrap
}


// Vertex: ignore the camera's translation, keep only its rotation.  That
// makes the grid feel like a sky reference — it's a fixed-orientation
// celestial sphere wrapping the camera, not an object at a specific world
// position.  Pin clip-z to just inside the far plane so the grid loses any
// depth comparison against nearer geometry (planets, sun) but still
// composites on top of the at-infinity galaxy (which pins to 0.9999).
const VERT = `
void main() {
  vec3 dir = mat3(viewMatrix) * (mat3(modelMatrix) * position);
  vec4 clipPos = projectionMatrix * vec4(dir, 1.0);
  clipPos.z = clipPos.w * 0.9997;
  gl_Position = clipPos;
}
`

const FRAG = `
uniform vec3  uColor;
uniform float uOpacity;
void main() {
  gl_FragColor = vec4(uColor, uOpacity);
}
`


// ===========================================================================
// LABELS
// ===========================================================================
//
// Each grid carries text labels at its meridians and parallels.  Equatorial
// uses RA hours for longitude (0h…23h) and signed degrees for declination;
// ecliptic and galactic use signed degrees in both directions.  Labels are
// rendered as Points sprites sampling a per-grid CanvasTexture atlas, with
// the same "pin to far plane, ignore camera translation" trick as the lines
// so they read as sky-fixed at any zoom.


/** @returns {Array<{lng:number, text:string}>} */
function hourMeridianLabels() {
  // 24 hours of RA; one label per 1h = 15° meridian.
  const out = []
  for (let h = 0; h < 24; h += MERIDIAN_STEP_DEG / 15) {
    out.push({lng: (h * 15) * toRad, text: `${h}h`})
  }
  return out
}


/** @returns {Array<{lng:number, text:string}>} */
function degMeridianLabels() {
  const out = []
  for (let d = 0; d < 360; d += MERIDIAN_STEP_DEG) {
    out.push({lng: d * toRad, text: `${d}°`})
  }
  return out
}


/** @returns {Array<{lat:number, text:string}>} */
function degParallelLabels() {
  // Strictly between the poles, signed degrees.
  const out = []
  for (let d = -90 + PARALLEL_STEP_DEG; d < 90; d += PARALLEL_STEP_DEG) {
    const sign = d > 0 ? '+' : (d < 0 ? '-' : '')
    out.push({lat: d * toRad, text: `${sign}${Math.abs(d)}°`})
  }
  return out
}


/**
 * Build a labels Points object for the grid's meridians and parallels and
 * attach it to `gridGroup`.  Two labels per line — one anchored to each
 * opposite screen edge (top + bottom for meridians, left + right for
 * parallels) — so as the camera rotates each line's labels slide along the
 * edge they're anchored to, like Celestia.
 *
 * In the bun test env canvas APIs are stubbed, so the texture build
 * gracefully returns null; no test impact.
 *
 * @param {Group} gridGroup
 * @param {Array<{lng:number, text:string}>} meridians
 * @param {Array<{lat:number, text:string}>} parallels
 * @param {Color} color
 */
function attachLabels(gridGroup, meridians, parallels, color) {
  const items = []
  for (const {lng, text} of meridians) {
    const samples = sampleMeridian(lng)
    items.push({text, samples, edge: 'top'})
    items.push({text, samples, edge: 'bottom'})
  }
  for (const {lat, text} of parallels) {
    const samples = sampleParallel(lat)
    items.push({text, samples, edge: 'right'})
    items.push({text, samples, edge: 'left'})
  }
  const points = buildLabelsPoints(items, color)
  if (!points) {
    return
  }
  attachEdgeFollower(points, items, gridGroup)
  gridGroup.add(points)
}


/**
 * Unit-sphere samples along a meridian (constant longitude, varying
 * latitude from south pole to north pole).  Returned as a flat
 * Float32Array of (x,y,z) triples for cheap iteration in the per-frame
 * edge follower.
 *
 * Exported for tests.
 *
 * @param {number} lng radians
 * @returns {Float32Array}
 */
export function sampleMeridian(lng) {
  const arr = new Float32Array(EDGE_SAMPLES * 3)
  const cl = Math.cos(lng); const sl = Math.sin(lng)
  for (let i = 0; i < EDGE_SAMPLES; i++) {
    const lat = (-Math.PI / 2) + ((Math.PI * i) / (EDGE_SAMPLES - 1))
    const cy = Math.cos(lat)
    arr[(3 * i)] = cy * cl
    arr[(3 * i) + 1] = Math.sin(lat)
    arr[(3 * i) + 2] = cy * sl
  }
  return arr
}


/**
 * Unit-sphere samples along a parallel (constant latitude, full longitude
 * loop).  Like sampleMeridian, returned as a flat Float32Array.
 *
 * Exported for tests.
 *
 * @param {number} lat radians
 * @returns {Float32Array}
 */
export function sampleParallel(lat) {
  const arr = new Float32Array(EDGE_SAMPLES * 3)
  const cy = Math.cos(lat); const sy = Math.sin(lat)
  for (let i = 0; i < EDGE_SAMPLES; i++) {
    const lng = (2 * Math.PI * i) / EDGE_SAMPLES
    arr[(3 * i)] = cy * Math.cos(lng)
    arr[(3 * i) + 1] = sy
    arr[(3 * i) + 2] = cy * Math.sin(lng)
  }
  return arr
}


/**
 * Score a sample's NDC position by distance to a target screen edge.
 * Smaller score = closer to that edge.  Off-screen samples return Infinity
 * so the edge-follower picks the on-screen sample even if all candidates
 * are far from the edge.
 *
 * Exported for tests.
 *
 * @param {number} ndcX in [-1, 1]
 * @param {number} ndcY in [-1, 1]
 * @param {string} edge 'top' | 'bottom' | 'right' | 'left'
 * @returns {number}
 */
export function edgeScore(ndcX, ndcY, edge) {
  if (Math.abs(ndcX) > 1 || Math.abs(ndcY) > 1) {
    return Infinity
  }
  switch (edge) {
    case 'top': return 1 - ndcY
    case 'bottom': return 1 + ndcY
    case 'right': return 1 - ndcX
    case 'left': return 1 + ndcX
    default: return Infinity
  }
}


/**
 * Per-frame, walk each label's sample circle, project each sample to NDC
 * (using the same skybox-style rotation-only transform the label shader
 * does), and pick the visible sample closest to that label's anchor edge.
 * Update the position attribute and toggle aVisible based on whether any
 * sample landed on screen.
 *
 * @param {Points} points
 * @param {Array<object>} items
 * @param {Group} gridGroup
 */
function attachEdgeFollower(points, items, gridGroup) {
  const positionAttr = points.geometry.attributes.position
  const visibleAttr = points.geometry.attributes.aVisible
  const positions = positionAttr.array
  const visibles = visibleAttr.array
  const _v = new Vector3()
  const _modelRot = new Matrix3()
  const _viewRot = new Matrix3()

  points.onBeforeRender = (renderer, scene, camera) => {
    gridGroup.updateMatrixWorld()
    _modelRot.setFromMatrix4(gridGroup.matrixWorld)
    _viewRot.setFromMatrix4(camera.matrixWorldInverse)

    for (let labelIdx = 0; labelIdx < items.length; labelIdx++) {
      const {samples, edge} = items[labelIdx]
      let bestX = 0; let bestY = 0; let bestZ = 0
      let bestScore = Infinity

      for (let i = 0; i < EDGE_SAMPLES; i++) {
        const off = i * 3
        _v.set(samples[off], samples[off + 1], samples[off + 2])
        _v.applyMatrix3(_modelRot).applyMatrix3(_viewRot)
        // Skip points behind / on the camera plane — perspective projection
        // is ill-defined and Vector3.applyMatrix4's perspective division
        // would give nonsense NDC.  Small epsilon guards points exactly at
        // the eye plane.
        if (_v.z >= -1e-6) {
          continue
        }
        _v.applyMatrix4(camera.projectionMatrix)
        const score = edgeScore(_v.x, _v.y, edge)
        if (score < bestScore) {
          bestScore = score
          bestX = samples[off]
          bestY = samples[off + 1]
          bestZ = samples[off + 2]
        }
      }

      const off = labelIdx * 3
      if (Number.isFinite(bestScore)) {
        positions[off] = bestX
        positions[off + 1] = bestY
        positions[off + 2] = bestZ
        visibles[labelIdx] = 1
      } else {
        visibles[labelIdx] = 0
      }
    }
    positionAttr.needsUpdate = true
    visibleAttr.needsUpdate = true
  }
}


/**
 * Bake `items` into a CanvasTexture atlas + Points geometry with one sprite
 * per item.  Returns null if the canvas environment can't measure text
 * (e.g. headless tests).
 *
 * @param {Array<{pos:Array<number>, text:string}>} items
 * @param {Color} color
 * @returns {Points|null}
 */
function buildLabelsPoints(items, color) {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return null
  }
  const measureCanvas = document.createElement('canvas')
  const measureCtx = measureCanvas.getContext('2d')
  if (!measureCtx) {
    return null
  }
  measureCtx.font = LABEL_FONT

  // Per-item tile size — the larger of text width and a fixed line height,
  // padded.  Tiles are square so the on-screen sprite (Points are square)
  // displays the text without stretching.
  const PAD = 6
  const LINE_H = 24
  const tiles = items.map(({text}) => {
    const m = measureCtx.measureText(text)
    const w = Math.ceil(m.width)
    const tileSize = Math.max(w, LINE_H) + (PAD * 2)
    return {tileSize, text, w}
  })
  if (tiles.some((t) => !Number.isFinite(t.tileSize) || t.tileSize <= 0)) {
    return null
  }

  // Pack tiles into a roughly-square atlas, row-by-row.
  const tilesPerRow = Math.max(1, Math.ceil(Math.sqrt(tiles.length)))
  const maxTile = Math.max(...tiles.map((t) => t.tileSize))
  const atlasW = tilesPerRow * maxTile
  let curX = 0; let curY = 0; let rowH = 0
  const placed = []
  for (const t of tiles) {
    if (curX + t.tileSize > atlasW) {
      curX = 0
      curY += rowH
      rowH = 0
    }
    placed.push({...t, x: curX, y: curY})
    curX += t.tileSize
    rowH = Math.max(rowH, t.tileSize)
  }
  const atlasH = curY + rowH

  // Render the atlas.
  const canvas = document.createElement('canvas')
  canvas.width = atlasW
  canvas.height = atlasH
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return null
  }
  ctx.font = LABEL_FONT
  ctx.fillStyle = color.getStyle()
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'
  for (const p of placed) {
    ctx.fillText(p.text, p.x + (p.tileSize / 2), p.y + (p.tileSize / 2))
  }

  // Build attribute buffers.  spriteCoord = (u_topLeft, v_topLeft, w, h) in
  // [0,1] atlas space.  v is flipped because gl_PointCoord runs top-down
  // while CanvasTexture is uploaded with the canvas's natural Y-down origin.
  // aVisible defaults to 0 — the edge-follower onBeforeRender flips it on
  // for each label whose line is currently on screen.  If no follower is
  // attached (e.g. tests), labels stay hidden, which is fine.
  const positions = new Float32Array(items.length * 3)
  const spriteCoords = new Float32Array(items.length * 4)
  const sizes = new Float32Array(items.length)
  const visibles = new Float32Array(items.length)
  for (let i = 0; i < items.length; i++) {
    const p = placed[i]
    // Initial position: first sample point if available, else (1, 0, 0).
    // The follower will overwrite this on the first frame anyway; this is
    // only used between geometry creation and the first render tick.
    const samples = items[i].samples
    if (samples) {
      positions[(3 * i)] = samples[0]
      positions[(3 * i) + 1] = samples[1]
      positions[(3 * i) + 2] = samples[2]
    } else {
      positions[(3 * i)] = 1
      positions[(3 * i) + 1] = 0
      positions[(3 * i) + 2] = 0
    }
    spriteCoords[(4 * i)] = p.x / atlasW
    spriteCoords[(4 * i) + 1] = (atlasH - p.y - p.tileSize) / atlasH
    spriteCoords[(4 * i) + 2] = p.tileSize / atlasW
    spriteCoords[(4 * i) + 3] = p.tileSize / atlasH
    sizes[i] = p.tileSize
    visibles[i] = 0
  }

  const geom = new BufferGeometry()
  geom.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geom.setAttribute('aSpriteCoord', new Float32BufferAttribute(spriteCoords, 4))
  geom.setAttribute('aSize', new Float32BufferAttribute(sizes, 1))
  geom.setAttribute('aVisible', new Float32BufferAttribute(visibles, 1))

  const tex = new CanvasTexture(canvas)
  tex.minFilter = LinearFilter
  tex.magFilter = LinearFilter
  tex.needsUpdate = true

  const mat = new ShaderMaterial({
    uniforms: {map: {value: tex}},
    vertexShader: LABEL_VERT,
    fragmentShader: LABEL_FRAG,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
  })
  const points = new Points(geom, mat)
  points.frustumCulled = false
  // Render after the lines (also at -1) within the transparent batch so
  // labels composite on top of grid line crossings.
  points.renderOrder = 0
  return points
}


// Vertex: same skybox-style projection as the lines (rotation only, pinned
// to far plane), plus per-vertex point size taken from aSize.  aVisible is
// passed through to the fragment which discards hidden labels (those whose
// line is fully off-screen this frame).
const LABEL_VERT = `
attribute vec4  aSpriteCoord;
attribute float aSize;
attribute float aVisible;
varying vec4  vSpriteCoord;
varying float vVisible;
void main() {
  vSpriteCoord = aSpriteCoord;
  vVisible = aVisible;
  vec3 dir = mat3(viewMatrix) * (mat3(modelMatrix) * position);
  vec4 clipPos = projectionMatrix * vec4(dir, 1.0);
  clipPos.z = clipPos.w * 0.9997;
  gl_Position = clipPos;
  gl_PointSize = aSize;
}
`

// Fragment: sample the per-tile sub-rect of the atlas.  gl_PointCoord is
// (0,0)=top-left → (1,1)=bottom-right of the sprite quad, while our atlas
// has (0,0)=bottom-left in UV — hence the (1.0 - y) flip.  Discard when
// the edge-follower has marked the label as not currently on screen.
const LABEL_FRAG = `
uniform sampler2D map;
varying vec4  vSpriteCoord;
varying float vVisible;
void main() {
  if (vVisible < 0.5) {
    discard;
  }
  vec2 uv = vec2(
    vSpriteCoord.x + vSpriteCoord.z * gl_PointCoord.x,
    vSpriteCoord.y + vSpriteCoord.w * (1.0 - gl_PointCoord.y));
  gl_FragColor = texture2D(map, uv);
}
`
