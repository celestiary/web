import {describe, expect, it} from 'bun:test'
import {COMPACT_FORMAT, decodeElements, encodeElements} from './compactElements.js'
import {newSatRecord, temePosition} from '../satellites/sgp4.js'


const omm = (id, extra = {}) => ({
  NORAD_CAT_ID: id, OBJECT_NAME: `STARLINK-${id}`, OBJECT_ID: '2020-001A',
  EPOCH: '2026-10-22T12:34:56.789012', MEAN_MOTION: 15.06412345, ECCENTRICITY: 0.0001234, INCLINATION: 53.0543,
  RA_OF_ASC_NODE: 123.4567, ARG_OF_PERICENTER: 89.1234, MEAN_ANOMALY: 270.8765, BSTAR: 0.00012345,
  MEAN_MOTION_DOT: 0.00001234, MEAN_MOTION_DDOT: 0, ...extra,
})


describe('compact elements', () => {
  it('round-trips the fields SGP4 starts from, in NORAD order', () => {
    const recs = [omm(45000), omm(44714, {EPOCH: '2026-10-20T05:52:09.093000'}), omm(45001, {BSTAR: -0.00001})]
    const data = encodeElements(recs, {names: true})
    expect(data.format).toBe(COMPACT_FORMAT)
    expect(data.epochBase).toBe('2026-10-20T00:00:00.000Z')
    expect(data.id).toEqual([44714, 286, 1])
    const back = decodeElements(JSON.parse(JSON.stringify(data)))
    expect(back.map((r) => r.NORAD_CAT_ID)).toEqual([44714, 45000, 45001])
    expect(back[1].OBJECT_NAME).toBe('STARLINK-45000')
    expect(back[1].EPOCH).toBe('2026-10-22T12:34:56.789Z')
    expect(back[1].MEAN_MOTION).toBeCloseTo(15.06412345, 8)
    expect(back[1].ECCENTRICITY).toBeCloseTo(0.0001234, 7)
    expect(back[1].RA_OF_ASC_NODE).toBeCloseTo(123.4567, 4)
    expect(back[2].BSTAR).toBeCloseTo(-0.00001, 9)
    // Not SGP4's: left out, read as 0.
    expect(back[1].MEAN_MOTION_DOT).toBe(0)
    // Without names, the number.
    expect(decodeElements(encodeElements(recs))[0].OBJECT_NAME).toBe('NORAD 44714')
  })

  it('keeps the names and designators, each once', () => {
    const recs = [omm(44714, {OBJECT_ID: '2019-074B'}), omm(44718, {OBJECT_ID: '2019-074F'}),
      omm(44720, {OBJECT_NAME: 'STARLINK-44720 [DTC]', OBJECT_ID: '2019-074AB'}), omm(45001, {OBJECT_ID: '2020-001A'}),
      omm(45002, {OBJECT_ID: ''}), omm(45003, {OBJECT_NAME: 'STARLINK-1008', OBJECT_ID: '2020-001B'})]
    const data = encodeElements(recs, {names: true})
    expect(data.namePrefix).toBe('STARLINK-')
    expect(data.name).toEqual(['44714', '44718', '44720 [DTC]', '45001', '45002', '1008'])
    expect(data.intlId).toEqual(['2019-074B', 'F', 'AB', '2020-001A', '', '2020-001B'])
    const back = decodeElements(JSON.parse(JSON.stringify(data)))
    expect(back.map((r) => [r.OBJECT_NAME, r.OBJECT_ID])).toEqual(recs.map((r) => [r.OBJECT_NAME, r.OBJECT_ID]))
    // A designator that would read as a piece is refused, not mangled.
    expect(() => encodeElements([omm(1, {OBJECT_ID: '2019-074B'}), omm(2, {OBJECT_ID: 'X'})], {names: true})).toThrow()
  })

  it('propagates where the full elements do, to metres over a week', () => {
    const full = omm(44714)
    const a = newSatRecord(full)
    const b = newSatRecord(decodeElements(encodeElements([full]))[0])
    for (const days of [0, 1, 7]) {
      const p = temePosition(a, a.epochJd + days, true)
      const q = temePosition(b, a.epochJd + days, true)
      expect(Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z)).toBeLessThan(0.15)
    }
  })

  it('refuses another format', () => {
    expect(() => decodeElements({format: 'x', id: []})).toThrow()
  })
})
