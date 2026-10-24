import fs from 'node:fs'
import {describe, expect, it} from 'bun:test'
import {Object3D} from 'three'
import {NETWORK_URLS, loadNetwork} from './loadNetworks.js'


/** A label sheet without a canvas. */
class StubSheet {
  /** */
  add() {/* no canvas */}

  /** @returns {Object3D} */
  compile() {
    return new Object3D
  }
}


const PUBLIC = new URL('../../../public/', import.meta.url)
const fromDisk = (url) => Promise.resolve(fs.existsSync(new URL(url, PUBLIC)) ?
  {ok: true, json: () => Promise.resolve(JSON.parse(fs.readFileSync(new URL(url, PUBLIC), 'utf8')))} :
  {ok: false, status: 404})


describe('the networks\' chunk', () => {
  it('loads each network from its bundled snapshot', async () => {
    const starlink = await loadNetwork('S', {}, fromDisk)
    expect(starlink.network.count).toBeGreaterThan(9000)
    expect(starlink.data.fetched).toMatch(/^2026-/)
    const iridium = await loadNetwork('I', {}, fromDisk)
    expect(iridium.network.records).toHaveLength(80)
    expect(iridium.network.planes).toHaveLength(6)
    const dsn = await loadNetwork('D', {Sheet: StubSheet}, fromDisk)
    expect(dsn.network.config.sites.map((s) => s.friendlyName)).toEqual(['Madrid', 'Goldstone', 'Canberra'])
    expect(dsn.network.dishes.length).toBeGreaterThan(12)
    expect(Object.keys(NETWORK_URLS)).toEqual(['S', 'I', 'D'])
  })

  it('keeps each snapshot under the data policy\'s line for plain git', () => {
    for (const url of Object.values(NETWORK_URLS)) {
      expect(fs.statSync(new URL(url, PUBLIC)).size).toBeLessThan(1024 * 1024)
    }
  })

  it('refuses an unknown network', async () => {
    await expect(loadNetwork('Q', {}, fromDisk)).rejects.toThrow()
  })
})
