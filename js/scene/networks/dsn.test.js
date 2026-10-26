import fs from 'node:fs'
import {describe, expect, it} from 'bun:test'
import {Object3D, Vector3} from 'three'
import DeepSpaceNetwork, {LIVE_WINDOW_DAYS, UNKNOWN_RANGE_M} from './DeepSpaceNetwork.js'
import {POLL_MS, bodyFixedToEquator, dsnLinks, parseDsnXml, rangeKm, spacecraftName, topocentricDirection} from './dsn.js'
import {gmstRad} from '../celestialFrame.js'
import {unixMsToJd} from '../satellites/sgp4.js'


// The fixture is DSN Now's feed (https://eyes.nasa.gov/dsn/data/dsn.xml) as
// it was at 2026-10-23 16:01:02 UTC; the configuration is the bundled one
// (tools/networks/fetch.mjs, from https://eyes.nasa.gov/dsn/config.xml).
const XML = fs.readFileSync(new URL('./dsn.fixture.xml', import.meta.url), 'utf8')
const CONFIG = JSON.parse(fs.readFileSync(new URL('../../../public/data/earth/networks/dsn.json', import.meta.url), 'utf8'))
const FEED_MS = 1792771262000
const DEG = Math.PI / 180


/** A label sheet without a canvas. */
class StubSheet {
  /** */
  add() {/* no canvas */}

  /** @returns {Object3D} */
  compile() {
    return new Object3D
  }
}


/**
 * @param {Vector3} v in Earth's equator frame (planetTilt's)
 * @returns {{ra: number, dec: number}} degrees
 */
function raDec(v) {
  const u = v.clone().normalize()
  return {ra: ((Math.atan2(-u.z, u.x) / DEG) + 360) % 360, dec: Math.asin(u.y) / DEG}
}


describe('DSN Now', () => {
  it('reads the feed', () => {
    const feed = parseDsnXml(XML)
    expect(feed.stations.map((s) => s.name)).toEqual(['gdscc', 'mdscc', 'cdscc'])
    expect(feed.stations[0].timeMs).toBe(FEED_MS)
    expect(feed.dishes).toHaveLength(14)
    const dss63 = feed.dishes.find((d) => d.name === 'DSS63')
    expect(dss63).toMatchObject({station: 'mdscc', azimuth: 198, elevation: 61})
    expect(dss63.targets[0]).toMatchObject({name: 'VGR1', uplegKm: 25800000000, downlegKm: 25800000000, rtltSec: null})
    expect(dss63.down[0]).toMatchObject({active: true, spacecraft: 'VGR1', band: 'X'})
  })

  it('makes a link of each dish and spacecraft with a signal, named as DSN Now names them', () => {
    const links = dsnLinks(parseDsnXml(XML), CONFIG)
    // Engineering, testing, and dishes with nothing on: no link.
    expect(links.map((l) => l.dish)).not.toContain('DSS14')
    const vgr1 = links.find((l) => l.spacecraft === 'VGR1')
    expect(vgr1).toMatchObject({dish: 'DSS63', site: 'mdscc', name: 'Voyager 1', up: false, down: true, rangeKm: 25800000000})
    // NAIF's id, from the signals' spacecraftID: an alias layer mode publishes.
    expect(vgr1.naifId).toBe(-31)
    const sta = links.find((l) => l.spacecraft === 'STA')
    expect(sta).toMatchObject({up: true, down: true, rangeKm: null})
    expect(spacecraftName('XYZ', CONFIG)).toBe('XYZ')
  })

  it('takes the range from the legs, else the light time', () => {
    expect(rangeKm({downlegKm: 5, uplegKm: 6})).toBe(5)
    expect(rangeKm({downlegKm: null, uplegKm: null, rtltSec: 2})).toBeCloseTo(299792.458, 3)
    expect(rangeKm({downlegKm: null, uplegKm: null, rtltSec: null})).toBeNull()
  })

  it('points by azimuth and elevation in the body-fixed frame', () => {
    const v = new Vector3
    // At 0°, 0°: up +X, north +Y, east −Z (coords.js).
    expect(topocentricDirection(0, 0, 0, 90, v).toArray().map((x) => Math.round(x * 1e9) / 1e9)).toEqual([1, 0, 0])
    expect(topocentricDirection(0, 0, 0, 0, v).y).toBeCloseTo(1, 9)
    expect(topocentricDirection(0, 0, 90, 0, v).z).toBeCloseTo(-1, 9)
    // Due south at 45° up from 40°N is 5° south of the equator's plane... on the meridian.
    const s = topocentricDirection(40, 0, 180, 45, v)
    expect(Math.asin(s.y) / DEG).toBeCloseTo(-5, 9)
  })

  it('turns body-fixed to the equator frame as Earth is turned', () => {
    const node = new Object3D()
    node.setRotationFromAxisAngle(new Vector3(0, 1, 0), 1.234)
    const p = new Vector3(1, 2, 3)
    expect(bodyFixedToEquator(1, 2, 3, 1.234, new Vector3).distanceTo(p.clone().applyQuaternion(node.quaternion))).toBeLessThan(1e-12)
  })

  it('aims at the Voyagers where they are in the sky', () => {
    // Voyager 1 has been near RA 17h 13m, Dec +12° for years, and Voyager 2
    // near 20h, −58° to −60°; the feed's angles are whole degrees.
    const links = dsnLinks(parseDsnXml(XML), CONFIG)
    const sky = (code) => {
      const l = links.find((x) => x.spacecraft === code)
      const site = CONFIG.sites.find((x) => x.name === l.site)
      const d = topocentricDirection(site.lat, site.lng, l.azimuth, l.elevation, new Vector3)
      return raDec(bodyFixedToEquator(d.x, d.y, d.z, gmstRad(unixMsToJd(l.timeMs)), new Vector3))
    }
    const v1 = sky('VGR1')
    expect(Math.abs(v1.ra - 258.3)).toBeLessThan(2)
    expect(Math.abs(v1.dec - 12)).toBeLessThan(1.5)
    const v2 = sky('VGR2')
    expect(Math.abs(v2.ra - 302)).toBeLessThan(5)
    expect(Math.abs(v2.dec + 59)).toBeLessThan(2.5)
  })
})


describe('DeepSpaceNetwork', () => {
  /**
   * @param {object} [opts]
   * @returns {{dsn: DeepSpaceNetwork, clock: {ms: number}, asked: Array<string>}}
   */
  function network({fail = false} = {}) {
    const clock = {ms: FEED_MS + 1000}
    const asked = []
    const fetchFn = (url) => {
      asked.push(url)
      return fail ? Promise.reject(new Error('offline')) : Promise.resolve({ok: true, text: () => Promise.resolve(XML)})
    }
    const dsn = new DeepSpaceNetwork(CONFIG, {Sheet: StubSheet, fetchFn, nowMs: () => clock.ms})
    return {dsn, clock, asked}
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

  it('polls no faster than the feed, and not while hidden', async () => {
    const {dsn, clock, asked} = network()
    const jd = unixMsToJd(clock.ms)
    dsn.update(jd)
    await settle()
    expect(asked).toHaveLength(1)
    expect(asked[0]).toStartWith('https://eyes.nasa.gov/dsn/data/dsn.xml?r=')
    dsn.update(jd)
    clock.ms += POLL_MS - 1
    dsn.update(jd)
    await settle()
    expect(asked).toHaveLength(1)
    clock.ms += 1
    dsn.update(jd)
    await settle()
    expect(asked).toHaveLength(2)
    dsn.visible = false
    clock.ms += 60e3
    dsn.update(jd)
    await settle()
    expect(asked).toHaveLength(2)
  })

  it('backs off quietly when the feed can\'t be had', async () => {
    const {dsn, clock, asked} = network({fail: true})
    const jd = unixMsToJd(clock.ms)
    dsn.update(jd)
    await settle()
    expect(dsn.status.failures).toBe(1)
    expect(dsn.links).toHaveLength(0)
    clock.ms += POLL_MS
    dsn.update(jd)
    await settle()
    // Twice the cadence after a failure.
    expect(asked).toHaveLength(1)
    clock.ms += POLL_MS
    dsn.update(jd)
    await settle()
    expect(asked).toHaveLength(2)
  })

  it('says when a feed changes what\'s drawn, not for the same one again', () => {
    const {dsn} = network()
    let n = 0
    dsn.onFeed = () => n++
    dsn.setFeed(XML)
    dsn.setFeed(XML)
    expect(n).toBe(1)
    dsn.setFeed(XML.replace('VGR1', 'VGR2'))
    expect(n).toBe(2)
  })

  it('draws each link from its dish, out to the range along its pointing, while live', () => {
    const {dsn} = network()
    dsn.setFeed(XML)
    const jd = unixMsToJd(FEED_MS)
    dsn.update(jd)
    const vgr1 = dsn.links.find((l) => l.spacecraft === 'VGR1')
    // 25.8e9 km out, from Madrid.
    expect(vgr1.end.length() / 1e3).toBeCloseTo(25.8e9, -6)
    const down = dsn.downBeams.geometry
    const up = dsn.upBeams.geometry
    const n = dsn.links.length
    const known = dsn.links.filter((l) => l.end).length
    // A known range is a segment, an unknown one 8 dashes.
    expect(down.instanceCount).toBe(dsn.links.filter((l) => l.down).reduce((s, l) => s + (l.end ? 1 : 8), 0))
    expect(up.instanceCount).toBe(dsn.links.filter((l) => l.up).reduce((s, l) => s + (l.end ? 1 : 8), 0))
    expect(n).toBeGreaterThan(known)
    // A dashed link reaches UNKNOWN_RANGE_M at most.
    const a = down.attributes
    let far = 0
    for (let i = 0; i < down.instanceCount; i++) {
      const e = new Vector3(a.endHigh.getX(i) + a.endLow.getX(i), a.endHigh.getY(i) + a.endLow.getY(i),
          a.endHigh.getZ(i) + a.endLow.getZ(i))
      if (e.length() < 1e10) {
        far = Math.max(far, e.length())
      }
    }
    expect(far).toBeLessThan(UNKNOWN_RANGE_M + 7e6)
    // Labels for the spacecraft, at the far ends.
    expect(dsn.scLabels.get('VGR1').visible).toBe(true)
    expect(dsn.scLabels.get('VGR1').position.distanceTo(vgr1.end)).toBe(0)
    // Off the feed's time by more than the window: no links.
    dsn.update(jd + LIVE_WINDOW_DAYS + 0.01)
    expect(down.instanceCount).toBe(0)
    expect(dsn.scLabels.get('VGR1').visible).toBe(false)
  })

  it('keeps a link\'s far end fixed in space as Earth turns, its near end on the dish', () => {
    const {dsn} = network()
    dsn.setFeed(XML)
    const jd = unixMsToJd(FEED_MS)
    dsn.update(jd)
    const vgr1 = dsn.links.find((l) => l.spacecraft === 'VGR1')
    const end = vgr1.end.clone()
    const madrid = dsn.dishByName.get('DSS63')
    const before = madrid.equator.clone()
    dsn.update(jd + (1 / 48))
    expect(vgr1.end.equals(end)).toBe(true)
    // Half an hour: the dish has turned 7.5° with Earth.
    expect(madrid.equator.angleTo(before) / DEG).toBeGreaterThan(5)
    // The dishes turn as Animation turns Earth: about +Y by GMST.
    const earth = new Object3D()
    earth.setRotationFromAxisAngle(new Vector3(0, 1, 0), gmstRad(jd + (1 / 48)))
    expect(dsn.earthFixed.quaternion.angleTo(earth.quaternion)).toBeLessThan(1e-9)
  })
})
