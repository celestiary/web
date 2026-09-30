import {readFileSync} from 'fs'
import {describe, expect, it} from 'bun:test'
import {Object3D, PerspectiveCamera, Quaternion, Vector3} from 'three'
import createTree from '@pablo-mayrgundter/yaot2'
import {
  J2000_JD,
  precessEcliptic,
  precessionQuaternion,
  ttMinusUtcSeconds,
  utcToTtJulianDay,
} from './celestialFrame.js'
import {eclipticToScene, moonScenePosition} from './lunarTheory.js'
import {queryPoints} from './Picker.js'
import {rteCameraLocal} from './rte.js'
import StarsCatalog from './StarsCatalog.js'
import StellarFrame, {STELLAR_FRAME_EPSILON_DAYS} from './StellarFrame.js'
import {toArrayBuffer} from '../utils.js'
import horizons from './StellarFrame.horizons.json'


const ARCSEC_PER_RAD = 206264.806247
const DAYS_PER_YEAR = 365.25


/**
 * Angle between two vectors in arcseconds, well-conditioned near 0.
 *
 * @param {Vector3} a
 * @param {Vector3} b
 * @returns {number}
 */
function sepArcsec(a, b) {
  return Math.atan2(new Vector3().crossVectors(a, b).length(), a.dot(b)) * ARCSEC_PER_RAD
}


/**
 * The UTC Julian Day whose TT (as the app converts it) is jde.
 *
 * @param {number} jde
 * @returns {number}
 */
function utcForTt(jde) {
  let jd = jde
  for (let i = 0; i < 3; i++) {
    jd = jde - (ttMinusUtcSeconds(jd) / 86400)
  }
  return jd
}


describe('precessionQuaternion', () => {
  it('turns directions as precessEcliptic does, to 1e-6″', () => {
    // From the year 0 to 4000; poles, equinoxes and points in between.
    const dates = [1721057.5, 2415020.5, 2451545.0, 2461313.1, 2634233.5, 2816787.5]
    const points = [[0, 0], [90, 0], [180, 0], [270, 0], [149.48, 1.77], [31, 85], [200, -60], [300, -89.9]]
    for (const jde of dates) {
      const q = precessionQuaternion(J2000_JD, jde)
      for (const [l, b] of points) {
        const v = eclipticToScene(l, b, 1).applyQuaternion(q)
        const p = precessEcliptic(l, b, J2000_JD, jde)
        expect(sepArcsec(v, eclipticToScene(p.lambda, p.beta, 1))).toBeLessThan(1e-6)
      }
    }
  })


  it('reproduces Meeus example 21.c', () => {
    // J2000 (λ, β) = (149.48194°, 1.76549°) precessed to -214 June 30.0 TD
    // (JDE 1643074.5): λ = 118.704°, β = +1.615°.
    const v = eclipticToScene(149.48194, 1.76549, 1).applyQuaternion(precessionQuaternion(J2000_JD, 1643074.5))
    const lambda = ((Math.atan2(-v.z, v.x) * 180 / Math.PI) + 360) % 360
    const beta = Math.asin(v.y) * 180 / Math.PI
    expect(lambda).toBeCloseTo(118.704, 3)
    expect(beta).toBeCloseTo(1.615, 3)
  })


  it('is the identity at J2000 and inverts by swapping the dates', () => {
    const q = precessionQuaternion(J2000_JD, J2000_JD)
    expect(q.angleTo(new Quaternion)).toBeLessThan(1e-15)
    const there = precessionQuaternion(J2000_JD, 2634233.5)
    const back = precessionQuaternion(2634233.5, J2000_JD)
    expect(there.multiply(back).angleTo(new Quaternion)).toBeLessThan(1e-12)
  })


  it('moves the J2000 equinox ~50.29″ a year along the ecliptic, about the ecliptic pole', () => {
    const years = 26.75
    const q = precessionQuaternion(J2000_JD, J2000_JD + (years * DAYS_PER_YEAR))
    const x = new Vector3(1, 0, 0).applyQuaternion(q)
    // Longitude increases toward -Z in the scene.
    const dLambda = Math.atan2(-x.z, x.x) * ARCSEC_PER_RAD
    expect(dLambda / years).toBeCloseTo(50.29, 1)
    // The ecliptic pole moves only by η, ~47″ a century.
    const pole = new Vector3(0, 1, 0).applyQuaternion(q)
    expect(sepArcsec(pole, new Vector3(0, 1, 0))).toBeLessThan(0.5 * years)
  })
})


describe('StellarFrame', () => {
  it('starts at the identity (J2000) and turns to the date', () => {
    const frame = new StellarFrame()
    expect(frame.quaternion.angleTo(new Quaternion)).toBe(0)
    const jd = 2461313.1
    expect(frame.update(jd)).toBe(true)
    const want = precessionQuaternion(J2000_JD, utcToTtJulianDay(jd))
    expect(frame.quaternion.angleTo(want)).toBeLessThan(1e-15)
  })


  it('recomputes only when the date moves by more than the threshold', () => {
    const frame = new StellarFrame()
    const calls = []
    frame.onChange((q) => calls.push(q))
    const q = frame.quaternion
    expect(frame.update(2461313.1)).toBe(true)
    expect(frame.update(2461313.1 + (0.9 * STELLAR_FRAME_EPSILON_DAYS))).toBe(false)
    expect(frame.update(2461313.1 - (0.9 * STELLAR_FRAME_EPSILON_DAYS))).toBe(false)
    expect(frame.update(2461313.1 + (1.1 * STELLAR_FRAME_EPSILON_DAYS))).toBe(true)
    expect(frame.update(NaN)).toBe(false)
    expect(calls.length).toBe(2)
    // In place: the same quaternion object throughout, and handed to the
    // callbacks.
    expect(frame.quaternion).toBe(q)
    expect(calls[0]).toBe(q)
  })


  it('lags the date by under 0.2″ between updates', () => {
    const frame = new StellarFrame()
    const jd = 2461313.1
    frame.update(jd)
    const later = precessionQuaternion(J2000_JD, utcToTtJulianDay(jd + STELLAR_FRAME_EPSILON_DAYS))
    expect(frame.quaternion.angleTo(later) * ARCSEC_PER_RAD).toBeLessThan(0.2)
  })


  it('follows Animation\'s preAnimCb with the animated Julian Day', () => {
    const frame = new StellarFrame()
    const time = {simTimeJulianDay: () => J2000_JD + 5000}
    frame.preAnimCb(time, 2634233.5)
    expect(frame.jde).toBeCloseTo(utcToTtJulianDay(2634233.5), 9)
    frame.preAnimCb(time, null)
    expect(frame.jde).toBeCloseTo(utcToTtJulianDay(J2000_JD + 5000), 9)
  })


  it('toParent turns a catalogue position about the Sun', () => {
    const frame = new StellarFrame()
    frame.update(2634233.5)
    const v = frame.toParent(new Vector3(3, 4, 12))
    expect(v.length()).toBeCloseTo(13, 12)
    expect(sepArcsec(v, new Vector3(3, 4, 12))).toBeGreaterThan(6 * 3600)
  })
})


describe('The Moon among the stars, against JPL Horizons', () => {
  // Geocentric geometric Moon vectors in the ecliptic of J2000 from
  // StellarFrame.horizons.json (the query is recorded there; offline), and
  // reference stars at their J2000 catalogue direction from stars.dat.  The
  // scene puts the Moon in the ecliptic of date (Meeus 47) and the stars
  // through the StellarFrame, at the same UTC Julian Day, as Animation does.
  // Proper motion, parallax (< 0.05″ for these stars) and aberration are
  // left out on both sides.  Measured 2026-09-30: every separation within
  // 3.1″ of Horizons', and the Moon's place among the stars within 4.3″;
  // without the StellarFrame, up to 6.7° off (2500).
  const catalog = new StarsCatalog()
  catalog.read(toArrayBuffer(readFileSync('./public/data/stars.dat')))

  for (const [jde, date, x, y, z, stars] of horizons.rows) {
    it(`agrees at ${date}`, () => {
      const jdUtc = utcForTt(jde)
      expect(utcToTtJulianDay(jdUtc)).toBeCloseTo(jde, 9)
      const frame = new StellarFrame()
      frame.update(jdUtc)
      frame.updateMatrixWorld()
      const moonScene = moonScenePosition(utcToTtJulianDay(jdUtc))
      // Horizons' ecliptic (x, y, z) in the scene's axes: (x, z, -y).
      const moonJ2000 = new Vector3(x, z, -y)
      for (const [hip, name] of stars) {
        const star = catalog.starByHip.get(hip)
        expect(star, name).toBeDefined()
        const starJ2000 = new Vector3(star.x, star.y, star.z)
        const starScene = starJ2000.clone().applyMatrix4(frame.matrixWorld)
        const dSep = sepArcsec(moonScene, starScene) - sepArcsec(moonJ2000, starJ2000)
        expect(Math.abs(dSep), `${name} ${dSep.toFixed(2)}″`).toBeLessThan(10)
      }
      // The whole 2D offset: the scene's stars are the catalogue's turned by
      // the frame, so the Moon's place among them is the frame's inverse on
      // the Moon, against Horizons' J2000 Moon.
      const moonAmongStars = moonScene.clone().applyQuaternion(frame.quaternion.clone().invert())
      expect(sepArcsec(moonAmongStars, moonJ2000)).toBeLessThan(10)
    })
  }
})


describe('rteCameraLocal', () => {
  it('puts the camera in the object\'s rotated, translated frame', () => {
    const world = new Object3D()
    world.position.set(-8.1e16, 2.3e16, 5.5e16)
    const frame = new StellarFrame()
    frame.update(1721057.5)
    const points = new Object3D()
    world.add(frame)
    frame.add(points)
    const camera = new PerspectiveCamera()
    camera.position.set(1.5e11, -2e10, 3e9)
    world.updateMatrixWorld()
    camera.updateMatrixWorld()
    const high = new Vector3()
    const low = new Vector3()
    rteCameraLocal(points, camera, high, low)
    const want = points.worldToLocal(camera.position.clone())
    const got = high.clone().add(low)
    expect(got.distanceTo(want) / want.length()).toBeLessThan(1e-12)
    expect(Math.fround(high.x)).toBe(high.x)
    expect(Math.abs(low.x)).toBeLessThan(Math.abs(high.x) * 1e-7)
  })
})


describe('queryPoints in the stellar frame', () => {
  it('picks a star where the precessed field draws it, not at its raw position', () => {
    // Year 0: precession ~28°, so the raw position is far off screen.
    const worldGroup = new Object3D()
    worldGroup.position.set(1e12, 0, 0)
    const frame = new StellarFrame()
    frame.update(1721057.5)
    worldGroup.add(frame)
    const LY = 9.4607304725808e15
    const raw = new Vector3(10 * LY, 1 * LY, -3 * LY)
    const stars = new Object3D()
    // The Sun (as in the catalogue), the star, and two more.
    stars.geom = {
      coords: new Float32Array([0, 0, 0, raw.x, raw.y, raw.z, -raw.x, raw.y, raw.z, 5 * LY, 0, 0]),
      idsByNdx: new Int32Array([0, 7, 8, 9]),
    }
    const star7 = {hipId: 7, x: raw.x, y: raw.y, z: raw.z}
    stars.catalog = {starByHip: new Map([[0, {hipId: 0}], [7, star7], [8, {hipId: 8}], [9, {hipId: 9}]])}
    frame.add(stars)
    worldGroup.updateMatrixWorld()
    const tree = createTree()
    tree.init(stars.geom.coords)

    const width = 800
    const height = 600
    const camera = new PerspectiveCamera(30, width / height, 1, 1e20)
    const ui = {renderer: {domElement: {clientWidth: width, clientHeight: height}}, camera}
    const click = {clientX: width / 2, clientY: height / 2}

    // Aim at the precessed star: picked.
    camera.lookAt(new Vector3().copy(raw).applyMatrix4(stars.matrixWorld))
    camera.updateMatrixWorld()
    let picked = null
    queryPoints(ui, click, tree, stars, (pick) => {
      picked = pick
    })
    expect(picked?.star).toBe(star7)
    expect(picked.x).toBeCloseTo(Math.fround(raw.x), -3)

    // Aim at the raw catalogue position: nothing there any more.
    camera.lookAt(new Vector3().copy(raw).add(worldGroup.position))
    camera.updateMatrixWorld()
    picked = null
    queryPoints(ui, click, tree, stars, (pick) => {
      picked = pick
    })
    expect(picked).toBeNull()
  })
})
