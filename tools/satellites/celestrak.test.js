import {afterEach, describe, expect, it} from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {cacheFile, fetchGroup, parseGpCsv} from './celestrak.mjs'


const HEADER = 'OBJECT_NAME,OBJECT_ID,EPOCH,MEAN_MOTION,ECCENTRICITY,INCLINATION,RA_OF_ASC_NODE,' +
  'ARG_OF_PERICENTER,MEAN_ANOMALY,EPHEMERIS_TYPE,CLASSIFICATION_TYPE,NORAD_CAT_ID,ELEMENT_SET_NO,' +
  'REV_AT_EPOCH,BSTAR,MEAN_MOTION_DOT,MEAN_MOTION_DDOT'
// CelesTrak's answer for CATNR=25544 on 2026-10-26, as CSV, and as JSON.
const ISS_CSV = `${HEADER}\r\nISS (ZARYA),1998-067A,2026-10-26T05:01:03.508032,15.49059765,.000692,51.6337,` +
  '11.7282,310.9581,49.0809,0,U,25544,999,59206,.1189007E-3,.6121E-4,0\r\n'
const ISS_JSON = {
  OBJECT_NAME: 'ISS (ZARYA)', OBJECT_ID: '1998-067A', EPOCH: '2026-10-26T05:01:03.508032',
  MEAN_MOTION: 15.49059765, ECCENTRICITY: 0.000692, INCLINATION: 51.6337, RA_OF_ASC_NODE: 11.7282,
  ARG_OF_PERICENTER: 310.9581, MEAN_ANOMALY: 49.0809, EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: 'U',
  NORAD_CAT_ID: 25544, ELEMENT_SET_NO: 999, REV_AT_EPOCH: 59206, BSTAR: 0.0001189007,
  MEAN_MOTION_DOT: 6.121e-5, MEAN_MOTION_DDOT: 0,
}
const row = (name, id) => `${name},2026-123A,2026-10-26T00:00:00.000000,15.5,.0001,53,1,2,3,0,U,${id},999,1,.1E-3,0,0`


describe('CelesTrak GP CSV', () => {
  it('reads as the records CelesTrak\'s JSON gives', () => {
    expect(parseGpCsv(ISS_CSV)).toEqual([ISS_JSON])
  })

  it('reads quoted names, blank fields and six-digit numbers', () => {
    const recs = parseGpCsv(`${HEADER}\n${row('"STARLINK-1, ""TEST"""', 101030)}\n${row('', 270001)}\n`)
    expect(recs.map((r) => [r.OBJECT_NAME, r.NORAD_CAT_ID])).toEqual([['STARLINK-1, "TEST"', 101030], [null, 270001]])
  })

  it('refuses an answer that isn\'t GP CSV, or a record SGP4 can\'t start from', () => {
    expect(() => parseGpCsv('No GP data found')).toThrow(/not CelesTrak's GP CSV/)
    expect(() => parseGpCsv('[{"OBJECT_NAME":"ISS"}]')).toThrow(/not CelesTrak's GP CSV/)
    expect(() => parseGpCsv(`${HEADER}\n${row('X', 1).replace(',15.5,', ',,')}`)).toThrow(/no MEAN_MOTION/)
    expect(() => parseGpCsv(`${HEADER}\n${row('X', 1).replace(',15.5,', ',fast,')}`)).toThrow(/isn't a number/)
    expect(() => parseGpCsv(`${HEADER}\n${row('X, Y', 1)}`)).toThrow(/18 fields/)
  })
})


describe('fetchGroup', () => {
  const dirs = []
  const tmp = () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'celestrak-test-'))
    dirs.push(d)
    return d
  }
  afterEach(() => dirs.splice(0).forEach((d) => fs.rmSync(d, {recursive: true, force: true})))
  const url = 'https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=CSV'

  it('asks once, without following redirects, and answers from the cache for two hours', async () => {
    const cacheDir = tmp()
    const calls = []
    const fetchFn = (u, init) => {
      calls.push([u, init.redirect])
      return Promise.resolve(new Response(ISS_CSV, {status: 200}))
    }
    const first = await fetchGroup(url, {cacheDir, fetchFn})
    const second = await fetchGroup(url, {cacheDir, fetchFn})
    expect(calls).toEqual([[url, 'manual']])
    expect(first.records).toEqual([ISS_JSON])
    expect(second.records).toEqual([ISS_JSON])
    expect(second.fetchedMs).toBe(fs.statSync(cacheFile(url, cacheDir)).mtimeMs)
  })

  it('stops at an answer that isn\'t a 200, and caches nothing it couldn\'t read', async () => {
    const cacheDir = tmp()
    for (const [body, status] of [['GP data has not updated since your last successful download', 403],
      ['', 301], ['No GP data found', 200]]) {
      await expect(fetchGroup(url, {cacheDir, fetchFn: () => Promise.resolve(new Response(body, {status}))})).rejects.toThrow(url)
    }
    expect(fs.existsSync(cacheFile(url, cacheDir))).toBe(false)
    await expect(fetchGroup(url, {cacheDir, offline: true})).rejects.toThrow(/--offline/)
  })
})
