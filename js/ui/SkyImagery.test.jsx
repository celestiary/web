import {describe, expect, it} from 'bun:test'
import createCache from '@emotion/cache'
import {CacheProvider} from '@emotion/react'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import * as sky from '../scene/sky/install.js'
import {newTileMaterial, keyLinear} from '../scene/sky/tileMaterial.js'
import SkyImagery from './SkyImagery.jsx'
import * as section from './SkySection.jsx'


/**
 * MUI's markup with an Emotion cache of its own (LayersButton.test.jsx says why).
 *
 * @param {React.ReactElement} element
 * @returns {string}
 */
function markup(element) {
  const cache = createCache({key: 'skytest', container: {insertBefore: () => {}, appendChild: () => {}}})
  return renderToStaticMarkup(<CacheProvider value={cache}>{element}</CacheProvider>)
}


describe('the sky imagery section', () => {
  it('has a switch per survey, its fields only while it\'s on', () => {
    const rows = sky.skyRows(['hst-wfc3'])
    expect(rows.map((r) => r.key)).toEqual(sky.CONTROL_SURVEYS.map((s) => s.key))
    const wfc3 = rows.find((r) => r.key === 'hst-wfc3')
    expect(wfc3.on).toBe(true)
    expect(wfc3.fields.map((f) => f.key)).toEqual(['pillars', 'westerlund2', 'ring', 'm51'])
    expect(rows.find((r) => r.key === 'jwst-nircam')).toMatchObject({on: false, fields: []})
  })

  it('draws a switch per survey, off by default, and no field buttons', () => {
    const html = markup(<SkyImagery section={section}/>)
    expect(html).toContain('Sky imagery')
    expect(html).toContain('data-testid="layers-sky-jwst-nircam-switch"')
    expect(html).toContain('aria-label="Hubble ACS"')
    expect(html).toContain('in grey')
    expect(html).not.toContain('checked=""')
    expect(html).not.toContain('layers-sky-jwst-nircam-field-')
    // (A server render reads the store's first state: the buttons once a
    // survey is on are skyRows' above, and the browser check's, Sky.md.)
  })
})


describe('a tile\'s key and negative', () => {
  it('keys black over the ramp asked for, and inverts only where asked', () => {
    // The ramp is given in the picture's values and held decoded, as the texel is sampled.
    const plain = newTileMaterial(null, {keyBlack: true})
    expect(plain.uniforms.uKeyFrom.value).toBe(0)
    expect(plain.uniforms.uKeyFull.value).toBeCloseTo(2 / 255 / 12.92, 12)
    expect(plain.uniforms.uInvert.value).toBe(0)
    const hubble = newTileMaterial(null, {keyBlack: true, keyBlackFrom: 16 / 255, keyBlackFull: 24 / 255, invert: true})
    expect(hubble.uniforms.uKeyFrom.value).toBeCloseTo(keyLinear(16 / 255), 12)
    expect(hubble.uniforms.uKeyFull.value).toBeCloseTo(keyLinear(24 / 255), 12)
    expect(keyLinear(24 / 255)).toBeCloseTo(Math.pow(((24 / 255) + 0.055) / 1.055, 2.4), 12)
    expect(hubble.uniforms.uInvert.value).toBe(1)
    // The key reads the texel as served; the negative is of the picture's bytes.
    expect(hubble.fragmentShader).toContain('smoothstep(uKeyFrom, uKeyFull, v)')
    expect(hubble.fragmentShader).toContain('dec(1.0 - enc(rgb.r))')
  })
})
