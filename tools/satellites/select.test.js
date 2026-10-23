import {describe, expect, it} from 'bun:test'
import {parseCatalog} from '../../js/scene/satellites/sgp4.js'
import {GROUP_QUERIES, buildSnapshot, gpUrl, sample} from './select.js'


const omm = (id, extra = {}) => ({
  NORAD_CAT_ID: id, OBJECT_NAME: `SAT ${id}`, OBJECT_ID: `2020-001${String.fromCharCode(65 + (id % 26))}`,
  EPOCH: '2026-10-22T12:00:00.000000', MEAN_MOTION: 15.5, ECCENTRICITY: 0.0005, INCLINATION: 51.6,
  RA_OF_ASC_NODE: 10, ARG_OF_PERICENTER: 20, MEAN_ANOMALY: 30, BSTAR: 1e-4, MEAN_MOTION_DOT: 1e-5,
  MEAN_MOTION_DDOT: 0, ...extra,
})


describe('satellites snapshot', () => {
  it('asks CelesTrak for OMM JSON', () => {
    expect(gpUrl({GROUP: 'stations'})).toBe('https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=json')
    expect(GROUP_QUERIES[0].group).toBe('stations')
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
    expect(snap.groups.gnss).toEqual({url: 'b', of: 3, kept: 1})
    // A group CelesTrak refused is named, for the next run.
    const partial = buildSnapshot([{group: 'starlink', records: [], url: 'c', error: '403'}], 'x')
    expect(partial.groups.starlink).toEqual({url: 'c', of: 0, kept: 0, error: '403'})
    const recs = parseCatalog(snap)
    expect(recs.map((r) => r.id)).toEqual([25544, 40000])
    expect(recs[1].group).toBe('gnss')
  })
})
