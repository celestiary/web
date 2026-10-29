import {describe, expect, it} from 'bun:test'
import {RUBIN} from '../scene/observer/instrument.js'
import {DEFAULT_RUBIN, decodeRubinToken, encodeRubinToken, fieldReadout, formatAngle} from './rubinApp.js'


describe('apps.rubin token', () => {
  it('writes nothing for the defaults, and what differs otherwise', () => {
    expect(encodeRubinToken(DEFAULT_RUBIN)).toBe(null)
    expect(encodeRubinToken({...DEFAULT_RUBIN, path: false})).toBe('path=0')
    expect(encodeRubinToken({...DEFAULT_RUBIN, nightMs: Date.UTC(2026, 3, 1)})).toBe('night=20544')
    expect(encodeRubinToken({...DEFAULT_RUBIN, shell: false})).toBe('shell=0')
    expect(encodeRubinToken({...DEFAULT_RUBIN, optics: false})).toBe('optics=0')
    expect(encodeRubinToken({...DEFAULT_RUBIN, pixel: true})).toBe('pixel=1')
    // A state saved before the switch has no pixel: the default, nothing written.
    expect(encodeRubinToken({...DEFAULT_RUBIN, pixel: undefined})).toBe(null)
  })

  it('reads a token back, and a bad value as its default', () => {
    expect(decodeRubinToken(undefined)).toEqual(DEFAULT_RUBIN)
    expect(DEFAULT_RUBIN.optics).toBe(true)
    expect(decodeRubinToken('path=0,night=20544,shell=0')).toEqual(
        {path: false, nightMs: Date.UTC(2026, 3, 1), shell: false, optics: true, pixel: false})
    expect(decodeRubinToken('optics=0')).toEqual({...DEFAULT_RUBIN, optics: false})
    expect(DEFAULT_RUBIN.pixel).toBe(false)
    expect(decodeRubinToken('pixel=1')).toEqual({...DEFAULT_RUBIN, pixel: true})
    expect(decodeRubinToken('path=2,night=x,shell=no,optics=off,pixel=on')).toEqual(DEFAULT_RUBIN)
    const s = {path: false, nightMs: Date.UTC(2026, 6, 20), shell: false, optics: false, pixel: true}
    expect(decodeRubinToken(encodeRubinToken(s))).toEqual(s)
  })
})


describe('the field readout', () => {
  it('writes an angle in degrees, arcminutes or arcseconds, as fits', () => {
    expect(formatAngle(3.5)).toBe('3.50°')
    expect(formatAngle(0.2)).toBe('12.0′')
    expect(formatAngle(200 / 3600)).toBe('3.3′')
    expect(formatAngle(0.0001615)).toBe('0.581″')
  })

  it('says where the field is in the range, the magnification and the pixel on screen', () => {
    const range = {minDeg: 200 / 3600, maxDeg: 3.5}
    const widest = fieldReadout(3.5, range, 1000, RUBIN)
    expect(widest.field).toBe('3.50°')
    expect(widest.end).toBe('at the widest field')
    expect(widest.magnification).toBe('14×')
    // 0.2″ in a 3.5° field over 1,000 px.
    expect(widest.pixelPx).toBe('0.016')
    const limit = fieldReadout(200 / 3600, range, 1000, RUBIN)
    expect(limit.end).toBe('at the pixel limit')
    expect(limit.pixelPx).toBe('1.0')
    expect(limit.magnification).toBe('854×')
    expect(fieldReadout(1, range, 1000, RUBIN).end).toBe(null)
    // With the optics off there is no range, and no end.
    expect(fieldReadout(0.001, null, 1000, RUBIN)).toEqual(
        {field: '3.60″', end: null, magnification: '47,465×', pixelPx: '56'})
  })
})
