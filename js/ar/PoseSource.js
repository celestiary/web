/**
 * Pose-source contract.  Concrete classes (NullPoseSource,
 * DeviceOrientationPoseSource, WebXRPoseSource) implement this shape.
 * No formal interface — JS doesn't enforce it — but every method here
 * must exist on every implementation so ARController can swap them.
 *
 * Every pose returned is a Three.js Quaternion that maps **camera-frame**
 * vectors to **ENU-frame** vectors, where:
 *   - Camera frame matches the user's screen-up after correction for
 *     screen.orientation.angle, and looks out the *back* of the phone
 *     (Three.js camera "forward" = camera −Z).
 *   - ENU frame = +X East, +Y North, +Z Up at the observer's location.
 *
 * The bodyFixed→ENU step (via enuToBodyFixedQuat at observer's lat/lng)
 * and the inertial→bodyFixed step (via the rotating-body parent) are
 * applied by ARController, not the source.
 *
 * Method shape (per implementation):
 *   - kind: string, one of 'null' | 'deviceorientation' | 'webxr'
 *   - needsCalibration: boolean  hint for the AR HUD's calibration gear
 *   - start(): Promise<void>     request permissions, attach listeners
 *   - stop(): void               detach listeners; safe when not started
 *   - getQuaternion(out): boolean  write camera→ENU into a pre-alloced
 *                                  Three.js Quaternion; false until ready
 *   - getStatus(): {fresh: boolean, source: string}  UX hint
 */


/**
 * Probe available sensor APIs and return the best PoseSource for this device.
 * Order of preference:
 *   1. WebXR immersive-ar with viewer reference space (Stage 1b — not yet wired)
 *   2. DeviceOrientationEvent (covers iOS Safari + most Android)
 *   3. Null fallback (desktop / no sensors)
 *
 * The factory is intentionally async so future WebXR probes
 * (`navigator.xr.isSessionSupported`) can run without blocking module load.
 *
 * @returns {Promise<object>} a PoseSource (see top-of-file contract)
 */
export async function createPoseSource() {
  // Stage 1b will probe navigator.xr here.  Stage 1a uses the
  // DeviceOrientation path on every mobile device, which is the floor we
  // need anyway because iOS Safari has no WebXR.
  const {default: WebXRPoseSource} = await import('./WebXRPoseSource.js')
  if (await WebXRPoseSource.isSupported()) {
    return new WebXRPoseSource()
  }
  if (typeof window !== 'undefined' && 'DeviceOrientationEvent' in window) {
    const {default: DeviceOrientationPoseSource} = await import('./DeviceOrientationPoseSource.js')
    return new DeviceOrientationPoseSource()
  }
  const {default: NullPoseSource} = await import('./NullPoseSource.js')
  return new NullPoseSource()
}
