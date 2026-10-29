import {Group, MeshBasicMaterial, Quaternion, Vector3} from 'three'
import {SHUTTER_SLIDE_RAD, newRubinModel} from './rubinModel.js'
import {SITE, altAz, localFrameQuaternion, pointingState} from './rubin.js'


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
/** The shutter's slide eases with this time constant, wall clock, s. */
const SHUTTER_SECONDS = 2
/**
 * The Sun's light leaves the model once the Sun is this far below the
 * horizon (degrees): three's point light doesn't know the Earth is in the
 * way, and lit the pier's underside and the shutter from below at
 * midnight, and a lit material can't be made dark (its Fresnel goes to
 * white at a grazing angle whatever its colour: the enclosure's rim was a
 * white slab at the dark gain), so by night every mesh wears an unlit
 * twin of its material instead.
 */
const SUNSET_DEG = -1
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
   *   `newWideLineStrip` (wideLines.js) and `loadModel` (model.js)
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
    this._lastMs = null
    // The unlit twins of the model's materials, for the night (_light), by
    // the lit material; and the meshes, gathered again when the telescope
    // arrives.
    this._twins = new Map
    this._meshes = null
    this._night = null
    this.model.ready?.then(() => {
      this._meshes = null
    })
    // The shutter: 0 shut, 1 slid aside; it eases toward the pointing's.
    this.shutterSlide = 0
    // The last frame's pointing (pointingState), for the app's readout.
    this.state = null
    // The shell: the enclosure and the dome, which setShell hides to show
    // the telescope from outside.
    this.shell = true
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


  /** A frame: the ground, the glow, the pointing, the shutter. */
  update() {
    const now = this.nowMs()
    const dt = this._lastMs === null ? 0 : (now - this._lastMs) / 1e3
    this._lastMs = now
    this._followGround()
    // Directions from the site in its local frame: the Sun's, at the world
    // origin, and the body's.
    this.getWorldPosition(tmpWorld)
    this.getWorldQuaternion(tmpQuat).invert()
    tmpSun.copy(tmpWorld).negate().applyQuaternion(tmpQuat)
    const body = this.bodyOf()
    if (!body) {
      this.state = null
      this._light(altAz(tmpSun).el)
      this._slideShutter(0, dt)
      return
    }
    body.getWorldPosition(tmpBody).sub(tmpWorld).applyQuaternion(tmpQuat)
    const state = pointingState(tmpBody, tmpSun)
    this.state = state
    this._light(state.sunEl)
    const {azimuth, elevation, dome, beam} = this.model
    azimuth.rotation.y = state.azimuthY
    dome.rotation.y = state.azimuthY
    elevation.rotation.x = state.elevationX
    beam.visible = state.tracking
    this._slideShutter(state.open ? 1 : 0, dt)
  }


  /**
   * Slide the shutter toward open (1) or shut (0), eased on the wall clock.
   *
   * @param {number} target
   * @param {number} dt Seconds since the last frame
   */
  _slideShutter(target, dt) {
    this.shutterSlide += (target - this.shutterSlide) * (1 - Math.exp(-dt / SHUTTER_SECONDS))
    if (Math.abs(target - this.shutterSlide) < 1e-3) {
      this.shutterSlide = target
    }
    // The shutter's rest is over the slit (rubinModel.js domeShell).
    this.model.shutter.rotation.y = (-Math.PI / 2) + (this.shutterSlide * SHUTTER_SLIDE_RAD)
  }


  /**
   * Take the terrain's height under the site when a Cesium layer knows it,
   * asking about once a second: the first answer may be a coarse tile's,
   * and finer ones refine it as the camera arrives.
   */
  _followGround() {
    const now = this._lastMs
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


  /**
   * The materials by the Sun's altitude: the model's own, lit by the Sun,
   * while it's up; by night an unlit twin of each (MeshBasicMaterial, the
   * same colour and side), glowing faintly in exposure units at the keyed
   * exposure, so the metered gain brings the building up as it brings up
   * the stars.  The swap is per mesh, once at each sunset and sunrise.
   *
   * @param {number} sunEl Degrees
   */
  _light(sunEl) {
    const night = sunEl < SUNSET_DEG
    if (this._meshes === null || night !== this._night) {
      this._meshes = []
      this.model.group.traverse((o) => {
        if (o.isMesh && (o.material?.isMeshStandardMaterial || o.material?.userData.lit)) {
          this._meshes.push(o)
        }
      })
      for (const mesh of this._meshes) {
        mesh.material = night ? this._twinOf(mesh.material) : (mesh.material.userData.lit ?? mesh.material)
      }
      this._night = night
    }
    if (!night) {
      return
    }
    const exposure = this.exposure()
    const intensity = exposure > 0 ? NIGHT_GLOW / exposure : 0
    for (const twin of this._twins.values()) {
      twin.color.copy(twin.userData.lit.color).multiplyScalar(intensity)
    }
  }


  /**
   * @param {object} material A lit material, or a twin
   * @returns {MeshBasicMaterial} Its unlit twin, made once
   */
  _twinOf(material) {
    const lit = material.userData.lit ?? material
    let twin = this._twins.get(lit)
    if (!twin) {
      twin = new MeshBasicMaterial({color: lit.color, side: lit.side})
      twin.userData.lit = lit
      this._twins.set(lit, twin)
    }
    return twin
  }


  /** @returns {object} The astronomer's seat, an Object3D on the elevation structure (rubinModel.js SEAT_M), for Scene.rideSeat */
  get seat() {
    return this.model.seat
  }


  /**
   * Show or hide the shell, the enclosure and its dome, leaving the
   * telescope on its mount in the open: the app's switch (Rubin.md).
   *
   * @param {boolean} on
   */
  setShell(on) {
    this.shell = Boolean(on)
    this.model.building.visible = this.shell
    this.model.dome.visible = this.shell
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
    for (const twin of this._twins.values()) {
      twin.dispose()
    }
    this.model.beam.material?.dispose?.()
  }
}

