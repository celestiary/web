import {describe, expect, it} from 'bun:test'
import {Object3D, PerspectiveCamera, Quaternion, Vector3} from 'three'
import CameraPath, {
  EASINGS, ease, fromSpherical, lerp, lookQuaternion, toSpherical, unwrapDegrees,
} from './tour.js'
import TourDriver, {MAX_STEP_MS} from './tourDriver.js'
import {HOME_TOUR_KEYFRAMES, HOME_TOUR_STILL_MS, homeTour} from './homeTour.js'
import * as Shared from './shared.js'


const X = new Vector3(1, 0, 0)


/**
 * @param {Quaternion} q A camera's world orientation
 * @returns {Vector3} Where it looks
 */
function forward(q) {
  return new Vector3(0, 0, -1).applyQuaternion(q)
}


describe('easing', () => {
  it('each runs 0 to 1, held to its ends', () => {
    for (const name of Object.keys(EASINGS)) {
      expect(ease(name, 0)).toBeCloseTo(0, 12)
      expect(ease(name, 1)).toBeCloseTo(1, 12)
      expect(ease(name, -1)).toBeCloseTo(0, 12)
      expect(ease(name, 2)).toBeCloseTo(1, 12)
    }
  })

  it('inOut is at rest at both ends and halfway at the middle', () => {
    const d = 1e-4
    expect(ease('inOut', 0.5)).toBeCloseTo(0.5, 12)
    expect(ease('inOut', d) / d).toBeLessThan(0.01)
    expect((1 - ease('inOut', 1 - d)) / d).toBeLessThan(0.01)
  })

  it('in starts at rest, out ends at rest', () => {
    const d = 1e-4
    expect(ease('in', d) / d).toBeLessThan(0.01)
    expect((1 - ease('out', 1 - d)) / d).toBeLessThan(0.01)
    expect(ease('linear', 0.3)).toBeCloseTo(0.3, 12)
  })

  it('is monotonic', () => {
    for (const name of Object.keys(EASINGS)) {
      let last = -1
      for (let t = 0; t <= 1; t += 0.01) {
        const v = ease(name, t)
        expect(v).toBeGreaterThanOrEqual(last)
        last = v
      }
    }
  })

  it('an unknown name is inOut', () => {
    expect(ease('bouncy', 0.25)).toBeCloseTo(ease('inOut', 0.25), 12)
    expect(ease(undefined, 0.25)).toBeCloseTo(ease('inOut', 0.25), 12)
  })
})


describe('spherical offsets', () => {
  it('az 0 is the reference, 90 a quarter turn counterclockwise seen from the north', () => {
    const v = fromSpherical(0, 0, 2, X)
    expect(v.x).toBeCloseTo(2, 9)
    const q = fromSpherical(90, 0, 1, X)
    expect(q.x).toBeCloseTo(0, 9)
    expect(q.z).toBeCloseTo(-1, 9)
    const up = fromSpherical(0, 90, 1, X)
    expect(up.y).toBeCloseTo(1, 9)
  })

  it('toSpherical inverts fromSpherical', () => {
    const ref = new Vector3(0.6, 0, -0.8)
    for (const [az, el, dist] of [[30, 10, 5e7], [-120, -40, 3], [179, 0, 1e19], [0, 85, 1]]) {
      const s = toSpherical(fromSpherical(az, el, dist, ref), ref)
      expect(s.az).toBeCloseTo(az, 8)
      expect(s.el).toBeCloseTo(el, 8)
      expect(s.dist / dist).toBeCloseTo(1, 12)
    }
  })

  it('unwraps an angle to within half a turn of another', () => {
    expect(unwrapDegrees(350, 10)).toBe(-10)
    expect(unwrapDegrees(-170, 170)).toBe(190)
    expect(unwrapDegrees(20, 30)).toBe(20)
  })

  it('lookQuaternion faces the target, its up the ecliptic north', () => {
    const q = lookQuaternion(new Vector3(0, 0, 10), new Vector3(0, 0, 0))
    expect(forward(q).z).toBeCloseTo(-1, 9)
    const up = new Vector3(0, 1, 0).applyQuaternion(q)
    expect(up.y).toBeCloseTo(1, 9)
    // Straight down still has a basis.
    const down = lookQuaternion(new Vector3(0, 10, 0), new Vector3(0, 0, 0))
    expect(forward(down).y).toBeCloseTo(-1, 6)
    expect(Number.isFinite(down.w)).toBe(true)
  })

  it('lerp', () => {
    expect(lerp(2, 4, 0.25)).toBe(2.5)
  })
})


describe('a camera path', () => {
  // Two bodies on the x axis: the Sun at the origin, Earth at 1e11; each
  // one's reference toward the other.
  const SUN = {pos: new Vector3(0, 0, 0), ref: new Vector3(1, 0, 0)}
  const EARTH = {pos: new Vector3(1e11, 0, 0), ref: new Vector3(-1, 0, 0)}
  const bodyAt = (name) => (name === 'sun' ? SUN : EARTH)

  const path = new CameraPath([
    {at: 0, body: 'earth', dist: 1e7, az: 0, el: 0, fov: 45},
    {at: 1000, body: 'earth', dist: 1e9, az: 270, el: 30, fov: 20, ease: 'linear'},
    {at: 3000, body: 'sun', dist: 1e10, az: 0, el: 0, fov: 20, turn: 0.5, ease: 'linear'},
  ])

  it('needs a keyframe', () => {
    expect(() => new CameraPath([])).toThrow()
  })

  it('is as long as its last keyframe', () => {
    expect(path.duration).toBe(3000)
  })

  it('finds the segment and its eased progress', () => {
    const s = path.segmentAt(500)
    expect(s.k0.at).toBe(0)
    expect(s.k1.at).toBe(1000)
    expect(s.u).toBeCloseTo(0.5, 12)
    const late = path.segmentAt(2000)
    expect(late.k0.at).toBe(1000)
    expect(late.u).toBeCloseTo(0.5, 12)
    // The turn takes the first half of the segment: done by its middle.
    expect(late.uLook).toBeCloseTo(1, 12)
    expect(path.segmentAt(1500).uLook).toBeCloseTo(0.5, 12)
  })

  it('holds at its ends', () => {
    expect(path.segmentAt(-10).k1.at).toBe(0)
    expect(path.segmentAt(5000).k1.at).toBe(3000)
    const p = path.pose(5000, bodyAt)
    expect(p.position.distanceTo(new Vector3(1e10, 0, 0))).toBeLessThan(1)
  })

  it('a looping path wraps', () => {
    const loop = new CameraPath(path.keyframes, {loop: true})
    expect(loop.localTime(3500)).toBe(500)
    expect(loop.segmentAt(3500).k1.at).toBe(1000)
  })

  it('is at each keyframe at its time', () => {
    const p0 = path.pose(0, bodyAt)
    expect(p0.position.distanceTo(new Vector3(1e11 - 1e7, 0, 0))).toBeLessThan(1e-3)
    expect(p0.fov).toBeCloseTo(45, 9)
    expect(p0.body).toBe('earth')
    const p1 = path.pose(1000, bodyAt)
    const want = fromSpherical(270, 30, 1e9, EARTH.ref).add(EARTH.pos)
    expect(p1.position.distanceTo(want)).toBeLessThan(1e-2)
    expect(p1.fov).toBeCloseTo(20, 9)
  })

  it('moves about one body by azimuth, elevation and the log of distance', () => {
    const mid = path.pose(500, bodyAt)
    const s = toSpherical(mid.position.clone().sub(EARTH.pos), EARTH.ref)
    // Halfway: 135° round (not the 90° the short way), 15° up, at the
    // geometric mean of the distances.
    expect(unwrapDegrees(s.az, 135)).toBeCloseTo(135, 6)
    expect(s.el).toBeCloseTo(15, 6)
    expect(s.dist).toBeCloseTo(1e8, -1)
    // The field's halfway is geometric too.
    expect(mid.fov).toBeCloseTo(Math.sqrt(45 * 20), 6)
    // Facing the body.
    const toEarth = EARTH.pos.clone().sub(mid.position).normalize()
    expect(forward(mid.quaternion).dot(toEarth)).toBeCloseTo(1, 9)
  })

  it('between two bodies, starts where the first keyframe left it and closes in geometrically', () => {
    // At the segment's start, the camera is at keyframe 1's place, though
    // expressed about the Sun.
    const start = path.pose(1000.000001, bodyAt)
    const k1 = fromSpherical(270, 30, 1e9, EARTH.ref).add(EARTH.pos)
    expect(start.position.distanceTo(k1) / 1e9).toBeLessThan(1e-6)
    expect(start.body).toBe('sun')
    // Halfway, at the geometric mean of the distances from the Sun.
    const from = k1.length()
    const mid = path.pose(2000, bodyAt)
    expect(mid.position.length() / Math.sqrt(from * 1e10)).toBeCloseTo(1, 6)
    // And the turn from Earth to the Sun is done by then.
    const toSun = mid.position.clone().negate().normalize()
    expect(forward(mid.quaternion).dot(toSun)).toBeCloseTo(1, 6)
  })

  it('turns from one body to the next over its turn, by the shortest way', () => {
    const t = 1500 // a quarter of the segment: half the turn
    const p = path.pose(t, bodyAt)
    const toEarth = EARTH.pos.clone().sub(p.position).normalize()
    const toSun = p.position.clone().negate().normalize()
    const f = forward(p.quaternion)
    const angle = toEarth.angleTo(toSun)
    // Within a milliradian: the slerp is of whole orientations, each with
    // its up the ecliptic's north, so a little roll goes with the turn.
    expect(f.angleTo(toEarth)).toBeCloseTo(angle / 2, 2)
    expect(f.angleTo(toSun)).toBeCloseTo(angle / 2, 2)
  })

  it('has a date where both ends give one', () => {
    const dated = new CameraPath([
      {at: 0, body: 'sun', dist: 1e10, az: 0, el: 0, fov: 45, days: 0},
      {at: 1000, body: 'sun', dist: 1e10, az: 0, el: 0, fov: 45, days: 2, ease: 'linear'},
      {at: 2000, body: 'sun', dist: 1e10, az: 0, el: 0, fov: 45},
    ])
    expect(dated.pose(250, bodyAt).days).toBeCloseTo(0.5, 12)
    expect(dated.pose(1500, bodyAt).days).toBe(null)
  })
})


describe('the homepage\'s tour', () => {
  it('starts near the Sun, passes over Earth, and goes out to the stars', () => {
    const tour = homeTour()
    expect(tour.loop).toBe(true)
    const kfs = HOME_TOUR_KEYFRAMES
    expect(kfs[0].body).toBe('sun')
    expect(kfs[0].dist).toBeLessThan(10 * Shared.SUN_RADIUS_METER)
    const earth = kfs.filter((k) => k.body === 'earth')
    expect(earth.length).toBeGreaterThanOrEqual(2)
    // The pass crosses toward the terminator: azimuth past 90°.
    expect(Math.max(...earth.map((k) => k.az))).toBeGreaterThan(90)
    expect(Math.min(...earth.map((k) => k.az))).toBeLessThan(60)
    const last = kfs[kfs.length - 1]
    expect(last.body).toBe('sun')
    expect(last.dist).toBeGreaterThan(1000 * Shared.LIGHTYEAR_METER)
  })

  it('is calm: no segment covers more than a decade of distance a second', () => {
    const kfs = HOME_TOUR_KEYFRAMES
    for (let i = 1; i < kfs.length; i++) {
      if (kfs[i].body !== kfs[i - 1].body) {
        continue
      }
      const decades = Math.abs(Math.log10(kfs[i].dist / kfs[i - 1].dist))
      const seconds = (kfs[i].at - kfs[i - 1].at) / 1000
      expect(decades / seconds).toBeLessThan(1)
    }
  })

  it('its still is over Earth', () => {
    expect(homeTour().segmentAt(HOME_TOUR_STILL_MS).k1.body).toBe('earth')
  })
})


describe('playing a path on the scene', () => {
  /** @returns {object} A scene with a Sun and an Earth, and a camera on a platform */
  function makeWorld() {
    const root = new Object3D()
    const objects = {}
    for (const [name, x] of [['sun', 0], ['earth', 1.5e11]]) {
      const orbitPosition = new Object3D()
      orbitPosition.position.set(x, 0, 0)
      const body = new Object3D()
      body.orbitPosition = orbitPosition
      orbitPosition.add(body)
      root.add(orbitPosition)
      objects[name] = body
    }
    const camera = new PerspectiveCamera(45, 1, 1, 1e20)
    camera.platform = new Object3D()
    camera.platform.add(camera)
    root.add(camera.platform)
    const calls = []
    const scene = {
      objects,
      setTarget: (name) => calls.push(['setTarget', name]),
      goTo: () => {
        // As Scene.goTo: hang the platform on the target's orbit, keeping
        // the camera's world pose.
        const name = calls.filter((c) => c[0] === 'setTarget').pop()[1]
        const pos = camera.getWorldPosition(new Vector3())
        const quat = camera.getWorldQuaternion(new Quaternion())
        objects[name].orbitPosition.add(camera.platform)
        camera.platform.updateWorldMatrix(true, false)
        camera.position.copy(camera.platform.worldToLocal(pos))
        camera.quaternion.copy(camera.platform.getWorldQuaternion(new Quaternion()).invert().multiply(quat))
        Shared.targets.tween = {fake: true}
        calls.push(['goTo', name])
      },
    }
    const ui = {
      camera,
      setFov: (fov) => {
        camera.fov = fov
      },
      dimCanvas: () => calls.push(['dim']),
      showCanvas: () => calls.push(['show']),
    }
    return {root, objects, camera, scene, ui, calls}
  }

  const PATH = new CameraPath([
    {at: 0, body: 'sun', dist: 5e9, az: 90, el: 0, fov: 45},
    {at: 1000, body: 'earth', dist: 2e7, az: 30, el: 10, fov: 40},
    {at: 2000, body: 'earth', dist: 2e7, az: 100, el: 10, fov: 40},
  ], {loop: true})

  it('puts the camera where the path says, in the frame of the body it\'s about', () => {
    const w = makeWorld()
    const driver = new TourDriver({scene: w.scene, ui: w.ui})
    driver.start(PATH)
    driver.frame(0)
    expect(w.calls.slice(0, 2)).toEqual([['setTarget', 'sun'], ['goTo', 'sun']])
    // The flight a go starts is dropped: the path moves the camera.
    expect(Shared.targets.tween).toBe(null)
    const want = PATH.pose(0, (n) => driver.bodyAt(n))
    expect(w.camera.getWorldPosition(new Vector3()).distanceTo(want.position)).toBeLessThan(1)
    expect(w.camera.getWorldQuaternion(new Quaternion()).angleTo(want.quaternion)).toBeLessThan(1e-6)
  })

  it('holds at the start until played, then steps by the frame clock, capped', () => {
    const w = makeWorld()
    const driver = new TourDriver({scene: w.scene, ui: w.ui})
    driver.start(PATH)
    driver.frame(0)
    driver.frame(500)
    expect(driver.t).toBe(0)
    driver.play()
    driver.frame(1000)
    driver.frame(1016)
    expect(driver.t).toBe(16)
    // A long gap (a stalled tab) moves it at most MAX_STEP_MS.
    driver.frame(10000)
    expect(driver.t).toBe(16 + MAX_STEP_MS)
  })

  it('doesn\'t move while the page is hidden', () => {
    const w = makeWorld()
    const driver = new TourDriver({scene: w.scene, ui: w.ui})
    const savedDoc = globalThis.document
    try {
      driver.start(PATH)
      driver.play()
      driver.frame(0)
      globalThis.document = {hidden: true}
      driver.frame(16)
      driver.frame(32)
      expect(driver.t).toBe(0)
      globalThis.document = {hidden: false}
      driver.frame(48)
      expect(driver.t).toBe(16)
    } finally {
      globalThis.document = savedDoc
    }
  })

  it('changes frame as it goes on to the next body', () => {
    const w = makeWorld()
    const driver = new TourDriver({scene: w.scene, ui: w.ui})
    driver.start(PATH)
    driver.play()
    for (let t = 0; t <= 600; t += 16) {
      driver.frame(t)
    }
    expect(driver.frameBody).toBe('earth')
    expect(w.camera.platform.parent).toBe(w.objects.earth.orbitPosition)
  })

  it('a still path never moves', () => {
    const w = makeWorld()
    const driver = new TourDriver({scene: w.scene, ui: w.ui})
    driver.start(PATH, {still: 1500})
    driver.play()
    driver.frame(0)
    const at = w.camera.getWorldPosition(new Vector3())
    driver.frame(100)
    driver.frame(200)
    expect(driver.t).toBe(1500)
    expect(w.camera.getWorldPosition(new Vector3()).distanceTo(at)).toBeLessThan(1e-3)
    expect(driver.frameBody).toBe('earth')
  })

  it('a loop fades to black over its end and back over its start', () => {
    const w = makeWorld()
    const driver = new TourDriver({scene: w.scene, ui: w.ui})
    driver.start(PATH, {loopFadeMs: 300})
    driver.play()
    for (let t = 0; t <= 2400; t += 16) {
      driver.frame(t)
    }
    const fades = w.calls.filter((c) => c[0] === 'dim' || c[0] === 'show').map((c) => c[0])
    expect(fades).toEqual(['dim', 'show'])
  })

  it('stopping leaves the camera where it is, and shows a dimmed canvas', () => {
    const w = makeWorld()
    const driver = new TourDriver({scene: w.scene, ui: w.ui})
    driver.start(PATH, {loopFadeMs: 300})
    driver.play()
    for (let t = 0; t <= 1900; t += 16) {
      driver.frame(t)
    }
    const at = w.camera.getWorldPosition(new Vector3())
    driver.stop()
    driver.frame(2000)
    expect(driver.active).toBe(false)
    expect(w.camera.getWorldPosition(new Vector3()).distanceTo(at)).toBe(0)
    expect(w.calls[w.calls.length - 1]).toEqual(['show'])
  })
})
