import fs from 'node:fs'
import {describe, expect, it} from 'bun:test'
import {Object3D, PerspectiveCamera, Scene as ThreeScene} from 'three'
import IridiumNetwork from './networks/IridiumNetwork.js'
import {SETTINGS_DEFAULTS, decodeSettings, encodeSettings} from '../permalink.js'
import {recordsOf} from './networks/loadNetworks.js'


// Scene's side of the space networks (networks/Networks.md): each its own
// overlay, off by default, loaded the first time it's shown, hung in
// Earth's equator, and in the link's settings.


const Scene = (await import('./Scene.js')).default
const {NETWORK_KEYS, OVERLAY_KEYS} = await import('./Scene.js')
const IRIDIUM = JSON.parse(fs.readFileSync(new URL('../../public/data/earth/satellites/networks/iridium.json', import.meta.url), 'utf8'))


/** @returns {object} a Scene with Earth's planetTilt, and a stub chunk counting its loads */
function scene() {
  const three = new ThreeScene()
  const camera = new PerspectiveCamera(45, 1, 1, 1e13)
  const ui = {scene: three, camera, addClickCb: () => {}, useStore: {getState: () => ({})}}
  const s = new Scene(ui)
  const tilt = new Object3D()
  s.objects['earth.planetTilt'] = tilt
  const loads = []
  s.importNetworks = () => Promise.resolve({
    loadNetwork: (key, opts) => {
      loads.push(key)
      return Promise.resolve({network: new IridiumNetwork(recordsOf(IRIDIUM, 'iridium'), opts), data: {fetched: IRIDIUM.fetched}})
    },
  })
  return {s, tilt, loads}
}


describe('Scene and the space networks', () => {
  it('has an overlay for each, off by default and in the link', () => {
    expect(NETWORK_KEYS).toEqual(['S', 'I', 'D'])
    for (const key of NETWORK_KEYS) {
      expect(OVERLAY_KEYS).toContain(key)
      expect(SETTINGS_DEFAULTS[key]).toBe(false)
    }
    const s = scene().s
    expect(NETWORK_KEYS.map((k) => s.getSetting(k))).toEqual([false, false, false])
    expect(encodeSettings({...SETTINGS_DEFAULTS, I: true, D: true})).toBe('ID')
    expect(decodeSettings('S').S).toBe(true)
  })

  it('loads a network the first time it\'s shown, once, and hangs it in Earth\'s equator', async () => {
    const {s, tilt, loads} = scene()
    s.toggleNetwork('I')
    expect(s.getSetting('I')).toBe(true)
    const [a, b] = await Promise.all([s._networksPending.I, s.loadNetwork('I')])
    expect(a).toBe(b)
    expect(loads).toEqual(['I'])
    expect(a.parent).toBe(tilt)
    expect(s._overlayNodes('I')).toEqual([a])
    expect(a.fadeUniform).toBe(s.fades.I.uniform)
    expect(s.networkData.I.fetched).toBe(IRIDIUM.fetched)
    s.overlays.finish()
    expect(a.visible).toBe(true)
    s.toggleNetwork('I')
    s.overlays.finish()
    expect(a.visible).toBe(false)
    s.toggleNetwork('I')
    expect(loads).toEqual(['I'])
  })

  it('leaves Earth\'s Iridium points to the network, whichever comes in first', async () => {
    for (const populationFirst of [true, false]) {
      const {s} = scene()
      const calls = []
      const pop = {setGroupDrawer: (group, drawer) => calls.push([group, drawer])}
      if (populationFirst) {
        s.populations.set('earth', pop)
      }
      const network = await s.loadNetwork('I')
      if (!populationFirst) {
        s.populations.set('earth', pop)
        s._shareNetworks()
      }
      expect(calls).toEqual([['iridium', network.sats]])
    }
  })

  it('is driven by applySettings, as V and a link drive it', async () => {
    const {s, loads} = scene()
    s.applySettings({...SETTINGS_DEFAULTS, D: true})
    expect(s.getSetting('D')).toBe(true)
    await s._networksPending.D
    expect(loads).toEqual(['D'])
    s.applySettings({...SETTINGS_DEFAULTS, D: false})
    expect(s.getSetting('D')).toBe(false)
  })

  it('isn\'t loaded while held (the homepage), only when revealed', async () => {
    const {s, loads} = scene()
    s.initSettings({...SETTINGS_DEFAULTS, S: true}, {hold: true})
    expect(loads).toEqual([])
    s.revealOverlays(['S'])
    await s._networksPending.S
    expect(loads).toEqual(['S'])
  })
})
