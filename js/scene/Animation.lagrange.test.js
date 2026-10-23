import {describe, expect, it} from 'bun:test'
import {Object3D, Vector3} from 'three'
import vsop87cLoader from 'vsop87/dist/vsop87c-wasm'
import Animation from './Animation.js'
import {utcToTtJulianDay} from './celestialFrame.js'
import {lagrangePoints, placePoints} from './lagrange.js'
import {moonScenePosition} from './lunarTheory.js'
import {meanElements} from './meanElements.js'
import {ASTRO_UNIT_METER} from '../shared.js'
import tethys from '../../public/data/tethys.json'


// Animation.layLagrange: the pair's line is the secondary's place (the
// Sun-Earth pair's, the Earth-Moon barycentre's), and its plane and side
// of motion the orbit's now, so the points lead and trail the body as it
// really moves.  The series from the package: Celestiary.test.js mocks
// ./vsop.js for the whole process.
const vsop87c = await vsop87cLoader

const JD = 2461326.441
const SECONDS_PER_DAY = 86400
const MOON_MASS_FRACTION = 1 / (1 + 81.30056)
const ORBITS = {
  moon: {eccentricity: 0.0554, semiMajorAxis: 384467000, siderealOrbitPeriod: 2360591.5},
  earth: {eccentricity: 0.0167, semiMajorAxis: 1.4959789e11, siderealOrbitPeriod: 31558149.8},
}


/**
 * @param {number} jd
 * @returns {Animation} at jd, on the real series
 */
function animationAt(jd) {
  const time = {simTimeJulianDay: () => jd, simTimeSecs: () => (jd - 2440587.5) * SECONDS_PER_DAY}
  const anim = new Animation(time, vsop87c)
  anim.setDate(jd)
  return anim
}


/**
 * @param {string} name
 * @param {object} orbit
 * @param {Vector3} position
 * @returns {Object3D} an orbitPosition whose marks record what they're given
 */
function secondary(name, orbit, position) {
  const node = new Object3D
  node.name = `${name}.orbitPosition`
  node.orbit = orbit
  node.position.copy(position)
  node.lagrange = {visible: true, place: (r, pole, body) => {
    node.laid = {r: r.clone(), pole: pole.clone().normalize(), body: body.clone()}
  }}
  return node
}


/**
 * @param {Vector3} r
 * @param {Vector3} v
 * @param {Vector3} pole
 * @returns {number} degrees between the pole and r × v
 */
function poleError(r, v, pole) {
  return new Vector3().crossVectors(r, v).normalize().angleTo(pole) * 180 / Math.PI
}


describe('Animation.layLagrange', () => {
  it('lays the Earth-Moon points on the Moon as it moves: L4 ahead', () => {
    const dt = 0.01
    const at = (jd) => moonScenePosition(utcToTtJulianDay(jd), new Vector3)
    const moon = secondary('moon', ORBITS.moon, at(JD))
    animationAt(JD).layLagrange(moon)
    const {r, pole} = moon.laid
    expect(r.distanceTo(at(JD))).toBeLessThan(1)
    const v = at(JD + dt).sub(at(JD - dt))
    expect(poleError(r, v, pole)).toBeLessThan(0.01)
    // L4 is where the Moon is heading: closer to it in a day than now.
    const [, , , L4, L5] = placePoints(lagrangePoints(0.01215), r, pole)
    const later = at(JD + 1)
    expect(later.distanceTo(L4)).toBeLessThan(r.distanceTo(L4))
    expect(later.distanceTo(L5)).toBeGreaterThan(r.distanceTo(L5))
  })

  it('takes the Sun-Earth pair\'s line through the Earth-Moon barycentre', () => {
    const earthAt = (jd) => {
      const e = vsop87c(jd).earth
      return new Vector3(e.x, e.z, -e.y).multiplyScalar(ASTRO_UNIT_METER)
    }
    const emb = (jd) => earthAt(jd).addScaledVector(moonScenePosition(utcToTtJulianDay(jd), new Vector3),
        MOON_MASS_FRACTION)
    const earth = secondary('earth', ORBITS.earth, earthAt(JD))
    animationAt(JD).layLagrange(earth)
    const {r, pole, body} = earth.laid
    expect(r.distanceTo(emb(JD))).toBeLessThan(1e3)
    // The Hill sphere is on the Earth itself.
    expect(body.distanceTo(earthAt(JD))).toBeLessThan(1)
    expect(poleError(r, emb(JD + 1).sub(emb(JD - 1)), pole)).toBeLessThan(0.01)
  })

  it('turns a moon\'s mean elements into the scene\'s frame of date', () => {
    const elements = meanElements(tethys.orbit)
    const place = (jd) => {
      const anim = animationAt(jd)
      return anim.placeByElements({elements}).clone()
    }
    const node = secondary('tethys', tethys.orbit, place(JD))
    node.elements = elements
    animationAt(JD).layLagrange(node)
    const dt = 0.001
    expect(poleError(node.laid.r, place(JD + dt).sub(place(JD - dt)), node.laid.pole)).toBeLessThan(0.1)
  })
})
