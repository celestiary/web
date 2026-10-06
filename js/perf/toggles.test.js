import {describe, expect, it} from 'bun:test'
import {TOGGLES, parsePerfParams, passesOff} from './toggles.js'


describe('parsePerfParams', () => {
  it('is off without perf=1', () => {
    expect(parsePerfParams('').enabled).toBe(false)
    expect(parsePerfParams('?perf=0').enabled).toBe(false)
    expect(parsePerfParams('?perf').enabled).toBe(false)
    expect(parsePerfParams(undefined).enabled).toBe(false)
    expect(parsePerfParams('?off=clouds').enabled).toBe(false)
  })

  it('is on with perf=1, with nothing switched off', () => {
    const p = parsePerfParams('?perf=1')
    expect(p.enabled).toBe(true)
    expect(p.off.size).toBe(0)
  })

  it('reads the comma-separated off list, and ignores unknown keys', () => {
    const p = parsePerfParams('?perf=1&off=atmosphere,clouds,nonsense,%20galaxy')
    expect(Array.from(p.off).sort()).toEqual(['atmosphere', 'clouds', 'galaxy'])
  })

  it('has a switch for each pass the issue names', () => {
    expect(TOGGLES.map((t) => t.key).sort()).toEqual(
        ['atmosphere', 'clouds', 'cesium', 'galaxy', 'meter', 'nightlights', 'overlay'].sort())
    const p = parsePerfParams(`?perf=1&off=${TOGGLES.map((t) => t.key).join(',')}`)
    expect(p.off.size).toBe(TOGGLES.length)
  })
})


describe('passesOff', () => {
  it('names the passes switched off, by how they are switched', () => {
    const off = ['atmosphere', 'clouds', 'galaxy', 'nightlights']
    expect(Array.from(passesOff(off, 'skip')).sort()).toEqual(['cesium.nightlights', 'clouds'])
    expect(Array.from(passesOff(off, 'gate'))).toEqual(['atmosphere'])
    expect(Array.from(passesOff(off, 'hide'))).toEqual(['galaxy'])
  })

  it('is empty for no toggles', () => {
    expect(passesOff([], 'skip').size).toBe(0)
  })
})
