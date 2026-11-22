import {describe, expect, it} from 'bun:test'
import {Group} from 'three'
import {showSurvey, surveyByKey} from './install.js'
import {JWST_NIRCAM, SURVEYS} from './surveys.js'


describe('a survey by its key', () => {
  it('gives each survey a key of its own, found in any case', () => {
    const keys = SURVEYS.map((s) => s.key)
    expect(keys.every((k) => /^[a-z0-9-]+$/.test(k))).toBe(true)
    expect(new Set(keys).size).toBe(keys.length)
    expect(surveyByKey('jwst-nircam')).toBe(JWST_NIRCAM)
    expect(surveyByKey('JWST-NIRCam')).toBe(JWST_NIRCAM)
    expect(surveyByKey('hubble')).toBe(null)
  })

  it('hangs its layer from the stellar frame, with the credit while tiles are drawn', () => {
    const scene = {stellarFrame: new Group(), ui: {camera: {fov: 1, aspect: 1.6}, height: 400}}
    const credits = new Map()
    const deps = {
      addCredit: (id, credit) => credits.set(id, credit),
      removeCredit: (id) => credits.delete(id),
      loadTexture: () => new Promise(() => {}),
    }
    expect(showSurvey(scene, 'nothing', deps)).toBe(null)
    const layer = showSurvey(scene, 'jwst-nircam', deps)
    expect(layer.parent).toBe(scene.stellarFrame)
    expect(layer.survey).toBe(JWST_NIRCAM)
    expect(layer.view()).toEqual({camera: scene.ui.camera, fovDeg: 1, aspect: 1.6, heightPx: 400})
    layer.onDrawn(true)
    expect(credits.get('sky-jwst-nircam').text).toContain('JWST NIRCam imaging')
    layer.onDrawn(false)
    expect(credits.size).toBe(0)
    layer.dispose()
  })
})
