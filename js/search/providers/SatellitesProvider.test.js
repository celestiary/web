import {describe, expect, it} from 'bun:test'
import {Object3D} from 'three'
import Satellites from '../../scene/satellites/Satellites.js'
import {parseCatalog} from '../../scene/satellites/sgp4.js'
import SatellitesProvider from './SatellitesProvider.js'


const EPOCH = '2026-10-22T12:00:00.000000'
const row = (id, name, group, intl = '2020-001A') => [id, name, group, intl, EPOCH, 15.06, 0.0001, 53, 10, 0, 0,
  1e-4, 0, 0]
const SNAPSHOT = {
  groups: {
    stations: {label: 'Space stations'},
    starlink: {label: 'Starlink', count: 2, orderedBy: 'serial number'},
  },
  known: {25544: {name: 'ISS', aliases: ['International Space Station']}},
  rows: [
    row(25544, 'ISS (ZARYA)', 'stations', '1998-067A'),
    row(48274, 'CSS (TIANHE)', 'stations'),
    row(44714, 'STARLINK-1008', 'starlink'),
    row(58385, 'STARLINK-30930', 'starlink'),
    row(58386, 'STARLINK-30931', 'starlink'),
    row(60000, 'STARLINK-3093', 'starlink'),
  ],
}


/** @returns {SatellitesProvider} */
function provider() {
  const sats = new Satellites(parseCatalog(SNAPSHOT), {groups: SNAPSHOT.groups,
    Sheet: class {
      add() {/* none */}
      compile() {
        return new Object3D
      }
    }})
  return new SatellitesProvider(sats, (name) => `milkyway/sun/${name}`)
}
const names = (hits) => hits.map((h) => h.entry.displayName)


describe('SatellitesProvider', () => {
  it('gives Tier A the groups shown whole, and searches every object itself', () => {
    const p = provider()
    expect(p.collectAll().map((e) => e.displayName)).toEqual(['ISS', 'CSS (TIANHE)'])
    expect(p.scopePath).toBe('milkyway/sun/earth')
    // Beyond Starlink's count of two, and found all the same.
    expect(names(p.search('starlink 30931'))).toEqual(['STARLINK-30931'])
    const e = p.search('STARLINK-30930')[0].entry
    expect(e).toMatchObject({id: 'sat:58385', kind: 'satellite', path: 'milkyway/sun/earth/sat:58385',
      payload: {group: 'starlink', target: {kind: 'satellite', id: 58385, body: 'earth'}}})
    expect(p.search('STARLINK-30930')[0].entry).toBe(e)
  })

  it('ranks the exact first, then by prefix, a word\'s prefix and anywhere', () => {
    const p = provider()
    // Case, spaces and dashes aside: the exact one, then the longer ones it begins.
    expect(names(p.search('Starlink 3093'))).toEqual(['STARLINK-3093', 'STARLINK-30930', 'STARLINK-30931'])
    expect(p.search('starlink-3093')[0].score).toBe(0)
    // A word: 'tianhe' in 'CSS (TIANHE)'; an alias; the catalogue number; anywhere.
    expect(names(p.search('tianhe'))).toEqual(['CSS (TIANHE)'])
    expect(names(p.search('international'))).toEqual(['ISS'])
    expect(names(p.search('25544'))).toEqual(['ISS'])
    expect(names(p.search('3093', 1))).toEqual(['STARLINK-3093'])
    expect(p.search('s')).toEqual([])
  })
})
