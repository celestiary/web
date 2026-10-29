import {
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three'


// The Rubin Observatory's model, in metres (Rubin.md, "The model"): the
// enclosure and its dome from primitives, by the published sizes (a 30 m
// dome with an 11 m slit), and the Simonyi Survey Telescope from NOIRLab's
// model of it (public/large/models/rubin/simonyi.glb, credit Rubin
// Observatory/NSF/AURA; tools/models/build.sh), whose parts are grouped
// into the pier, the azimuth structure and the elevation structure, so
// the mount turns as the real one does.  Lit by the Sun as the planets are
// (models.md), with a faint glow of its own so it shows at night
// (RubinObservatory.js sets it).  Nothing here imports the first load's
// modules but three (rubin.js says why): the loader and the line strip
// come in as `deps`.

export const BUILDING_RADIUS_M = 16
export const BUILDING_HEIGHT_M = 14
export const DOME_RADIUS_M = 15
/** The dome's centre over the ground: the enclosure's top. */
export const DOME_CENTRE_M = BUILDING_HEIGHT_M
/** The elevation axis over the ground. */
export const AXIS_HEIGHT_M = 15
/** Half the slit's angle at the dome's centre (an 11 m slit). */
export const SLIT_HALF_RAD = Math.asin(5.5 / DOME_RADIUS_M)
/** The shutter slides aside by the slit's width to open. */
export const SHUTTER_SLIDE_RAD = 2 * SLIT_HALF_RAD

/** NOIRLab's telescope (build.sh), under the site's data. */
export const MODEL_PATH = 'large/models/rubin/simonyi.glb'
/** In the model: the elevation axis over its origin, metres, along X. */
export const MODEL_AXIS_Y = 7.8
/** The model's pose: its tube points this far up, toward its +Z. */
export const MODEL_POSE_EL_DEG = 45
/** The tube's top end over the axis, along the tube, metres. */
export const MODEL_TUBE_TOP_M = 9.6

export const BEAM_LENGTH_M = 400
/**
 * The astronomer's seat (Rubin.md, "The seat"): a viewpoint on the
 * elevation structure, in its frame (the tube along +Y, the axis along X),
 * so it rides the pointing and looks parallel to it.  On the walkway the
 * model carries on the structure's +Z side (its `platform` and `rails1`
 * parts: a floor at radius 7 to 8 m from the axis, a metre above it, with
 * rails to 3 m), at a standing eye's height over the floor, outside the
 * structure's rings (radius 6) and the beam of the view.
 */
export const SEAT_M = Object.freeze({x: 0, y: 2.8, z: 7.3})
const BEAM_COLOR = 0x9fe8ff
const BEAM_WIDTH_PX = 1.5
const BEAM_OPACITY = 0.6
const SEGMENTS = 48
const toRad = Math.PI / 180

const PAINT = {color: 0xd9d9d6, roughness: 0.85, metalness: 0}
const DOME_PAINT = {color: 0xe4e4e0, roughness: 0.8, metalness: 0.05}
const DARK = {color: 0x2a2c30, roughness: 0.7, metalness: 0.3}
const Y_AXIS = new Vector3(0, 1, 0)


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
 * The telescope's parts from NOIRLab's model, re-hung for the mount: the
 * model is turned about Y by 180° (its tube leans toward +Z, the mount's
 * toward −Z at azimuth 0) and its elevation axis put at the origin, and
 * the elevation structure is turned from the model's pose to the park,
 * the tube along +Y.
 *
 * @param {Object3D} root The loaded model (its scene), with nodes named
 *   `pier`, `azimuth` and `elevation` (build.sh's groups)
 * @param {object} [opts]
 * @param {number} [opts.axisY] MODEL_AXIS_Y
 * @param {number} [opts.poseElDeg] MODEL_POSE_EL_DEG
 * @returns {{pier: Object3D, azimuth: Object3D, tube: Object3D, materials: MeshStandardMaterial[]}}
 *   `pier` to go at the axis's height (newRubinModel leaves it out),
 *   `azimuth` under the azimuth group and `tube` under the elevation
 *   group, both pivoted on the axis
 */
export function assembleTelescope(root, {axisY = MODEL_AXIS_Y, poseElDeg = MODEL_POSE_EL_DEG} = {}) {
  const parts = ['pier', 'azimuth', 'elevation'].map((name) => root.getObjectByName(name))
  if (parts.some((p) => !p)) {
    throw new Error('the telescope model needs pier, azimuth and elevation nodes')
  }
  // Its materials, before the parts leave the root.
  const materials = []
  root.traverse((o) => {
    for (const m of Array.isArray(o.material) ? o.material : (o.material ? [o.material] : [])) {
      if (!materials.includes(m)) {
        materials.push(m)
      }
    }
  })
  const flip = new Quaternion().setFromAxisAngle(Y_AXIS, Math.PI)
  const hang = (part, name) => {
    const node = new Group
    node.name = name
    node.quaternion.copy(flip)
    node.position.y = -axisY
    node.add(part)
    return node
  }
  const pier = hang(parts[0], 'pier')
  const azimuth = hang(parts[1], 'azimuth parts')
  const tube = new Group
  tube.name = 'tube'
  tube.rotation.x = poseElDeg * toRad
  tube.add(hang(parts[2], 'elevation parts'))
  return {pier, azimuth, tube, materials}
}


/**
 * @param {object} deps
 * @param {Function} deps.newWideLineStrip wideLines.js's, handed in (rubin.js)
 * @param {?Function} [deps.loadModel] model.js's; without it the mount is
 *   empty (a test)
 * @returns {{group: Group, azimuth: Object3D, elevation: Object3D, dome: Object3D, shutter: Mesh,
 *   beam: Mesh, seat: Object3D, building: Mesh, materials: MeshStandardMaterial[],
 *   ready: Promise<?object>}} The
 *   model, its moving parts (RubinObservatory.js turns them), the seat on
 *   the elevation structure (SEAT_M), the enclosure (with the dome, the
 *   shell RubinObservatory.setShell hides), every lit
 *   material, for the night glow (the telescope's join the list when it
 *   loads), and the telescope's arrival (assembleTelescope's, or null)
 */
export function newRubinModel({newWideLineStrip, loadModel = null}) {
  const group = new Group
  group.name = 'rubin model'
  const paint = new MeshStandardMaterial(PAINT)
  const domePaint = new MeshStandardMaterial(DOME_PAINT)
  const dark = new MeshStandardMaterial(DARK)
  const materials = [paint, domePaint, dark]

  // The enclosure, sunk a little so a slope doesn't open a gap under it.
  const building = new Mesh(new CylinderGeometry(BUILDING_RADIUS_M, BUILDING_RADIUS_M, BUILDING_HEIGHT_M + 2, SEGMENTS), paint)
  building.position.y = (BUILDING_HEIGHT_M / 2) - 1
  group.add(building)

  // The dome turns with the telescope's azimuth; its shutter slides aside
  // to open (RubinObservatory).
  const dome = new Object3D
  dome.name = 'dome'
  dome.position.y = DOME_CENTRE_M
  dome.add(domeShell(DOME_RADIUS_M, false, domePaint))
  const shutter = domeShell(DOME_RADIUS_M + 0.3, true, dark)
  shutter.name = 'shutter'
  dome.add(shutter)
  group.add(dome)

  // The mount: the azimuth group about +Y at the axis's height, the
  // elevation group about its +X.  Empty until the telescope loads.
  const azimuth = new Object3D
  azimuth.name = 'azimuth'
  azimuth.position.y = AXIS_HEIGHT_M
  const elevation = new Object3D
  elevation.name = 'elevation'
  azimuth.add(elevation)
  group.add(azimuth)

  // The beam out along the pointing, from the tube's top, shown while
  // tracking.
  const beam = newWideLineStrip(new Float32Array([0, MODEL_TUBE_TOP_M, 0, 0, MODEL_TUBE_TOP_M + BEAM_LENGTH_M, 0]),
      {name: 'rubin beam', color: BEAM_COLOR, width: BEAM_WIDTH_PX, opacity: BEAM_OPACITY,
        material: {depthWrite: false, transparent: true}})
  beam.visible = false
  elevation.add(beam)

  // The astronomer's seat, riding the elevation structure.
  const seat = new Object3D
  seat.name = 'seat'
  seat.position.set(SEAT_M.x, SEAT_M.y, SEAT_M.z)
  elevation.add(seat)

  const model = {group, azimuth, elevation, dome, shutter, beam, seat, building, materials, telescope: null, ready: null}
  model.ready = loadModel ?
    loadModel(MODEL_PATH, {doubleSided: true}).then((root) => {
      const parts = assembleTelescope(root)
      // Not the pier: it's inside the enclosure and runs 13 m under the
      // ground, where nothing hides it from a camera on the ground.
      azimuth.add(parts.azimuth)
      elevation.add(parts.tube)
      materials.push(...parts.materials)
      model.telescope = parts
      return parts
    }).catch((err) => {
      console.warn(`Rubin: no telescope model (${MODEL_PATH}): ${err.message}`)
      return null
    }) :
    Promise.resolve(null)
  return model
}
