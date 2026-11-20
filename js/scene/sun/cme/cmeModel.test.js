import {describe, expect, it} from 'bun:test'
import {CME_DEPS} from '../SunLayers.js'
import {cmesAt} from '../solarEvents.js'
import {
  ALPHA,
  CORE_OFFSET,
  CORE_RADIUS,
  ERUPTION_MAX_HEIGHT,
  ERUPTIVE_SHARE,
  KAPPA,
  KIND_CORE,
  KIND_ROPE,
  KIND_SHEATH,
  PSI_MAX,
  SHARE,
  STRANDS,
  STRAND_GLSL,
  cmeModel,
  envelope,
  frontRadius,
  solveApex,
  strandPoint,
  tubeScale,
} from './cmeModel.js'


const {shapeOf, buildStrands} = cmeModel(CME_DEPS)
const DEG = Math.PI / 180
const cme = (front, {launch = 1.7e12, width = 25 * DEG} = {}) =>
  ({launch, front, speed: 450, width, mass: 1e15, source: {lat: 10, lon: 20}})
const strands = buildStrands()
const radius = (p) => Math.hypot(...p)


describe('a CME\'s rope', () => {
  it('puts its leading edge at the CME\'s front', () => {
    for (const kappa of [KAPPA[0], 0.25, KAPPA[1]]) {
      for (const front of [1.05, 1.5, 3.6, 12, 38]) {
        expect(frontRadius(solveApex(front, kappa), kappa)).toBeCloseTo(front, 6)
      }
    }
    // At launch the rope is on the surface, small: the tube grows in.
    expect(solveApex(1, 0.3)).toBe(0.02)
    expect(tubeScale(0.02, 0.3)).toBeLessThan(0.02)
    expect(tubeScale(30, 0.3)).toBeGreaterThan(0.29)
  })

  it('takes its width and its legs from the CME\'s apparent width', () => {
    const narrow = shapeOf(cme(5, {width: 8 * DEG}))
    const typical = shapeOf(cme(5))
    const wide = shapeOf(cme(5, {width: 70 * DEG}))
    expect(narrow.kappa).toBe(KAPPA[0])
    expect(narrow.alpha).toBe(ALPHA[0])
    expect(typical.kappa).toBeCloseTo(Math.sin(17.5 * DEG) / 1.45, 6)
    // The front's own half-width is 17.5° then, and the legs 2 × (25° − 17.5°) apart.
    expect(typical.alpha / DEG).toBeCloseTo(15, 3)
    expect(wide.kappa).toBe(KAPPA[1])
    expect(wide.alpha).toBeLessThanOrEqual(ALPHA[1])
    expect(wide.alpha).toBeGreaterThan(typical.alpha)
  })

  it('carries its core behind its front, as the three-part CME does: 0.56 of it for a wide one, 0.72 a narrow', () => {
    for (const front of [8, 20, 38]) {
      for (const width of [15, 25, 45, 70]) {
        const shape = shapeOf(cme(front, {width: width * DEG}))
        expect(shape.core / front).toBeGreaterThan(0.54)
        expect(shape.core / front).toBeLessThan(0.78)
      }
    }
    expect(shapeOf(cme(20, {width: 70 * DEG})).core / 20).toBeCloseTo(0.56, 1)
    expect(shapeOf(cme(20)).core / 20).toBeCloseTo(0.71, 1)
  })

  it('is the same for a date in every session, and differs from CME to CME', () => {
    const ms = Date.UTC(2024, 3, 17, 22, 15)
    const a = cmesAt(ms).map((c) => shapeOf(c))
    const b = cmesAt(ms).map((c) => shapeOf(c))
    expect(a).toEqual(b)
    expect(a.length).toBeGreaterThan(1)
    expect(new Set(a.map((s) => s.theta)).size).toBe(a.length)
    for (const s of a) {
      expect(Math.abs(s.flip)).toBe(1)
      expect(Math.abs(s.tilt)).toBeLessThanOrEqual(40 * DEG)
      expect(s.twist).toBeGreaterThanOrEqual(1.2)
      expect(s.twist).toBeLessThanOrEqual(2.8)
    }
  })
})


describe('an erupting prominence, the core\'s cool plasma', () => {
  it('goes with the observed share of CMEs', () => {
    let n = 0
    const total = 4000
    for (let i = 0; i < total; i++) {
      n += shapeOf(cme(2, {launch: 1.7e12 + (i * 3.7e6)})).halpha > 0 ? 1 : 0
    }
    expect(n / total).toBeGreaterThan(ERUPTIVE_SHARE - 0.04)
    expect(n / total).toBeLessThan(ERUPTIVE_SHARE + 0.04)
  })

  it('fades as the core rises, and is gone by the height it is followed to', () => {
    let launch = 1.7e12
    while (!(shapeOf(cme(1.2, {launch})).halpha > 0)) {
      launch += 3.7e6
    }
    // A bright prominence at the start: 0.02 nm of Hα, 5 times the quiet disc in He II.
    let last = shapeOf(cme(1.05, {launch}))
    expect(last.halpha).toBeCloseTo(0.02, 3)
    expect(last.euv).toBeCloseTo(5, 1)
    for (const front of [1.5, 2, 3, 5, 8]) {
      const shape = shapeOf(cme(front, {launch}))
      expect(shape.halpha).toBeLessThan(last.halpha)
      expect(shape.halpha).toBeGreaterThan(0)
      expect(shape.euv).toBeLessThan(last.euv)
      // Hα thins as well as dims: it falls faster than the He II line.
      expect(shape.halpha / 0.02).toBeLessThan((shape.euv / 5) + 1e-9)
      last = shape
    }
    // He II about 1 with the core at 2 radii; Hα a thousandth of the start's with it at 2.5.
    const two = shapeOf(cme(3.6, {launch}))
    expect(two.core).toBeGreaterThan(2)
    expect(two.core).toBeLessThan(2.8)
    expect(two.euv).toBeGreaterThan(0.4)
    expect(two.euv).toBeLessThan(1.2)
    expect(two.halpha).toBeLessThan(0.02 / 500)
    const far = shapeOf(cme(2.2 * (ERUPTION_MAX_HEIGHT + 1), {launch}))
    expect(far.core - 1).toBeGreaterThan(ERUPTION_MAX_HEIGHT)
    expect(far.halpha).toBe(0)
    expect(far.euv).toBe(0)
  })
})


describe('a CME\'s particles', () => {
  const kindOf = (set, i) => set.extra[4 * i]
  const share = (set, i) => set.extra[(4 * i) + 1]

  it('are its threads (the rope\'s and the core\'s) and its front\'s puffs', () => {
    expect(strands.threads.count).toBe(STRANDS[KIND_ROPE] + STRANDS[KIND_CORE])
    expect(strands.puffs.count).toBe(STRANDS[KIND_SHEATH])
    for (let i = 0; i < strands.puffs.count; i++) {
      expect(kindOf(strands.puffs, i)).toBe(KIND_SHEATH)
    }
  })

  it('carry all of its electrons between them, each kind its share', () => {
    const totals = [0, 0, 0]
    for (const set of [strands.threads, strands.puffs]) {
      for (let i = 0; i < set.count; i++) {
        totals[kindOf(set, i)] += share(set, i)
      }
    }
    for (const kind of [KIND_ROPE, KIND_SHEATH, KIND_CORE]) {
      expect(totals[kind]).toBeCloseTo(SHARE[kind], 4)
    }
    expect(totals[0] + totals[1] + totals[2]).toBeCloseTo(1, 4)
  })

  it('spread a thread\'s share along it: its density over its envelope integrates to the share', () => {
    const set = strands.threads
    for (let i = 0; i < set.count; i += 37) {
      const [psi0, psi1] = set.path.subarray(4 * i, (4 * i) + 2)
      const density = set.tube[(4 * i) + 3]
      const n = 400
      let sum = 0
      for (let k = 0; k < n; k++) {
        const q = (k + 0.5) / n
        sum += density * envelope(q, psi0 + ((psi1 - psi0) * q), kindOf(set, i)) / n
      }
      expect(sum / share(set, i)).toBeGreaterThan(0.97)
      expect(sum / share(set, i)).toBeLessThan(1.03)
    }
  })

  it('are in a random order, so a first part of them is a fair sample', () => {
    const set = strands.threads
    const first = Math.round(set.count / 5)
    let cores = 0
    let electrons = 0
    for (let i = 0; i < first; i++) {
      cores += kindOf(set, i) === KIND_CORE ? 1 : 0
      electrons += share(set, i)
    }
    const expected = STRANDS[KIND_CORE] / set.count
    expect(cores / first).toBeGreaterThan(expected - 0.06)
    expect(cores / first).toBeLessThan(expected + 0.06)
    // A fifth of the threads holds about a fifth of the threads' electrons.
    const all = SHARE[KIND_ROPE] + SHARE[KIND_CORE]
    expect(electrons / all).toBeGreaterThan(0.16)
    expect(electrons / all).toBeLessThan(0.24)
  })

  it('are the same every time', () => {
    const again = buildStrands()
    expect(again.threads.path).toEqual(strands.threads.path)
    expect(again.puffs.tube).toEqual(strands.puffs.tube)
    expect(buildStrands(7).threads.path).not.toEqual(strands.threads.path)
  })
})


describe('where a CME\'s particles are', () => {
  const shape = {...shapeOf(cme(6)), flip: 1}
  const front = 6

  it('within its front, and out of the star but at its legs\' feet', () => {
    let farthest = 0
    for (const set of [strands.threads, strands.puffs]) {
      for (let i = 0; i < set.count; i += 3) {
        for (const q of [0, 0.25, 0.5, 0.75, 1]) {
          const r = radius(strandPoint(set, i, q, shape).point)
          farthest = Math.max(farthest, r)
          expect(r).toBeGreaterThan(0.9)
          expect(r).toBeLessThan(front * 1.08)
        }
      }
    }
    // The puffs reach the front.
    expect(farthest).toBeGreaterThan(front * 0.9)
  })

  it('a rope\'s thread runs foot to foot over the apex, on the tube\'s shell: the rope is hollow', () => {
    const set = strands.threads
    const apex = 1 + shape.H
    const tube = shape.tube * apex
    let checked = 0
    for (let i = 0; i < set.count && checked < 60; i++) {
      const [psi0, psi1] = set.path.subarray(4 * i, (4 * i) + 2)
      if (set.extra[4 * i] !== KIND_ROPE || psi0 > -PSI_MAX || psi1 < PSI_MAX) {
        continue
      }
      checked++
      // Its feet are low, by the surface.
      for (const q of [0, 1]) {
        const foot = strandPoint(set, i, q, shape)
        expect(radius(foot.point)).toBeLessThan(1 + (0.3 * shape.H))
      }
      // At the apex it is a tube's radius from the axis (components: T, d, B).
      const mid = strandPoint(set, i, 0.5, shape)
      expect(mid.psi).toBeCloseTo(0, 9)
      expect(mid.tube).toBeCloseTo(tube, 9)
      const fromAxis = Math.hypot(mid.point[0], mid.point[1] - apex, mid.point[2])
      expect(fromAxis / tube).toBeGreaterThan(0.6)
      expect(fromAxis / tube).toBeLessThan(1.4)
    }
    expect(checked).toBe(60)
  })

  it('the core is a bundle at the rope\'s sunward side', () => {
    const set = strands.threads
    const apex = 1 + shape.H
    const tube = shape.tube * apex
    let checked = 0
    for (let i = 0; i < set.count; i++) {
      if (set.extra[4 * i] !== KIND_CORE) {
        continue
      }
      const [psi0, psi1] = set.path.subarray(4 * i, (4 * i) + 2)
      // Where it crosses the apex, if it does.
      if (psi0 >= 0 || psi1 <= 0) {
        continue
      }
      checked++
      const at = strandPoint(set, i, -psi0 / (psi1 - psi0), shape)
      const fromCentre = Math.hypot(at.point[0], at.point[1] - (apex + (CORE_OFFSET * tube)), at.point[2])
      expect(fromCentre / tube).toBeLessThan(CORE_RADIUS * 1.25)
      // Sunward of the axis, but for its outermost threads' wobble.
      expect(at.point[1]).toBeLessThan(apex + (0.1 * tube))
    }
    expect(checked).toBeGreaterThan(100)
  })

  it('the front\'s puffs are outside the rope, on its leading side most', () => {
    const set = strands.puffs
    const apex = 1 + shape.H
    let ahead = 0
    let weight = 0
    for (let i = 0; i < set.count; i++) {
      const at = strandPoint(set, i, 0.5, shape)
      const s = set.extra[(4 * i) + 1]
      weight += s
      // Outward of its place on the axis: farther from the centre.
      const onAxis = 1 + (shape.H * Math.cos(at.psi))
      ahead += radius(at.point) > onAxis ? s : 0
    }
    expect(apex).toBeGreaterThan(1)
    expect(ahead / weight).toBeGreaterThan(0.7)
  })

  it('mirrors along its axis with the CME\'s flip', () => {
    const set = strands.threads
    const a = strandPoint(set, 5, 0.3, shape)
    const b = strandPoint(set, 5, 0.3, {...shape, flip: -1})
    expect(b.psi).toBeCloseTo(-a.psi, 12)
  })
})


describe('a thread\'s light along itself', () => {
  it('fades to its ends, and down the legs for the rope and the core', () => {
    for (const kind of [KIND_ROPE, KIND_SHEATH, KIND_CORE]) {
      expect(envelope(0, 0, kind)).toBe(0)
      expect(envelope(1, 0, kind)).toBeCloseTo(0, 3)
      expect(envelope(0.5, 0, kind)).toBeCloseTo(1, 9)
    }
    expect(envelope(0.5, 1.2, KIND_ROPE)).toBeLessThan(envelope(0.5, 0.3, KIND_ROPE))
    expect(envelope(0.5, 1.2, KIND_CORE)).toBeLessThan(envelope(0.5, 0.3, KIND_CORE))
    expect(envelope(0.5, 1.2, KIND_SHEATH)).toBe(1)
  })

  it('has its GLSL', () => {
    expect(STRAND_GLSL).toContain('vec3 strandPoint(float q, out float psi, out float tube)')
    expect(STRAND_GLSL).toContain('float strandEnvelope(float q, float psi)')
  })
})
