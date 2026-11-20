import {describe, expect, it} from 'bun:test'
import {decodeAppTokens, encodeAppTokens} from './appTokens.js'
import {
  DEFAULT_SUNTAN,
  SUNTAN_APP_ID,
  SUNTAN_RATES,
  decodeSuntanToken,
  encodeSuntanToken,
  formatSunlight,
  rateLabel,
} from './suntanApp.js'
import {INITIAL_WIDGETS} from './WidgetsSlice.js'


describe('apps.suntan token', () => {
  it('writes nothing for the defaults', () => {
    expect(encodeSuntanToken(DEFAULT_SUNTAN)).toBe(null)
  })

  it('round-trips the lander and the trajectory off', () => {
    const state = {vehicle: 'lander', paths: false}
    const value = encodeSuntanToken(state)
    expect(value).toBe('vehicle=lander,paths=0')
    expect(decodeSuntanToken(value)).toEqual(state)
  })

  it('reads a bad value as its default', () => {
    expect(decodeSuntanToken('vehicle=rover,paths=2')).toEqual(DEFAULT_SUNTAN)
    expect(decodeSuntanToken(undefined)).toEqual(DEFAULT_SUNTAN)
  })

  it('travels in the link with the drawer', () => {
    const widgets = {
      ...INITIAL_WIDGETS,
      isOpen: true,
      view: SUNTAN_APP_ID,
      running: [SUNTAN_APP_ID],
      appStates: {[SUNTAN_APP_ID]: {vehicle: 'lander', paths: true}},
    }
    const tokens = encodeAppTokens(widgets)
    expect(tokens['apps.suntan']).toBe('vehicle=lander')
    expect(decodeAppTokens(tokens).appStates[SUNTAN_APP_ID]).toEqual({vehicle: 'lander', paths: true})
  })
})


describe('the panel\'s readouts', () => {
  it('labels each speed by what it means', () => {
    expect(SUNTAN_RATES.map(rateLabel)).toEqual(['1 min/s', '1 h/s', '18 h/s', '6 d/s', '49 d/s'])
    expect(rateLabel(1)).toBe('1×')
    expect(rateLabel(-4096)).toBe('−1 h/s')
  })

  it('writes sunlight in kilowatts or megawatts', () => {
    expect(formatSunlight(50031)).toBe('50 kW/m²')
    expect(formatSunlight(62938592)).toBe('62.9 MW/m²')
  })
})
