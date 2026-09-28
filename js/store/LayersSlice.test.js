import {DEFAULT_BODY_LAYER, bodyLayer} from './LayersSlice.js'


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
