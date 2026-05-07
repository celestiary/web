import {Quaternion, Vector3} from 'three'
import {CalibrationStore} from './Calibration.js'
import {createPoseSource} from './PoseSource.js'
import {enuToBodyFixedQuat} from './enuFrame.js'
import {worldToLatLngAlt} from '../coords.js'
import * as Shared from '../shared.js'


/** Per-frame slerp factor for sensor-pose smoothing.  See updateFrame(). */
const POSE_SLERP_T = 0.35


/**
 * Top-level orchestrator for the AR sky-view feature.
 *
 * Lifecycle: `enter()` lands the camera on a body (via Scene.land), starts
 * the pose source (may prompt for permissions), and registers a per-frame
 * callback that overrides camera.quaternion with the sensor pose.
 * `exit()` unwinds all of the above.  The render loop in ThreeUI calls
 * `updateFrame()` once per frame, AFTER any other code that touches
 * camera.quaternion (TrackballControls, arrow-key tween, goTo tween) — so
 * the AR pose always wins.
 *
 * Frame chain (when active):
 *
 *   camera.quaternion  =  enu_to_bodyFixed(lat, lng)
 *                       · q_calibration_enu        (optional)
 *                       · q_camera_to_enu          (from PoseSource)
 *
 * The body-fixed → inertial step is delivered by the scene graph: in
 * Scene.land the camera platform is reparented to the *rotating* body
 * Object3D, so the parent's world quaternion already includes axial tilt
 * and sidereal rotation.  See coords.js / Scene.js for the bodyFixed
 * convention.
 *
 * Stage 1 (this commit): black background, no atmosphere, no camera
 * passthrough.  Validates the frame chain.  Stage 2 will add `<video>`
 * passthrough and re-enable the atmosphere with premultiplied-alpha
 * blending.
 */
export default class ARController {
  /**
   * @param {object} deps
   * @param {object} deps.scene  Celestiary Scene instance (must expose enterAR/exitAR)
   * @param {object} deps.ui  ThreeUI instance (provides camera + renderer)
   * @param {object} deps.time  Time instance (so we can switch to real-time on enter)
   * @param {Function} deps.useStore  Zustand store accessor
   * @param {CalibrationStore} [deps.calibrationStore]  Optional override for tests
   * @param {Function} [deps.poseSourceFactory]  Optional async () => PoseSource;
   *   defaults to createPoseSource().  Tests inject a deterministic source.
   */
  constructor({scene, ui, time, useStore, calibrationStore, poseSourceFactory}) {
    this.scene = scene
    this.ui = ui
    this.time = time
    this.useStore = useStore
    this.calibrationStore = calibrationStore ?? new CalibrationStore()
    this._poseSourceFactory = poseSourceFactory ?? createPoseSource
    this._active = false
    this._poseSource = null
    this._body = null
    this._lat = 0
    this._lng = 0
    this._alt = 0
    // First-sample-after-enter snaps to the composed pose; subsequent
    // samples slerp from prior so magnetometer noise on the alpha axis
    // doesn't show up as visible left/right jitter.  See updateFrame().
    this._hasAppliedSample = false
    // Pre-allocated scratch — updateFrame runs every frame.  No per-frame
    // allocations here keeps the pose-update path GC-free.
    this._qCamToEnu = new Quaternion()
    this._qEnuToBody = new Quaternion()
    this._qCalibration = new Quaternion()
    this._qOut = new Quaternion()
    this._scratchVec = new Vector3()
  }


  /** @returns {boolean} */
  isActive() {
    return this._active
  }


  /**
   * Enter AR mode.
   *
   * Order of operations is deliberate:
   *   1. Switch sim-time to real wall-clock and 1× scale, so the sky's
   *      sidereal rotation and planetary ephemerides are accurate at this
   *      very moment.  Done first so step 2's land() places the observer
   *      on a body whose orientation matches reality.
   *   2. Apply the AR scene-visibility preset (atmosphere off, planet
   *      meshes hidden, asterisms + labels on).
   *   3. Construct and start the pose source (may prompt for permissions).
   *
   * If step 3 throws (permissions denied, no sensors), the prior steps
   * are unwound so the user is left in a sensible non-AR state.
   *
   * Camera position / parenting is *not* changed.  AR engages wherever
   * the camera is.  If the user has previously landed on a body's
   * surface (via Scene.land or place-click), the body-fixed → inertial
   * chain is already correct via the scene-graph parenting and AR will
   * align with the local sky.  If the user is in space, sensor pose
   * still drives the camera quaternion, but the celestial-sphere
   * composition won't be aligned to a particular ground frame —
   * by-design tradeoff so AR doesn't silently teleport the user away
   * from the spot they chose.
   *
   * If the camera is already over a body's surface (typical: user
   * clicked a place, then tapped AR), the live camera-derived position
   * wins over `opts.lat / opts.lng` — keeps the math honest about
   * where the user actually is in the simulation, regardless of what
   * geolocation the OS reported.  `opts` is still the fallback for the
   * in-space case.
   *
   * @param {object} opts
   * @param {string} [opts.body]  Defaults to 'earth' — used only for the
   *   ENU→body-fixed math seed when the in-camera fallback fails.
   * @param {number} opts.lat
   * @param {number} opts.lng
   * @param {number} [opts.alt]  Defaults to 2 m (eye-height)
   * @returns {Promise<void>}
   */
  async enter({body = 'earth', lat, lng, alt = 2}) {
    if (this._active) {
      return
    }
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      throw new Error(`ARController.enter: lat/lng required (got ${lat}, ${lng})`)
    }
    // Prefer the camera's actual world-position-on-current-target over the
    // caller-supplied opts when the camera is already over a body's
    // surface (typical: user clicked a place to land, then tapped AR).
    // This makes the ENU→body-fixed math seed match where the user
    // *visually* is, and keeps the HUD's reported observer position
    // honest.  Fall back to opts when no body is targeted (in space).
    const live = this._observerFromCamera()
    if (live !== null) {
      body = live.body
      lat = live.lat
      lng = live.lng
      alt = live.alt
    }
    this._body = body
    this._lat = lat
    this._lng = lng
    this._alt = alt
    this._hasAppliedSample = false
    this._qEnuToBody.copy(enuToBodyFixedQuat(lat, lng))

    // Real-time sim — AR is meaningless if the simulated sky doesn't match
    // wall-clock reality.  Save prior state so exit() can restore.
    this._priorTimeScale = this.time.timeScale
    this._priorTimeScaleSteps = this.time.timeScaleSteps
    this._priorSimTime = this.time.simTime
    this._priorIsPaused = this.time.isPaused
    if (this.time.isPaused) {
      this.time.togglePause()
    }
    this.time.setTimeToNow()

    // Scene visibility preset.
    if (typeof this.scene.enterAR === 'function') {
      this._priorSceneState = this.scene.enterAR()
    }

    // Construct + start the pose source last — it may prompt and reject.
    try {
      this._poseSource = await this._poseSourceFactory()
      await this._poseSource.start()
    } catch (e) {
      // Roll back.  Best-effort: scene state restore + bail out.
      if (this._priorSceneState && typeof this.scene.exitAR === 'function') {
        this.scene.exitAR(this._priorSceneState)
      }
      this._poseSource = null
      throw e
    }

    // Load any persisted calibration for this source / orientation.
    const angle = readScreenAngle()
    const cal = this.calibrationStore.load(this._poseSource.kind, angle)
    if (cal) {
      this._qCalibration.copy(cal)
    } else {
      this._qCalibration.identity()
    }

    this._active = true

    // Publish to the store so the AR HUD can mount its gear icon and
    // status pill.  We write through the slice setter rather than direct
    // mutation so React subscriptions fire.
    const setter = this.useStore?.getState?.()?.setARMode
    if (typeof setter === 'function') {
      setter({
        active: true,
        body, lat, lng, alt,
        sourceKind: this._poseSource.kind,
        needsCalibration: this._poseSource.needsCalibration,
      })
    }
  }


  /** Tear down AR mode and restore prior view state. */
  exit() {
    if (!this._active) {
      return
    }
    if (this._poseSource) {
      this._poseSource.stop()
      this._poseSource = null
    }
    if (this._priorSceneState && typeof this.scene.exitAR === 'function') {
      this.scene.exitAR(this._priorSceneState)
      this._priorSceneState = null
    }
    // Restore time state if we changed it.
    if (this._priorTimeScale !== undefined) {
      this.time.timeScale = this._priorTimeScale
      this.time.timeScaleSteps = this._priorTimeScaleSteps
      // Don't roll back simTime — the user may want the sim to keep
      // running from "now".  Restoring it would teleport them backwards
      // unexpectedly.
      if (this._priorIsPaused) {
        this.time.togglePause()
      }
    }
    this._active = false
    const setter = this.useStore?.getState?.()?.setARMode
    if (typeof setter === 'function') {
      setter({active: false})
    }
  }


  /**
   * Per-frame update.  No-op when AR is inactive or the pose source has
   * not yet delivered a sample.  When active, slerps camera.quaternion
   * toward the composed AR pose — this must be called AFTER any other
   * per-frame code that touches camera.quaternion, so the AR pose wins.
   *
   * Slerp factor (`POSE_SLERP_T`): the magnetometer-fused alpha axis on
   * `deviceorientationabsolute` is noisy on most phones, especially
   * indoors and before the figure-8 calibration dance — snapping to it
   * raw produces visible left/right jitter.  At 60fps a slerp of 0.35
   * settles in ~3 frames (~50ms), which is below the perceptual lag
   * threshold but kills the jitter.  A 1-Euro filter would be better
   * for stage 2 (camera passthrough) where every ms of lag is
   * registered against the live video; for stage 1 sky-only this is
   * plenty.
   */
  updateFrame() {
    if (!this._active || !this._poseSource) {
      return
    }
    if (!this._poseSource.getQuaternion(this._qCamToEnu)) {
      return // no sample yet
    }
    // camera.quaternion = enu_to_bodyFixed · q_calibration · q_cam_to_enu
    this._qOut.copy(this._qEnuToBody).multiply(this._qCalibration).multiply(this._qCamToEnu)
    // First sample of this AR session: snap, so the camera lands on the
    // sensor pose immediately rather than tweening from the prior view.
    // Subsequent samples slerp toward target — see POSE_SLERP_T.
    const t = this._hasAppliedSample ? POSE_SLERP_T : 1.0
    this.ui.camera.quaternion.slerp(this._qOut, t)
    this._hasAppliedSample = true
  }


  /**
   * Capture a one-shot calibration sample.  Called by the AR HUD's gear
   * icon.  The caller supplies the *true* direction (in ENU coords at
   * the observer's location) to a known reference body — Polaris, Sun,
   * Sirius, etc.  The current sensor reading provides the device's idea
   * of where the camera is currently aimed; the difference is the bias
   * we save.
   *
   * @param {Vector3} trueDirEnu  Unit vector, true direction in ENU
   */
  captureCalibration(trueDirEnu) {
    if (!this._active || !this._poseSource) {
      return
    }
    if (!this._poseSource.getQuaternion(this._qCamToEnu)) {
      return
    }
    // Camera-forward in screen frame is (0, 0, −1) (Three.js convention).
    // Apply current sensor pose to get the device-aimed direction in ENU.
    const deviceAim = this._scratchVec.set(0, 0, -1).applyQuaternion(this._qCamToEnu)
    this._qCalibration.setFromUnitVectors(deviceAim, trueDirEnu)
    const angle = readScreenAngle()
    this.calibrationStore.save(this._poseSource.kind, angle, this._qCalibration)
  }


  /**
   * Forward an alpha-axis damping preset change to the active pose source.
   * No-op when AR isn't running (preset will be applied on next enter).
   *
   * @param {string} name  One of `getAlphaDampingNames()`
   */
  setAlphaDamping(name) {
    if (this._poseSource && typeof this._poseSource.setAlphaDamping === 'function') {
      this._poseSource.setAlphaDamping(name)
    }
  }


  /** Reset calibration to identity and clear persistent storage. */
  clearCalibration() {
    this._qCalibration.identity()
    if (this._poseSource) {
      const angle = readScreenAngle()
      this.calibrationStore.clear(this._poseSource.kind, angle)
    }
  }


  /**
   * If the camera is currently sitting over a body with a known radius,
   * return the body's name + lat/lng/alt derived from the camera's
   * world position.  Returns null when no such body is targeted (e.g.
   * the user is looking at a star or empty space) — caller falls back
   * to whatever lat/lng the AR-entry call supplied.
   *
   * @returns {?{body: string, lat: number, lng: number, alt: number}}
   */
  _observerFromCamera() {
    const cur = Shared?.targets?.cur
    const props = cur?.props
    if (!props || !props.name || !props.radius || !props.radius.scalar) {
      return null
    }
    if (props.spectralType !== undefined) {
      // Star — body-fixed math doesn't make sense (no surface to stand on).
      return null
    }
    if (!this.ui?.camera || !cur.getWorldQuaternion || !cur.getWorldPosition) {
      return null
    }
    const camWorld = this._scratchVec.set(0, 0, 0)
    const planetWorld = new Vector3()
    const planetWorldQuat = new Quaternion()
    this.ui.camera.getWorldPosition(camWorld)
    cur.getWorldPosition(planetWorld)
    cur.getWorldQuaternion(planetWorldQuat)
    const {lat, lng, alt} = worldToLatLngAlt(camWorld, planetWorld, planetWorldQuat, props.radius.scalar)
    return {body: props.name, lat, lng, alt}
  }


  /**
   * @returns {?{kind: string, needsCalibration: boolean, lat: number, lng: number}}
   *   null when AR is inactive
   */
  getStatus() {
    if (!this._active || !this._poseSource) {
      return null
    }
    return {
      kind: this._poseSource.kind,
      needsCalibration: this._poseSource.needsCalibration,
      lat: this._lat,
      lng: this._lng,
    }
  }


  /**
   * Snapshot for the AR debug HUD.  Always safe to call; returns an
   * `active: false` payload when AR is not running.  Includes the raw
   * sensor sample so we can tell at a glance whether the browser is
   * delivering DeviceOrientationEvents at all (the most common failure
   * mode is a permissions / secure-context issue that leaves the
   * listener attached but events never firing).
   *
   * @returns {object}
   */
  getDebugSnapshot() {
    const screenAngle = readScreenAngle()
    if (!this._active) {
      return {active: false, screenAngle}
    }
    const poseSrc = this._poseSource?.getDebugSnapshot?.() ?? {kind: this._poseSource?.kind ?? null}
    const cam = this.ui?.camera
    const camQuat = cam ? {
      x: round3(cam.quaternion.x),
      y: round3(cam.quaternion.y),
      z: round3(cam.quaternion.z),
      w: round3(cam.quaternion.w),
    } : null
    // Renderer-state cross-checks: the AR-mode preset is supposed to gate
    // the atmosphere post-pass (`uAtmEnabled = 0`).  If the user reports
    // atmosphere colors leaking through, surface the live values so we can
    // tell whether _arMode got cleared or the gate isn't taking effect.
    const arMode = this.ui?._arMode === true
    const atmMesh = this.ui?._atmMesh
    const uAtmEnabled = atmMesh?.material?.uniforms?.uAtmEnabled?.value ?? null
    return {
      active: true,
      body: this._body,
      lat: this._lat,
      lng: this._lng,
      screenAngle,
      poseSrc,
      camQuat,
      arMode,
      uAtmEnabled,
    }
  }
}


/**
 * @param {number} v
 * @returns {number} v rounded to 3 decimal places
 */
function round3(v) {
  return Math.round(v * 1000) / 1000
}


/** @returns {number} screen.orientation.angle in degrees, 0 if unavailable */
function readScreenAngle() {
  if (typeof screen !== 'undefined' && screen.orientation && typeof screen.orientation.angle === 'number') {
    return screen.orientation.angle
  }
  if (typeof window !== 'undefined' && typeof window.orientation === 'number') {
    return window.orientation
  }
  return 0
}
