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
  Vector2,
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

// Label font / atlas tile size.  Small — these are reference-grid axis
// labels and shouldn't dominate the scene; we want them legible but
// understated.  LABEL_FONT_PX is also the inset (1 em) we apply between
// the label anchor and the screen edge so labels don't kiss the canvas.
const LABEL_FONT_PX = 12
const LABEL_FONT = `${LABEL_FONT_PX}px sans-serif`
const LABEL_TILE_PAD = 3
const LABEL_TILE_LINE_H = LABEL_FONT_PX + 4

// How many points to sample along each meridian / parallel circle when
// searching for the screen-edge intersection per frame.  Continuous
// interpolation between adjacent samples (see attachEdgeFollower) keeps
// motion smooth, but the chord-vs-arc discrepancy between linear-3D-lerp
// and the actual sphere arc shows up as a sub-pixel wobble at low sample
// counts.  96 samples → 3.75° per step, which is below the perceptible
// jitter threshold at typical FOVs while still cheap (≈10k matrix-vector
// mults per grid per frame).
const EDGE_SAMPLES = 96


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
  // Meridians are open arcs from south pole to north pole; the (last,
  // first) sample pair would be a chord through the centre of the sphere,
  // not a continuation of the line, so closed=false.  Parallels are full
  // small circles, so closed=true.
  for (const {lng, text} of meridians) {
    const samples = sampleMeridian(lng)
    items.push({text, samples, edge: 'top', closed: false})
    items.push({text, samples, edge: 'bottom', closed: false})
  }
  for (const {lat, text} of parallels) {
    const samples = sampleParallel(lat)
    items.push({text, samples, edge: 'right', closed: true})
    items.push({text, samples, edge: 'left', closed: true})
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
 * Per-frame, walk each label's sample circle and place the label at the
 * exact point where the line crosses its target screen edge.  Two-pass:
 *
 *   1. Pre-project every sample to NDC (cheap — ~32 matrix-vector mults).
 *   2. For each pair of adjacent samples, check whether they bracket the
 *      target edge in NDC; if so, linearly interpolate to find the exact
 *      crossing in NDC space, then lerp the corresponding 3D positions to
 *      produce a continuous label position that slides smoothly along the
 *      edge as the camera rotates.
 *
 * Falls back to the closest visible sample when no pair brackets (the
 * line stays entirely on screen or entirely off the edge side).  When no
 * sample is visible, marks the label as hidden via the aVisible attribute,
 * which the fragment shader uses to discard.
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

  // Per-frame scratch: per-sample NDC + frontness, reused across every
  // label so we don't reallocate.
  const ndcX = new Float32Array(EDGE_SAMPLES)
  const ndcY = new Float32Array(EDGE_SAMPLES)
  const front = new Uint8Array(EDGE_SAMPLES)

  const _v = new Vector3()
  const _modelRot = new Matrix3()
  const _viewRot = new Matrix3()
  // renderer.getSize requires a Vector2 (the Three.js call does
  // `target.set(width, height)`, which a plain literal won't provide).
  const _rendererSize = new Vector2()

  points.onBeforeRender = (renderer, scene, camera) => {
    gridGroup.updateMatrixWorld()
    _modelRot.setFromMatrix4(gridGroup.matrixWorld)
    _viewRot.setFromMatrix4(camera.matrixWorldInverse)
    // Convert a 1 em (LABEL_FONT_PX) inset from each screen edge into NDC.
    // NDC spans [-1, 1] (= 2 units) across the full canvas in each axis,
    // so 1 px = 2 / size, and the per-axis pad in NDC is FONT_PX * 2 /
    // size.  Recomputed each frame so the gap stays a constant em
    // regardless of window resizes.
    renderer.getSize(_rendererSize)
    const padX = _rendererSize.x > 0 ? (LABEL_FONT_PX * 2) / _rendererSize.x : 0
    const padY = _rendererSize.y > 0 ? (LABEL_FONT_PX * 2) / _rendererSize.y : 0

    for (let labelIdx = 0; labelIdx < items.length; labelIdx++) {
      const {samples, edge, closed} = items[labelIdx]
      const padNDC = (edge === 'top' || edge === 'bottom') ? padY : padX

      // Pass 1: project all samples once.
      for (let i = 0; i < EDGE_SAMPLES; i++) {
        const off = i * 3
        _v.set(samples[off], samples[off + 1], samples[off + 2])
        _v.applyMatrix3(_modelRot).applyMatrix3(_viewRot)
        if (_v.z >= -1e-6) {
          front[i] = 0
          continue
        }
        _v.applyMatrix4(camera.projectionMatrix)
        ndcX[i] = _v.x
        ndcY[i] = _v.y
        front[i] = 1
      }

      // Pass 2: walk pairs, find the bracket whose NDC-interpolation
      // lands closest to screen centre (the visible portion of the line).
      let bestX3 = 0; let bestY3 = 0; let bestZ3 = 0
      let bestScore = Infinity
      const pairLimit = closed ? EDGE_SAMPLES : EDGE_SAMPLES - 1
      for (let i = 0; i < pairLimit; i++) {
        const j = (i + 1) % EDGE_SAMPLES
        if (!front[i] || !front[j]) {
          continue
        }
        const xi = ndcX[i]; const yi = ndcY[i]
        const xj = ndcX[j]; const yj = ndcY[j]
        const cross = bracketCrossing(xi, yi, xj, yj, edge, padNDC)
        if (cross === null) {
          continue
        }
        // Tie-break: prefer the visible portion of the line — interpolated
        // crossing closest to screen centre.  Pure |x|+|y| keeps it cheap.
        const score = Math.abs(cross.x) + Math.abs(cross.y)
        if (score < bestScore) {
          bestScore = score
          const t = cross.t
          const offI = i * 3; const offJ = j * 3
          bestX3 = ((1 - t) * samples[offI]) + (t * samples[offJ])
          bestY3 = ((1 - t) * samples[offI + 1]) + (t * samples[offJ + 1])
          bestZ3 = ((1 - t) * samples[offI + 2]) + (t * samples[offJ + 2])
        }
      }

      // Fallback: no bracket — line never reaches the edge but might still
      // be visible somewhere.  Pick the visible sample closest to the
      // edge, then refine to sub-sample precision via a parabolic fit
      // through that sample and its two neighbours.  Linear interpolation
      // can't help here (both segment endpoints have score ≥ the local
      // min), but the score curve through three adjacent samples is
      // approximately quadratic, and the vertex of the fitted parabola
      // gives a smooth continuous position even when no segment brackets
      // the edge.  This eliminates the "snap to nearest sample" stepping
      // for parallels viewed obliquely (where right/left-edge crossings
      // are off-screen on the orthogonal axis).
      if (!Number.isFinite(bestScore)) {
        let bestI = -1
        let bestEdgeScore = Infinity
        for (let i = 0; i < EDGE_SAMPLES; i++) {
          if (!front[i]) {
            continue
          }
          const score = edgeScore(ndcX[i], ndcY[i], edge)
          if (score < bestEdgeScore) {
            bestEdgeScore = score
            bestI = i
          }
        }
        if (bestI >= 0) {
          const refined = refineSubSample(
              bestI, samples, ndcX, ndcY, front, edge, closed)
          bestX3 = refined.x
          bestY3 = refined.y
          bestZ3 = refined.z
          bestScore = bestEdgeScore
        }
      }

      const labelOff = labelIdx * 3
      if (Number.isFinite(bestScore)) {
        positions[labelOff] = bestX3
        positions[labelOff + 1] = bestY3
        positions[labelOff + 2] = bestZ3
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
 * Sub-sample refinement around `bestI`: fit a parabola through bestI's
 * edge-score and its two neighbours' scores, find the vertex (offset t in
 * [-1, +1] sample-spacings from bestI), and return the linearly
 * interpolated 3D position toward whichever neighbour the vertex falls
 * toward.  Falls back to the bestI sample directly when the three points
 * don't form a true upward parabola (e.g. one neighbour is off-screen).
 *
 * Exported for tests.
 *
 * @param {number} bestI
 * @param {Float32Array|Array<number>} samples flat (x,y,z) triples
 * @param {Float32Array|Array<number>} ndcX
 * @param {Float32Array|Array<number>} ndcY
 * @param {Uint8Array|Array<number>} front per-sample visibility flag (1/0)
 * @param {string} edge 'top' | 'bottom' | 'right' | 'left'
 * @param {boolean} closed wrap (-1 ↔ N-1) when true
 * @returns {{x:number, y:number, z:number}}
 */
export function refineSubSample(bestI, samples, ndcX, ndcY, front, edge, closed) {
  const N = front.length
  let prevI; let nextI
  if (closed) {
    prevI = (bestI - 1 + N) % N
    nextI = (bestI + 1) % N
  } else {
    prevI = bestI > 0 ? bestI - 1 : bestI
    nextI = bestI < N - 1 ? bestI + 1 : bestI
  }
  const offB = bestI * 3
  if (prevI === bestI || nextI === bestI || !front[prevI] || !front[nextI]) {
    return {x: samples[offB], y: samples[offB + 1], z: samples[offB + 2]}
  }
  const sa = edgeScore(ndcX[prevI], ndcY[prevI], edge)
  const sb = edgeScore(ndcX[bestI], ndcY[bestI], edge)
  const sc = edgeScore(ndcX[nextI], ndcY[nextI], edge)
  if (!Number.isFinite(sa) || !Number.isFinite(sc)) {
    return {x: samples[offB], y: samples[offB + 1], z: samples[offB + 2]}
  }
  // Parabola through (-1, sa), (0, sb), (1, sc) has vertex at
  //   x* = (sa - sc) / (2 * (sa + sc - 2 sb))
  // Only use the result if denom > 0 (parabola opens upward, sb really is
  // a local min between sa and sc).  Clamp to [-1, +1] so we never reach
  // past the neighbours.
  const denom = (sa + sc) - (2 * sb)
  if (denom <= 1e-12) {
    return {x: samples[offB], y: samples[offB + 1], z: samples[offB + 2]}
  }
  let t = (sa - sc) / (2 * denom)
  if (t > 1) {
    t = 1
  } else if (t < -1) {
    t = -1
  }
  // Linearly interpolate between bestI and the neighbour in t's direction.
  const otherI = t >= 0 ? nextI : prevI
  const w = Math.abs(t) // fractional distance toward `otherI`, in [0, 1]
  const offO = otherI * 3
  return {
    x: ((1 - w) * samples[offB]) + (w * samples[offO]),
    y: ((1 - w) * samples[offB + 1]) + (w * samples[offO + 1]),
    z: ((1 - w) * samples[offB + 2]) + (w * samples[offO + 2]),
  }
}


/**
 * Test whether the NDC line segment (xi,yi) → (xj,yj) crosses the given
 * screen edge (optionally inset by `padNDC` from the canvas border so
 * labels can sit slightly inside the visible area), and if so return the
 * linear-interpolation parameter t at the crossing along with the
 * crossing's NDC coordinates.  Returns null if the segment doesn't cross
 * the inset edge or crosses it off-screen on the orthogonal axis.
 *
 * Exported for tests.
 *
 * @param {number} xi NDC x of segment start
 * @param {number} yi NDC y of segment start
 * @param {number} xj NDC x of segment end
 * @param {number} yj NDC y of segment end
 * @param {string} edge 'top' | 'bottom' | 'right' | 'left'
 * @param {number} [padNDC] inset toward screen centre, in NDC units
 *   (e.g. 12 px on a 600 px-tall canvas → 12 / 300 = 0.04).
 * @returns {{t:number, x:number, y:number}|null}
 */
export function bracketCrossing(xi, yi, xj, yj, edge, padNDC = 0) {
  let edgeVal; let isYAxis
  switch (edge) {
    case 'top': edgeVal = 1 - padNDC; isYAxis = true; break
    case 'bottom': edgeVal = -1 + padNDC; isYAxis = true; break
    case 'right': edgeVal = 1 - padNDC; isYAxis = false; break
    case 'left': edgeVal = -1 + padNDC; isYAxis = false; break
    default: return null
  }
  const vi = isYAxis ? yi : xi
  const vj = isYAxis ? yj : xj
  // Bracket iff edge sits strictly between the two values.  Use product
  // of differences: negative ⇒ opposite signs ⇒ crosses.
  const di = vi - edgeVal
  const dj = vj - edgeVal
  if (di * dj >= 0) {
    return null
  }
  const t = di / (di - dj) // ∈ (0, 1)
  const xCross = xi + (t * (xj - xi))
  const yCross = yi + (t * (yj - yi))
  // Reject if the orthogonal coordinate is off-screen (line crosses the
  // edge's axis but outside the visible window — no inset on this axis).
  const orth = isYAxis ? xCross : yCross
  if (orth < -1 || orth > 1) {
    return null
  }
  return {t, x: xCross, y: yCross}
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
  const tiles = items.map(({text}) => {
    const m = measureCtx.measureText(text)
    const w = Math.ceil(m.width)
    const tileSize = Math.max(w, LABEL_TILE_LINE_H) + (LABEL_TILE_PAD * 2)
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
