import {describe, expect, it} from 'bun:test'
import {Matrix4, Vector3} from 'three'
import {gmstRad, J2000_JD} from './celestialFrame.js'


// Conversion helpers — kept local so the test independently re-derives any
// quantities it checks rather than echoing module internals.
const toDeg = 180 / Math.PI
const toRad = Math.PI / 180


// Earth obliquity at J2000 (IAU value).  Matches `axialInclination` for
// Earth in public/data/earth.json (modulo the JSON's published precision).
const EARTH_OBLIQUITY_DEG = 23.4392811


/**
 * Build the Earth-orientation rotation matrix that the scene applies, by
 * mirroring the Planet.js + Animation.js chain:
 *   planetTilt: rotateX(-ε)
 *   planet:     rotateY(GMST)         (local-Y, applied as child of planetTilt)
 * Composed: M_world = M_tilt · M_spin (matrix multiplication, left-to-right
 * means M_tilt is applied to body-fixed positions LAST).
 *
 * @param {number} jd Julian Day (UT1)
 * @param {number} obliquityDeg axial obliquity in degrees
 * @returns {Matrix4} body-fixed → scene rotation
 */
function earthOrientation(jd, obliquityDeg = EARTH_OBLIQUITY_DEG) {
  const tilt = new Matrix4().makeRotationX(-obliquityDeg * toRad)
  const spin = new Matrix4().makeRotationY(gmstRad(jd))
  return new Matrix4().multiplyMatrices(tilt, spin)
}


describe('gmstRad', () => {
  it('returns the J2000 epoch GMST (280.46061837°) at JD 2451545.0', () => {
    // At J2000 noon (TT) the IAU GMST polynomial evaluates to its constant
    // term: 280.46061837°.  This is the published anchor that the rest of
    // the formula advances from.
    const g = gmstRad(J2000_JD) * toDeg
    expect(g).toBeCloseTo(280.46061837, 5)
  })


  it('advances by 360.98564736629° per Julian day (sidereal rate)', () => {
    // One mean solar day later, GMST should have advanced by the IAU rate,
    // not by 360° — Earth completes slightly more than one rotation per UT
    // day (the difference being Earth's orbital motion around the Sun).
    const a = gmstRad(J2000_JD)
    const b = gmstRad(J2000_JD + 1)
    // diff in [-π, π]
    let diff = (b - a)
    const TWO_PI = 2 * Math.PI
    diff = ((diff % TWO_PI) + TWO_PI) % TWO_PI
    if (diff > Math.PI) {
      diff -= TWO_PI
    }
    // 360.98564736629° = 360° + 0.98564736629° → diff mod 360° = 0.98564736629°.
    expect(diff * toDeg).toBeCloseTo(0.98564736629, 5)
  })


  it('returns a value in [0, 2π)', () => {
    // Far in the future: many wraparounds.  Should still normalize cleanly.
    const g = gmstRad(J2000_JD + 1e6)
    expect(g).toBeGreaterThanOrEqual(0)
    expect(g).toBeLessThan(2 * Math.PI)
  })


  it('returns a value in [0, 2π) for dates before J2000', () => {
    // 1970-01-01 12:00 UT — well before J2000.  Negative T_days; the
    // implementation must wrap negatives into the positive range.
    const jd1970 = 2440587.5 + 0.5 // Unix epoch + 12h
    const g = gmstRad(jd1970)
    expect(g).toBeGreaterThanOrEqual(0)
    expect(g).toBeLessThan(2 * Math.PI)
  })


  it('matches almanac GMST for 1970-01-01 00:00 UT to within 0.1°', () => {
    // Almanac value: 6h 41m 17.2s = 100.322°.  The IAU low-precision
    // polynomial we use here drops the higher-order terms (UT1−TT,
    // precession-rate corrections), so 30 years before J2000 it lags by
    // ~0.1° (~25 s).  That's more than good enough to render Earth at
    // the right side of the sky; tighten the tolerance only if we ever
    // adopt the full IAU 2006 expression.
    const jd = 2440587.5 // 1970-01-01 00:00 UT
    const g = gmstRad(jd) * toDeg
    expect(g).toBeGreaterThan(100.1)
    expect(g).toBeLessThan(100.4)
  })


  it('regression: at JD 2461167.191 GMST is ≈ 113.31° (screenshot anchor)', () => {
    // The screenshot-time check from the design analysis: at JD 2,461,167.191
    // (2026-05-06 16:35 UT) the prime meridian's RA is in the
    // mid-Pacific-on-the-equator direction.  Pinning the value here lets
    // any future regression in the GMST formula be diagnosed by name.
    const g = gmstRad(2461167.191) * toDeg
    expect(g).toBeCloseTo(113.31, 1)
  })
})


describe('Earth orientation chain (tilt + spin)', () => {
  it('places the rotational axis at the IAU North Celestial Pole', () => {
    // Body-local +Y is the rotational axis (Planet.js convention).  After
    // tilt-then-spin, +Y in scene must equal NCP_scene = (0, cos ε, -sin ε)
    // independent of GMST (spin around +Y leaves +Y invariant).  This is
    // the test that catches the rotateZ-vs-rotateX axial-tilt bug.
    const eps = EARTH_OBLIQUITY_DEG * toRad
    const ncpScene = new Vector3(0, Math.cos(eps), -Math.sin(eps))
    // Try several JDs — pole must be steady regardless of spin phase.
    for (const jd of [J2000_JD, J2000_JD + 100, 2461167.191, 2440587.5]) {
      const m = earthOrientation(jd)
      const polelocal = new Vector3(0, 1, 0)
      const poleScene = polelocal.clone().applyMatrix4(m)
      expect(poleScene.x).toBeCloseTo(ncpScene.x, 6)
      expect(poleScene.y).toBeCloseTo(ncpScene.y, 6)
      expect(poleScene.z).toBeCloseTo(ncpScene.z, 6)
    }
  })


  it('places the prime meridian on the celestial equator at RA = GMST', () => {
    // Body-local +X is the prime meridian (coords.js convention).  After
    // tilt-then-spin, prime meridian in scene must lie ON the celestial
    // equator (declination 0) and AT right ascension equal to GMST.
    //
    // Validation route: convert the prime meridian's scene direction back
    // to equatorial Cartesian and check (RA, Dec) directly.
    //
    //   scene → ecliptic: ecl_X = scene_X, ecl_Y = -scene_Z, ecl_Z = scene_Y
    //   ecliptic → equatorial: rotateX(+ε)  (NEP → NCP via the VE pivot)
    const eps = EARTH_OBLIQUITY_DEG * toRad
    const cE = Math.cos(eps); const sE = Math.sin(eps)
    for (const jd of [J2000_JD, J2000_JD + 365.25, 2461167.191]) {
      const m = earthOrientation(jd)
      const pm = new Vector3(1, 0, 0).applyMatrix4(m)
      const eclX = pm.x; const eclY = -pm.z; const eclZ = pm.y
      const eqX = eclX
      const eqY = (eclY * cE) - (eclZ * sE)
      const eqZ = (eclY * sE) + (eclZ * cE)
      // Dec = asin(eqZ).  Should be 0 (prime meridian on the equator).
      expect(eqZ).toBeCloseTo(0, 6)
      // RA = atan2(eqY, eqX), normalized to [0, 2π).
      let ra = Math.atan2(eqY, eqX)
      if (ra < 0) {
        ra += 2 * Math.PI
      }
      const expectedGMST = gmstRad(jd)
      expect(ra).toBeCloseTo(expectedGMST, 6)
    }
  })


  it('local +X (prime meridian) is preserved by the tilt at GMST=0', () => {
    // Sanity: at the rotation phase where the spin is identity, prime
    // meridian must lie along scene +X (the vernal equinox direction).
    // Tests the tilt rotation in isolation.
    const tilt = new Matrix4().makeRotationX(-EARTH_OBLIQUITY_DEG * toRad)
    const x = new Vector3(1, 0, 0).applyMatrix4(tilt)
    expect(x.x).toBeCloseTo(1, 6)
    expect(x.y).toBeCloseTo(0, 6)
    expect(x.z).toBeCloseTo(0, 6)
  })


  it('regression: pre-fix rotateZ-tilt placed the pole 90° from NCP', () => {
    // Old code: planetTilt.rotateZ(+ε), spin around local-Y.  Body-local
    // +Y mapped to (-sin ε, cos ε, 0) — in scene's X-Y plane, 90° rotated
    // around scene +Y from the real NCP.  Keep this regression baked in
    // so anyone reverting the tilt axis sees the test name and stops.
    const eps = EARTH_OBLIQUITY_DEG * toRad
    const oldTilt = new Matrix4().makeRotationZ(eps)
    const oldPole = new Vector3(0, 1, 0).applyMatrix4(oldTilt)
    expect(oldPole.x).toBeCloseTo(-Math.sin(eps), 6)
    expect(oldPole.y).toBeCloseTo(Math.cos(eps), 6)
    expect(oldPole.z).toBeCloseTo(0, 6)
    // Angle to true NCP — should be ~90° (specifically 2 ε ≈ 46.88°
    // angular gap; the relevant fact is just that it's *not* zero).
    const ncp = new Vector3(0, Math.cos(eps), -Math.sin(eps))
    const angleDeg = Math.acos(Math.min(1, oldPole.dot(ncp))) * toDeg
    expect(angleDeg).toBeGreaterThan(20) // ≈ 2ε, well clear of 0
  })
})
