import {describe, expect, it} from 'bun:test'
import {landableBodyName} from './Celestiary.js'


// `landableBodyName` is the pure helper backing Celestiary._currentBodyName.
// It decides whether a scene-graph target is a body the AR entry point
// should default to landing on.  These tests pin down the exclusion
// rules so a future refactor can't silently re-introduce the bug
// where tapping AR with the Sun selected lands the user on the
// photosphere.

describe('landableBodyName', () => {
  it('returns null for empty / null target', () => {
    expect(landableBodyName(null)).toBeNull()
    expect(landableBodyName(undefined)).toBeNull()
    expect(landableBodyName({})).toBeNull()
  })

  it('returns null when props.name is missing', () => {
    expect(landableBodyName({props: {radius: {scalar: 1e6}}})).toBeNull()
  })

  it('returns null when props.radius is missing or zero', () => {
    expect(landableBodyName({props: {name: 'shadow'}})).toBeNull()
    expect(landableBodyName({props: {name: 'shadow', radius: {scalar: 0}}})).toBeNull()
  })

  it('returns null for stars (spectralType present)', () => {
    // Sun: G-type, has a radius and a name, but spectralType excludes it.
    const sun = {props: {name: 'sun', radius: {scalar: 6.96e8}, spectralType: 4}}
    expect(landableBodyName(sun)).toBeNull()
  })

  it('returns the name for planets / moons', () => {
    const earth = {props: {name: 'earth', radius: {scalar: 6.371e6}}}
    expect(landableBodyName(earth)).toBe('earth')
    const moon = {props: {name: 'moon', radius: {scalar: 1.737e6}}}
    expect(landableBodyName(moon)).toBe('moon')
  })
})
