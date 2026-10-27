import {describe, expect, it} from 'bun:test'
import {Object3D, Vector3} from 'three'
import vsop87cLoader from 'vsop87/dist/vsop87c-wasm'
import Animation, {HANDOVER_MS} from './Animation.js'
import Planet from './Planet.js'
import {planetsApprox} from './planetsApprox.js'
import {OrbitPaths} from './orbitPath.js'
import {ASTRO_UNIT_METER} from '../shared.js'
import earthJson from '../../public/data/earth/index.json'


// The hand-over from the planets' mean elements to VSOP87C, once its chunk
// has loaded (Animation.planetCoords).  The series from the package, not
// ./vsop.js, which Celestiary.test.js mocks for the whole process; every
// Animation here is told its ephemeris (null: none yet) rather than take
// the module's, so no other file's loading reaches these.
const vsop87c = await vsop87cLoader

const J2000 = 2451545
const JD_2026 = 2461313.1007
const SECONDS_PER_DAY = 86400
const DEG = 180 / Math.PI
const FRAME_MS = 1000 / 60


/**
 * @param {number} jd
 * @returns {object} a clock the tests set
 */
function newTime(jd) {
  const time = {jd}
  time.updateTime = () => {}
  time.simTimeJulianDay = () => time.jd
  time.simTimeDays = () => time.jd - 2440587.5
  time.simTimeSecs = () => (time.jd - 2440587.5) * SECONDS_PER_DAY
  return time
}


/**
 * An Animation on a clock the test advances.
 *
 * @param {?Function} vsop
 * @param {number} [jd]
 * @returns {{anim: Animation, clock: {ms: number}}}
 */
function newAnimation(vsop, jd = J2000) {
  const anim = new Animation(newTime(jd), vsop)
  const clock = {ms: 1000}
  anim.clock = () => clock.ms
  return {anim, clock}
}


/**
 * Earth, Jupiter, and a camera riding Earth, as `goTo` leaves it: the
 * platform a child of Earth's orbitPosition.
 *
 * @returns {{root: Object3D, earth: Object3D, jupiter: Object3D, camera: Object3D}}
 */
function newSystem() {
  const root = new Object3D
  const body = (name) => {
    const node = new Object3D
    node.name = `${name}.orbitPosition`
    node.orbit = {semiMajorAxis: {scalar: ASTRO_UNIT_METER}}
    root.add(node)
    return node
  }
  const earth = body('earth')
  const jupiter = body('jupiter')
  const camera = new Object3D
  camera.position.set(3e7, 0, 0)
  earth.add(camera)
  return {root, earth, jupiter, camera}
}


/**
 * @param {Object3D} node
 * @returns {Vector3} its world position
 */
function worldOf(node) {
  node.updateWorldMatrix(true, false)
  return node.getWorldPosition(new Vector3)
}


/**
 * @param {Vector3} a
 * @param {Vector3} b
 * @param {Vector3} from
 * @returns {number} the angle between the directions to a and b from there, degrees
 */
function angleFrom(a, b, from) {
  return new Vector3().subVectors(a, from).angleTo(new Vector3().subVectors(b, from)) * DEG
}


/**
 * @param {Function} ephemeris
 * @param {string} name
 * @param {number} jd
 * @returns {Vector3} where the ephemeris puts the planet, in the scene
 */
function sceneOf(ephemeris, name, jd) {
  const c = ephemeris(jd)[name]
  return new Vector3(c.x, c.z, -c.y).multiplyScalar(ASTRO_UNIT_METER)
}


describe('the planets before VSOP87C has loaded', () => {
  it('are on mean elements, not at the origin', () => {
    const {anim} = newAnimation(null, JD_2026)
    const {root, earth, jupiter} = newSystem()
    expect(anim.vsopReady()).toBe(false)
    anim.animateAtJD(root, JD_2026)
    for (const [node, name] of [[earth, 'earth'], [jupiter, 'jupiter']]) {
      const want = sceneOf(vsop87c, name, JD_2026)
      expect(node.position.length()).toBeGreaterThan(0.9 * ASTRO_UNIT_METER)
      // Near the present: the inner planets within thousands of km, Jupiter
      // within millions (planetsApprox.test.js).
      expect(node.position.distanceTo(want)).toBeLessThan(2e9)
    }
    expect(earth.position.distanceTo(sceneOf(vsop87c, 'earth', JD_2026))).toBeLessThan(2e7)
  })

  it('give vsopAt the stand-in too, so nothing samples the origin', () => {
    const {anim} = newAnimation(null)
    const c = anim.vsopAt(JD_2026)
    expect(Math.hypot(c.earth.x, c.earth.y, c.earth.z)).toBeGreaterThan(0.98)
  })

  it('are the same objects frame to frame, allocating nothing', () => {
    const {anim} = newAnimation(null)
    anim.setDate(JD_2026)
    const first = anim.curVsopCoords
    anim.setDate(JD_2026 + 1)
    expect(anim.curVsopCoords).toBe(first)
  })

  it('stay on the stand-in with the series not loaded, however the clock runs', () => {
    const {anim, clock} = newAnimation(null)
    const {root, earth} = newSystem()
    anim.animateAtJD(root, J2000)
    const was = earth.position.clone()
    clock.ms += 60000
    anim.animateAtJD(root, J2000)
    expect(earth.position.distanceTo(was)).toBe(0)
    expect(anim.vsopReady()).toBe(false)
  })
})


describe('the hand-over to VSOP87C', () => {
  /**
   * Run the glide a frame at a time.
   *
   * @param {number} jd
   * @returns {object} the Earth and Jupiter positions, and the camera's
   *   view of Jupiter, at the stand-in, each frame, and VSOP87C's
   */
  function glide(jd) {
    const {anim, clock} = newAnimation(null, jd)
    const {root, earth, jupiter, camera} = newSystem()
    anim.animateAtJD(root, jd)
    const frames = [{earth: earth.position.clone(), jupiter: jupiter.position.clone(),
      view: worldOf(jupiter).clone().sub(worldOf(camera))}]
    anim.setEphemeris(vsop87c)
    expect(anim.vsopReady()).toBe(true)
    // The first frame after: the glide starts then, not when the series came.
    clock.ms += 5000
    const start = clock.ms
    for (let t = 0; t <= HANDOVER_MS + FRAME_MS; t += FRAME_MS) {
      clock.ms = start + t
      anim.animateAtJD(root, jd)
      frames.push({earth: earth.position.clone(), jupiter: jupiter.position.clone(),
        view: worldOf(jupiter).clone().sub(worldOf(camera))})
    }
    return {anim, frames, root, earth, jupiter, camera,
      vsopEarth: sceneOf(vsop87c, 'earth', jd), vsopJupiter: sceneOf(vsop87c, 'jupiter', jd)}
  }

  it('starts where the stand-in was: no jump at the switch', () => {
    const {frames} = glide(J2000)
    // The first frame on the series is the stand-in's place, to float rounding.
    expect(frames[1].earth.distanceTo(frames[0].earth)).toBeLessThan(1)
    expect(frames[1].jupiter.distanceTo(frames[0].jupiter)).toBeLessThan(1)
  })

  it('ends exactly on VSOP87C', () => {
    const {frames, vsopEarth, vsopJupiter, anim} = glide(J2000)
    const last = frames[frames.length - 1]
    expect(last.earth.distanceTo(vsopEarth)).toBeLessThan(1)
    expect(last.jupiter.distanceTo(vsopJupiter)).toBeLessThan(1)
    expect(anim._handover).toBeNull()
  })

  it('moves a planet by a small part of its error each frame, and always toward the series', () => {
    const {frames, vsopEarth, vsopJupiter} = glide(J2000)
    const total = frames[0].jupiter.distanceTo(vsopJupiter)
    // J2000: Jupiter is a few hundred thousand km out.
    expect(total).toBeGreaterThan(1e8)
    let step = 0
    for (let i = 1; i < frames.length; i++) {
      step = Math.max(step, frames[i].jupiter.distanceTo(frames[i - 1].jupiter))
      expect(frames[i].jupiter.distanceTo(vsopJupiter)).toBeLessThanOrEqual(frames[i - 1].jupiter.distanceTo(vsopJupiter) + 1)
      expect(frames[i].earth.distanceTo(vsopEarth)).toBeLessThanOrEqual(frames[i - 1].earth.distanceTo(vsopEarth) + 1)
    }
    // Smoothstep's steepest: 1.5 of the error over HANDOVER_MS.
    expect(step).toBeLessThan(total * 1.5 * FRAME_MS / HANDOVER_MS * 1.05)
  })

  it('keeps a camera riding Earth where it was, and moves Jupiter in its sky by a hundredth of a degree a frame', () => {
    const {frames, camera, earth, vsopJupiter} = glide(J2000)
    expect(camera.position.x).toBe(3e7)
    expect(worldOf(camera).distanceTo(worldOf(earth))).toBeCloseTo(3e7, 3)
    let step = 0
    for (let i = 1; i < frames.length; i++) {
      step = Math.max(step, frames[i].view.angleTo(frames[i - 1].view) * DEG)
    }
    // Jupiter's whole shift, from the camera: the glide spreads it.
    const eye = frames[0].earth.clone().add(camera.position)
    const total = angleFrom(frames[0].jupiter, vsopJupiter, eye)
    expect(total).toBeGreaterThan(0.05)
    expect(step).toBeLessThan(0.01)
  })

  it('is a glide of the two at the frame\'s date, so a date set meanwhile is right too', () => {
    const {anim, clock} = newAnimation(null, J2000)
    const {root, earth} = newSystem()
    anim.animateAtJD(root, J2000)
    anim.setEphemeris(vsop87c)
    anim.animateAtJD(root, J2000)
    // Halfway through: the smoothstep's middle, half way between the two.
    clock.ms += HANDOVER_MS / 2
    const other = JD_2026
    anim.animateAtJD(root, other)
    const a = planetsApprox(other).earth
    const standIn = new Vector3(a.x, a.z, -a.y).multiplyScalar(ASTRO_UNIT_METER)
    const middle = standIn.add(sceneOf(vsop87c, 'earth', other)).multiplyScalar(0.5)
    expect(earth.position.distanceTo(middle)).toBeLessThan(1)
    clock.ms += HANDOVER_MS
    anim.animateAtJD(root, other)
    expect(earth.position.distanceTo(sceneOf(vsop87c, 'earth', other))).toBeLessThan(1)
  })

  it('is no glide for an Animation that has the series from the start', () => {
    const {anim} = newAnimation(vsop87c)
    const {root, earth} = newSystem()
    anim.animateAtJD(root, JD_2026)
    expect(earth.position.distanceTo(sceneOf(vsop87c, 'earth', JD_2026))).toBeLessThan(1)
    expect(anim._handover).toBeNull()
  })

  it('tells its listener when the series is in', () => {
    const {anim} = newAnimation(null)
    let told = 0
    anim.onEphemeris = () => told++
    anim.setEphemeris(vsop87c)
    anim.setEphemeris(vsop87c)
    expect(told).toBe(1)
  })
})


describe('the planets\' orbit lines across the hand-over', () => {
  /**
   * Planet.load's orbit graph for Earth.
   *
   * @returns {{root: Object3D, orbitPosition: Object3D, shape: Object3D}}
   */
  function earthGraph() {
    const root = new Object3D
    const orbitPlane = new Object3D
    root.add(orbitPlane)
    const o = earthJson.orbit
    const orbit = {...o, semiMajorAxis: {scalar: o.semiMajorAxis}, siderealOrbitPeriod: {scalar: o.siderealOrbitPeriod}}
    const shape = Planet.prototype.newOrbit.call(null, {}, orbit)
    orbitPlane.add(shape)
    const orbitPosition = new Object3D
    orbitPosition.name = 'earth.orbitPosition'
    orbitPosition.orbit = orbit
    orbitPosition.orbitShape = shape
    orbitPosition.bodyRadius = parseFloat(earthJson.radius)
    orbitPlane.add(orbitPosition)
    return {root, orbitPosition, shape}
  }

  it('are drawn at once from the stand-in, then rebuilt on the series', () => {
    const {anim, clock} = newAnimation(null)
    anim.orbitPaths.budgetMs = Infinity
    anim.orbitPaths.catchUpBudgetMs = Infinity
    const g = earthGraph()
    anim.animateAtJD(g.root, J2000)
    const path = g.orbitPosition.orbitPath
    expect(g.shape.line.visible).toBe(true)
    expect(path.builtApproximate).toBe(true)
    const before = Float64Array.from(path.drawn.coarse)
    anim.setEphemeris(vsop87c)
    clock.ms += 10
    anim.animateAtJD(g.root, J2000)
    expect(path.builtApproximate).toBe(false)
    // The same line, to the stand-in's error: the Earth-Moon barycentre's
    // path, a few thousand km out of 1.5e8.
    const after = path.drawn.coarse
    let worst = 0
    for (let i = 0; i < after.length; i += 3) {
      worst = Math.max(worst, Math.hypot(after[i] - before[i], after[i + 1] - before[i + 1], after[i + 2] - before[i + 2]))
    }
    expect(worst).toBeGreaterThan(0)
    expect(worst).toBeLessThan(1e8)
  })

  it('are rebuilt when the series comes in part way through a build', () => {
    const {anim} = newAnimation(null)
    // A few slices a frame, on a counting clock.
    let ticks = 0
    anim.orbitPaths = new OrbitPaths
    anim.orbitPaths.clock = () => ticks++
    anim.orbitPaths.budgetMs = 3
    anim.orbitPaths.catchUpBudgetMs = 3
    const g = earthGraph()
    anim.animateAtJD(g.root, J2000)
    const path = g.orbitPosition.orbitPath
    expect(anim.orbitPaths.job).not.toBeNull()
    expect(path.centre).toBeNull()
    anim.setEphemeris(vsop87c)
    for (let frame = 0; frame < 4000 && (path.centre === null || path.builtApproximate); frame++) {
      anim.animateAtJD(g.root, J2000)
    }
    expect(path.centre).toBe(J2000)
    expect(path.builtApproximate).toBe(false)
  })
})
