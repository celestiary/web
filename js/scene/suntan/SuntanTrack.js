import {Group, Object3D} from 'three'
import {craftQuaternion} from './craftModel.js'
import {sampleTimes} from './kepler.js'


// The Suntan mission drawn (Suntan.md): one line per leg, and the relay and
// the lander where they are at the clock's time, each a ring and its name.
// The two are one stack until the lander's release, so the lander's mark
// shows only after it.  Heliocentric, under the Sun's node; ecliptic of date,
// the scene's frame, turned to the scene's axes (x, z, −y), as CraftTrack.

const WIDTH = 1.5
const OPACITY = 0.9
// Per leg drawn; even in eccentric anomaly, so the perihelia are smooth.
const SEGMENTS = 720
const UNIX_EPOCH_JD = 2440587.5
const DAY = 86400
// How far from a craft a go to it arrives (Scene.goTo): the craft is a
// point, so near enough to see the paths bend round it, far enough that
// at the photosphere the Sun doesn't fill the view.
const CRAFT_ARRIVAL_M = 3e9
// The craft's size for the zoom (zoom.js homeBody), metres: about the flight
// system's half-length in design/suntan/cad/ (11.7 m long).  The camera then
// eases in to a few metres from the mark.
const CRAFT_RADIUS_M = 6

/** The craft as targets (Scene.setTarget's `{kind: 'craft'}`), by id. */
export const SUNTAN_CRAFT = Object.freeze({
  relay: Object.freeze({kind: 'craft', id: 'relay', name: 'Suntan relay', body: 'sun'}),
  lander: Object.freeze({kind: 'craft', id: 'lander', name: 'Suntan lander', body: 'sun'}),
})

/** Colours by leg, then by phase. */
export const SUNTAN_COLORS = Object.freeze({
  psp: 0xd08040,
  transfer: 0xffe040,
  sync: 0x40ff90,
  relay: 0x40ff90,
  descent: 0xff4060,
})


/** */
export default class SuntanTrack extends Group {
  /**
   * @param {object} mission buildMission's
   * @param {object} deps The first load's helpers (Scene.getSuntan):
   *   newWideLineStrip, newRings, newLabels
   * @param {number} [layer]
   */
  constructor(mission, deps, layer = null) {
    super()
    this.name = 'suntan'
    this.mission = mission
    this.paths = new Group()
    this.paths.name = 'suntan.paths'
    for (const leg of mission.legs) {
      const color = SUNTAN_COLORS[leg.id] ?? SUNTAN_COLORS[leg.phase]
      if (leg.id === 'surface' || color === undefined) {
        continue
      }
      const t1 = Number.isFinite(leg.t1) ? leg.t1 : leg.t0 + leg.orbit.period
      const times = sampleTimes(leg.orbit, leg.t0, t1, SEGMENTS)
      const points = new Float32Array(times.length * 3)
      times.forEach((t, i) => toScene(leg.stateAt(t).r, points, 3 * i))
      this.paths.add(deps.newWideLineStrip(points, {name: `suntan.${leg.id}`, color, width: WIDTH, opacity: OPACITY}))
    }
    this.relay = deps.newRings(SUNTAN_COLORS.relay, 1)
    this.relay.name = 'suntan.relay'
    this.lander = deps.newRings(SUNTAN_COLORS.descent, 1)
    this.lander.name = 'suntan.lander'
    // A sheet each, so each name hides with its mark.
    this.relay.label = deps.newLabels([{text: 'Suntan relay', color: SUNTAN_COLORS.relay}])
    this.lander.label = deps.newLabels([{text: 'Suntan lander', color: SUNTAN_COLORS.descent}])
    this.add(this.paths, this.relay, this.lander, this.relay.label.sprites, this.lander.label.sprites)
    // Each craft's node, where it is at the clock's time, for a go to it
    // and for riding it (Scene._craftNode, goTo): the camera's platform
    // hangs on it as on a satellite's.  Not in this group, whose visibility
    // the orbits (`o`) and the panel switch: install.js puts them under
    // the Sun beside it.
    this.nodes = {}
    for (const id of Object.keys(SUNTAN_CRAFT)) {
      const node = new Object3D()
      node.name = `suntan.${id}.node`
      node.arrivalDistance = CRAFT_ARRIVAL_M
      node.inFlight = false
      // Riding it, the zoom and the ground floor are about the craft, not
      // the Sun (zoom.js homeBody).
      node.isCraftNode = true
      node.props = {name: SUNTAN_CRAFT[id].name, radius: {scalar: CRAFT_RADIUS_M}}
      this.nodes[id] = node
    }
    if (layer !== null) {
      this.traverse((o) => o.layers.set(layer))
    }
    // Animation calls this with the frame's Julian Day (UTC).
    this.preAnimCb = (time, jd) => this.place((jd - UNIX_EPOCH_JD) * DAY)
    this.place(mission.tStart - 1)
  }


  /**
   * The marks where the craft are at a time; hidden before launch, and the
   * lander's until it's released.
   *
   * @param {number} t Unix seconds
   */
  place(t) {
    this._lastT = t
    const relay = this.mission.stateAt(t, 'relay')
    const lander = this.mission.stateAt(t, 'lander')
    const separate = lander !== null && lander.leg.vehicle === 'lander'
    this._mark(this.relay, relay)
    this._mark(this.lander, separate ? lander : null)
    // The lander's node is the stack's until release, so a go to it before
    // then arrives at the relay it rides on.
    this._placeNode(this.nodes.relay, relay)
    this._placeNode(this.nodes.lander, lander)
    // The models (craftModel.js), once loaded: the stack on the relay, with
    // its rim lander until the copy on the lander's node flies off.
    if (this.models) {
      const {relay: relayModel, lander: landerModel, released} = this.models
      this._orient(relayModel, relay)
      if (landerModel) {
        this._orient(landerModel, separate ? lander : null)
      }
      if (released) {
        released.visible = !separate
      }
    }
  }


  /**
   * Put the flight system's models on the craft (install.js, once the GLB
   * is in), and size each craft for the zoom by its model (zoom.js
   * homeBody), where the nodes had a stand-in.
   *
   * @param {{relay: object, lander: ?object, released: ?object}} models
   *   craftModel.js prepareCraftModels'
   */
  attachModels(models) {
    this.models = models
    this.nodes.relay.add(models.relay)
    this.nodes.relay.props.radius.scalar = models.relay.radius
    if (models.lander) {
      this.nodes.lander.add(models.lander)
      this.nodes.lander.props.radius.scalar = models.lander.radius
    }
    this.place(this._lastT ?? this.mission.tStart - 1)
  }


  /**
   * @param {object} model A centred model group
   * @param {?object} state mission.stateAt's; null hides it
   */
  _orient(model, state) {
    model.visible = state !== null
    if (state) {
      const {r, v} = state
      craftQuaternion([r[0], r[2], -r[1]], [v[0], v[2], -v[1]], model.quaternion)
    }
  }


  /**
   * @param {object} node One of this.nodes
   * @param {?object} state mission.stateAt's; null before launch
   */
  _placeNode(node, state) {
    node.inFlight = state !== null
    if (state) {
      node.position.set(state.r[0], state.r[2], -state.r[1])
    }
  }


  /**
   * @param {object} rings newRings', with its label
   * @param {?object} state mission.stateAt's
   */
  _mark(rings, state) {
    rings.visible = state !== null
    rings.label.sprites.visible = state !== null
    if (!state) {
      return
    }
    // The place goes in the objects' positions, which stay doubles until
    // three takes the camera's out of them (modelViewMatrix), and the one
    // vertex each stays at the origin.  As a vertex, a float32 at the
    // relay's 2.5e10 m from the Sun is good to only 2 km, so the mark and
    // its name jumped about the steady model as the camera closed in.
    rings.position.set(state.r[0], state.r[2], -state.r[1])
    rings.label.sprites.position.copy(rings.position)
  }


  /** Free the GPU buffers, and take the craft's nodes out of the scene. */
  dispose() {
    this.traverse((o) => {
      o.geometry?.dispose()
      o.material?.dispose()
    })
    this.removeFromParent()
    for (const node of Object.values(this.nodes)) {
      node.removeFromParent()
    }
  }
}


/**
 * Ecliptic metres to scene axes, (x, z, −y), as DESIGN.md "Frames and time".
 *
 * @param {Array<number>} r
 * @param {Float32Array} out
 * @param {number} offset
 */
function toScene(r, out, offset) {
  out[offset] = r[0]
  out[offset + 1] = r[2]
  out[offset + 2] = -r[1]
}
