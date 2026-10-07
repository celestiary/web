import {describe, expect, it} from 'bun:test'
import {EV_MAX, clampEv, evGain, formatEv, renderExposure, roundEv, stepEv} from './evCompensation.js'


describe('evGain', () => {
  it('is 2^EV: a stop doubles the light', () => {
    expect(evGain(0)).toBe(1)
    expect(evGain(1)).toBe(2)
    expect(evGain(-2)).toBe(0.25)
    expect(evGain(1 / 3)).toBeCloseTo(2 ** (1 / 3), 12)
  })

  it('holds to the range, and a non-number is no compensation', () => {
    expect(evGain(99)).toBe(2 ** EV_MAX)
    expect(evGain(-99)).toBe(2 ** -EV_MAX)
    expect(evGain(NaN)).toBe(1)
    expect(evGain(undefined)).toBe(1)
  })
})


describe('renderExposure', () => {
  it('is the keyed exposure times the metered gain times the compensation', () => {
    expect(renderExposure(2, 3, 0)).toBe(6)
    expect(renderExposure(2, 3, 1)).toBe(12)
    expect(renderExposure(2, 3, -1)).toBe(3)
    expect(renderExposure(5e-5, 1, 1.5)).toBeCloseTo(5e-5 * (2 ** 1.5), 15)
  })
})


describe('stepEv', () => {
  it('steps by thirds of a stop, exactly: three presses are a stop', () => {
    let ev = 0
    for (let i = 0; i < 3; i++) {
      ev = stepEv(ev, 1)
    }
    expect(ev).toBe(1)
    expect(stepEv(0, -1)).toBeCloseTo(-1 / 3, 12)
  })

  it('snaps a linked 1.3 to the thirds', () => {
    expect(stepEv(1.3, 1)).toBeCloseTo(5 / 3, 12)
    expect(stepEv(1.33, -1)).toBeCloseTo(1, 12)
  })

  it('stops at the range', () => {
    expect(stepEv(EV_MAX, 1)).toBe(EV_MAX)
    expect(stepEv(-EV_MAX, -1)).toBe(-EV_MAX)
  })
})


describe('roundEv and clampEv', () => {
  it('rounds to the link\'s two places, and never to -0', () => {
    expect(roundEv(1 / 3)).toBe(0.33)
    expect(roundEv(-1 / 3)).toBe(-0.33)
    expect(Object.is(roundEv(-0.001), 0)).toBe(true)
    expect(clampEv(-1e9)).toBe(-EV_MAX)
    expect(clampEv(Infinity)).toBe(0)
  })
})


describe('formatEv', () => {
  it('reads as a camera\'s dial: signed, one decimal', () => {
    expect(formatEv(0)).toBe('EV 0')
    expect(formatEv(4 / 3)).toBe('EV +1.3')
    expect(formatEv(-2 / 3)).toBe('EV -0.7')
    expect(formatEv(1)).toBe('EV +1.0')
    expect(formatEv(0.01)).toBe('EV 0')
  })
})
