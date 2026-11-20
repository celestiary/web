import {Matrix4, Quaternion} from 'three'


// The sky guest's view (design/SkyGuest.md): a host's camera, given as a
// rotation in Earth's equator of date (+X the equinox, +Z the north pole)
// and a projection, as celestiary's camera landed on Earth; the Sun's
// altitude there; and the exposure celestiary's meter settles on for it.
// Pure, so the tests drive it in bun.


const DEG = Math.PI / 180
const RX_MINUS_90 = new Quaternion().setFromAxisAngle({x: 1, y: 0, z: 0}, -Math.PI / 2)


/**
 * The landed camera's quaternion, relative to Earth's body-fixed frame
 * (its spun node: +Y the pole, +X Greenwich, east toward −Z), for a host
 * view.  The view matrix takes the equator of date to the eye; the
 * equator frame is Rx(−90°) from Earth's tilt frame (as sgp4.js
 * temeToEquator), and the body-fixed frame is the tilt frame turned by
 * GMST about +Y (Animation): body = Ry(−GMST) · Rx(−90°) · equator.
 *
 * @param {Array<number>} viewMatrix column-major, equator of date → eye (a rotation)
 * @param {number} gmst radians, at the view's time
 * @param {Quaternion} [out]
 * @returns {Quaternion} out
 */
export function landedQuaternion(viewMatrix, gmst, out = new Quaternion) {
  // The eye's axes in the equator frame: the view's rotation, transposed.
  const eyeToEq = new Quaternion().setFromRotationMatrix(new Matrix4().fromArray(viewMatrix)).invert()
  const spin = new Quaternion().setFromAxisAngle({x: 0, y: 1, z: 0}, -gmst)
  return out.copy(spin).multiply(RX_MINUS_90).multiply(eyeToEq)
}


/**
 * A symmetric perspective's vertical field and aspect.
 *
 * @param {Array<number>} projectionMatrix column-major
 * @returns {{fov: number, aspect: number}} degrees, and width over height
 */
export function fieldOf(projectionMatrix) {
  const p0 = projectionMatrix[0]
  const p5 = projectionMatrix[5]
  return {fov: 2 * Math.atan(1 / p5) / DEG, aspect: p5 / p0}
}


/**
 * The Sun's altitude, degrees, from the low-precision almanac formula (to
 * about 0.01° over centuries): enough to pick an exposure.
 *
 * @param {number} timeMs Unix ms, UTC
 * @param {number} lat degrees
 * @param {number} lon degrees, east
 * @returns {number}
 */
export function sunAltitude(timeMs, lat, lon) {
  const n = (timeMs / 86400000) + 2440587.5 - 2451545.0
  const L = (280.460 + (0.9856474 * n)) * DEG
  const g = (357.528 + (0.9856003 * n)) * DEG
  const lambda = L + (((1.915 * Math.sin(g)) + (0.020 * Math.sin(2 * g))) * DEG)
  const eps = (23.439 - (4e-7 * n)) * DEG
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda))
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda))
  const gmst = (280.46061837 + (360.98564736629 * n)) * DEG
  const h = gmst + (lon * DEG) - ra
  const phi = lat * DEG
  return Math.asin((Math.sin(phi) * Math.sin(dec)) + (Math.cos(phi) * Math.cos(dec) * Math.cos(h))) / DEG
}


/**
 * What celestiary's meter settles on, landed on Earth at 55.6° N looking
 * south 20° up, by the Sun's altitude: the meter's gain over the keyed
 * exposure, read from the metered sky guest on its check host (headless,
 * 2026-11-02; the app itself gave the same within 15%).  A guest that
 * doesn't draw on its shadow can't meter: it takes the gain from here.
 */
export const METERED_GAIN = Object.freeze([
  [19.5, 1], [5.1, 1], [-0.4, 3.7], [-4.3, 19.9], [-8.3, 336], [-12.5, 22700], [-18.8, 239000], [-44.7, 373000],
])


/**
 * The meter's gain for the Sun's altitude, interpolated in its logarithm.
 *
 * @param {number} alt degrees
 * @returns {number}
 */
export function skyGain(alt) {
  const t = METERED_GAIN
  if (alt >= t[0][0]) {
    return t[0][1]
  }
  for (let i = 1; i < t.length; i++) {
    const [a1, g1] = t[i]
    if (alt >= a1) {
      const [a0, g0] = t[i - 1]
      const f = (alt - a0) / (a1 - a0)
      return Math.exp(Math.log(g0) + (f * (Math.log(g1) - Math.log(g0))))
    }
  }
  return t[t.length - 1][1]
}


/**
 * Whether the sky guest's shadow draws into a target (sky.js meterOnly):
 * the scene buffer on the frames the meter samples, the screen never, any
 * other target (the caches read again later, the metering target) always.
 *
 * @param {?object} target the render target bound, null for the screen
 * @param {?object} sceneTarget the scene buffer (ThreeUi._sceneRT)
 * @param {boolean} meterFrame whether the meter samples the frame under way
 * @returns {boolean} whether draws to the target run on the shadow
 */
export function shadowDrawsFor(target, sceneTarget, meterFrame) {
  if (!target) {
    return false
  }
  return target !== sceneTarget || meterFrame
}
