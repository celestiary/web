import {describe, expect, it} from 'bun:test'
import {Group, PerspectiveCamera, Vector3} from 'three'
import {newImageSwitch} from '../rubin/install.js'
import {equatorialToScene} from '../rubin/wcs.js'
import {CONTROL_SURVEYS, followControl, showSurvey, skyDirection, skyLayers, surveyByKey, surveyCredit, surveyFields} from './install.js'
import {JWST_NIRCAM, RUBIN_VIRGO, SURVEYS} from './surveys.js'


const newScene = () => ({stellarFrame: new Group(), ui: {camera: {fov: 1, aspect: 1.6}, height: 400}})
const newDeps = (credits = new Map()) => ({
  addCredit: (id, credit) => credits.set(id, credit),
  removeCredit: (id) => credits.delete(id),
  loadTexture: () => new Promise(() => {}),
})


describe('a survey by its key', () => {
  it('gives each survey a key of its own, found in any case', () => {
    const keys = SURVEYS.map((s) => s.key)
    expect(keys.every((k) => /^[a-z0-9-]+$/.test(k))).toBe(true)
    expect(new Set(keys).size).toBe(keys.length)
    expect(surveyByKey('jwst-nircam')).toBe(JWST_NIRCAM)
    expect(surveyByKey('JWST-NIRCam')).toBe(JWST_NIRCAM)
    expect(surveyByKey('hubble')).toBe(null)
  })

  it('lists in the control the surveys with showpieces: JWST\'s, Hubble\'s and Rubin\'s own, not CDS\'s', () => {
    expect(CONTROL_SURVEYS.map((s) => s.key))
        .toEqual(['jwst-nircam', 'jwst-miri', 'hst-acs', 'hst-wfc3', 'hst-wfpc2', 'rubin-virgo'])
  })

  it('credits a survey by its title, credit and licence, the licence once', () => {
    expect(surveyCredit(JWST_NIRCAM).text).toBe(`JWST NIRCam: ${JWST_NIRCAM.credit} (ESASky's terms)`)
    expect(surveyCredit(RUBIN_VIRGO).text).toBe(`${RUBIN_VIRGO.title}: ${RUBIN_VIRGO.credit}`)
  })

  it('hangs a link\'s survey from the stellar frame, with the credit while tiles are drawn', () => {
    const scene = newScene()
    const credits = new Map()
    const deps = newDeps(credits)
    expect(showSurvey(scene, 'nothing', deps)).toBe(null)
    const layer = showSurvey(scene, 'jwst-nircam', deps)
    expect(layer.parent).toBe(scene.stellarFrame)
    expect(layer.survey).toBe(JWST_NIRCAM)
    expect(layer.view()).toEqual({camera: scene.ui.camera, fovDeg: 1, aspect: 1.6, heightPx: 400})
    layer.onDrawn(true)
    expect(credits.get('sky-jwst-nircam').text).toContain('JWST NIRCam:')
    layer.onDrawn(false)
    expect(credits.size).toBe(0)
    layer.dispose()
  })
})


describe('the survey layers', () => {
  it('make one layer per survey, held while anyone wants it', () => {
    const scene = newScene()
    const layers = skyLayers(scene, newDeps())
    expect(skyLayers(scene, {})).toBe(layers)
    const a = layers.acquire('hst-acs', 'control')
    const b = layers.acquire('HST-ACS', 'link')
    expect(b).toBe(a)
    expect(scene.stellarFrame.children).toEqual([a])
    expect(layers.owners('hst-acs')).toEqual(new Set(['control', 'link']))
    layers.release('hst-acs', 'control')
    expect(a.disposed).toBeFalsy()
    expect(layers.layer('hst-acs')).toBe(a)
    layers.release('hst-acs', 'link')
    expect(layers.layer('hst-acs')).toBe(null)
    expect(scene.stellarFrame.children.length).toBe(0)
    expect(layers.acquire('nothing', 'control')).toBe(null)
    expect(layers.keys()).toEqual([])
  })

  it('share Rubin\'s Virgo tiles between the control and the Rubin app\'s switch', () => {
    const scene = {stellarFrame: new Group(), ui: {camera: new PerspectiveCamera(), height: 500}}
    const deps = {...newDeps(), fetchJson: () => Promise.resolve({wcs: {crval: [0, 0]}}), fetchOk: () => Promise.resolve(false)}
    const layers = skyLayers(scene, deps)
    const control = layers.acquire('rubin-virgo', 'control')
    const sw = newImageSwitch(scene, deps)
    sw.enabled = true
    expect(sw.virgo).toBe(control)
    expect(scene.stellarFrame.children.filter((c) => c.survey?.key === 'rubin-virgo').length).toBe(1)
    expect(layers.owners('rubin-virgo')).toEqual(new Set(['control', 'rubin']))
    // The app's switch off leaves the control's.
    sw.enabled = false
    expect(sw.virgo).toBe(null)
    expect(layers.layer('rubin-virgo')).toBe(control)
    expect(control.parent).toBe(scene.stellarFrame)
    sw.enabled = true
    sw.dispose()
    expect(layers.owners('rubin-virgo')).toEqual(new Set(['control']))
    layers.release('rubin-virgo', 'control')
    expect(layers.keys()).toEqual([])
  })
})


describe('the control\'s surveys', () => {
  it('are held while on and let go of when off, a link\'s left as it is', () => {
    const scene = newScene()
    const deps = newDeps()
    showSurvey(scene, 'jwst-nircam', deps)
    expect(followControl(scene, ['hst-acs', 'jwst-nircam', 'nothing'], deps)).toEqual(['jwst-nircam', 'hst-acs'])
    expect(followControl(scene, ['hst-acs'], deps)).toEqual(['hst-acs'])
    // The link's NIRCam stays; the control no longer holds it.
    expect(skyLayers(scene, deps).owners('jwst-nircam')).toEqual(new Set(['link']))
    expect(followControl(scene, [], deps)).toEqual([])
    expect(skyLayers(scene, deps).keys()).toEqual(['jwst-nircam'])
  })
})


describe('the showpiece fields', () => {
  it('turn with the stars\' frame, from their J2000 places', () => {
    const scene = newScene()
    const [pillars] = surveyFields(scene, JWST_NIRCAM)
    expect(pillars).toMatchObject({key: 'pillars', label: 'Pillars of Creation', fovDeg: 0.07})
    const at = new Vector3(...equatorialToScene(274.7284, -13.8515))
    expect(pillars.direction().distanceTo(at)).toBeLessThan(1e-12)
    expect(skyDirection(scene, 274.7284, -13.8515).distanceTo(at)).toBeLessThan(1e-12)
    scene.stellarFrame.rotation.y = 0.3
    scene.stellarFrame.updateMatrixWorld()
    expect(pillars.direction().distanceTo(at)).toBeGreaterThan(0.1)
  })
})
