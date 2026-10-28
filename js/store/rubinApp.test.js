import {describe, expect, it} from 'bun:test'
import {DEFAULT_RUBIN, decodeRubinToken, encodeRubinToken} from './rubinApp.js'


describe('apps.rubin token', () => {
  it('writes nothing for the defaults, and what differs otherwise', () => {
    expect(encodeRubinToken(DEFAULT_RUBIN)).toBe(null)
    expect(encodeRubinToken({...DEFAULT_RUBIN, path: false})).toBe('path=0')
    expect(encodeRubinToken({path: true, nightMs: Date.UTC(2026, 3, 1)})).toBe('night=20544')
  })

  it('reads a token back, and a bad value as its default', () => {
    expect(decodeRubinToken(undefined)).toEqual(DEFAULT_RUBIN)
    expect(decodeRubinToken('path=0,night=20544')).toEqual({path: false, nightMs: Date.UTC(2026, 3, 1)})
    expect(decodeRubinToken('path=2,night=x')).toEqual(DEFAULT_RUBIN)
    const s = {path: false, nightMs: Date.UTC(2026, 6, 20)}
    expect(decodeRubinToken(encodeRubinToken(s))).toEqual(s)
  })
})
