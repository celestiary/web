import {
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NormalBlending,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
} from 'three'
import {LIGHTYEAR_METER} from '../shared.js'
import {sceneReferred} from './hdr.js'
import {rteCameraLocal} from './rte.js'


/**
 * Wide, antialiased lines at astronomical distances: each segment an
 * instance of one screen-space quad, so it can be wider than WebGL's 1 px
 * lines, precise at light-years (RTE), cut in front of the camera, and
 * optionally drawn far to near.  Used by the human expansion lines
 * (ColonizationLines.js) and the asterisms (Asterisms.js).  Design and the
 * GPU lessons behind it: Colonization.md, "Drawing".
 *
 * Per segment: start and end (metres, in the mesh's frame), colour, hop
 * (for a width ramp and a pulse) and times (to grow it over time).  Static
 * lines leave hop and times at their defaults and are always whole.
 */


// A time after every arrival (a uniform can't hold Infinity reliably).
export const ALWAYS = 1e30
// A pulse lights a segment this much of the way to white.
const PULSE_WHITEN = 0.85
// Size attenuation never widens a line past this multiple of its width.
const MAX_ATTENUATION_GAIN = 4
// Painter's order (sortFarToNear): log-distance buckets.  Enough that
// segments sharing a bucket are within ~1% of each other's distance.
const SORT_BUCKETS = 4096
// Re-sort when the camera has moved this much plus this share of its
// distance from the frame's origin, at most this often.
const RESORT_MIN_LY = 0.05
const RESORT_FRACTION = 0.02
const RESORT_MIN_MS = 250
// A segment crossing the camera plane is cut at this fraction of its length
// in front of the camera (or the near plane, if farther).  float32 resolves
// a point on a segment to ~1e-7 of its length (~1e12 m for a hop thousands
// of light-years long), so a cut at the near plane (~6e5 m) landed anywhere
// within that: at or behind the camera, where w <= 0.  1e-5 keeps the cut a
// hundred times its error in front, so on screen within about a pixel.
const TRIM_FRACTION = 1e-5
const ATTRIBUTES = ['startHigh', 'startLow', 'endHigh', 'endLow', 'aColor', 'aTimes', 'aHop']


// Each segment is an instance of one quad, extruded in screen space so it
// can be wider than WebGL's 1 px lines.  position.x is the side (-1, 1),
// position.y the end (0 start, 1 end).
//
// RTE: endpoints are float32 high + low parts about the
// camera, turned by mat3(modelViewMatrix) (the StellarFrame's precession and
// the view) and never translated in float32.  The end grows from the start
// while the ship is in transit: at the start at departure (aTimes.x), at its
// star at arrival (aTimes.y).  A segment crossing the camera plane is cut in
// front of the camera in view space before projecting (trimToFront), as a
// line that passes behind the camera would otherwise project through
// infinity.
const vertexShader = `
  uniform vec3 uCamPosWorldHigh;
  uniform vec3 uCamPosWorldLow;
  uniform float uTime;
  uniform vec2 uResolution;
  uniform float uPixelRatio;
  uniform float uNear;
  uniform float uMaxHop;
  uniform float uWidthFirst;
  uniform float uWidthLast;
  uniform float uAttenuation;
  uniform float uOpacity;
  uniform float uPulseOn;
  uniform float uPulseHop;
  uniform float uTrail;
  uniform vec4 uOverride;
  attribute vec3 startHigh;
  attribute vec3 startLow;
  attribute vec3 endHigh;
  attribute vec3 endLow;
  attribute vec2 aTimes;
  attribute vec3 aColor;
  attribute float aHop;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vSide;
  varying float vHalf;

  const vec4 CULLED = vec4(0.0, 0.0, 2.0, 1.0);

  void main() {
    if (uTime < aTimes.x) {
      gl_Position = CULLED;
      return;
    }
    vec3 s = (startHigh - uCamPosWorldHigh) + (startLow - uCamPosWorldLow);
    vec3 e = (endHigh - uCamPosWorldHigh) + (endLow - uCamPosWorldLow);
    float span = max(aTimes.y - aTimes.x, 1e-6);
    e = mix(s, e, clamp((uTime - aTimes.x) / span, 0.0, 1.0));
    vec3 vs = mat3(modelViewMatrix) * s;
    vec3 ve = mat3(modelViewMatrix) * e;
    // As trimToFront.  The cut's depth is set, not computed: computed, it
    // carries the mix's float32 error, which can put it behind the camera.
    float zCut = -max(uNear, ${TRIM_FRACTION.toExponential()} * length(ve - vs));
    if (vs.z > zCut && ve.z > zCut) {
      gl_Position = CULLED;
      return;
    }
    if (vs.z > zCut) {
      vs = mix(vs, ve, (zCut - vs.z) / (ve.z - vs.z));
      vs.z = zCut;
    } else if (ve.z > zCut) {
      ve = mix(ve, vs, (zCut - ve.z) / (vs.z - ve.z));
      ve.z = zCut;
    }
    vec4 cs = projectionMatrix * vec4(vs, 1.0);
    vec4 ce = projectionMatrix * vec4(ve, 1.0);
    vec2 halfRes = 0.5 * uResolution;
    vec2 d = (ce.xy / ce.w - cs.xy / cs.w) * halfRes;
    float len = length(d);
    vec2 dir = len > 1e-6 ? d / len : vec2(1.0, 0.0);
    vec2 perp = vec2(-dir.y, dir.x);
    bool atEnd = position.y > 0.5;

    float t = uMaxHop > 1.0 ? (aHop - 1.0) / (uMaxHop - 1.0) : 0.0;
    float w = mix(uWidthFirst, uWidthLast, t);
    float boost = 0.0;
    if (uPulseOn > 0.5) {
      float behind = floor(uPulseHop) - aHop;
      if (behind >= 0.0 && behind <= uTrail) {
        boost = 1.0 - (behind / (uTrail + 1.0));
      }
    }
    w *= 1.0 + boost;
    if (uAttenuation > 0.0) {
      w *= min(uAttenuation / length(atEnd ? ve : vs), ${MAX_ATTENUATION_GAIN.toFixed(1)});
    }
    w *= uPixelRatio;
    // Half the quad's width: half the line's, and a pixel for its edge.
    float halfW = (0.5 * w) + 1.0;
    vec4 clip = atEnd ? ce : cs;
    // Square caps: out along the segment by halfW, so hops meet without gaps.
    vec2 offset = (perp * position.x + dir * (atEnd ? 1.0 : -1.0)) * halfW;
    clip.xy += offset / halfRes * clip.w;
    // Divided through to w = 1: the same point and depth, with w out of the
    // way.  w is the distance in metres, ~1e18 at light-years, and the
    // rasterizer's perspective-corrected varyings work in 1/w products that
    // underflow float32 there (the coverage across the width came out 0).
    // With w = 1 they interpolate linearly on screen, as wanted across a
    // line's width.  Safe because both ends are in front of the near plane.
    gl_Position = vec4(clip.xyz / clip.w, 1.0);

    vColor = mix(mix(aColor, vec3(1.0), ${PULSE_WHITEN} * boost), uOverride.rgb, uOverride.a);
    vAlpha = max(uOpacity, boost);
    vSide = position.x;
    vHalf = halfW;
  }
`

// Coverage across the width: 1 to half a pixel inside the line's edge, 0
// by half a pixel outside it (vHalf is the line's half width plus 1).  A
// 1 px line is 1 at its centre, as a GL line; a thinner one never reaches
// 1, so attenuated lines fade as they thin.
const fragmentShader = `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vSide;
  varying float vHalf;
  void main() {
    float cover = clamp(vHalf - 0.5 - (abs(vSide) * vHalf), 0.0, 1.0);
    gl_FragColor = vec4(vColor, vAlpha * cover);
  }
`


/**
 * @param {object} segments Columns, n segments: `start` and `end`
 *   (Float64Array or Array, 3n, metres), `color` (3n, display values), and
 *   optionally `hop` (n; default 1) and `times` (2n, departure and arrival;
 *   default always whole)
 * @param {object} [options]
 * @param {string} [options.name]
 * @param {boolean} [options.sort] Keep the segments drawn far to near
 * @param {Function} [options.onFrame] Called with the uniforms each frame
 * @returns {Mesh} With uniforms for width (uWidthFirst, uWidthLast,
 *   uMaxHop), uOpacity, uAttenuation (metres; 0 off), uTime, the pulse
 *   (uPulseOn, uPulseHop, uTrail) and uOverride (rgb, mix)
 */
export function newWideLines(segments, {name = 'WideLines', sort = false, onFrame} = {}) {
  const {start, end, color} = segments
  const n = start.length / 3
  const arrays = {
    startHigh: new Float32Array(n * 3),
    startLow: new Float32Array(n * 3),
    endHigh: new Float32Array(n * 3),
    endLow: new Float32Array(n * 3),
    aColor: Float32Array.from(color),
    aTimes: segments.times ? Float32Array.from(segments.times) : new Float32Array(n * 2),
    aHop: segments.hop ? Float32Array.from(segments.hop) : new Float32Array(n).fill(1),
  }
  for (let j = 0; j < n * 3; j++) {
    arrays.startHigh[j] = start[j]
    arrays.startLow[j] = start[j] - arrays.startHigh[j]
    arrays.endHigh[j] = end[j]
    arrays.endLow[j] = end[j] - arrays.endHigh[j]
  }
  const geom = new InstancedBufferGeometry()
  geom.setAttribute('position', new Float32BufferAttribute([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0], 3))
  // Counter-clockwise on screen (front faces): perp is dir turned left, so
  // side -1 is the right edge.
  geom.setIndex([1, 0, 2, 1, 2, 3])
  const sizes = {aTimes: 2, aHop: 1}
  for (const key of ATTRIBUTES) {
    geom.setAttribute(key, new InstancedBufferAttribute(arrays[key], sizes[key] || 3))
  }
  geom.instanceCount = n
  // The arrays in build order, which sorting permutes into the attributes.
  geom.userData.master = sort ? Object.fromEntries(ATTRIBUTES.map((key) => [key, arrays[key].slice()])) : null
  const mesh = new Mesh(geom, newWideLineMaterial())
  mesh.name = name
  // Vertices are placed in the shader, so three's bounds don't apply, and
  // the quad in `position` isn't where anything is: never cull or pick it.
  mesh.frustumCulled = false
  mesh.raycast = noRaycast
  const u = mesh.material.uniforms
  const res = new Vector2()
  const sorted = {at: null, ms: 0}
  mesh.onBeforeRender = (renderer, scene, camera) => {
    rteCameraLocal(mesh, camera, u.uCamPosWorldHigh.value, u.uCamPosWorldLow.value)
    const target = renderer.getRenderTarget()
    if (target) {
      res.set(target.width, target.height)
    } else {
      renderer.getDrawingBufferSize(res)
    }
    u.uResolution.value.copy(res)
    u.uPixelRatio.value = renderer.getPixelRatio()
    u.uNear.value = camera.near
    if (sort) {
      maybeSort(geom, sorted, u.uCamPosWorldHigh.value, u.uCamPosWorldLow.value)
    }
    onFrame?.(u)
  }
  return mesh
}


/** @param {Mesh} mesh From newWideLines; frees its GPU buffers */
export function disposeWideLines(mesh) {
  mesh.removeFromParent()
  mesh.geometry.dispose()
  mesh.material.dispose()
}


/**
 * Keep the segments drawn far to near from the camera.  The lines blend
 * without writing depth, so they composite in draw order, and depth can't
 * order them anyway: past ~70 AU every distance is the same 24-bit depth.
 * Only the camera's position matters, so turning the view never re-sorts.
 * Applies from the next frame: three has uploaded this frame's attributes.
 *
 * @param {InstancedBufferGeometry} geom
 * @param {object} sorted {at, ms} of the last sort, updated
 * @param {Vector3} high Camera position in the lines' frame, float32 part
 * @param {Vector3} low The residual
 */
function maybeSort(geom, sorted, high, low) {
  const cam = [high.x + low.x, high.y + low.y, high.z + low.z]
  const now = performance.now()
  if (sorted.at) {
    const moved = Math.hypot(...cam.map((v, c) => v - sorted.at[c]))
    const threshold = (LIGHTYEAR_METER * RESORT_MIN_LY) + (RESORT_FRACTION * Math.hypot(...cam))
    if (moved < threshold || now - sorted.ms < RESORT_MIN_MS) {
      return
    }
  }
  sorted.at = cam
  sorted.ms = now
  const {master} = geom.userData
  const order = sortFarToNear(master.startHigh, master.startLow, master.endHigh, master.endLow, cam)
  for (const [key, src] of Object.entries(master)) {
    const attr = geom.attributes[key]
    const size = attr.itemSize
    const dst = attr.array
    for (let k = 0; k < order.length; k++) {
      const from = order[k] * size
      for (let c = 0; c < size; c++) {
        dst[(k * size) + c] = src[from + c]
      }
    }
    attr.needsUpdate = true
  }
}


/** @returns {ShaderMaterial} */
function newWideLineMaterial() {
  return sceneReferred(new ShaderMaterial({
    uniforms: {
      uCamPosWorldHigh: {value: new Vector3()},
      uCamPosWorldLow: {value: new Vector3()},
      uTime: {value: ALWAYS},
      uResolution: {value: new Vector2(1, 1)},
      uPixelRatio: {value: 1},
      uNear: {value: 1},
      uMaxHop: {value: 1},
      uWidthFirst: {value: 1},
      uWidthLast: {value: 1},
      uAttenuation: {value: 0},
      uOpacity: {value: 1},
      uPulseOn: {value: 0},
      uPulseHop: {value: 0},
      uTrail: {value: 0},
      uOverride: {value: new Vector4(0, 0, 0, 0)},
    },
    vertexShader,
    fragmentShader,
    toneMapped: false,
    transparent: true,
    blending: NormalBlending,
    depthWrite: false,
  }))
}


/**
 * Segment indices ordered far to near from a point, by each segment's
 * closest distance to it, bucketed on log distance (linear time; order
 * within a bucket, ~1% of distance, is arbitrary).
 *
 * @param {Float32Array} startHigh Segment starts, packed xyz, float32 part
 * @param {Float32Array} startLow The residuals
 * @param {Float32Array} endHigh Segment ends, packed xyz
 * @param {Float32Array} endLow The residuals
 * @param {Array<number>} cam The point, xyz, in the same frame and units
 * @returns {Uint32Array} Indices, farthest first
 */
export function sortFarToNear(startHigh, startLow, endHigh, endLow, cam) {
  const n = startHigh.length / 3
  const logDist = new Float64Array(n)
  let lo = Infinity
  let hi = -Infinity
  const [cx, cy, cz] = cam
  for (let i = 0; i < n; i++) {
    const j = 3 * i
    const sx = startHigh[j] + startLow[j] - cx
    const sy = startHigh[j + 1] + startLow[j + 1] - cy
    const sz = startHigh[j + 2] + startLow[j + 2] - cz
    const dx = endHigh[j] + endLow[j] - cx - sx
    const dy = endHigh[j + 1] + endLow[j + 1] - cy - sy
    const dz = endHigh[j + 2] + endLow[j + 2] - cz - sz
    // Closest point to the camera on start + t d, t in [0, 1].
    const dd = (dx * dx) + (dy * dy) + (dz * dz)
    let t = dd > 0 ? -((sx * dx) + (sy * dy) + (sz * dz)) / dd : 0
    t = t < 0 ? 0 : (t > 1 ? 1 : t)
    const px = sx + (t * dx)
    const py = sy + (t * dy)
    const pz = sz + (t * dz)
    // Half the log of the squared distance: the same order, no sqrt.
    const v = 0.5 * Math.log(Math.max((px * px) + (py * py) + (pz * pz), 1))
    logDist[i] = v
    if (v < lo) {
      lo = v
    }
    if (v > hi) {
      hi = v
    }
  }
  const scale = hi > lo ? (SORT_BUCKETS - 1) / (hi - lo) : 0
  const bucket = new Uint32Array(n)
  const count = new Uint32Array(SORT_BUCKETS + 1)
  for (let i = 0; i < n; i++) {
    // Farthest in bucket 0.
    bucket[i] = SORT_BUCKETS - 1 - Math.floor((logDist[i] - lo) * scale)
    count[bucket[i] + 1]++
  }
  for (let b = 1; b <= SORT_BUCKETS; b++) {
    count[b] += count[b - 1]
  }
  const order = new Uint32Array(n)
  for (let i = 0; i < n; i++) {
    order[count[bucket[i]]++] = i
  }
  return order
}


/**
 * Cut a view-space segment to the part in front of the camera, as the
 * vertex shader does.  `round` emulates the GPU's float32 (Math.fround) for
 * tests; the default is exact.
 *
 * @param {Array<number>} vs Start, view space (the camera looks down -z)
 * @param {Array<number>} ve End
 * @param {number} near Camera near plane distance
 * @param {Function} [round]
 * @returns {Array<Array<number>>|null} [start, end], or null if all behind
 */
export function trimToFront(vs, ve, near, round = (x) => x) {
  const r = round
  const len = r(Math.hypot(...ve.map((v, c) => r(v - vs[c]))))
  const zCut = r(-Math.max(near, r(TRIM_FRACTION * len)))
  if (vs[2] > zCut && ve[2] > zCut) {
    return null
  }
  const cut = (a, b) => {
    const t = r(r(zCut - a[2]) / r(b[2] - a[2]))
    const p = a.map((v, c) => r(v + r(t * r(b[c] - v))))
    p[2] = zCut
    return p
  }
  if (vs[2] > zCut) {
    return [cut(vs, ve), ve]
  }
  if (ve[2] > zCut) {
    return [vs, cut(ve, vs)]
  }
  return [vs, ve]
}


/** Raycasting skips the lines: their quad isn't where they're drawn. */
function noRaycast() {
  // Nothing to intersect.
}
