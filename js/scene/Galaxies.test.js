import {readFileSync} from 'node:fs'
import Galaxies, {
  CORE_HR, VIEW_DISTANCE_HR, attenuationAt, displayName, milkyWayRecord, patchRadians, pointLight,
} from './Galaxies.js'
import {L_TOTAL_LSUN, VALUE_PER_LSUN_KPC2} from './galaxyModel.js'
import {equatorialToSceneUnit} from './galacticFrame.js'
import {ATTENUATION_MU} from './sparcGalaxy.js'
import GalaxiesProvider from '../search/providers/GalaxiesProvider.js'
import {parseTargetPath, targetFramePath, targetPath} from '../targetPath.js'
import {ASTRO_UNIT_METER, DISPLAY_GAIN} from '../shared.js'


const JSON_DATA = JSON.parse(readFileSync('./public/data/sparc/galaxies.json', 'utf8'))
const galaxies = new Galaxies()
galaxies.setCatalog(JSON_DATA)
const DEG = Math.PI / 180


describe('Galaxies', () => {
  it('builds a record for each of SPARC\'s galaxies, and a point for each and the Milky Way', () => {
    expect(galaxies.records.length).toBe(175)
    expect(galaxies.points.geometry.getAttribute('position').count).toBe(176)
    for (const r of galaxies.records) {
      expect(Number.isFinite(r.x + r.y + r.z)).toBe(true)
      expect(r.atten.every((t) => t > 0 && t <= 1)).toBe(true)
      expect(r.spec.L).toBeGreaterThan(1e6)
    }
  })

  it('names them as people write them, and finds them by any of their names', () => {
    expect(displayName('NGC0024')).toBe('NGC 24')
    expect(displayName('UGC02885')).toBe('UGC 2885')
    expect(displayName('UGCA442')).toBe('UGCA 442')
    expect(displayName('ESO079-G014')).toBe('ESO 79-14')
    expect(displayName('F568-1')).toBe('F568-1')
    expect(galaxies.galaxy('NGC2403').name).toBe('NGC 2403')
    expect(galaxies.galaxy('ngc2403')).toBe(galaxies.galaxy('NGC2403'))
    // UGCA 444 is WLM, which RC3 names.
    expect(galaxies.galaxy('UGCA444').aliases).toContain('WLM')
  })

  it('arrives where a galaxy fills the view, and zooms into its core', () => {
    const r = galaxies.galaxy('NGC3198')
    expect(r.viewDistance / r.radius).toBeCloseTo(VIEW_DISTANCE_HR / CORE_HR, 6)
    // Four scale lengths at the view distance: about 27° of a 45° field.
    expect(2 * Math.atan(4 * r.spec.thin.hR / (VIEW_DISTANCE_HR * r.spec.thin.hR)) / DEG).toBeCloseTo(27, 0)
  })

  it('puts the Milky Way\'s far point at the Galactic Centre, 8.15 kpc toward Sagittarius', () => {
    const mw = milkyWayRecord()
    const d = Math.hypot(mw.x, mw.y, mw.z)
    expect(d / 3.0857e19).toBeCloseTo(8.15, 2)
    const sgr = equatorialToSceneUnit(266.40499, -28.93617)
    // 0.146° south of the IAU centre: the Sun is 20.8 pc over the plane (atan(0.0208 / 8.15)).
    expect(Math.acos(((mw.x * sgr.x) + (mw.y * sgr.y) + (mw.z * sgr.z)) / d) / DEG).toBeCloseTo(0.146, 2)
    expect(mw.spec.L).toBe(L_TOTAL_LSUN)
  })
})


describe('a far galaxy\'s light', () => {
  it('is its luminosity over the inverse square, as a star\'s, times what its dust passes', () => {
    const r = galaxies.galaxy('NGC2403')
    const d = r.row.D * 3.0857e22
    const face = pointLight(r, d, 1)
    expect(face).toBeCloseTo(DISPLAY_GAIN * Math.PI * r.spec.L * ((ASTRO_UNIT_METER / d) ** 2) * r.atten[0], 30)
    expect(pointLight(r, d, 0.05) / face).toBeCloseTo(r.atten[4] / r.atten[0], 9)
  })

  it('is the impostor\'s light summed over its solid angle: a column\'s units over a star\'s', () => {
    // A column of L_sun/kpc² over dΩ = dA/d²: the same DISPLAY_GAIN·π·(AU/d)² per L_sun.
    const d = 3.0857e22
    const perLsunAsPoint = DISPLAY_GAIN * Math.PI * ((ASTRO_UNIT_METER / d) ** 2)
    const perLsunAsColumn = VALUE_PER_LSUN_KPC2 / ((d / 3.085677581491367e19) ** 2)
    expect(perLsunAsColumn / perLsunAsPoint).toBeCloseTo(1, 6)
  })

  it('interpolates its dust\'s table in the cosine of the inclination', () => {
    const table = [1, 0.8, 0.6, 0.4, 0.2]
    ATTENUATION_MU.forEach((mu, i) => expect(attenuationAt(table, mu)).toBeCloseTo(table[i], 12))
    expect(attenuationAt(table, 0.625)).toBeCloseTo(0.7, 12)
    expect(attenuationAt(table, 0)).toBe(0.2)
  })

  it('lands in the eye\'s patch: 10′, or a pixel where pixels are coarser', () => {
    expect(patchRadians(45, 1080) / DEG * 60).toBeCloseTo(10, 6)
    expect(patchRadians(45, 200) / DEG * 60).toBeCloseTo(45 * 60 / 200, 6)
  })
})


describe('search and links', () => {
  it('offers every galaxy to the search, in the root\'s scope', () => {
    const entries = new GalaxiesProvider(galaxies).collectAll()
    expect(entries.length).toBe(175)
    const e = entries.find((x) => x.displayName === 'NGC 2403')
    expect(e.id).toBe('galaxy:ngc2403')
    expect(e.path.startsWith('milkyway/')).toBe(true)
    expect(e.payload.galaxy).toBe(galaxies.galaxy('NGC2403'))
  })

  it('has a path in the link, galaxy:<id>, which parses back, its frame its own', () => {
    const g = galaxies.galaxy('NGC2403')
    const target = {kind: 'galaxy', galaxy: g, id: g.id, name: g.name}
    expect(targetPath(target, () => null)).toBe('galaxy:ngc2403')
    expect(targetFramePath(target, () => null)).toBe('galaxy:ngc2403')
    expect(parseTargetPath('galaxy:ngc2403')).toEqual({kind: 'galaxy', id: 'ngc2403'})
    expect(parseTargetPath('galaxy:')).toBe(null)
  })
})
