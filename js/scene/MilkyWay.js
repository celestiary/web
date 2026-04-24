import {
  AdditiveBlending,
  BufferGeometry,
  Float32BufferAttribute,
  Points,
  ShaderMaterial,
  Vector3,
} from 'three'
import {pathTexture} from './material.js'
import {LIGHTYEAR_METER} from '../shared.js'


// Sun's distance from the galactic centre (Sgr A*) is ~26 kLY.  We park the
// galactic centre at a fixed offset from the world origin so the Sun (which
// already sits at the origin) lands on the inner edge of a spiral arm at
// roughly its real galacto-centric radius.
const SUN_GALACTIC_RADIUS_M = 26000 * LIGHTYEAR_METER

// Milky-Way-ish shape parameters (artistic, not surveyed).
const DISK_RADIUS_M = 50000 * LIGHTYEAR_METER
const DISK_THICKNESS_M = 1000 * LIGHTYEAR_METER
const BAR_HALF_LEN_M = 7000 * LIGHTYEAR_METER
const BAR_HALF_WIDTH_M = 1500 * LIGHTYEAR_METER
const BULGE_RADIUS_M = 4000 * LIGHTYEAR_METER

const NUM_STARS = 12000
const NUM_ARMS = 2 // two grand-design arms emerging from the bar
const ARM_PITCH = 0.22 // tan(pitch); ≈ 12.5° pitch angle, MW-ish
const FRAC_BULGE = 0.18
const FRAC_BAR = 0.18
// Remainder goes into the spiral arms.

// Choice of "Sun arm" controls the galactic orientation.  Arm 0's logarithmic
// spiral is sampled at r = SUN_GALACTIC_RADIUS_M to find the Sun anchor; the
// whole disk is then translated so that anchor sits at the world origin.
const SUN_ARM_INDEX = 0


/**
 * Procedural barred-spiral Milky Way as an additive Points cloud.
 *
 * Coordinate convention: built in galactic-centre local space (centre at
 * origin, disk in XZ plane, +Y = galactic north).  The whole Points object
 * is then translated so that the Sun's anchor point on a spiral arm lands at
 * the world origin (where the simulated Sun lives).
 *
 * Uses Relative-To-Eye (RTE) emulated double precision in the shader so the
 * stars stay rock-solid when the camera is rebased during star navigation
 * (worldGroup shifts under the galaxy, but the eye-relative math cancels out).
 *
 * @returns {Points}
 */
export default function newMilkyWay() {
  const positions = new Float32Array(NUM_STARS * 3)
  const positionLow = new Float32Array(NUM_STARS * 3)
  const colors = new Float32Array(NUM_STARS * 3)

  // Sun sits on arm SUN_ARM_INDEX at radius SUN_GALACTIC_RADIUS_M.
  const sunArmAngle = armAngleAt(SUN_ARM_INDEX, SUN_GALACTIC_RADIUS_M)
  const sunGalCx = SUN_GALACTIC_RADIUS_M * Math.cos(sunArmAngle)
  const sunGalCz = SUN_GALACTIC_RADIUS_M * Math.sin(sunArmAngle)

  const tmp = new Vector3()
  for (let i = 0; i < NUM_STARS; i++) {
    const r = Math.random()
    let col
    if (r < FRAC_BULGE) {
      sampleBulge(tmp); col = bulgeColor()
    } else if (r < FRAC_BULGE + FRAC_BAR) {
      sampleBar(tmp); col = barColor()
    } else {
      sampleArm(tmp); col = armColor()
    }
    // Translate galaxy so the Sun anchor sits at the world origin: galaxy
    // points get shifted by -sunGalC so SUN ↦ (0,0,0).
    const x = tmp.x - sunGalCx
    const y = tmp.y
    const z = tmp.z - sunGalCz
    // RTE high/low split: hi = fround(x), lo = x - hi.  Magnitudes match,
    // so float32 subtraction (position - camPos) is exact.
    const hx = Math.fround(x); const hy = Math.fround(y); const hz = Math.fround(z)
    const off3 = i * 3
    positions[off3] = hx
    positions[off3 + 1] = hy
    positions[off3 + 2] = hz
    positionLow[off3] = x - hx
    positionLow[off3 + 1] = y - hy
    positionLow[off3 + 2] = z - hz
    colors[off3] = col[0]
    colors[off3 + 1] = col[1]
    colors[off3 + 2] = col[2]
  }

  const geom = new BufferGeometry()
  geom.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geom.setAttribute('positionLow', new Float32BufferAttribute(positionLow, 3))
  geom.setAttribute('color', new Float32BufferAttribute(colors, 3))

  // Texture is loaded lazily on first onBeforeRender so headless tests (no
  // DOM, so TextureLoader.load → document.createElementNS would throw)
  // construct the galaxy without touching the loader.
  const mat = new ShaderMaterial({
    uniforms: {
      texSampler: {value: null},
      uMinPxSize: {value: 1.0},
      uMaxPxSize: {value: 48.0},
      uSizeFalloff: {value: 8e18}, // metres; gl_PointSize ≈ uSizeFalloff / dist
      uCamPosWorldHigh: {value: new Vector3()},
      uCamPosWorldLow: {value: new Vector3()},
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    blending: AdditiveBlending,
    depthTest: true,
    depthWrite: false,
    transparent: true,
    vertexColors: true,
    toneMapped: false,
  })

  const points = new Points(geom, mat)
  points.name = 'MilkyWay'
  // Galaxy sits on top of any rebase the worldGroup applies; positions are
  // already in world coords, so identity local transform.
  // Auto-computed bounding sphere is correct but huge — leave frustum
  // culling enabled.
  // RenderOrder < 0 so the additive cloud composites cleanly behind the
  // local star particles (which default to renderOrder 0).
  points.renderOrder = -2

  // Drive the RTE camera-position uniforms each frame, mirroring Stars.js.
  // worldGroup may translate during star navigation; subtract its position so
  // the residual is in galaxy-local frame (= world frame for this object,
  // since the galaxy itself sits in worldGroup with identity local).
  const rtePos = new Vector3()
  points.onBeforeRender = (renderer, scene, camera) => {
    if (mat.uniforms.texSampler.value === null) {
      mat.uniforms.texSampler.value = pathTexture('star_glow', '.png')
    }
    camera.getWorldPosition(rtePos)
    const wg = scene.getObjectByName('WorldGroup')
    if (wg) {
      rtePos.sub(wg.position)
    }
    const hx = Math.fround(rtePos.x)
    const hy = Math.fround(rtePos.y)
    const hz = Math.fround(rtePos.z)
    mat.uniforms.uCamPosWorldHigh.value.set(hx, hy, hz)
    mat.uniforms.uCamPosWorldLow.value.set(rtePos.x - hx, rtePos.y - hy, rtePos.z - hz)
  }

  return points
}


// --- Disk component samplers ------------------------------------------------

/** @param {Vector3} out */
function sampleBulge(out) {
  // Slightly oblate spheroid concentrated toward centre.
  const u = Math.random(); const v = Math.random()
  const theta = 2 * Math.PI * u
  const phi = Math.acos((2 * v) - 1)
  const r = Math.pow(Math.random(), 0.7) * BULGE_RADIUS_M
  out.set(
      r * Math.sin(phi) * Math.cos(theta),
      r * Math.cos(phi) * 0.4, // flatter than wide
      r * Math.sin(phi) * Math.sin(theta))
}


/** @param {Vector3} out */
function sampleBar(out) {
  // Bar oriented along X in galactic-centre frame.  Long-axis density
  // peaks at centre via sqrt-of-uniform.
  const tx = (Math.random() - 0.5) * 2.0
  out.set(
      Math.sign(tx) * Math.sqrt(Math.abs(tx)) * BAR_HALF_LEN_M,
      (Math.random() - 0.5) * DISK_THICKNESS_M * 0.6,
      (Math.random() - 0.5) * BAR_HALF_WIDTH_M * 2.0)
}


/** @param {Vector3} out */
function sampleArm(out) {
  const armIdx = Math.floor(Math.random() * NUM_ARMS)
  // Distance from the bar end out to disk edge, biased outward gently.
  const t = Math.random()
  const r = BAR_HALF_LEN_M + (Math.pow(t, 0.5) * (DISK_RADIUS_M - BAR_HALF_LEN_M))
  const angle = armAngleAt(armIdx, r)
  // Scatter perpendicular and along the arm so it reads as a thick lane,
  // not a hairline.
  const armWidth = (DISK_THICKNESS_M * 0.8) + (r * 0.04)
  const dr = (Math.random() - 0.5) * armWidth * 1.6
  const da = (Math.random() - 0.5) * 0.30
  const finalR = Math.max(0, r + dr)
  const finalA = angle + da
  // Disk thins very gradually with radius.
  const thickness = DISK_THICKNESS_M * (0.6 + (0.4 * Math.exp(-r / DISK_RADIUS_M)))
  out.set(
      finalR * Math.cos(finalA),
      (Math.random() - 0.5) * thickness,
      finalR * Math.sin(finalA))
}


/**
 * Logarithmic spiral arm angle at radius r for arm index armIdx.
 *
 * @param {number} armIdx
 * @param {number} r metres from galactic centre
 * @returns {number} radians
 */
function armAngleAt(armIdx, r) {
  // θ = (1/pitch) · ln(r / r0) + arm_offset
  const r0 = BAR_HALF_LEN_M
  return ((1 / ARM_PITCH) * Math.log(Math.max(r, r0) / r0)) + ((armIdx * 2 * Math.PI) / NUM_ARMS)
}


// Slight color variation per region — bulge/bar populated by older yellower
// stars, arms by hotter younger stars on average.

/** @returns {Array<number>} [r, g, b] in 0..1 */
function bulgeColor() {
  const j = Math.random() * 0.1
  return [1.0, 0.85 - j, 0.6 - j]
}

/** @returns {Array<number>} [r, g, b] in 0..1 */
function barColor() {
  const j = Math.random() * 0.1
  return [1.0, 0.88 - j, 0.7 - j]
}

/** @returns {Array<number>} [r, g, b] in 0..1 */
function armColor() {
  const blueT = Math.random()
  return [0.85 + ((1 - blueT) * 0.15), 0.92, 0.95 + (blueT * 0.05)]
}


// ---- Shaders ---------------------------------------------------------------
//
// Vertex: RTE eye-relative position so worldGroup rebases stay precise.
// Bias gl_Position.z to the far plane so the cloud composites strictly behind
// every depth-writing object regardless of float32 depth-buffer crush at
// galactic scales.

const VERT = `
attribute vec3 color;
attribute vec3 positionLow;
uniform vec3  uCamPosWorldHigh;
uniform vec3  uCamPosWorldLow;
uniform float uMinPxSize;
uniform float uMaxPxSize;
uniform float uSizeFalloff;
varying vec3  vColor;
void main() {
  vColor = color;
  vec3 highDiff = position    - uCamPosWorldHigh;
  vec3 lowDiff  = positionLow - uCamPosWorldLow;
  vec3 eyePos   = highDiff + lowDiff;
  vec4 mvPosition = vec4(mat3(viewMatrix) * eyePos, 1.0);
  float dist = max(-mvPosition.z, 1.0);
  gl_PointSize = clamp(uSizeFalloff / dist, uMinPxSize, uMaxPxSize);
  vec4 clip = projectionMatrix * mvPosition;
  // Pin to (just inside) far plane in clip space so the additive galaxy
  // never "wins" a depth comparison against any nearer geometry.  z = w
  // would map to the far plane exactly; pull a touch in to avoid ties.
  clip.z = clip.w * 0.9999;
  gl_Position = clip;
}
`

const FRAG = `
uniform sampler2D texSampler;
varying vec3 vColor;
void main() {
  vec4 tex = texture2D(texSampler, gl_PointCoord);
  gl_FragColor = vec4(vColor, 1.0) * tex;
}
`
