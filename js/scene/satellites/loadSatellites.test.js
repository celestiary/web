import fs from 'node:fs'
import {describe, expect, it} from 'bun:test'
import {SATELLITES_URL, loadSatelliteRecords} from './loadSatellites.js'
import {NETWORK_URLS} from '../networks/loadNetworks.js'


const PUBLIC = new URL('../../../public/', import.meta.url)
const asked = []
const fromDisk = (url) => {
  asked.push(url)
  return Promise.resolve(fs.existsSync(new URL(url, PUBLIC)) ?
    {ok: true, json: () => Promise.resolve(JSON.parse(fs.readFileSync(new URL(url, PUBLIC), 'utf8')))} :
    {ok: false, status: 404})
}


describe('Earth\'s satellites, from the bundled snapshot', () => {
  it('reads the constellations from the networks\' own files: one copy each', async () => {
    asked.length = 0
    const {records, header} = await loadSatelliteRecords(fromDisk)
    expect(asked).toEqual([SATELLITES_URL, NETWORK_URLS.I, NETWORK_URLS.S])
    expect(header.groups.starlink.file).toBe(NETWORK_URLS.S)
    expect(header.groups.iridium.file).toBe(NETWORK_URLS.I)
    const of = (group) => records.filter((r) => r.group === group)
    expect(of('starlink').length).toBe(header.groups.starlink.kept)
    expect(of('iridium')).toHaveLength(80)
    // Each once.
    expect(new Set(records.map((r) => r.id)).size).toBe(records.length)
    // Starlink in its order, the first its slider counts: by serial number.
    expect(of('starlink').slice(0, 3).map((r) => r.name)).toEqual(['STARLINK-1008', 'STARLINK-1012', 'STARLINK-1017'])
    // With their designators, as the rows have them.
    expect(of('starlink')[0].intlId).toBe('2019-074B')
    expect(records.find((r) => r.id === 25544)).toMatchObject({known: true, label: 'ISS', intlId: '1998-067A'})
  })

  it('leaves out the groups asked, and doesn\'t fetch their files', async () => {
    asked.length = 0
    const {records, header} = await loadSatelliteRecords(fromDisk, {skip: new Set(['starlink', 'iridium'])})
    expect(asked).toEqual([SATELLITES_URL])
    expect(header.groups.starlink).toBeUndefined()
    expect(records.some((r) => r.group === 'starlink' || r.group === 'iridium')).toBe(false)
    expect(records.length).toBeGreaterThan(400)
  })
})
