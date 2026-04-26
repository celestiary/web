import {
  AdditiveBlending,
  BufferGeometry,
  Float32BufferAttribute,
  Points,
  ShaderMaterial,
  Texture,
  Vector3,
} from 'three'
import {pathTexture} from './material.js'
import {LIGHTYEAR_METER, STARS_RADIUS_METER, toRad} from '../shared.js'


// Sun's distance from the galactic centre (Sgr A*) is ~26 kLY.  We park the
// galactic centre at a fixed offset from the world origin so the Sun (which
// already sits at the origin) lands on the inner edge of a spiral arm at
// roughly its real galacto-centric radius.
const SUN_GALACTIC_RADIUS_M = 26000 * LIGHTYEAR_METER

// Galactic plane orientation in scene coords.  Same Z-rotation the Galactic
// reference grid uses (Grids.js); puts the disk perpendicular to the IAU
// J2000 galactic pole instead of the ecliptic pole.  Without this the disk
// sits in the ecliptic plane, which is wrong by ~60° (the angle between
// the two normals).
const ECLIPTIC_TO_GALACTIC_DEG = 60.187

// Milky-Way-ish shape parameters (artistic, not surveyed).
const DISK_RADIUS_M = 50000 * LIGHTYEAR_METER
const DISK_THICKNESS_M = 1000 * LIGHTYEAR_METER
const BAR_HALF_LEN_M = 7000 * LIGHTYEAR_METER
const BAR_HALF_WIDTH_M = 1800 * LIGHTYEAR_METER
const BULGE_RADIUS_M = 4500 * LIGHTYEAR_METER

const NUM_STARS = 16000
const NUM_ARMS = 4 // four arms — Milky Way is a "multi-arm" / 4-arm design
const ARM_PITCH = 0.22 // tan(pitch); ≈ 12.5° pitch angle, MW-ish
const FRAC_BULGE = 0.20
const FRAC_BAR = 0.15
// Remainder goes into the spiral arms.

// Choice of "Sun arm" controls the galactic orientation.  Arm 0's logarithmic
// spiral is sampled at r = SUN_GALACTIC_RADIUS_M to find the Sun anchor; the
// whole disk is then translated so that anchor sits at the world origin.
const SUN_ARM_INDEX = 0

// Carve a hole around the Sun where the local Hipparcos catalog already
// renders real stars at full fidelity.  Galaxy points inside this hole would
// (a) overlap individual catalog stars, (b) blow up gl_PointSize when the
// camera is inside the hole, and (c) be much closer than the cloud is
// designed for.  Uses STARS_RADIUS_METER (~10 kLY) so the carve-out matches
// the actual catalog footprint.
const LOCAL_CATALOG_HOLE_M = STARS_RADIUS_METER


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
  const sizes = new Float32Array(NUM_STARS)

  // Sun sits on arm SUN_ARM_INDEX at radius SUN_GALACTIC_RADIUS_M.
  const sunArmAngle = armAngleAt(SUN_ARM_INDEX, SUN_GALACTIC_RADIUS_M)
  const sunGalCx = SUN_GALACTIC_RADIUS_M * Math.cos(sunArmAngle)
  const sunGalCz = SUN_GALACTIC_RADIUS_M * Math.sin(sunArmAngle)

  const tmp = new Vector3()
  const holeSq = LOCAL_CATALOG_HOLE_M * LOCAL_CATALOG_HOLE_M
  let written = 0
  // Rejection-sample: reroll any point that lands inside the local catalog
  // hole.  Cap the rejection budget so a degenerate config (Sun far inside
  // the bar, etc.) can't infinite-loop.
  const MAX_TRIES = NUM_STARS * 8
  for (let tries = 0; tries < MAX_TRIES && written < NUM_STARS; tries++) {
    const r = Math.random()
    let col; let sz
    if (r < FRAC_BULGE) {
      sampleBulge(tmp); col = bulgeColor(); sz = bulgeSize()
    } else if (r < FRAC_BULGE + FRAC_BAR) {
      sampleBar(tmp); col = barColor(); sz = bulgeSize()
    } else {
      sampleArm(tmp); col = armColor(); sz = armSize()
    }
    // Translate galaxy so the Sun anchor sits at the world origin: galaxy
    // points get shifted by -sunGalC so SUN ↦ (0,0,0).
    const x = tmp.x - sunGalCx
    const y = tmp.y
    const z = tmp.z - sunGalCz
    // Reject if inside the local catalog hole around the Sun.
    if (((x * x) + (y * y) + (z * z)) < holeSq) {
      continue
    }
    // RTE high/low split: hi = fround(x), lo = x - hi.  Magnitudes match,
    // so float32 subtraction (position - camPos) is exact.
    const hx = Math.fround(x); const hy = Math.fround(y); const hz = Math.fround(z)
    const off3 = written * 3
    positions[off3] = hx
    positions[off3 + 1] = hy
    positions[off3 + 2] = hz
    positionLow[off3] = x - hx
    positionLow[off3 + 1] = y - hy
    positionLow[off3 + 2] = z - hz
    colors[off3] = col[0]
    colors[off3 + 1] = col[1]
    colors[off3 + 2] = col[2]
    sizes[written] = sz
    written++
  }
  // Trim attribute arrays if rejection sampling left us short.
  const positionsFinal = (written === NUM_STARS) ? positions : positions.subarray(0, written * 3)
  const positionLowFinal = (written === NUM_STARS) ? positionLow : positionLow.subarray(0, written * 3)
  const colorsFinal = (written === NUM_STARS) ? colors : colors.subarray(0, written * 3)
  const sizesFinal = (written === NUM_STARS) ? sizes : sizes.subarray(0, written)

  const geom = new BufferGeometry()
  geom.setAttribute('position', new Float32BufferAttribute(positionsFinal, 3))
  geom.setAttribute('positionLow', new Float32BufferAttribute(positionLowFinal, 3))
  geom.setAttribute('aGalaxyColor', new Float32BufferAttribute(colorsFinal, 3))
  geom.setAttribute('aSize', new Float32BufferAttribute(sizesFinal, 1))

  // pathTexture() routes through three's TextureLoader, which calls
  // document.createElementNS synchronously to spin up an Image element.
  // The bun test env supplies a stub document without that method, so
  // guard the call: in headless we use a 1x1 placeholder texture (the
  // Points cloud is never actually rendered there anyway).
  let glowTex
  try {
    glowTex = pathTexture('star_glow', '.png')
  } catch {
    glowTex = new Texture()
  }

  // Note: do NOT set `vertexColors: true` on a ShaderMaterial whose vertex
  // shader already declares `attribute vec3 color`.  Three injects a
  // USE_COLOR define and may wire the standard Points chunks into the
  // pipeline, which silently overrides the shader's gl_PointSize and
  // produces giant fixed-size sprites instead of our intended size.
  const mat = new ShaderMaterial({
    uniforms: {
      texSampler: {value: glowTex},
      uCamPosWorldHigh: {value: new Vector3()},
      uCamPosWorldLow: {value: new Vector3()},
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    blending: AdditiveBlending,
    depthTest: true,
    depthWrite: false,
    transparent: true,
    toneMapped: false,
  })

  const points = new Points(geom, mat)
  points.name = 'MilkyWay'
  // Tilt the disk into the galactic plane.  The samplers above lay the
  // galaxy out with its pole along scene +Y (the ecliptic pole); rotating
  // about Z by the IAU obliquity of the galactic plane swings the pole
  // onto the actual galactic-pole direction.  Sun stays at the origin
  // because we already shifted vertices by -sunGalC pre-rotation.
  points.rotation.z = ECLIPTIC_TO_GALACTIC_DEG * toRad
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
// stars, arms by hotter younger stars on average.  Each function returns a
// random sample from its region's color distribution; the per-particle
// variation is what gives the cloud its mottled, non-uniform appearance.

/** @returns {Array<number>} [r, g, b] in 0..1 */
function bulgeColor() {
  // Yellow-orange core with a hint of red on the redder samples.
  const j = Math.random() * 0.15
  return [1.0, 0.78 - j, 0.55 - j]
}

/** @returns {Array<number>} [r, g, b] in 0..1 */
function barColor() {
  // Slightly cooler than the bulge — transitions toward the arm temperatures.
  const j = Math.random() * 0.12
  return [1.0, 0.85 - j, 0.65 - j]
}

/** @returns {Array<number>} [r, g, b] in 0..1 */
function armColor() {
  // Mostly blue-white (young hot OB stars + scatter), with the occasional
  // yellow giant — matches the catalog's per-star color distribution at the
  // hole boundary so the transition to the local catalog is seamless.
  if (Math.random() < 0.06) {
    return [1.0, 0.85, 0.6]
  }
  const blueT = Math.random()
  return [0.85 + ((1 - blueT) * 0.15), 0.92, 0.95 + (blueT * 0.05)]
}


// --- Per-particle size --------------------------------------------------
//
// The galaxy's visual texture (clumpy bright spots in a sea of fainter
// background) comes from per-particle size variation, not from real
// brightness — at galactic distances every star projects to clamp-sized
// (~3 px) under the catalog's standard rendering, so all the visible
// "structure" has to be painted by the size distribution.  Most particles
// are sub-3-px haze; a small fraction are the bright cluster / HII-region
// stand-ins that show up as the discrete bright dots in Celestia-style
// galaxy renders.
//
// Choices below produce a mix that visually matches the catalog stars at
// the catalog-hole boundary (~10 kLY).


/** @returns {number} pixels — bulge / bar particle */
function bulgeSize() {
  // Bulge has a denser, slightly larger average — concentrated mass.
  const r = Math.random()
  if (r < 0.05) {
    return 4.5 + (Math.random() * 2.5)
  } // bright cluster
  if (r < 0.20) {
    return 2.5 + (Math.random() * 1.5)
  }
  return 1.2 + (Math.random() * 1.0)
}


/** @returns {number} pixels — arm particle */
function armSize() {
  // Arms have more sparse bright spots (HII regions / O-star clusters)
  // against a fainter background dot population.
  const r = Math.random()
  if (r < 0.04) {
    return 4.0 + (Math.random() * 2.5)
  } // bright clump
  if (r < 0.15) {
    return 2.2 + (Math.random() * 1.3)
  }
  return 1.0 + (Math.random() * 1.0)
}


// ---- Shaders ---------------------------------------------------------------
//
// Vertex: RTE eye-relative position so worldGroup rebases stay precise.
// Bias gl_Position.z to the far plane so the cloud composites strictly behind
// every depth-writing object regardless of float32 depth-buffer crush at
// galactic scales.

// Custom attribute name aGalaxyColor (instead of plain `color`) sidesteps any
// chance of three.js wiring its built-in vertex-color attribute on top of ours
// — that path expects a different layout and silently breaks gl_PointSize.
const VERT = `
attribute vec3  aGalaxyColor;
attribute vec3  positionLow;
attribute float aSize;
uniform vec3 uCamPosWorldHigh;
uniform vec3 uCamPosWorldLow;
varying vec3  vColor;
void main() {
  vColor = aGalaxyColor;
  vec3 highDiff = position    - uCamPosWorldHigh;
  vec3 lowDiff  = positionLow - uCamPosWorldLow;
  vec3 eyePos   = highDiff + lowDiff;
  vec4 mvPosition = vec4(mat3(viewMatrix) * eyePos, 1.0);
  // Per-particle pixel size: the JS-side sampler hands out a mix of small
  // background dots (1–2 px), medium stars (2.5–4 px), and bright cluster
  // clumps (5–7 px).  Constant in screen space (no 1/dist) so close-by
  // points don't blow up and overdraw stays bounded.  The size mix is
  // what gives the cloud its texture and lets nearby Hipparcos stars
  // blend into the galaxy at the catalog-hole boundary.
  gl_PointSize = aSize;
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
