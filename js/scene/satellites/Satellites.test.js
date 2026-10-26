import {describe, expect, it} from 'bun:test'
import {Color, Object3D, PerspectiveCamera, Vector3} from 'three'
import Satellites, {ARRIVAL_DIST} from './Satellites.js'
import {NAME_FADE_MS} from '../population/Population.js'
import {aliasesOf, displayName, satelliteFacts} from './names.js'
import {parseCatalog, temePosition} from './sgp4.js'


// An ISS-like orbit, a GPS-like one and two Starlink-like ones, elements of
// 2026 Oct 22 12:00 UTC (made up for the test: the real snapshot's are in
// data/earth/satellites/), with the header's groups and known names.
const EPOCH_JD = 2461336.0
const EPOCH = '2026-10-22T12:00:00.000000'
const SNAPSHOT = {
  body: 'earth',
  groups: {
    stations: {label: 'Space stations', kind: 'space station', color: '#fff2c0'},
    gnss: {label: 'Navigation', kind: 'navigation', color: '#9fe09f'},
    starlink: {label: 'Starlink (a sample)', kind: 'Starlink', color: '#7fd0ff'},
  },
  known: {25544: {name: 'ISS', aliases: ['International Space Station', 'Zarya']}},
  rows: [
    [25544, 'ISS (ZARYA)', 'stations', '1998-067A', EPOCH, 15.5, 0.0005, 51.64, 100, 90, 0, 1.5e-4, 1e-4, 0],
    [40000, 'GPS BIIF-9 (PRN 26)', 'gnss', '2015-013A', EPOCH, 2.0056, 0.005, 55, 30, 10, 0, 0, 0, 0],
    [50001, 'STARLINK-1001', 'starlink', '2019-074A', EPOCH, 15.06, 0.0001, 53, 10, 0, 0, 1e-4, 0, 0],
    [50002, 'STARLINK-1002', 'starlink', '2019-074B', EPOCH, 15.06, 0.0001, 53, 10, 0, 30, 1e-4, 0, 0],
  ],
}


/** A label sheet without a canvas. */
class StubSheet {
  /** */
  constructor() {
    this.labels = []
    this.positions = []
    this.positionAttribute = null
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {string} text
   */
  add(x, y, z, text) {
    this.labels.push(text)
    this.positions.push(x, y, z)
  }

  /** @returns {Object3D} */
  compile() {
    const sprites = new Object3D
    sprites.userData.sheet = this
    return sprites
  }
}


/** A label sheet with the shown states and fade the declutter and Population use. */
class FadeSheet extends StubSheet {
  /**
   * @param {number} n
   * @param {Array<string>} texts
   * @param {string} [font]
   * @param {Array<number>} [padding]
   * @param {boolean} [rte]
   * @param {boolean} [surface]
   * @param {object} [opts]
   */
  constructor(n, texts, font, padding, rte, surface, opts) {
    super()
    this.fontArgs = font ? [font, opts] : null
    this.shown = []
    this.alpha = []
    this.fadeMs = 0
  }

  /** @param {...any} args */
  add(...args) {
    super.add(...args)
    this.shown.push(1)
    this.alpha.push(1)
  }

  /** @returns {Object3D} */
  compile() {
    const sprites = super.compile()
    this.shownAttribute = {getX: (i) => this.alpha[i], setX: (i, v) => {
      this.alpha[i] = v
    }}
    return sprites
  }

  /** @param {number} ms */
  setFade(ms) {
    this.fadeMs = ms
  }

  /**
   * @param {number} i
   * @param {number} scale
   * @param {number} brightness
   */
  setStyle(i, scale, brightness) {
    (this.styles ??= [])[i] = [scale, brightness]
  }
}


const newSatellites = (opts = {}) => new Satellites(parseCatalog(SNAPSHOT),
    {groups: SNAPSHOT.groups, Sheet: StubSheet, ...opts})
const names = (sats) => sats.nameSheet?.userData.ownSheet.labels ?? []


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
    expect(sats.drawnCount).toBe(4)
    expect(sats.body).toBe('earth')
  })

  it('hides a satellite outside its elements\' window', () => {
    const sats = newSatellites()
    // 60 days on: the low orbits' 30-day windows are over, GPS's 180 isn't.
    sats.update(EPOCH_JD + 60)
    const show = sats.points.geometry.attributes.aShow
    expect([0, 1, 2, 3].map((i) => show.getX(i))).toEqual([0, 1, 0, 0])
    expect(sats.drawnAt(25544, EPOCH_JD + 60)).toBe(false)
    expect(sats.drawnAt(40000, EPOCH_JD + 60)).toBe(true)
  })

  it('makes a node for a target, moved with it, for the camera to hang from', () => {
    const sats = newSatellites()
    sats.update(EPOCH_JD)
    const node = sats.node(25544)
    expect(node.isSatelliteNode).toBe(true)
    expect(node.body).toBe('earth')
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

  it('lists its groups from the data, with their counts, colours and switches', () => {
    const sats = newSatellites()
    expect(sats.groups()).toEqual([
      {key: 'stations', label: 'Space stations', kind: 'space station', color: '#fff2c0', count: 1, shown: true},
      {key: 'gnss', label: 'Navigation', kind: 'navigation', color: '#9fe09f', count: 1, shown: true},
      {key: 'starlink', label: 'Starlink (a sample)', kind: 'Starlink', color: '#7fd0ff', count: 2, shown: true},
    ])
    const c = sats.points.geometry.attributes.aColor
    // In linear values, as three's Color holds them.
    expect(c.getX(1)).toBeCloseTo(new Color('#9fe09f').r, 5)
  })

  it('hides a group\'s points and names when it\'s switched off', () => {
    const sats = newSatellites()
    let changes = 0
    sats.onChange = () => changes++
    sats.setLabelBudget(4)
    sats.setGroupShown('starlink', false)
    expect(changes).toBe(2)
    sats.update(EPOCH_JD)
    const show = sats.points.geometry.attributes.aShow
    expect([0, 1, 2, 3].map((i) => show.getX(i))).toEqual([1, 1, 0, 0])
    expect(sats.maxLabels()).toBe(2)
    // The budget can't ask for more names than the shown groups hold.
    expect(sats.labelBudget).toBe(2)
    expect(names(sats)).toEqual(['ISS', 'GPS BIIF-9 (PRN 26)'])
    sats.setGroupShown('starlink', false)
    expect(changes).toBe(2)
    sats.setGroupShown('starlink', true, true)
    expect(changes).toBe(2)
    expect(sats.isGroupShown('starlink')).toBe(true)
  })

  it('names the best known to start, then as many as the budget, ranked', () => {
    const sats = newSatellites()
    expect(sats.defaultLabelBudget).toBe(1)
    sats.update(EPOCH_JD)
    expect(names(sats)).toEqual(['ISS'])
    sats.setLabelBudget(3)
    sats.update(EPOCH_JD)
    // The best known, then by group in the data's order.
    expect(names(sats)).toEqual(['ISS', 'GPS BIIF-9 (PRN 26)', 'STARLINK-1001'])
    const sprites = sats.nameSheet
    expect(sprites.userData.labelTargets.map((t) => t.id)).toEqual([25544, 40000, 50001])
    expect(sprites.userData.labelRank[0]).toBeGreaterThan(sprites.userData.labelRank[2])
    // Laid on their satellites.
    const pos = sats.points.geometry.attributes.position
    expect(sprites.userData.ownSheet.positions.slice(3, 6)).toEqual([pos.getX(1), pos.getY(1), pos.getZ(1)])
    sats.setLabelBudget(99)
    expect(sats.labelBudget).toBe(4)
    sats.setLabelBudget(0)
    sats.update(EPOCH_JD)
    expect(sats.nameSheet).toBeNull()
  })

  it('names the target on its own, whatever the budget and its group', () => {
    const sats = newSatellites()
    sats.setLabelBudget(0)
    sats.setGroupShown('starlink', false)
    sats.setTarget(50002)
    sats.update(EPOCH_JD)
    expect(sats.targetLabel.userData.ownSheet.labels).toEqual(['STARLINK-1002'])
    expect(sats.targetLabel.userData.labelTargets).toEqual([
      {kind: 'satellite', id: 50002, name: 'STARLINK-1002', body: 'earth'},
    ])
    expect(sats.targetLabel.visible).toBe(true)
    sats.setTarget(null)
    sats.update(EPOCH_JD)
    expect(sats.targetLabel).toBeNull()
  })

  it('names a target the budget names by the label it has: no second one, no rebuild', () => {
    const camera = new PerspectiveCamera()
    const sats = newSatellites({camera, labelDist: 1e8})
    new Object3D().add(sats)
    camera.position.set(0, 0, 5e7)
    camera.updateMatrixWorld()
    sats.setLabelBudget(3)
    sats.update(EPOCH_JD)
    const sheet = sats.nameSheet
    sats.setTarget(50001)
    sats.update(EPOCH_JD)
    expect(sats.nameSheet).toBe(sheet)
    expect(names(sats)).toEqual(['ISS', 'GPS BIIF-9 (PRN 26)', 'STARLINK-1001'])
    expect(sats.targetLabel).toBeNull()
    // Too far for the budget's names: the target's alone, on its own.
    camera.position.set(0, 0, 5e8)
    camera.updateMatrixWorld()
    sats.update(EPOCH_JD)
    expect(sats.nameSheet.visible).toBe(false)
    expect(sats.targetLabel.userData.ownSheet.labels).toEqual(['STARLINK-1001'])
    expect(sats.targetLabel.visible).toBe(true)
  })

  it('keeps each staying name\'s shown state through a rebuild, and fades new ones in', () => {
    const sats = newSatellites({Sheet: FadeSheet})
    sats.setLabelBudget(2)
    sats.update(EPOCH_JD)
    const first = sats.nameSheet.userData.ownSheet
    expect(first.fadeMs).toBe(NAME_FADE_MS)
    // As the declutter left them: the ISS shown, GPS hidden.
    first.shown = [1, 0]
    first.alpha = [1, 0.4]
    sats.setLabelBudget(3)
    sats.update(EPOCH_JD)
    const next = sats.nameSheet.userData.ownSheet
    expect(next).not.toBe(first)
    expect(next.labels).toEqual(['ISS', 'GPS BIIF-9 (PRN 26)', 'STARLINK-1001'])
    expect(next.shown).toEqual([1, 0, 0])
    expect(next.alpha).toEqual([1, 0.4, 0])
    // Its shown names keep their place; those behind Earth take none.
    expect(sats.nameSheet.userData.declutterHold).toBeGreaterThan(0)
    expect(sats.nameSheet.userData.labelOccluder).toBe(sats)
  })

  it('sizes and dims each name from the nearest in view to the farthest, the nearer winning where two touch', () => {
    const camera = new PerspectiveCamera(90, 1, 1, 1e10)
    const sats = newSatellites({camera, Sheet: FadeSheet})
    sats.bodyRadius = 6.371e6
    new Object3D().add(sats)
    sats.setLabelBudget(4)
    sats.update(EPOCH_JD)
    const pos = sats.points.geometry.attributes.position
    const at = (i) => new Vector3(pos.getX(i), pos.getY(i), pos.getZ(i))
    // Far back past the ISS, looking at Earth's centre: the satellites on
    // this side in view.
    camera.position.copy(at(0)).multiplyScalar(12)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld()
    // A fresh view: the range set at once, not eased from the first frame's.
    sats._labelRange = null
    sats.update(EPOCH_JD)
    const sheet = sats.nameSheet.userData.ownSheet
    expect(sheet.fontArgs).toEqual(['14px arial', {scalable: true}])
    const texts = sheet.labels
    const eye = camera.position
    // The range is the names' in view: the nearest at its largest and
    // brightest, the farthest at its least, 11 px and 0.7.
    const {near, far} = sats._labelRange
    const inView = texts.map((t, k) => [t, eye.distanceTo(at(sats._nameIds[k]))])
        .filter(([, d]) => d >= near * 0.999 && d <= far * 1.001)
    expect(inView.length).toBeGreaterThanOrEqual(2)
    const nearest = inView.reduce((a, b) => (b[1] < a[1] ? b : a))
    const farthest = inView.reduce((a, b) => (b[1] > a[1] ? b : a))
    const style = (name) => sheet.styles[texts.indexOf(name)]
    expect(style(nearest[0])[0]).toBeCloseTo(1, 6)
    expect(style(nearest[0])[1]).toBeCloseTo(1, 6)
    expect(style(farthest[0])[0]).toBeCloseTo(11 / 14, 6)
    expect(style(farthest[0])[1]).toBeCloseTo(0.7, 6)
    const rank = sats.nameSheet.userData.labelRank
    expect(rank[texts.indexOf(nearest[0])]).toBeGreaterThan(rank[texts.indexOf(farthest[0])])
    // Moved, the range eases toward the new one rather than jumping.
    camera.position.multiplyScalar(2)
    camera.updateMatrixWorld()
    sats.update(EPOCH_JD)
    expect(sats._labelRange.near).toBeGreaterThan(near)
    expect(sats._labelRange.near).toBeLessThan(near * 2)
    // The target, whatever its distance, at its largest and brightest.
    sats.setTarget(farthest[0] === 'ISS' ? 25544 : sats.records[sats._nameIds[texts.indexOf(farthest[0])]].id)
    sats.update(EPOCH_JD)
    expect(style(farthest[0])).toEqual([1, 1])
  })

  it('shows the points near Earth, and the names nearer', () => {
    const camera = new PerspectiveCamera()
    const sats = newSatellites({camera})
    const earth = new Object3D
    earth.add(sats)
    const at = (d) => {
      camera.position.set(0, 0, d)
      camera.updateMatrixWorld()
      sats.update(EPOCH_JD)
    }
    at(5e7)
    expect(sats.points.visible).toBe(true)
    expect(sats.nameSheet.visible).toBe(true)
    at(5e8)
    expect(sats.points.visible).toBe(true)
    expect(sats.nameSheet.visible).toBe(false)
    at(5e9)
    expect(sats.points.visible).toBe(false)
  })
})


describe('satellite names', () => {
  it('calls the known ones by the names the snapshot gives them', () => {
    const [iss, gps] = parseCatalog(SNAPSHOT)
    expect(iss.known).toBe(true)
    expect(displayName(iss)).toBe('ISS')
    expect(aliasesOf(iss)).toEqual(expect.arrayContaining(['International Space Station', 'ISS (ZARYA)', '25544',
      '1998-067A']))
    expect(displayName(gps)).toBe('GPS BIIF-9 (PRN 26)')
    expect(gps.known).toBeUndefined()
  })
})


describe('satellite facts', () => {
  it('gives the orbit from the mean elements, and the elements\' age', () => {
    const [iss, gps] = parseCatalog(SNAPSHOT)
    const f = satelliteFacts(iss, EPOCH_JD + 0.5, '2026-10-22T13:00:00Z', 'space station')
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
    expect(satelliteFacts(gps, EPOCH_JD).kind).toBe('Satellite')
    // GPS: 20,200 km up.
    expect(satelliteFacts(gps, EPOCH_JD).fact).toMatch(/^20,\d{3} km up$/)
    // Past its window, it says it isn't drawn.
    expect(satelliteFacts(iss, EPOCH_JD - 40).notes[0]).toMatch(/^Not drawn: more than 30 days/)
  })
})
