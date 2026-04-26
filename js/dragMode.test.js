import {describe, expect, it} from 'bun:test'
import {pickDragMode, resolveDragMode} from './dragMode'


/** Build a target stub with the props shape pickDragMode reads. */
function target(radius, atmosphereHeight) {
  return {
    props: {
      radius: {scalar: radius},
      ...(atmosphereHeight !== undefined ?
        {atmosphere: {height: {scalar: atmosphereHeight}}} :
        {}),
    },
  }
}


describe('pickDragMode', () => {
  it('returns \'pan\' when no target is supplied (e.g. star-only scene)', () => {
    expect(pickDragMode(1e9, null)).toBe('pan')
    expect(pickDragMode(1e9, undefined)).toBe('pan')
    expect(pickDragMode(1e9, {})).toBe('pan')
  })

  it('returns \'pan\' when the camera is within ~3 surface radii of an airless body', () => {
    const earth = target(6.4e6) // no atmosphere
    expect(pickDragMode(6.4e6, earth)).toBe('pan') // at surface
    expect(pickDragMode(6.4e6 * 2.9, earth)).toBe('pan') // just below threshold
  })

  it('returns \'orbit\' when the camera is well above an airless body', () => {
    const earth = target(6.4e6)
    expect(pickDragMode(6.4e6 * 5, earth)).toBe('orbit')
    expect(pickDragMode(1e10, earth)).toBe('orbit')
  })

  it('uses (radius + atmosphere height) × 2 as the threshold when the body has an atmosphere', () => {
    // Earth-ish: 6.4e6 m radius + 1e5 m atmosphere → threshold = 1.3e7 m.
    const earth = target(6.4e6, 1e5)
    expect(pickDragMode(1.2e7, earth)).toBe('pan')
    expect(pickDragMode(1.4e7, earth)).toBe('orbit')
  })
})


describe('resolveDragMode', () => {
  // Regression: the UI toggle's highlight must follow the *effective*
  // mode — that's what resolveDragMode produces from the user's intent
  // and the current camera/target context.

  it('passes explicit \'pan\' or \'orbit\' through unchanged', () => {
    const earth = target(6.4e6)
    expect(resolveDragMode('pan', 1e10, earth)).toBe('pan')
    expect(resolveDragMode('orbit', 1, earth)).toBe('orbit')
  })

  it('routes \'auto\' through pickDragMode using camera distance and target', () => {
    const earth = target(6.4e6)
    expect(resolveDragMode('auto', 6.4e6, earth)).toBe('pan') // close
    expect(resolveDragMode('auto', 1e10, earth)).toBe('orbit') // far
  })

  it('treats unknown / undefined intent as \'auto\'', () => {
    const earth = target(6.4e6)
    expect(resolveDragMode(undefined, 1e10, earth)).toBe('orbit')
    expect(resolveDragMode(null, 6.4e6, earth)).toBe('pan')
    expect(resolveDragMode('garbage', 1e10, earth)).toBe('orbit')
  })

  it('falls back to \'pan\' in \'auto\' when no target is supplied', () => {
    expect(resolveDragMode('auto', 1e10, null)).toBe('pan')
  })
})
