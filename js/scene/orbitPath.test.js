import {describe, expect, it} from 'bun:test'
import {Object3D, Quaternion, Vector3} from 'three'
import vsop87cLoader from 'vsop87/dist/vsop87c-wasm'
import Animation from './Animation.js'
import Planet from './Planet.js'
import {meanElements, orbitAt} from './meanElements.js'
import {
  JUPITER_SATURN_SAMPLES,
  OrbitPath,
  OrbitPaths,
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
  anim.orbitPaths.catchUpBudgetMs = ms
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
        // A jump: the line is rebuilt around the new date, within the
        // frame on an unlimited budget.
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


  it('keeps drawing the old line after a jump, until the new one is built', () => {
    const time = newTime()
    const anim = new Animation(time, vsop87c)
    budget(anim, Infinity)
    const g = orbitGraph('mars', mars)
    anim.animateAtJD(g.root, JD_2026)
    expect(g.shape.line.visible).toBe(true)
    const before = Float32Array.from(g.shape.line.geometry.attributes.position.array)
    budget(anim, 0)
    anim.animateAtJD(g.root, JD_2026 + 1000)
    expect(g.shape.line.visible).toBe(true)
    expect(g.orbitPosition.orbitPath.centre).toBe(JD_2026)
    expect(g.shape.line.geometry.attributes.position.array).toEqual(before)
    budget(anim, Infinity)
    anim.animateAtJD(g.root, JD_2026 + 1000)
    expect(g.shape.line.visible).toBe(true)
    expect(g.orbitPosition.orbitPath.centre).toBe(JD_2026 + 1000)
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


// What a VSOP87C call costs in Chromium (and bun), ms, and what the pump's
// every clock reading adds: the paced clock below makes the per-frame
// budgets deterministic.
const VSOP_CALL_MS = 2
const CLOCK_TICK_MS = 0.05
const DAYS_PER_YEAR = 365.25


/**
 * An Animation whose orbit-line pump runs on a clock that VSOP87C calls
 * advance by their real cost, with the app's own budgets.
 *
 * @param {object} time newTime
 * @returns {Animation}
 */
function pacedAnimation(time) {
  let ms = 0
  const anim = new Animation(time, (jd) => {
    ms += VSOP_CALL_MS
    return vsop87c(jd)
  })
  anim.orbitPaths.clock = () => {
    ms += CLOCK_TICK_MS
    return ms
  }
  return anim
}


/**
 * One frame at a date, as Animation.animate runs it.
 *
 * @param {Animation} anim
 * @param {object} time newTime
 * @param {Object3D} root
 * @param {number} jd
 */
function frame(anim, time, root, jd) {
  time.jd = jd
  anim.animateAtJD(root, jd)
}


/**
 * Watches an orbit line frame by frame: once drawn it must stay drawn, and
 * its vertices may change only when a rebuild completes (a new centre),
 * never part-way through one.
 *
 * @param {string} name
 * @param {object} g orbitGraph
 * @returns {object} with check(label) to call after each frame
 */
function lineWatch(name, g) {
  const line = g.shape.line
  const xyz = line.geometry.attributes.position.array
  const w = {name, g, shown: false, builds: 0, centre: null, last: Float32Array.from(xyz)}
  w.check = (label) => {
    const path = g.orbitPosition.orbitPath
    const centre = path ? path.centre : null
    const rebuilt = centre !== w.centre
    let changed = false
    for (let j = 0; j < xyz.length && !changed; j++) {
      changed = xyz[j] !== w.last[j]
    }
    expect(`${name} ${label}: vertices ${changed ? 'changed' : 'kept'}`)
        .toBe(`${name} ${label}: vertices ${changed && !rebuilt ? 'kept' : (changed ? 'changed' : 'kept')}`)
    if (rebuilt) {
      w.builds++
      w.centre = centre
      w.last.set(xyz)
    }
    if (w.shown) {
      expect(`${name} ${label}: ${line.visible ? 'drawn' : 'hidden'}`).toBe(`${name} ${label}: drawn`)
    }
    w.shown = w.shown || line.visible
  }
  return w
}


/**
 * @param {object} g orbitGraph
 * @returns {boolean} whether its line has been built
 */
function built(g) {
  const path = g.orbitPosition.orbitPath
  return Boolean(path) && path.centre !== null
}


describe('orbit lines under high time rates and jumps', () => {
  it('keeps Mercury\'s line drawn at 30 days a frame, swapping in whole rebuilds', () => {
    const time = newTime()
    const anim = pacedAnimation(time)
    const g = orbitGraph('mercury', mercury)
    const w = lineWatch('mercury', g)
    let jd = JD_2026
    for (let i = 0; i < 20 && !built(g); i++) {
      frame(anim, time, g.root, jd)
      w.check(`start ${i}`)
    }
    expect(g.shape.line.visible).toBe(true)
    const frames = 200
    for (let i = 0; i < frames; i++) {
      jd += 30
      frame(anim, time, g.root, jd)
      w.check(`frame ${i}`)
    }
    // It keeps up: a rebuild every few frames, each for a recent date.
    expect(w.builds).toBeGreaterThan(frames / 8)
    expect(jd - g.orbitPosition.orbitPath.centre).toBeLessThan(30 * 10)
    // Standing still, it catches up (on the steady budget: the last line
    // still holds the body), and holds the body.
    for (let i = 0; i < 30 && g.orbitPosition.orbitPath.centre !== jd; i++) {
      frame(anim, time, g.root, jd)
      w.check(`still ${i}`)
    }
    expect(g.orbitPosition.orbitPath.centre).toBe(jd)
    expect(offLine(g)).toBeLessThan(TOLERANCE)
  })


  it('keeps the lines drawn at a year a frame, and rebuilds them all in turn', () => {
    const time = newTime()
    const anim = pacedAnimation(time)
    const root = new Object3D
    // The cheapest and the dearest rebuilds (Neptune's is ~110 VSOP87
    // calls), and the Moon's, which has none.
    const watches = Object.entries({mercury, earth, jupiter, neptune, moon}).map(([name, props]) => {
      const g = orbitGraph(name, props)
      root.add(g.root)
      return lineWatch(name, g)
    })
    let jd = JD_2026
    const checkAll = (label) => watches.forEach((w) => w.check(label))
    for (let i = 0; i < 200 && !watches.every((w) => built(w.g)); i++) {
      frame(anim, time, root, jd)
      checkAll(`start ${i}`)
    }
    expect(watches.every((w) => built(w.g) && w.g.shape.line.visible)).toBe(true)
    // The rebuilds take turns: at 6 VSOP87 calls a frame, the five take
    // ~60 frames between them (Neptune's alone ~20).  None starves.
    const frames = 150
    const maxAge = 80
    const builds = watches.map((w) => w.builds)
    const lastBuilt = watches.map(() => 0)
    for (let i = 0; i < frames; i++) {
      jd += DAYS_PER_YEAR
      frame(anim, time, root, jd)
      checkAll(`frame ${i}`)
      watches.forEach((w, k) => {
        if (w.builds !== builds[k]) {
          builds[k] = w.builds
          lastBuilt[k] = i
        }
        expect(`${w.name} frame ${i}: built ${i - lastBuilt[k] <= maxAge ? 'lately' : 'long ago'}`)
            .toBe(`${w.name} frame ${i}: built lately`)
      })
    }
    const caughtUp = () => watches.every((w) => w.g.orbitPosition.orbitPath.centre === jd)
    for (let i = 0; i < 200 && !caughtUp(); i++) {
      frame(anim, time, root, jd)
      checkAll(`still ${i}`)
    }
    for (const w of watches) {
      expect(`${w.name} ${w.g.orbitPosition.orbitPath.centre}`).toBe(`${w.name} ${jd}`)
      expect(offLine(w.g)).toBeLessThan(TOLERANCE)
    }
  })


  it('keeps Earth\'s old line through a jump of millennia, then swaps in the new one', () => {
    const time = newTime()
    const anim = pacedAnimation(time)
    const g = orbitGraph('earth', earth)
    const w = lineWatch('earth', g)
    for (let i = 0; i < 20 && !built(g); i++) {
      frame(anim, time, g.root, JD_2026)
      w.check(`start ${i}`)
    }
    // Two jumps a frame apart: the second retargets the rebuild.
    const jumps = [JD_2026 + (3000 * DAYS_PER_YEAR), JD_2026 - (3000 * DAYS_PER_YEAR)]
    frame(anim, time, g.root, jumps[0])
    w.check('jump 0')
    frame(anim, time, g.root, jumps[1])
    w.check('jump 1')
    let i = 0
    for (; i < 20 && g.orbitPosition.orbitPath.centre !== jumps[1]; i++) {
      frame(anim, time, g.root, jumps[1])
      w.check(`after ${i}`)
    }
    expect(g.orbitPosition.orbitPath.centre).toBe(jumps[1])
    // Within a few frames of the catch-up budget.
    expect(i).toBeLessThan(8)
    expect(offLine(g)).toBeLessThan(TOLERANCE)
  })
})


describe('orbit lines refuse non-finite dates and samples', () => {
  /**
   * @param {function(number, Vector3): Vector3} positionAt
   * @returns {{path: OrbitPath, xyz: Float32Array}}
   */
  function moonLikePath(positionAt) {
    const shape = Planet.prototype.newOrbit.call(null, {}, reified(moon))
    const path = new OrbitPath(shape.line, {positionAt, periodDays: 27.3})
    return {path, xyz: shape.line.geometry.attributes.position.array}
  }
  const circle = (jd, target) => target.set(Math.cos(jd), 0, Math.sin(jd)).multiplyScalar(4e8)


  it('ignores a request for a non-finite date', () => {
    const {path} = moonLikePath(circle)
    const paths = new OrbitPaths
    for (const jd of [NaN, Infinity, -Infinity]) {
      paths.request(path, jd)
    }
    expect(paths.queue.length).toBe(0)
    paths.request(path, JD_2026)
    paths.request(path, NaN)
    expect(path.pendingJd).toBe(JD_2026)
  })


  it('builds nothing for a non-finite date', () => {
    const {path, xyz} = moonLikePath(circle)
    const before = Float32Array.from(xyz)
    for (const jd of [NaN, Infinity]) {
      expect([...path.build(jd)].length).toBe(0)
    }
    expect(path.centre).toBeNull()
    expect(xyz).toEqual(before)
  })


  it('keeps the last line when the ephemeris gives a non-finite sample', () => {
    let bad = false
    const {path, xyz} = moonLikePath((jd, target) => (bad ? target.set(NaN, 0, 0) : circle(jd, target)))
    const paths = new OrbitPaths
    paths.request(path, JD_2026)
    paths.pump(Infinity)
    expect(path.centre).toBe(JD_2026)
    expect(path.line.visible).toBe(true)
    const good = Float32Array.from(xyz)
    bad = true
    paths.request(path, JD_2026 + 100)
    paths.pump(Infinity)
    expect(path.centre).toBe(JD_2026)
    expect(path.line.visible).toBe(true)
    expect(xyz).toEqual(good)
  })


  it('leaves the bodies and lines where they were for a non-finite date', () => {
    const time = newTime()
    time.updateTime = () => {}
    const anim = new Animation(time, vsop87c)
    budget(anim, Infinity)
    const g = orbitGraph('mars', mars)
    anim.animateAtJD(g.root, JD_2026)
    const position = g.orbitPosition.position.clone()
    const xyz = Float32Array.from(g.shape.line.geometry.attributes.position.array)
    for (const jd of [NaN, Infinity, -Infinity]) {
      time.jd = jd
      anim.animateAtJD(g.root, jd)
      anim.animate(g.root)
    }
    expect(g.orbitPosition.position).toEqual(position)
    expect(g.orbitPosition.orbitPath.centre).toBe(JD_2026)
    expect(g.shape.line.geometry.attributes.position.array).toEqual(xyz)
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
