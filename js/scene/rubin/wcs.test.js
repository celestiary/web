import {describe, expect, it} from 'bun:test'
import {readFileSync} from 'node:fs'
import {equatorialToSceneUnit} from '../galacticFrame.js'
import {equatorialToScene, pixToWorld, sceneToEquatorial, worldToPix} from './wcs.js'


const manifest = JSON.parse(readFileSync(new URL('../../../public/data/rubin/noirlab2626d.json', import.meta.url)))
const fixture = JSON.parse(readFileSync(new URL('./noirlab2626d.stars.json', import.meta.url)))
const {wcs} = manifest


describe('the image\'s WCS', () => {
  it('round-trips pixels through RA and Dec', () => {
    for (const [x, y] of [[0, 0], [16537.5, 11025], [33075, 22050], [1000, 20000]]) {
      const w = pixToWorld(wcs, x, y)
      const p = worldToPix(wcs, w.ra, w.dec)
      expect(Math.abs(p.x - x)).toBeLessThan(1e-6)
      expect(Math.abs(p.y - y)).toBeLessThan(1e-6)
    }
  })

  it('has the image\'s centre where NOIRLab gives it, at 0.2″ a pixel, turned as the page says', () => {
    const c = pixToWorld(wcs, wcs.width / 2, wcs.height / 2)
    // RA 18h17m03.45s, Dec −42°46′36″: within 2″.
    expect(Math.abs((c.ra - 274.264375) * Math.cos(c.dec * Math.PI / 180) * 3600)).toBeLessThan(2)
    expect(Math.abs((c.dec - -42.776667) * 3600)).toBeLessThan(2)
    expect(wcs.scaleArcsec).toBeCloseTo(0.2, 3)
    // North, the direction of growing Dec in pixels, 23.9° left of up (y
    // down): the WorldWide Telescope link's 23.87°, and NOIRLab's "north
    // 156.1° left of vertical" measured from the vertical's other end.
    const n = worldToPix(wcs, c.ra, c.dec + 0.01)
    const angle = Math.atan2(-(n.x - (wcs.width / 2)), -(n.y - (wcs.height / 2))) * 180 / Math.PI
    expect(Math.abs(angle - 23.87)).toBeLessThan(0.2)
  })

  it('maps the fixture\'s Gaia stars to their centroids in the image', () => {
    expect(fixture.stars.length).toBeGreaterThan(50)
    let sum = 0
    for (const s of fixture.stars) {
      const p = worldToPix(wcs, s.ra, s.dec)
      const d = Math.hypot(p.x - s.x, p.y - s.y)
      // The fit's residual is 3 px (0.6″) rms: none past 10 px (2″).
      expect(d).toBeLessThan(10)
      sum += d * d
    }
    const rmsArcsec = Math.sqrt(sum / fixture.stars.length) * wcs.scaleArcsec
    expect(rmsArcsec).toBeLessThan(1)
    expect(wcs.fit.rmsArcsec).toBeLessThan(1)
  })

  it('has 2026 ED138 inside the image through the run, across it', () => {
    const horizons = JSON.parse(readFileSync(new URL('../ed138.horizons.json', import.meta.url)))
    // The visits ran 4 March to 11 July 2026 (JD 2461103.5 to 2461232.5).
    const xs = []
    for (const o of horizons.observer.filter((e) => e.jd >= 2461103.5 && e.jd <= 2461232.5)) {
      const p = worldToPix(wcs, o.raDeg, o.decDeg)
      expect(p.x).toBeGreaterThan(0)
      expect(p.x).toBeLessThan(wcs.width)
      expect(p.y).toBeGreaterThan(0)
      expect(p.y).toBeLessThan(wcs.height)
      xs.push(p.x)
    }
    // The composite is framed on the track: it crosses most of the width.
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(wcs.width * 0.6)
  })

  it('places RA and Dec in the scene as the star catalogue does', () => {
    for (const [ra, dec] of [[274.264, -42.777], [0, 0], [101.287, -16.716], [300, 60]]) {
      const v = equatorialToScene(ra, dec)
      const u = equatorialToSceneUnit(ra, dec)
      expect(v[0]).toBeCloseTo(u.x, 12)
      expect(v[1]).toBeCloseTo(u.y, 12)
      expect(v[2]).toBeCloseTo(u.z, 12)
      const back = sceneToEquatorial(v)
      expect(back.ra).toBeCloseTo(ra, 9)
      expect(back.dec).toBeCloseTo(dec, 9)
    }
  })
})
