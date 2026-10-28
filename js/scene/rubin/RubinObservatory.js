import {Group, Quaternion, Vector3} from 'three'
import {newRubinModel} from './rubinModel.js'
import {SITE, localFrameQuaternion, pointingState} from './rubin.js'


// The Rubin Observatory on Earth's ground (Rubin.md): the model at Cerro
// Pachón in the local frame there, a child of Earth's spun node so it turns
// with the Earth, its telescope and dome turned each frame to follow a body
// in the sky while it can be observed, parked with the dome shut when it
// can't.

/**
 * The night glow, in exposure units over Earth's keyed exposure: a
 * tenth of a city's lights (HDR.md, 3e-5 of a sunlit white), standing in for the
 * moonlight and sky glow the scene doesn't cast on it.  Without it the
 * observatory is a black cut-out at night, as every unlit surface is; at a
 * city's level it was a white blob at the dark-adapted gain (1e5, where
 * the lights show at 231-240 of 255).
 */
export const NIGHT_GLOW = 3e-6
/** The terrain under the site is asked for this often, ms: finer tiles refine it. */
const GROUND_POLL_MS = 1000
/** A height this near the last is the same ground, metres. */
const GROUND_SAME_M = 0.5
const tmpWorld = new Vector3
const tmpBody = new Vector3
const tmpSun = new Vector3
const tmpQuat = new Quaternion


/** */
export default class RubinObservatory extends Group {
  /**
   * @param {object} opts
   * @param {object} opts.earth Earth's spun node (scene.objects.earth), the parent
   * @param {() => ?object} opts.body The body followed (its node), or null
   *   until the scene has it
   * @param {(lat: number, lng: number) => ?number} [opts.groundHeight] The
   *   terrain's height at the site over Earth's sphere, metres, when a Cesium
   *   layer knows it; null otherwise (CesiumLayers.groundHeightAt)
   * @param {() => number} [opts.exposure] The target-keyed exposure, for the glow
   * @param {() => number} [opts.nowMs] The wall clock, for the ground poll
   * @param {object} opts.deps The first load's functions, handed in
   *   (install.js): `latLngAltToBodyFixed` (coords.js) and, for the model,
   *   `newWideLineStrip` (wideLines.js)
   * @param {object} [opts.site] SITE's shape, for a test
   * @param {Function} [opts.newModel] rubinModel.js newRubinModel, or a stub
   */
  constructor({earth, body, deps, groundHeight = () => null, exposure = () => 1, nowMs = () => performance.now(),
    site = SITE, newModel = newRubinModel}) {
    super()
    this.deps = deps
    this.name = 'rubin'
    this.earth = earth
    this.bodyOf = body
    this.groundHeight = groundHeight
    this.exposure = exposure
    this.nowMs = nowMs
    this.site = site
    this.radius = earth.props.radius.scalar
    this.model = newModel(deps)
    this.add(this.model.group)
    // Where the ground is: the site's own height until a layer knows the
    // terrain's (placeAt), refined as finer tiles come in.
    this.groundKnown = false
    this.altitude = site.alt
    this.placeAt(site.alt)
    this._groundAskedMs = -Infinity
    // The last frame's pointing (pointingState), for the app's readout.
    this.state = null
    // Each frame, before the bodies move (Animation.animateSystem).
    this.preAnimCb = () => this.update()
    earth.add(this)
  }


  /**
   * Put the observatory on the ground at the site: the local frame there
   * (+X east, +Y up, −Z north), at a height over Earth's sphere.
   *
   * @param {number} alt Metres over the sphere
   */
  placeAt(alt) {
    const {lat, lng} = this.site
    this.altitude = alt
    this.position.copy(this.deps.latLngAltToBodyFixed(lat, lng, alt, this.radius))
    localFrameQuaternion(lat, lng, this.quaternion)
  }


  /** A frame: the ground, the glow, the pointing. */
  update() {
    this._followGround()
    this._glow()
    const body = this.bodyOf()
    if (!body) {
      this.state = null
      return
    }
    // Directions from the site in its local frame: the body's, and the
    // Sun's, at the world origin.
    this.getWorldPosition(tmpWorld)
    this.getWorldQuaternion(tmpQuat).invert()
    body.getWorldPosition(tmpBody).sub(tmpWorld).applyQuaternion(tmpQuat)
    tmpSun.copy(tmpWorld).negate().applyQuaternion(tmpQuat)
    const state = pointingState(tmpBody, tmpSun)
    this.state = state
    const {azimuth, elevation, dome, shutter, beam} = this.model
    azimuth.rotation.y = state.azimuthY
    dome.rotation.y = state.azimuthY
    elevation.rotation.x = state.elevationX
    shutter.visible = !state.open
    beam.visible = state.tracking
  }


  /**
   * Take the terrain's height under the site when a Cesium layer knows it,
   * asking about once a second: the first answer may be a coarse tile's,
   * and finer ones refine it as the camera arrives.
   */
  _followGround() {
    const now = this.nowMs()
    if (now - this._groundAskedMs < GROUND_POLL_MS) {
      return
    }
    this._groundAskedMs = now
    const height = this.groundHeight(this.site.lat, this.site.lng)
    if (Number.isFinite(height) && (!this.groundKnown || Math.abs(height - this.altitude) > GROUND_SAME_M)) {
      this.groundKnown = true
      this.placeAt(height)
    }
  }


  /** The faint glow that shows the building at night, in exposure units at the keyed exposure. */
  _glow() {
    const exposure = this.exposure()
    if (!(exposure > 0)) {
      return
    }
    const intensity = NIGHT_GLOW / exposure
    for (const m of this.model.materials) {
      m.emissive.copy(m.color)
      m.emissiveIntensity = intensity
    }
  }


  /** @returns {Vector3} The dome's centre, world space */
  domeWorldPosition(out = new Vector3) {
    return this.localToWorld(out.copy(this.model.dome.position))
  }


  /** Out of the scene. */
  dispose() {
    this.removeFromParent()
    this.model.group.traverse((o) => {
      o.geometry?.dispose?.()
    })
    for (const m of this.model.materials) {
      m.dispose()
    }
    this.model.beam.material?.dispose?.()
  }
}

