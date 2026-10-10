import {describe, expect, it} from 'bun:test'
import {deflateRawSync} from 'node:zlib'
import {readDbf, readZip} from './readers.mjs'
import {
  TIER0_MAX, kindOf, matchKey, parseRadiusM, placeOf, sizeFraction, tierPlaces, wrapLng,
} from './tiers.mjs'


/**
 * @param {{[name: string]: Buffer}} files
 * @param {boolean} [deflate]
 * @returns {Buffer} A ZIP archive of them
 */
function zipOf(files, deflate = false) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const [name, data] of Object.entries(files)) {
    const stored = deflate ? deflateRawSync(data) : data
    const nameBuf = Buffer.from(name)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(deflate ? 8 : 0, 8)
    local.writeUInt32LE(stored.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(deflate ? 8 : 0, 10)
    central.writeUInt32LE(stored.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, nameBuf, stored)
    centrals.push(central, nameBuf)
    offset += local.length + nameBuf.length + stored.length
  }
  const dir = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(dir.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, dir, end])
}


/**
 * @param {Array<[string, number]>} fields [name, length]
 * @param {Array<Array<string>>} rows
 * @returns {Buffer} A dBase III table of text fields
 */
function dbfOf(fields, rows) {
  const headerLen = 32 + (32 * fields.length) + 1
  const recordLen = 1 + fields.reduce((a, [, n]) => a + n, 0)
  const buf = Buffer.alloc(headerLen + (rows.length * recordLen), 0x20)
  buf[0] = 3
  buf.writeUInt32LE(rows.length, 4)
  buf.writeUInt16LE(headerLen, 8)
  buf.writeUInt16LE(recordLen, 10)
  fields.forEach(([name, len], i) => {
    const o = 32 + (32 * i)
    buf.fill(0, o, o + 32)
    buf.write(name, o, 'latin1')
    buf[o + 11] = 'C'.charCodeAt(0)
    buf[o + 16] = len
  })
  buf[headerLen - 1] = 0x0d
  rows.forEach((row, r) => {
    let p = headerLen + (r * recordLen)
    buf[p++] = 0x20
    row.forEach((v, i) => {
      buf.write(v, p, 'utf8')
      p += fields[i][1]
    })
  })
  return buf
}


describe('readZip', () => {
  it('reads stored and deflated entries', () => {
    const files = {'a.txt': Buffer.from('hello'), 'dir/b.dbf': Buffer.from('x'.repeat(500))}
    for (const deflate of [false, true]) {
      const got = readZip(zipOf(files, deflate))
      expect([...got.keys()]).toEqual(['a.txt', 'dir/b.dbf'])
      expect(got.get('a.txt').toString()).toBe('hello')
      expect(got.get('dir/b.dbf').length).toBe(500)
    }
  })

  it('refuses what is not a ZIP', () => {
    expect(() => readZip(Buffer.from('not a zip at all, nothing in it'))).toThrow()
  })
})


describe('readDbf', () => {
  it('reads text fields as trimmed strings, in UTF-8', () => {
    const buf = dbfOf([['name', 20], ['diameter', 12]], [['Poincaré', '336.5'], ['Rupēs', '0']])
    expect(readDbf(buf)).toEqual([{name: 'Poincaré', diameter: '336.5'}, {name: 'Rupēs', diameter: '0'}])
  })
})


describe('placeOf', () => {
  const row = {
    name: 'Olympus Mons', type: 'Mons, montes', diameter: '624', center_lat: '18.65', center_lon: '226.2',
    min_lat: '', max_lat: '', min_lon: '', max_lon: '',
  }

  it('gives the east-positive longitude in -180..+180, and the kind', () => {
    expect(placeOf(row)).toEqual({n: 'Olympus Mons', lat: 18.65, lng: -133.8, k: 'mons', d: 624, arc: 0})
  })

  it('wraps longitudes', () => {
    expect(wrapLng(0)).toBe(0)
    expect(wrapLng(180)).toBe(-180)
    expect(wrapLng(190)).toBe(-170)
    expect(wrapLng(359.5)).toBe(-0.5)
    expect(wrapLng(-190)).toBe(170)
    expect(wrapLng(540)).toBe(-180)
  })

  it('leaves out what is not a name to read on a surface', () => {
    expect(placeOf({...row, type: 'Satellite Feature'})).toBeNull()
    expect(placeOf({...row, type: 'Statio'})).toBeNull()
    expect(placeOf({...row, name: ''})).toBeNull()
    expect(placeOf({...row, center_lat: '95'})).toBeNull()
    expect(placeOf({...row, center_lon: 'x'})).toBeNull()
  })

  it('sizes a feature with no diameter by its bounding box', () => {
    const p = placeOf({...row, diameter: '0', min_lat: '10', max_lat: '20', min_lon: '40', max_lon: '44', center_lat: '15'})
    expect(p.d).toBe(0)
    expect(p.arc).toBe(10)
    // The box wrapping the 0/360 seam.
    const w = placeOf({...row, diameter: '0', min_lat: '0', max_lat: '1', min_lon: '1', max_lon: '359', center_lat: '0'})
    expect(w.arc).toBeCloseTo(2)
  })

  it('tags kinds from the type', () => {
    expect(kindOf('Crater, craters')).toBe('crater')
    expect(kindOf('Albedo Feature')).toBe('albedo')
    expect(kindOf('Large ringed feature')).toBe('ringed feature')
    expect(kindOf('Mare, maria')).toBe('mare')
  })
})


describe('sizeFraction', () => {
  it('is the diameter over the body\'s, halved for a line', () => {
    expect(sizeFraction({k: 'crater', d: 100, arc: 0}, 1000)).toBeCloseTo(0.1)
    expect(sizeFraction({k: 'vallis', d: 100, arc: 0}, 1000)).toBeCloseTo(0.05)
  })

  it('falls back to the arc of the bounding box, then a default', () => {
    // 36 degrees of a 1000 km body's circumference (pi x 1000 km): a tenth of it.
    expect(sizeFraction({k: 'crater', d: 0, arc: 36}, 1000)).toBeCloseTo(Math.PI / 10)
    expect(sizeFraction({k: 'crater', d: 0, arc: 0}, 1000)).toBeCloseTo(0.03)
  })
})


describe('matchKey', () => {
  it('matches a curated name to the Gazetteer\'s', () => {
    expect(matchKey('Gale Crater')).toBe(matchKey('Gale'))
    expect(matchKey('Poincaré')).toBe(matchKey('Poincare'))
    expect(matchKey('Rupēs Tenuis')).toBe(matchKey('rupes  tenuis'))
  })
})


describe('parseRadiusM', () => {
  it('reads a descriptor\'s radius', () => {
    expect(parseRadiusM('3.3895E6 m')).toBe(3389500)
    expect(parseRadiusM('2E5 m')).toBe(200000)
    expect(parseRadiusM('1737.4 km')).toBe(1737400)
    expect(() => parseRadiusM('big')).toThrow()
  })
})


describe('tierPlaces', () => {
  const BODY_KM = 1000
  const f = (n, d, k = 'crater', lat = 0, lng = 0) => ({n, d, k, lat, lng, arc: 0})

  it('tiers by the feature\'s share of the body\'s width: 0.2, 0.08 and 0.025', () => {
    // 300 km down by 3% each: 0.3 of the body to 0.005.
    const many = Array.from({length: 200}, (_, i) => f(`F${i}`, 300 * (0.97 ** i)))
    const tierOf = Object.fromEntries(tierPlaces(many, BODY_KM).map((p) => [p.n, p.t]))
    expect(tierOf.F0).toBe(0)
    expect(tierOf.F11).toBe(0)
    expect(tierOf.F12).toBe(1) // 0.208 is over 0.2, but tier 0 is a handful
    expect(tierOf.F30).toBe(1) // 0.12
    expect(tierOf.F60).toBe(2) // 0.048
    expect(tierOf.F76).toBe(2) // 0.0296
    expect(tierOf.F85).toBe(3) // 0.0224, and past the first 80
    expect(tierOf.F199).toBe(3)
  })

  it('keeps the first twenty in tiers 0-1 and the first eighty in 0-2, for a body of small features', () => {
    // Every feature a hundredth of the body: all tier 3 by size.
    const small = Array.from({length: 120}, (_, i) => f(`S${i}`, 10 - (i * 0.01)))
    const tierOf = Object.fromEntries(tierPlaces(small, BODY_KM).map((p) => [p.n, p.t]))
    expect(tierOf.S19).toBe(1)
    expect(tierOf.S20).toBe(2)
    expect(tierOf.S79).toBe(2)
    expect(tierOf.S80).toBe(3)
  })

  it('has at least the three largest at tier 0, and at most TIER0_MAX', () => {
    const few = tierPlaces([f('A', 10), f('B', 9), f('C', 8), f('D', 7)], BODY_KM)
    expect(few.filter((p) => p.t === 0).map((p) => p.n)).toEqual(['A', 'B', 'C'])
    const many = Array.from({length: 40}, (_, i) => f(`F${i}`, 900 - i))
    expect(tierPlaces(many, BODY_KM).filter((p) => p.t === 0).length).toBe(TIER0_MAX)
  })

  it('lists the places by tier, the larger first within a tier', () => {
    const many = Array.from({length: 200}, (_, i) => f(`F${i}`, 300 * (0.97 ** i)))
    const places = tierPlaces(many, BODY_KM)
    expect(places.map((p) => p.t)).toEqual([...places.map((p) => p.t)].sort())
    expect(places.map((p) => Number(p.n.slice(1)))).toEqual(many.map((_, i) => i))
  })

  it('keeps one place to a name, the largest', () => {
    const places = tierPlaces([f('Dup', 10, 'crater', 1, 1), f('Dup', 50, 'mons', 2, 2)], BODY_KM)
    expect(places.length).toBe(1)
    expect(places[0].lat).toBe(2)
  })

  it('lets a curated entry that names a Gazetteer feature set its tier, and the Gazetteer its place', () => {
    const features = Array.from({length: 40}, (_, i) => f(`F${i}`, 900 - i))
    features.push(f('Tycho', 85, 'crater', -43.31, -11.36))
    const curated = [{n: 'Tycho', t: 0, lat: -40, lng: -10, k: 'crater'}]
    const tycho = tierPlaces(features, BODY_KM, curated).find((p) => p.n === 'Tycho')
    expect(tycho).toEqual({n: 'Tycho', t: 0, lat: -43.31, lng: -11.36, k: 'crater'})
    // And with none, a crater of 0.085 is tier 1.
    expect(tierPlaces(features, BODY_KM).find((p) => p.n === 'Tycho').t).toBe(1)
  })

  it('never moves a feature down: a curated tier below its size\'s is ignored', () => {
    const features = [f('Huge', 800), f('A', 700), f('B', 600), f('C', 500)]
    const huge = tierPlaces(features, BODY_KM, [{n: 'Huge', t: 2}]).find((p) => p.n === 'Huge')
    expect(huge.t).toBe(0)
  })

  it('promotes a name with no position, and drops one the Gazetteer lacks', () => {
    const features = Array.from({length: 120}, (_, i) => f(`F${i}`, 400 - i))
    const places = tierPlaces(features, BODY_KM, [{n: 'F119', t: 0}, {n: 'Nowhere', t: 0}])
    expect(places.find((p) => p.n === 'F119').t).toBe(0)
    expect(places.some((p) => p.n === 'Nowhere')).toBe(false)
  })

  it('keeps the curated entries the Gazetteer lacks (landers, poles) first in their tier, longitude wrapped', () => {
    const places = tierPlaces([f('Big', 900)], BODY_KM, [
      {n: 'Lander', t: 0, lat: 1, lng: 351, k: 'lander'},
      {n: 'North Pole', t: 0, lat: 90, lng: 0, k: 'pole'},
    ])
    expect(places.map((p) => p.n)).toEqual(['Lander', 'North Pole', 'Big'])
    expect(places[0].lng).toBe(-9)
  })

  it('keeps a curated altitude', () => {
    const places = tierPlaces([f('Olympus Mons', 624, 'mons')], 6779, [{n: 'Olympus Mons', t: 0, lat: 1, lng: 1, a: 21229}])
    expect(places[0].a).toBe(21229)
  })
})
