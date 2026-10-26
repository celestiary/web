import {describe, expect, it} from 'bun:test'
import {decodeElements} from '../../js/scene/networks/compactElements.js'
import {serialOf} from '../../js/scene/satellites/names.js'
import {parseCatalog} from '../../js/scene/satellites/sgp4.js'
import {GROUP_QUERIES, buildSnapshot, gpUrl, sample} from './select.js'


const omm = (id, extra = {}) => ({
  NORAD_CAT_ID: id, OBJECT_NAME: `SAT ${id}`, OBJECT_ID: `2020-001${String.fromCharCode(65 + (id % 26))}`,
  EPOCH: '2026-10-22T12:00:00.000000', MEAN_MOTION: 15.5, ECCENTRICITY: 0.0005, INCLINATION: 51.6,
  RA_OF_ASC_NODE: 10, ARG_OF_PERICENTER: 20, MEAN_ANOMALY: 30, BSTAR: 1e-4, MEAN_MOTION_DOT: 1e-5,
  MEAN_MOTION_DDOT: 0, ...extra,
})


describe('satellites snapshot', () => {
  it('asks CelesTrak for OMM CSV', () => {
    expect(gpUrl({GROUP: 'stations'})).toBe('https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=CSV')
    expect(GROUP_QUERIES[0].group).toBe('stations')
    // Each group brings how the app shows it: no table of the app's own.
    for (const g of GROUP_QUERIES) {
      expect(g.label).toBeTruthy()
      expect(g.color).toMatch(/^#[0-9a-f]{6}$/)
    }
    expect(GROUP_QUERIES.find((g) => g.group === 'iridium').query).toEqual({GROUP: 'iridium-NEXT'})
  })

  it('samples evenly by NORAD number', () => {
    const recs = Array.from({length: 100}, (_, i) => omm(1000 - i))
    const kept = sample(recs, 10)
    expect(kept.map((r) => r.NORAD_CAT_ID)).toEqual([901, 911, 921, 931, 941, 951, 961, 971, 981, 991])
    expect(sample(recs.slice(0, 3), 10)).toHaveLength(3)
  })

  it('files a satellite once, under its first group, and the app reads it back', () => {
    const snap = buildSnapshot([
      {group: 'stations', records: [omm(25544)], url: 'a'},
      {group: 'gnss', records: [omm(25544), omm(40000, {MEAN_MOTION: 2.0056}), omm(1, {MEAN_MOTION: 0})], url: 'b'},
    ], '2026-10-23T00:00:00Z')
    expect(snap.rows.map((r) => [r[0], r[2]])).toEqual([[25544, 'stations'], [40000, 'gnss']])
    expect(snap.groups.gnss).toEqual({label: 'gnss', kind: 'gnss', color: '#c8c8c8', url: 'b', of: 3, kept: 1})
    expect(snap.body).toBe('earth')
    expect(snap.known[25544].name).toBe('ISS')
    // A group CelesTrak refused is named, for the next run.
    const partial = buildSnapshot([{group: 'starlink', records: [], url: 'c', error: '403', label: 'Starlink',
      kind: 'Starlink', color: '#7fd0ff'}], 'x')
    expect(partial.groups.starlink).toEqual({label: 'Starlink', kind: 'Starlink', color: '#7fd0ff', url: 'c', of: 0,
      kept: 0, error: '403'})
    const recs = parseCatalog(snap)
    expect(recs.map((r) => r.id)).toEqual([25544, 40000])
    expect(recs[1].group).toBe('gnss')
  })

  it('keeps a constellation whole in a file of its own, with its order and how many show to start', () => {
    const starlink = GROUP_QUERIES.find((g) => g.group === 'starlink')
    expect(starlink).toMatchObject({order: 'serial', count: 300, file: 'data/earth/satellites/networks/starlink.json'})
    expect(GROUP_QUERIES.find((g) => g.group === 'iridium').file).toBe('data/earth/satellites/networks/iridium.json')
    expect(starlink.keep).toBeUndefined()
    const sl = (id, n) => omm(id, {OBJECT_NAME: `STARLINK-${n}`})
    const snap = buildSnapshot([
      {group: 'stations', records: [omm(25544)], url: 'a'},
      {...starlink, records: [sl(3, 30930), sl(1, 1008), sl(2, 2449), sl(4, 1008), sl(25544, 1)], url: 'b'},
    ], 'x')
    expect(snap.rows.map((r) => r[0])).toEqual([25544])
    expect(snap.groups.starlink).toMatchObject({order: 'serial', orderedBy: 'serial number', count: 300,
      file: 'data/earth/satellites/networks/starlink.json', of: 5, kept: 4})
    const part = snap.files['data/earth/satellites/networks/starlink.json']
    expect(part).toMatchObject({group: 'starlink', fetched: 'x', url: 'b', count: 4})
    // In NORAD order (the app puts it in its order), named, each once.
    expect(decodeElements(part).map((r) => [r.NORAD_CAT_ID, r.OBJECT_NAME])).toEqual([
      [1, 'STARLINK-1008'], [2, 'STARLINK-2449'], [3, 'STARLINK-30930'], [4, 'STARLINK-1008']])
    // Refused this time: no file, so the last one stays.
    const refused = buildSnapshot([{...starlink, records: [], url: 'b', error: '403'}], 'x')
    expect(refused.files).toEqual({})
    expect(serialOf('STARLINK-11385 [DTC]')).toBe(11385)
    expect(serialOf('NO NUMBER')).toBe(Infinity)
  })
})
