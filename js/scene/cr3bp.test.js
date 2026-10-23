import {describe, expect, it} from 'bun:test'
import {correctSymmetric, jacobi, propagate, rates, withStm} from './cr3bp.js'
import {collinearDistances} from './lagrange.js'


const MU = 0.012150585609624


describe('cr3bp', () => {
  it('holds still at the Lagrange points', () => {
    const {l1, l2, l3} = collinearDistances(MU)
    const out = new Float64Array(6)
    for (const x of [1 - MU - l1, 1 - MU + l2, -MU - l3]) {
      rates(MU, [x, 0, 0, 0, 0, 0], out)
      expect(Math.hypot(out[3], out[4], out[5])).toBeLessThan(1e-12)
    }
    rates(MU, [0.5 - MU, Math.sqrt(3) / 2, 0, 0, 0, 0], out)
    expect(Math.hypot(out[3], out[4])).toBeLessThan(1e-12)
  })

  it('keeps the Jacobi constant over a long arc', () => {
    const s0 = [0.9, 0.05, 0.03, 0.01, 0.2, -0.02]
    const c0 = jacobi(MU, s0)
    const {s} = propagate(MU, s0, {t: 20})
    expect(Math.abs(jacobi(MU, s) - c0)).toBeLessThan(1e-9)
  })

  it('carries the state-transition matrix as finite differences say', () => {
    const s0 = [0.85, 0, 0.05, 0, 0.18, 0]
    const t = 1.3
    const {s} = propagate(MU, withStm(s0), {t})
    const eps = 1e-7
    for (const j of [0, 2, 4]) {
      const plus = [...s0]
      const minus = [...s0]
      plus[j] += eps
      minus[j] -= eps
      const a = propagate(MU, plus, {t}).s
      const b = propagate(MU, minus, {t}).s
      for (let i = 0; i < 6; i++) {
        const fd = (a[i] - b[i]) / (2 * eps)
        expect(Math.abs(s[6 + (6 * i) + j] - fd)).toBeLessThan(1e-5 * Math.max(1, Math.abs(fd)))
      }
    }
  })

  it('closes a symmetric orbit, and stops at the plane crossing', () => {
    const m = correctSymmetric(MU, [1.0221, -0.1821, -0.1033], 'z')
    expect(m).not.toBeNull()
    const half = propagate(MU, m.state, {toCrossing: true})
    expect(Math.abs(half.s[1])).toBeLessThan(1e-12)
    expect(half.t * 2).toBeCloseTo(m.period, 9)
    const end = propagate(MU, m.state, {t: m.period}).s
    expect(Math.hypot(end[0] - m.state[0], end[1], end[2] - m.state[2])).toBeLessThan(1e-9)
  })
})
