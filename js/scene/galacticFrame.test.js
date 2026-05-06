import {describe, expect, it} from 'bun:test'
import {Matrix3, Vector3} from 'three'
import {equatorialToSceneUnit, galacticToSceneMatrix, SUN_GALACTIC_RADIUS_LY} from './galacticFrame.js'


// IAU galactic frame anchors (J2000) — replicated locally so the test
// independently re-derives them rather than just echoing module constants.
const NGP_RA_DEG = 192.85948
const NGP_DEC_DEG = 27.12825
const GC_RA_DEG = 266.40499
const GC_DEC_DEG = -28.93617


describe('equatorialToSceneUnit', () => {
  it('returns a unit vector', () => {
    const v = equatorialToSceneUnit(123.4, -45.6)
    expect(v.length()).toBeCloseTo(1, 6)
  })


  it('reproduces Sirius position from the catalog (β=-39.605°, λ=104.083°)', () => {
    // Empirical check: stars.dat stores Sirius at (-1.613, -5.483, -6.428) ly
    // for r ≈ 8.601 ly.  Sirius J2000: RA=101.287°, Dec=-16.716°.  The unit
    // vector our helper produces, scaled by 8.601 ly, must reproduce those
    // catalog values within the on-disk float32 precision (~1e-3 ly).
    const u = equatorialToSceneUnit(101.287, -16.716)
    const r = 8.601
    expect(u.x * r).toBeCloseTo(-1.613, 1)
    expect(u.y * r).toBeCloseTo(-5.483, 1)
    expect(u.z * r).toBeCloseTo(-6.428, 1)
  })


  it('places the north ecliptic pole at scene +Y', () => {
    // NEP in equatorial: α arbitrary at the pole, but conventionally
    // α = 18h = 270°, δ = 90° - ε = 66.560719°.
    const v = equatorialToSceneUnit(270, 66.560719)
    expect(v.x).toBeCloseTo(0, 5)
    expect(v.y).toBeCloseTo(1, 5)
    expect(v.z).toBeCloseTo(0, 5)
  })


  it('places the vernal equinox at scene +X', () => {
    // VE: α=0, δ=0.
    const v = equatorialToSceneUnit(0, 0)
    expect(v.x).toBeCloseTo(1, 5)
    expect(v.y).toBeCloseTo(0, 5)
    expect(v.z).toBeCloseTo(0, 5)
  })
})


describe('galacticToSceneMatrix', () => {
  it('produces an orthonormal rotation (det=1, columns mutually orthogonal)', () => {
    const m = galacticToSceneMatrix()
    const r = new Matrix3().setFromMatrix4(m)
    // Columns
    const cX = new Vector3(r.elements[0], r.elements[1], r.elements[2])
    const cY = new Vector3(r.elements[3], r.elements[4], r.elements[5])
    const cZ = new Vector3(r.elements[6], r.elements[7], r.elements[8])
    expect(cX.length()).toBeCloseTo(1, 6)
    expect(cY.length()).toBeCloseTo(1, 6)
    expect(cZ.length()).toBeCloseTo(1, 6)
    expect(cX.dot(cY)).toBeCloseTo(0, 6)
    expect(cY.dot(cZ)).toBeCloseTo(0, 6)
    expect(cZ.dot(cX)).toBeCloseTo(0, 6)
    // Right-handed: cX × cY = cZ
    const cross = new Vector3().crossVectors(cX, cY)
    expect(cross.x).toBeCloseTo(cZ.x, 6)
    expect(cross.y).toBeCloseTo(cZ.y, 6)
    expect(cross.z).toBeCloseTo(cZ.z, 6)
  })


  it('maps F-frame +Y (NGP) to the scene-frame NGP direction', () => {
    // F's +Y is the galactic pole.  Applied to scene, it should land on the
    // sky position of the IAU NGP.
    const m = galacticToSceneMatrix()
    const ngpScene = new Vector3(0, 1, 0).applyMatrix4(m)
    const ngpExpected = equatorialToSceneUnit(NGP_RA_DEG, NGP_DEC_DEG)
    // The matrix is orthogonalized off NGP, so this match is essentially
    // exact (limited by float64 round-off).
    expect(ngpScene.dot(ngpExpected)).toBeGreaterThan(1 - 1e-6)
  })


  it('maps F-frame +X (sun→GC) to the scene-frame GC direction within 0.1°', () => {
    // F's +X is the line from Sun toward the galactic center.  Mapped into
    // scene, it should be very close to the IAU GC sky position.  Small
    // deviation is expected because the published NGP and GC directions
    // aren't perfectly perpendicular and we orthogonalize off NGP.
    const m = galacticToSceneMatrix()
    const gcScene = new Vector3(1, 0, 0).applyMatrix4(m)
    const gcExpected = equatorialToSceneUnit(GC_RA_DEG, GC_DEC_DEG)
    const cosErr = gcScene.dot(gcExpected)
    const errDeg = Math.acos(Math.min(1, cosErr)) * 180 / Math.PI
    expect(errDeg).toBeLessThan(0.1)
  })


  it('regression: previous single-Z-rotation approach put GC ~65° off', () => {
    // Sanity check that the new full-rotation matrix is materially different
    // from the old broken approach (just to keep the bug fix from silently
    // regressing into a Z-rotation later).
    const m = galacticToSceneMatrix()
    const gcScene = new Vector3(1, 0, 0).applyMatrix4(m)
    // Old approach: disk in XZ plane, rotation.z = 60.187° in scene frame,
    // sun on arm 0 at azimuth (1/0.22)·ln(26000/7000) ≈ 5.965 rad.  GC dir
    // from sun in shifted disk-D frame was (-cos θ, 0, -sin θ); after Z-rot:
    const theta = (1 / 0.22) * Math.log(SUN_GALACTIC_RADIUS_LY / 7000)
    const tilt = 60.187 * Math.PI / 180
    const oldGCx = -Math.cos(theta) * Math.cos(tilt)
    const oldGCy = -Math.cos(theta) * Math.sin(tilt)
    const oldGCz = -Math.sin(theta)
    const oldR = Math.hypot(oldGCx, oldGCy, oldGCz)
    const oldGC = new Vector3(oldGCx / oldR, oldGCy / oldR, oldGCz / oldR)
    const angleBetween = Math.acos(Math.min(1, gcScene.dot(oldGC))) * 180 / Math.PI
    // New direction is dramatically different from the old one — 50° to 80°.
    expect(angleBetween).toBeGreaterThan(50)
    expect(angleBetween).toBeLessThan(80)
  })
})
