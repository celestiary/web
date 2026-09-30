// Vector3 is imported for the JSDoc type only.
import {Object3D, Vector3} from 'three'
import {J2000_JD, precessionQuaternion, utcToTtJulianDay} from './celestialFrame.js'


// Precession is ~50.3″ a year, 0.14″ a day: the frame is rebuilt when the
// date moves by more than this, so it lags the date by at most ~0.14″.
export const STELLAR_FRAME_EPSILON_DAYS = 1


/**
 * The parent group of everything placed from J2000 catalogues: the star
 * field, its labels, the asterisms and the Milky Way.  It sits at the Sun
 * (the WorldGroup origin: the catalogue is heliocentric) and turns them by
 * precession from the mean ecliptic and equinox of J2000 to those of the
 * simulation date, the frame of the planets (VSOP87C) and the Moon
 * (Meeus 47).  So the whole scene is in one frame, the ecliptic of date.
 *
 * Driven by Animation through `preAnimCb` every frame; the rotation is
 * recomputed only when the date has moved by STELLAR_FRAME_EPSILON_DAYS,
 * and without allocating.
 *
 * Anything that reads raw catalogue positions (star.x/y/z, the stars'
 * geometry) is in this group's local frame: take it to the WorldGroup
 * frame with {@link StellarFrame#toParent}, or to world space with the
 * stars' matrixWorld.
 */
export default class StellarFrame extends Object3D {
  /** */
  constructor() {
    super()
    this.name = 'StellarFrame'
    // Identity at J2000.
    this.jde = J2000_JD
    this._changeCbs = []
    this.preAnimCb = (time, jd) => {
      this.update(jd ?? time.simTimeJulianDay())
    }
  }


  /**
   * Turn the frame to the equinox of a date, if it has moved far enough.
   *
   * @param {number} jdUtc Julian Day (UTC), as Time.simTimeJulianDay gives
   * @returns {boolean} whether the rotation changed
   */
  update(jdUtc) {
    if (!Number.isFinite(jdUtc)) {
      return false
    }
    const jde = utcToTtJulianDay(jdUtc)
    if (Math.abs(jde - this.jde) <= STELLAR_FRAME_EPSILON_DAYS) {
      return false
    }
    this.jde = jde
    precessionQuaternion(J2000_JD, jde, this.quaternion)
    for (const cb of this._changeCbs) {
      cb(this.quaternion)
    }
    return true
  }


  /**
   * Call cb(quaternion) after each change of the rotation.
   *
   * @param {Function} cb
   */
  onChange(cb) {
    this._changeCbs.push(cb)
  }


  /**
   * Take a catalogue (J2000) position into the parent's frame, i.e. the
   * WorldGroup's (heliocentric, ecliptic of date).  In place.
   *
   * @param {Vector3} v
   * @returns {Vector3} v
   */
  toParent(v) {
    return v.applyQuaternion(this.quaternion)
  }
}
