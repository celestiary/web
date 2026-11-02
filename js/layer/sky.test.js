import fs from 'node:fs'
import {describe, expect, it} from 'bun:test'
import {Vector3} from 'three'
import SkyLayer, {SKY_LIMIT_MAG, SKY_PLANETS, eclipticToEquator, magBrightness, meanObliquity, starColor} from './SkyLayer.js'
import {SKY_HELLO, serveLayer} from './protocol.js'
import {decodeCatalogueTile} from '../scene/catalogue/catalogueTile.js'
import {decodePack} from '../scene/points/tileFormat.js'


// Layer mode's sky (design/LayerMode.md, "The sky"): its frame, the
// equator of date, against the almanac's numbers; the bodies' places and
// brightness; the stars; and the hello a sky host (exo.cafe's abode) looks for.


const DEG = Math.PI / 180
const ROOTS = new URL('../../public/large/stars/v1/packs/roots.bin', import.meta.url)
// A checkout without git-lfs has a pointer file here, not the stars.
const HAVE_STARS = fs.existsSync(ROOTS) && fs.statSync(ROOTS).size > 1024
const fromDisk = () => Promise.resolve(HAVE_STARS ?
  {ok: true, arrayBuffer: () => Promise.resolve(new Uint8Array(fs.readFileSync(ROOTS)).buffer)} :
  {ok: false, status: 404})


/**
 * @param {Vector3} d a unit vector in the equator of date
 * @returns {{ra: number, dec: number}} degrees
 */
function raDec(d) {
  return {ra: ((Math.atan2(d.y, d.x) / DEG) + 360) % 360, dec: Math.asin(d.z) / DEG}
}


/**
 * @param {number} a degrees
 * @param {number} b degrees
 * @returns {number} the difference, wrapped to ±180
 */
const dRa = (a, b) => ((a - b + 540) % 360) - 180


/** A face's view (the identity: looking down −z) and a 90° projection, as exo sends them. */
function view(timeMs, observer = {lat: 55.6, lon: 0, alt: 0}) {
  const n = 1
  const f = 1e8
  return {
    frame: 'equator-of-date',
    viewMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    projectionMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, (2 * f * n) / (n - f), 0],
    viewport: [0, 0, 1024, 1024], pixelRatio: 1, timeMs, observer,
  }
}


describe('the sky\'s frame', () => {
  it('takes the ecliptic to the equator by the obliquity', () => {
    expect(meanObliquity(2451545.0) / DEG).toBeCloseTo(23.4392911, 6)
    const eps = meanObliquity(2451545.0)
    // The ecliptic's pole is at RA 18h, declination 90° − ε.
    const pole = raDec(eclipticToEquator(new Vector3(0, 0, 1), eps))
    expect(pole.ra).toBeCloseTo(270, 6)
    expect(pole.dec).toBeCloseTo(90 - (eps / DEG), 6)
  })

  it('puts the Sun at the equinox and the solstice where the almanac does', () => {
    const sky = new SkyLayer()
    // The March equinox of 2026, 14:46 UTC: RA 0, declination 0.
    sky.applyView(view(Date.parse('2026-03-20T14:46:00Z')), 1)
    let s = raDec(sky.dirs.sun)
    expect(Math.abs(dRa(s.ra, 0))).toBeLessThan(0.1)
    expect(Math.abs(s.dec)).toBeLessThan(0.05)
    // The June solstice, 08:24 UTC: RA 6h, declination +ε.
    sky.applyView(view(Date.parse('2026-06-21T08:24:00Z')), 2)
    s = raDec(sky.dirs.sun)
    expect(Math.abs(dRa(s.ra, 90))).toBeLessThan(0.1)
    expect(s.dec).toBeCloseTo(23.436, 1)
    // About half a degree across.
    expect(2 * sky.sun.material.uniforms.radius.value / DEG).toBeCloseTo(0.525, 2)
  })
})


describe('the Moon', () => {
  it('is new beside the Sun and full opposite it, and phased by it', () => {
    const sky = new SkyLayer()
    const sep = () => Math.acos(sky.dirs.sun.dot(sky.dirs.moon)) / DEG
    // New moon, 2026-01-18 19:52 UTC; full, 2026-01-03 10:03 UTC (geocentric
    // elongation within the Moon's 5° latitude, plus parallax).
    sky.applyView(view(Date.parse('2026-01-18T19:52:00Z')), 1)
    expect(sep()).toBeLessThan(6.5)
    sky.applyView(view(Date.parse('2026-01-03T10:03:00Z')), 2)
    expect(sep()).toBeGreaterThan(173.5)
    // Lit from the Sun's side, in view space (the identity view here).
    expect(sky.moon.material.uniforms.light.value.distanceTo(sky.dirs.sun)).toBeLessThan(1e-6)
    // About half a degree across.
    expect(2 * sky.moon.material.uniforms.radius.value / DEG).toBeGreaterThan(0.48)
    expect(2 * sky.moon.material.uniforms.radius.value / DEG).toBeLessThan(0.58)
  })

  it('moves by up to its parallax with the observer', () => {
    const t = Date.parse('2026-11-02T20:00:00Z')
    const a = new SkyLayer()
    const b = new SkyLayer()
    a.applyView(view(t, {lat: 60, lon: 0, alt: 0}), 1)
    b.applyView(view(t, {lat: -60, lon: 0, alt: 0}), 1)
    const shift = Math.acos(a.dirs.moon.dot(b.dirs.moon)) / DEG
    expect(shift).toBeGreaterThan(0.2)
    expect(shift).toBeLessThan(2 * 0.96)
    // The Sun's parallax is 9″.
    expect(Math.acos(Math.min(1, a.dirs.sun.dot(b.dirs.sun))) / DEG).toBeLessThan(0.01)
  })
})


describe('the planets', () => {
  it('shine as bright as the almanac\'s ranges', () => {
    const sky = new SkyLayer()
    const range = {mercury: [-2.6, 5.8], venus: [-4.9, -3.8], mars: [-3, 1.9], jupiter: [-2.95, -1.6],
      saturn: [-0.6, 1.5], uranus: [5.3, 6.1], neptune: [7.6, 8.1]}
    for (let month = 0; month < 24; month++) {
      sky.applyView(view(Date.UTC(2026, month, 15)), month)
      for (const name of SKY_PLANETS) {
        expect(sky.mags[name]).toBeGreaterThan(range[name][0])
        expect(sky.mags[name]).toBeLessThan(range[name][1])
        expect(Math.abs(sky.dirs[name].length() - 1)).toBeLessThan(1e-9)
      }
    }
    // Planets keep near the ecliptic: within 8° of it (Mercury's 7° tilt).
    const eps = meanObliquity(2461000)
    const eclPole = eclipticToEquator(new Vector3(0, 0, 1), eps)
    for (const name of SKY_PLANETS) {
      expect(Math.abs(90 - (Math.acos(sky.dirs[name].dot(eclPole)) / DEG))).toBeLessThan(8)
    }
  })

  it('maps magnitudes to brightness: 1 at magnitude 1.5, a visible 10% at the eye\'s limit', () => {
    expect(magBrightness(1.5)).toBeCloseTo(1, 9)
    expect(magBrightness(SKY_LIMIT_MAG)).toBeCloseTo(0.1, 9)
    expect(magBrightness(-1.46)).toBeGreaterThan(magBrightness(0))
    // Star colours stay pale: blue-white and orange, never saturated.
    for (const t of [3000, 5800, 10000, 30000]) {
      expect(Math.max(...starColor(t))).toBeCloseTo(1, 6)
      expect(Math.min(...starColor(t))).toBeGreaterThanOrEqual(0.5)
    }
    expect(starColor(3000)[0]).toBeGreaterThan(starColor(3000)[2])
    expect(starColor(20000)[2]).toBeGreaterThan(starColor(20000)[0])
  })
})


describe.skipIf(!HAVE_STARS)('the stars', () => {
  it('loads the naked-eye sky, and precesses it to date', async () => {
    const sky = new SkyLayer({fetchFn: fromDisk})
    expect(await sky.load()).toEqual([])
    expect(sky.starCount).toBeGreaterThan(8000)
    expect(sky.starCount).toBeLessThan(9500)
    sky.applyView(view(Date.parse('2026-01-01T00:00:00Z')), 1)
    sky.scene.updateMatrixWorld()
    const tiles = decodePack(new Uint8Array(fs.readFileSync(ROOTS)).buffer).map((t) => decodeCatalogueTile(t.buf))
    const find = (hip) => {
      for (const t of tiles) {
        const s = t.stars.find((st) => st.hipId === hip)
        if (s) {
          return new Vector3(s.x, s.y, s.z).normalize().transformDirection(sky.stars.matrixWorld)
        }
      }
      throw new Error(`no HIP ${hip}`)
    }
    // Polaris and Sirius, of date at 2026.0 (their J2000 places precessed).
    const polaris = raDec(find(11767))
    expect(polaris.dec).toBeCloseTo(89.37, 1)
    const sirius = raDec(find(32349))
    expect(Math.abs(dRa(sirius.ra, 101.58))).toBeLessThan(0.15)
    expect(Math.abs(sirius.dec - -16.74)).toBeLessThan(0.1)
  })
})


describe('the sky\'s hello', () => {
  it('offers the sky in the equator of date, as a sky host asks', () => {
    const posted = []
    const transport = {post: (m) => posted.push(m), onMessage: () => () => {}}
    const timers = {setInterval: () => 0, clearInterval: () => {}}
    const sky = new SkyLayer({fetchFn: fromDisk})
    serveLayer({transport, layer: sky, loaded: Promise.resolve([]), render: () => {}, endFrame: () => {},
      timers, hello: SKY_HELLO})
    const hello = posted.find((m) => m.type === 'layer:hello')
    expect(hello.version).toBe(1)
    expect(hello.adapter).toBe('celestiary-sky')
    // exo.cafe's isSkyHello.
    expect(hello.capabilities.kinds).toContain('sky')
    expect(hello.capabilities.frames).toContain('equator-of-date')
    expect(hello.contracts).toEqual({alpha: 'premultiplied', color: 'display'})
  })
})
