import {describe, expect, it} from 'bun:test'
import {Object3D, Quaternion, Vector3} from 'three'
import vsop87cLoader from 'vsop87/dist/vsop87c-wasm'
import Animation from './Animation.js'
import Planet from './Planet.js'
import {meanElements, orbitAt} from './meanElements.js'
import {
  JUPITER_SATURN_SAMPLES,
  REBUILD_FRACTION,
  SUN_GM_M3_PER_DAY2,
  lagrange4,
  osculatingEllipse,
} from './orbitPath.js'
import earth from '../../public/data/earth.json'
import europa from '../../public/data/europa.json'
import io from '../../public/data/io.json'
import jupiter from '../../public/data/jupiter.json'
import mars from '../../public/data/mars.json'
import mercury from '../../public/data/mercury.json'
import moon from '../../public/data/moon.json'
import neptune from '../../public/data/neptune.json'
import phobos from '../../public/data/phobos.json'
import pluto from '../../public/data/pluto.json'
import saturn from '../../public/data/saturn.json'
import titan from '../../public/data/titan.json'
import triton from '../../public/data/triton.json'
import uranus from '../../public/data/uranus.json'
import venus from '../../public/data/venus.json'


const vsop87c = await vsop87cLoader

// 2026-09-29 14:25 UTC, and two dates far from J2000.
const JD_2026 = 2461313.1007
const JD_1900 = 2415020.5
const JD_2500 = 2634166.5
const DATES = [JD_2026, JD_1900, JD_2500]
const SECONDS_PER_DAY = 86400

const PLANETS = {mercury, venus, earth, mars, jupiter, saturn, uranus, neptune}
const MEAN_ELEMENT_BODIES = {io, europa, titan, triton, phobos, pluto}

// The body's distance from its line, as a fraction of the semi-major axis.
// A 1000-segment line's chords are within 5e-6 of the curve; the sampled
// paths' interpolation adds less than that.
const TOLERANCE = 1e-5


/**
 * Set how long a frame may spend rebuilding orbit lines.
 *
 * @param {Animation} anim
 * @param {number} ms
 */
function budget(anim, ms) {
  anim.orbitPaths.budgetMs = ms
  anim.orbitPaths.hiddenBudgetMs = ms
}


/**
 * A clock the tests set.
 *
 * @returns {object}
 */
function newTime() {
  const time = {jd: JD_2026}
  time.simTimeJulianDay = () => time.jd
  time.simTimeDays = () => time.jd - 2440587.5
  time.simTimeSecs = () => (time.jd - 2440587.5) * SECONDS_PER_DAY
  return time
}


/**
 * A body's orbit as the app reifies it (Measures for the lengths).
 *
 * @param {object} props JSON descriptor
 * @returns {object}
 */
function reified(props) {
  const o = props.orbit
  return {
    ...o,
    semiMajorAxis: {scalar: o.semiMajorAxis},
    siderealOrbitPeriod: {scalar: o.siderealOrbitPeriod},
  }
}


/**
 * Planet.load's orbit graph for one body: orbitPlane holds the orbit line
 * (Planet.newOrbit's, the app's own) beside the orbitPosition Animation
 * moves; both are in the primary's unrotated frame.
 *
 * @param {string} name
 * @param {object} props JSON descriptor
 * @returns {{root: Object3D, orbitPosition: Object3D, shape: Object3D}}
 */
function orbitGraph(name, props) {
  const root = new Object3D
  const orbitPlane = new Object3D
  root.add(orbitPlane)
  const orbit = reified(props)
  const shape = Planet.prototype.newOrbit.call(null, {}, orbit)
  orbitPlane.add(shape)
  const orbitPosition = new Object3D
  orbitPosition.name = `${name}.orbitPosition`
  orbitPosition.orbit = orbit
  orbitPosition.elements = meanElements(orbit)
  orbitPosition.orbitShape = shape
  orbitPlane.add(orbitPosition)
  return {root, orbitPosition, shape}
}


/**
 * Distance from a point to a polyline.
 *
 * @param {Vector3} p
 * @param {Float32Array} xyz the line's vertices
 * @param {object} matrix the line's transform to p's frame
 * @returns {number}
 */
function distanceToLine(p, xyz, matrix) {
  const a = new Vector3
  const b = new Vector3
  const ab = new Vector3
  const ap = new Vector3
  let best = Infinity
  for (let j = 0; j + 5 < xyz.length; j += 3) {
    a.fromArray(xyz, j).applyMatrix4(matrix)
    b.fromArray(xyz, j + 3).applyMatrix4(matrix)
    ab.subVectors(b, a)
    ap.subVectors(p, a)
    const s = Math.min(Math.max(ap.dot(ab) / ab.lengthSq(), 0), 1)
    best = Math.min(best, ap.distanceTo(ab.multiplyScalar(s)))
  }
  return best
}


/**
 * How far a body is from its orbit line, as drawn now, relative to a.
 *
 * @param {object} g orbitGraph
 * @returns {number}
 */
function offLine(g) {
  g.shape.updateMatrix()
  g.shape.line.updateMatrix()
  const matrix = g.shape.matrix.clone().multiply(g.shape.line.matrix)
  const xyz = g.shape.line.geometry.attributes.position.array
  return distanceToLine(g.orbitPosition.position, xyz, matrix) / g.orbitPosition.orbit.semiMajorAxis.scalar
}


describe('orbitPath helpers', () => {
  it('interpolates a cubic exactly', () => {
    const f = (u) => new Vector3((u ** 3) - (2 * u), 1 - (u * u), 3 * u)
    const ys = [0, 1, 2, 3, 4, 5].map(f)
    for (const u of [0.25, 1.5, 2.9, 4.75]) {
      expect(lagrange4(ys, u, new Vector3).distanceTo(f(u))).toBeLessThan(1e-12)
    }
  })


  it('recovers a Kepler orbit from a position and velocity', () => {
    // Pluto's elements, as a two-body orbit about the Sun.
    const el = {
      ...meanElements(pluto.orbit),
      epoch: JD_2026, aRate: 0, eRate: 0, iRate: 0, nodeRate: 0, wRate: 0,
    }
    el.mRate = Math.sqrt(SUN_GM_M3_PER_DAY2 / (el.a ** 3)) / (Math.PI / 180)
    const r = new Vector3
    orbitAt(el, JD_2026, new Quaternion, r)
    const dt = 1
    const ahead = new Vector3
    const behind = new Vector3
    orbitAt(el, JD_2026 + dt, new Quaternion, ahead)
    orbitAt(el, JD_2026 - dt, new Quaternion, behind)
    const v = ahead.sub(behind).divideScalar(2 * dt)
    const osc = osculatingEllipse(r, v, SUN_GM_M3_PER_DAY2)
    expect(osc.a / el.a).toBeCloseTo(1, 6)
    expect(osc.e).toBeCloseTo(el.e, 6)
  })


  it('makes no ellipse of a body that doesn\'t move', () => {
    expect(osculatingEllipse(new Vector3(1e11, 0, 0), new Vector3, SUN_GM_M3_PER_DAY2)).toBeNull()
  })
})


describe('orbit lines follow the computed paths', () => {
  const bodies = {...PLANETS, moon}
  for (const [name, props] of Object.entries(bodies)) {
    it(`puts ${name} on its line, near the build date and across the window, at three dates`, () => {
      const time = newTime()
      const anim = new Animation(time, vsop87c)
      budget(anim, Infinity)
      const g = orbitGraph(name, props)
      const periodDays = props.orbit.siderealOrbitPeriod / SECONDS_PER_DAY
      for (const jd of DATES) {
        // A jump: the old line doesn't hold the body, so it's hidden, then
        // rebuilt around the new date.
        time.jd = jd
        anim.animateAtJD(g.root, jd)
        expect(g.shape.line.visible).toBe(true)
        expect(g.orbitPosition.orbitPath.centre).toBe(jd)
        expect(offLine(g)).toBeLessThan(TOLERANCE)
        // Later, without a rebuild (the line turns with the precession).
        budget(anim, 0)
        // Off the vertices' times (the Moon's are even in time).
        for (const f of [REBUILD_FRACTION * 0.537, 0.2331, -0.3117, 0.4893]) {
          const later = jd + (f * periodDays)
          anim.animateAtJD(g.root, later)
          expect(g.orbitPosition.orbitPath.centre).toBe(jd)
          expect(g.shape.line.visible).toBe(true)
          expect(offLine(g)).toBeLessThan(TOLERANCE)
        }
        budget(anim, Infinity)
      }
    })
  }


  it('hides a line whose window no longer holds its body, until rebuilt', () => {
    const time = newTime()
    const anim = new Animation(time, vsop87c)
    budget(anim, Infinity)
    const g = orbitGraph('mars', mars)
    anim.animateAtJD(g.root, JD_2026)
    expect(g.shape.line.visible).toBe(true)
    budget(anim, 0)
    anim.animateAtJD(g.root, JD_2026 + 1000)
    expect(g.shape.line.visible).toBe(false)
    budget(anim, Infinity)
    anim.animateAtJD(g.root, JD_2026 + 1000)
    anim.animateAtJD(g.root, JD_2026 + 1000)
    expect(g.shape.line.visible).toBe(true)
    expect(offLine(g)).toBeLessThan(TOLERANCE)
  })


  it('rebuilds after a fiftieth of a period, not before', () => {
    const time = newTime()
    const anim = new Animation(time, vsop87c)
    budget(anim, Infinity)
    const g = orbitGraph('mercury', mercury)
    const periodDays = mercury.orbit.siderealOrbitPeriod / SECONDS_PER_DAY
    anim.animateAtJD(g.root, JD_2026)
    anim.animateAtJD(g.root, JD_2026 + (periodDays * REBUILD_FRACTION * 0.9))
    expect(g.orbitPosition.orbitPath.centre).toBe(JD_2026)
    const later = JD_2026 + (periodDays * REBUILD_FRACTION * 1.1)
    anim.animateAtJD(g.root, later)
    expect(g.orbitPosition.orbitPath.centre).toBe(later)
  })


  it('rebuilds a planet in a few dozen VSOP87 calls, a slice per frame', () => {
    const time = newTime()
    let calls = 0
    const anim = new Animation(time, (jd) => {
      calls++
      return vsop87c(jd)
    })
    const g = orbitGraph('saturn', saturn)
    budget(anim, 0)
    calls = 0
    anim.animateAtJD(g.root, JD_2026)
    // The frame's own; the rebuild waits for a budget.
    expect(calls).toBe(1)
    expect(g.shape.line.visible).toBe(false)
    budget(anim, Infinity)
    calls = 0
    anim.animateAtJD(g.root, JD_2026)
    // The frame's, the centre and its neighbours for the velocity, and the
    // samples (the centre's reused).
    expect(calls).toBe(1 + 3 + JUPITER_SATURN_SAMPLES)
    expect(anim.orbitPaths.lastBuildMs).toBeGreaterThan(0)
    expect(g.shape.line.visible).toBe(true)
  })
})


describe('mean-element bodies stay on their ellipses of date', () => {
  for (const [name, props] of Object.entries(MEAN_ELEMENT_BODIES)) {
    it(`puts ${name} on its line at three dates`, () => {
      const time = newTime()
      const anim = new Animation(time, vsop87c)
      const g = orbitGraph(name, props)
      for (const jd of DATES) {
        time.jd = jd
        anim.animateAtJD(g.root, jd)
        expect(g.orbitPosition.orbitPath).toBeUndefined()
        expect(offLine(g)).toBeLessThan(TOLERANCE)
      }
    })
  }
})
