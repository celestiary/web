import {describe, expect, it} from 'bun:test'
import {Color, Object3D, PerspectiveCamera, Vector3} from 'three'
import Satellites, {ARRIVAL_DIST, GROUPS} from './Satellites.js'
import {aliasesOf, displayName, satelliteFacts, satelliteTarget} from './names.js'
import {parseCatalog, temePosition} from './sgp4.js'


// An ISS-like orbit and a GPS-like one, elements of 2026 Oct 22 12:00 UTC
// (made up for the test: the real snapshot's are in satellites.json).
const EPOCH_JD = 2461336.0
const SNAPSHOT = {rows: [
  [25544, 'ISS (ZARYA)', 'stations', '1998-067A', '2026-10-22T12:00:00.000000', 15.5, 0.0005, 51.64, 100, 90, 0,
    1.5e-4, 1e-4, 0],
  [40000, 'GPS BIIF-9 (PRN 26)', 'gnss', '2015-013A', '2026-10-22T12:00:00.000000', 2.0056, 0.005, 55, 30, 10, 0,
    0, 0, 0],
]}


/** A label sheet without a canvas. */
class StubSheet {
  /** */
  constructor() {
    this.labels = []
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {string} text
   */
  add(x, y, z, text) {
    this.labels.push(text)
  }

  /** @returns {Object3D} */
  compile() {
    const sprites = new Object3D
    sprites.userData.sheet = this
    return sprites
  }
}


const newSatellites = (opts = {}) => new Satellites(parseCatalog(SNAPSHOT), {Sheet: StubSheet, ...opts})


describe('Satellites', () => {
  it('puts each satellite where SGP4 does, in the equator frame', () => {
    const sats = newSatellites()
    sats.update(EPOCH_JD + 0.25)
    const pos = sats.points.geometry.attributes.position
    const p = temePosition(sats.records[0], EPOCH_JD + 0.25)
    expect(pos.getX(0)).toBeCloseTo(p.x * 1e3, -1)
    expect(pos.getY(0)).toBeCloseTo(p.z * 1e3, -1)
    expect(pos.getZ(0)).toBeCloseTo(-p.y * 1e3, -1)
    // The ISS about 400 km up, GPS about 20,200 km.
    const r = (i) => new Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).length()
    expect(r(0) / 1e3).toBeGreaterThan(6378 + 300)
    expect(r(0) / 1e3).toBeLessThan(6378 + 500)
    expect(r(1) / 1e3).toBeCloseTo(26560, -3)
    expect(sats.drawnCount).toBe(2)
  })

  it('hides a satellite outside its elements\' window', () => {
    const sats = newSatellites()
    // 60 days on: the ISS's 30-day window is over, GPS's 180 isn't.
    sats.update(EPOCH_JD + 60)
    const show = sats.points.geometry.attributes.aShow
    expect([show.getX(0), show.getX(1)]).toEqual([0, 1])
    expect(sats.drawnAt(25544, EPOCH_JD + 60)).toBe(false)
    expect(sats.drawnAt(40000, EPOCH_JD + 60)).toBe(true)
  })

  it('makes a node for a target, moved with it, for the camera to hang from', () => {
    const sats = newSatellites()
    sats.update(EPOCH_JD)
    const node = sats.node(25544)
    expect(node.isSatelliteNode).toBe(true)
    expect(node.parent).toBe(sats)
    expect(node.arrivalDistance).toBe(ARRIVAL_DIST)
    expect(sats.node(25544)).toBe(node)
    expect(sats.node(1)).toBeNull()
    const before = node.position.clone()
    sats.marks.visible = false
    // Moved even with the points hidden: 10 minutes is ~4,600 km along.
    sats.update(EPOCH_JD + (10 / 1440))
    expect(node.position.distanceTo(before) / 1e3).toBeCloseTo(4600, -3)
  })

  it('names the stations and the target, the target only while it is', () => {
    const sats = newSatellites()
    sats.update(EPOCH_JD)
    expect([...sats.labels.keys()]).toEqual([25544])
    const label = sats.labels.get(25544)
    expect(label.userData.ownSheet.labels).toEqual(['ISS'])
    expect(label.userData.labelTargets).toEqual([{kind: 'satellite', id: 25544, name: 'ISS', body: 'earth'}])
    sats.setTarget(40000)
    sats.update(EPOCH_JD)
    expect([...sats.labels.keys()].sort()).toEqual([25544, 40000])
    sats.setTarget(null)
    sats.update(EPOCH_JD)
    expect([...sats.labels.keys()]).toEqual([25544])
  })

  it('shows the points near Earth, and the names nearer', () => {
    const camera = new PerspectiveCamera()
    const sats = newSatellites({camera})
    const earth = new Object3D
    earth.add(sats)
    camera.position.set(0, 0, 5e7)
    camera.updateMatrixWorld()
    sats.update(EPOCH_JD)
    sats.update(EPOCH_JD)
    expect(sats.points.visible).toBe(true)
    expect(sats.labels.get(25544).visible).toBe(true)
    camera.position.set(0, 0, 5e8)
    camera.updateMatrixWorld()
    sats.update(EPOCH_JD)
    expect(sats.points.visible).toBe(true)
    expect(sats.labels.get(25544).visible).toBe(false)
    camera.position.set(0, 0, 5e9)
    camera.updateMatrixWorld()
    sats.update(EPOCH_JD)
    expect(sats.points.visible).toBe(false)
  })

  it('colours each group, in linear values as three\'s Color holds them', () => {
    const sats = newSatellites()
    const c = sats.points.geometry.attributes.aColor
    expect(c.getX(1)).toBeCloseTo(new Color(GROUPS.gnss.color).r, 5)
  })
})


describe('satellite names', () => {
  it('calls the known ones by the names people use', () => {
    const [iss, gps] = parseCatalog(SNAPSHOT)
    expect(displayName(iss)).toBe('ISS')
    expect(aliasesOf(iss)).toEqual(expect.arrayContaining(['International Space Station', 'ISS (ZARYA)', '25544',
      '1998-067A']))
    expect(displayName(gps)).toBe('GPS BIIF-9 (PRN 26)')
    expect(satelliteTarget(gps)).toEqual({kind: 'satellite', id: 40000, name: 'GPS BIIF-9 (PRN 26)', body: 'earth'})
  })
})


describe('satellite facts', () => {
  it('gives the orbit from the mean elements, and the elements\' age', () => {
    const [iss, gps] = parseCatalog(SNAPSHOT)
    const f = satelliteFacts(iss, EPOCH_JD + 0.5, '2026-10-22T13:00:00Z')
    expect(f.name).toBe('ISS')
    expect(f.kind).toBe('Satellite, space station')
    const row = (label) => f.rows.find((r) => r[0] === label)
    // 15.5 rev/day: a = 6,796 km, about 418 km up.
    expect(row('Height')[1]).toMatch(/^41\d – 42\d$/)
    expect(row('Inclination')[1]).toBe('51.6°')
    expect(row('Period')[1]).toBe('92.9')
    expect(row('Elements')).toEqual(['Elements', '2026-10-22 12:00 UTC', '12.0 h before this date'])
    expect(row('Designator')[1]).toBe('1998-067A')
    expect(f.notes).toEqual(['Elements from CelesTrak, 2026-10-22.'])
    // GPS: 20,200 km up.
    expect(satelliteFacts(gps, EPOCH_JD).fact).toMatch(/^20,\d{3} km up$/)
    // Past its window, it says it isn't drawn.
    expect(satelliteFacts(iss, EPOCH_JD - 40).notes[0]).toMatch(/^Not drawn: more than 30 days/)
  })
})
