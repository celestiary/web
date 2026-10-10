import {readFileSync} from 'node:fs'
import Galaxies, {
  CORE_HR, LABEL_MARGIN_MAG, VIEW_DISTANCE_HR, apparentMagnitude, attenuationAt, commonName, displayName, labelShown,
  milkyWayRecord, patchRadians, pointLight,
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


describe('labels', () => {
  const fromSun = (r) => {
    const d = Math.hypot(r.x, r.y, r.z)
    const pole = r.place.basis[1]
    const mu = Math.abs(((r.x * pole[0]) + (r.y * pole[1]) + (r.z * pole[2])) / d)
    return apparentMagnitude(r, d, mu)
  }

  it('name a galaxy as people know it: its Messier number, else an NGC or IC for a UGC', () => {
    const label = (name) => galaxies.galaxy(name).label
    expect(label('NGC5055')).toBe('M 63')
    expect(label('NGC3992')).toBe('M 109')
    expect(label('UGC11914')).toBe('NGC 7217')
    expect(label('UGC02953')).toBe('IC 356')
    expect(label('ESO079-G014')).toBe('NGC 360')
    // Its own names kept where they're the known ones.
    expect(label('NGC2403')).toBe('NGC 2403')
    expect(label('DDO154')).toBe('DDO 154')
    expect(label('F568-1')).toBe('F568-1')
    expect(commonName({name: 'UGC00001'})).toBe('UGC 1')
  })

  it('give each galaxy the magnitude its point draws', () => {
    const r = galaxies.galaxy('NGC2403')
    const d = Math.hypot(r.x, r.y, r.z)
    const fromLight = -26.74 - (2.5 * Math.log10(pointLight(r, d, 0.6) / (DISPLAY_GAIN * Math.PI)))
    expect(apparentMagnitude(r, d, 0.6)).toBeCloseTo(fromLight, 6)
    // NGC 2403's V from RC3's B_T 8.93 and B−V 0.47 is 8.46; the model's, with its dust, is within 0.3.
    expect(Math.abs(fromSun(r) - 8.46)).toBeLessThan(0.3)
    // A tenth of the distance is 5 magnitudes brighter.
    expect(apparentMagnitude(r, d / 10, 0.6)).toBeCloseTo(apparentMagnitude(r, d, 0.6) - 5, 6)
  })

  it('show a galaxy within a magnitude of the limit, or the target whatever its magnitude', () => {
    expect(labelShown(7.4, 6.5, false)).toBe(true)
    expect(labelShown(7.6, 6.5, false)).toBe(false)
    expect(labelShown(20, 6.5, true)).toBe(true)
    // None from the Sun at the naked eye's 6.5, 35 at sm=3's 9.5.
    const count = (limit) => galaxies.records.filter((r) => labelShown(fromSun(r), limit, false)).length
    expect(LABEL_MARGIN_MAG).toBe(1)
    expect(count(6.5)).toBe(0)
    expect(count(9.5)).toBe(35)
  })

  it('gate each label every frame, and build nothing while they are off', () => {
    const g = new Galaxies()
    g.setCatalog(JSON_DATA)
    g.labelState = () => ({limit: 9.5, target: null})
    g.preAnimCb()
    expect(g._labels).toBe(null)
    // With a sheet (as a browser builds it the first time they're wanted),
    // from the Sun at sm=3's limit.
    const shown = {array: new Float32Array(g.records.length), needsUpdate: false}
    g._labels = {sheet: {shownAttribute: shown}, points: {visible: false}}
    g.setLabelsVisible(true)
    expect(g._labels.points.visible).toBe(true)
    g.preAnimCb()
    expect(shown.array.reduce((a, b) => a + b, 0)).toBe(35)
    expect(shown.needsUpdate).toBe(true)
    // The target is named at the naked eye's limit, where nothing else is.
    const target = g.galaxy('DDO154')
    g.labelState = () => ({limit: 6.5, target})
    g.preAnimCb()
    expect(shown.array.reduce((a, b) => a + b, 0)).toBe(1)
    expect(shown.array[target.index]).toBe(1)
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
