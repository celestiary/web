import createLayersSlice, {DEFAULT_BODY_LAYER, bodyLayer, withSurvey} from './LayersSlice.js'


describe('bodyLayer', () => {
  it('defaults to the Cesium layer', () => {
    expect(DEFAULT_BODY_LAYER).toBe('cesium')
    expect(bodyLayer({}, 'earth')).toBe('cesium')
    expect(bodyLayer(undefined, 'mars')).toBe('cesium')
  })

  it('keeps the user\'s choice', () => {
    expect(bodyLayer({earth: 'default'}, 'earth')).toBe('default')
    expect(bodyLayer({earth: 'default'}, 'moon')).toBe('cesium')
  })
})


describe('the sky surveys on', () => {
  it('adds a survey at the end and takes one out, the same list when nothing changes', () => {
    const on = ['hst-acs']
    expect(withSurvey(on, 'jwst-nircam', true)).toEqual(['hst-acs', 'jwst-nircam'])
    expect(withSurvey(on, 'hst-acs', true)).toBe(on)
    expect(withSurvey(on, 'hst-acs', false)).toEqual([])
    expect(withSurvey(on, 'jwst-nircam', false)).toBe(on)
  })

  it('is none by default; set as a list without repeats', () => {
    let state = {}
    const set = (fn) => {
      state = {...state, ...fn(state)}
    }
    state = createLayersSlice(set, () => state)
    expect(state.skyOn).toEqual([])
    state.setSkySurvey('hst-wfc3', true)
    state.setSkySurvey('jwst-nircam', true)
    expect(state.skyOn).toEqual(['hst-wfc3', 'jwst-nircam'])
    state.setSkyOn(['hst-wfc3', 'hst-wfc3', 'rubin-virgo'])
    expect(state.skyOn).toEqual(['hst-wfc3', 'rubin-virgo'])
    state.setSkySurvey('hst-wfc3', false)
    expect(state.skyOn).toEqual(['rubin-virgo'])
  })
})
