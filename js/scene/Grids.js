import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  LineSegments,
  ShaderMaterial,
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

// Grid resolution.
const NUM_PARALLELS = 11 // latitude small-circles (excluding poles)
const NUM_MERIDIANS = 24 // longitude great-circles (one every 15° = 1h RA)
const SEGMENTS = 96 // segments per circle


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

  const ecliptic = wrapWithMaterial(sphereGeom, COLOR_ECLIPTIC, 'EclipticGrid')
  // identity rotation — the scene's Y axis IS the ecliptic pole

  const galactic = wrapWithMaterial(sphereGeom, COLOR_GALACTIC, 'GalacticGrid')
  galactic.rotation.z = ECLIPTIC_TO_GALACTIC_DEG * toRad

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
