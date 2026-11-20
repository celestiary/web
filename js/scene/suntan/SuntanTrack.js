import {Group, Object3D} from 'three'
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
      this.nodes[id] = node
    }
    if (layer !== null) {
      this.traverse((o) => o.layers.set(layer))
    }
    this._at = new Float32Array(3)
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
    const relay = this.mission.stateAt(t, 'relay')
    const lander = this.mission.stateAt(t, 'lander')
    const separate = lander !== null && lander.leg.vehicle === 'lander'
    this._mark(this.relay, relay)
    this._mark(this.lander, separate ? lander : null)
    // The lander's node is the stack's until release, so a go to it before
    // then arrives at the relay it rides on.
    this._placeNode(this.nodes.relay, relay)
    this._placeNode(this.nodes.lander, lander)
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
    toScene(state.r, this._at, 0)
    const attr = rings.geometry.getAttribute('position')
    attr.setXYZ(0, ...this._at)
    attr.needsUpdate = true
    const labels = rings.label.sheet.positionAttribute
    if (labels) {
      labels.setXYZ(0, ...this._at)
      labels.needsUpdate = true
    }
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
