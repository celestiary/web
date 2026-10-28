import {
  BoxGeometry,
  CircleGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three'


// A model of the Rubin Observatory from primitives, in metres (Rubin.md):
// the enclosure and its dome, the Simonyi Survey Telescope on its
// alt-azimuth mount, and a beam along its pointing.  Not a survey of the
// building: the published sizes (a 30 m dome, an 8.4 m primary, a compact
// 9 m telescope) and the shapes a visitor knows it by.  Lit by the Sun as
// the planets are (models.md), with a faint glow of its own so it shows
// at night (RubinObservatory.js sets it).

export const BUILDING_RADIUS_M = 16
export const BUILDING_HEIGHT_M = 14
export const DOME_RADIUS_M = 15
/** The dome's centre over the ground: the enclosure's top. */
export const DOME_CENTRE_M = BUILDING_HEIGHT_M
/** The elevation axis over the ground. */
export const AXIS_HEIGHT_M = 15
/** Half the slit's angle at the dome's centre (an 11 m slit). */
const SLIT_HALF_RAD = Math.asin(5.5 / DOME_RADIUS_M)
const PRIMARY_RADIUS_M = 4.2
const CELL_RADIUS_M = 4.6
const TOP_RING_RADIUS_M = 3
const TOP_HEIGHT_M = 5
const CELL_DEPTH_M = -2.5
const TRUSS_COUNT = 6
export const BEAM_LENGTH_M = 400
const BEAM_COLOR = 0x9fe8ff
const BEAM_WIDTH_PX = 1.5
const BEAM_OPACITY = 0.6
const SEGMENTS = 48

const PAINT = {color: 0xd9d9d6, roughness: 0.85, metalness: 0}
const DOME_PAINT = {color: 0xe4e4e0, roughness: 0.8, metalness: 0.05}
const STEEL = {color: 0x7f8a99, roughness: 0.55, metalness: 0.6}
const MIRROR = {color: 0x404855, roughness: 0.12, metalness: 1}
const DARK = {color: 0x2a2c30, roughness: 0.7, metalness: 0.3}
const Y_AXIS = new Vector3(0, 1, 0)


/**
 * @param {object} params MeshStandardMaterial's
 * @returns {MeshStandardMaterial}
 */
function material(params) {
  return new MeshStandardMaterial(params)
}


/**
 * A strut from one point to another, a thin cylinder.
 *
 * @param {Vector3} from
 * @param {Vector3} to
 * @param {MeshStandardMaterial} mat
 * @returns {Mesh}
 */
function strut(from, to, mat) {
  const dir = to.clone().sub(from)
  const mesh = new Mesh(new CylinderGeometry(0.15, 0.15, dir.length(), 8), mat)
  mesh.position.copy(from).add(to).multiplyScalar(0.5)
  mesh.quaternion.setFromUnitVectors(Y_AXIS, dir.normalize())
  return mesh
}


/**
 * The dome's shell with its slit, or the shutter that fills it.
 *
 * @param {number} radius
 * @param {boolean} shutter
 * @param {MeshStandardMaterial} mat
 * @returns {Mesh}
 */
function domeShell(radius, shutter, mat) {
  // SphereGeometry's phi runs from −X; the slit is centred there and the
  // mesh turned so it faces −Z, north at azimuth 0 (rubin.js mountAngles).
  const geometry = shutter ?
    new SphereGeometry(radius, 12, 16, -SLIT_HALF_RAD, 2 * SLIT_HALF_RAD, 0, Math.PI / 2) :
    new SphereGeometry(radius, SEGMENTS, 24, SLIT_HALF_RAD, (2 * Math.PI) - (2 * SLIT_HALF_RAD), 0, Math.PI / 2)
  const mesh = new Mesh(geometry, mat)
  mesh.rotation.y = -Math.PI / 2
  return mesh
}


/**
 * @param {object} deps
 * @param {Function} deps.newWideLineStrip wideLines.js's, handed in (rubin.js)
 * @returns {{group: Group, azimuth: Object3D, elevation: Object3D, dome: Object3D, shutter: Mesh,
 *   beam: Mesh, materials: MeshStandardMaterial[]}} The model, its moving
 *   parts (RubinObservatory.js turns them), and every lit material, for
 *   the night glow
 */
export function newRubinModel({newWideLineStrip}) {
  const group = new Group
  group.name = 'rubin model'
  const paint = material(PAINT)
  const domePaint = material(DOME_PAINT)
  const steel = material(STEEL)
  const mirror = material(MIRROR)
  const dark = material(DARK)

  // The enclosure, sunk a little so a slope doesn't open a gap under it.
  const building = new Mesh(new CylinderGeometry(BUILDING_RADIUS_M, BUILDING_RADIUS_M, BUILDING_HEIGHT_M + 2, SEGMENTS), paint)
  building.position.y = (BUILDING_HEIGHT_M / 2) - 1
  group.add(building)

  // The dome turns with the telescope's azimuth; its shutter shows while
  // the dome is shut.
  const dome = new Object3D
  dome.name = 'dome'
  dome.position.y = DOME_CENTRE_M
  dome.add(domeShell(DOME_RADIUS_M, false, domePaint))
  const shutter = domeShell(DOME_RADIUS_M + 0.3, true, dark)
  shutter.name = 'shutter'
  dome.add(shutter)
  group.add(dome)

  // The mount: a pier, the azimuth ring and fork, the elevation axis.
  const pier = new Mesh(new CylinderGeometry(3, 3.5, AXIS_HEIGHT_M - 6, 24), dark)
  pier.position.y = (AXIS_HEIGHT_M - 6) / 2
  group.add(pier)
  const azimuth = new Object3D
  azimuth.name = 'azimuth'
  azimuth.position.y = AXIS_HEIGHT_M
  const base = new Mesh(new CylinderGeometry(6, 6, 1.2, 32), steel)
  base.position.y = -5.4
  azimuth.add(base)
  for (const side of [-1, 1]) {
    const arm = new Mesh(new BoxGeometry(1.4, 7, 3.2), steel)
    arm.position.set(side * 5.6, -2.5, 0)
    azimuth.add(arm)
  }
  const elevation = new Object3D
  elevation.name = 'elevation'
  azimuth.add(elevation)
  group.add(azimuth)

  // The telescope about its elevation axis: the mirror cell and the
  // primary at the bottom, a truss to the top ring, the camera at the top.
  const cell = new Mesh(new CylinderGeometry(CELL_RADIUS_M, CELL_RADIUS_M, 1.6, SEGMENTS), steel)
  cell.position.y = CELL_DEPTH_M - 0.5
  elevation.add(cell)
  const primary = new Mesh(new CircleGeometry(PRIMARY_RADIUS_M, SEGMENTS), mirror)
  primary.rotation.x = -Math.PI / 2
  primary.position.y = CELL_DEPTH_M + 0.4
  elevation.add(primary)
  const trunnion = new Mesh(new CylinderGeometry(0.8, 0.8, 12, 16), steel)
  trunnion.rotation.z = Math.PI / 2
  elevation.add(trunnion)
  for (let i = 0; i < TRUSS_COUNT; i++) {
    const a = (i / TRUSS_COUNT) * 2 * Math.PI
    const b = ((i + 0.5) / TRUSS_COUNT) * 2 * Math.PI
    const foot = new Vector3(CELL_RADIUS_M * Math.cos(a), CELL_DEPTH_M, CELL_RADIUS_M * Math.sin(a))
    elevation.add(strut(foot, new Vector3(TOP_RING_RADIUS_M * Math.cos(a), TOP_HEIGHT_M, TOP_RING_RADIUS_M * Math.sin(a)), steel))
    elevation.add(strut(foot, new Vector3(TOP_RING_RADIUS_M * Math.cos(b), TOP_HEIGHT_M, TOP_RING_RADIUS_M * Math.sin(b)), steel))
  }
  const topRing = new Mesh(new TorusGeometry(TOP_RING_RADIUS_M, 0.3, 8, SEGMENTS), steel)
  topRing.rotation.x = Math.PI / 2
  topRing.position.y = TOP_HEIGHT_M
  elevation.add(topRing)
  const camera = new Mesh(new CylinderGeometry(0.85, 0.85, 3, 24), dark)
  camera.position.y = TOP_HEIGHT_M - 1.5
  elevation.add(camera)

  // The beam out along the pointing, shown while tracking.
  const beam = newWideLineStrip(new Float32Array([0, TOP_HEIGHT_M, 0, 0, TOP_HEIGHT_M + BEAM_LENGTH_M, 0]),
      {name: 'rubin beam', color: BEAM_COLOR, width: BEAM_WIDTH_PX, opacity: BEAM_OPACITY,
        material: {depthWrite: false, transparent: true}})
  beam.visible = false
  elevation.add(beam)

  return {group, azimuth, elevation, dome, shutter, beam, materials: [paint, domePaint, steel, mirror, dark]}
}

