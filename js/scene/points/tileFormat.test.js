import {describe, expect, it} from 'bun:test'
import {
  ABS_MAG_SCALE,
  HAS_CLASS,
  HAS_HIP,
  HAS_IDS,
  HAS_VELOCITY,
  decodePack,
  decodeTile,
  encodePack,
  encodeTile,
  packPath,
  tileBytes,
  tileId,
  tilePath,
  tileVelocity,
} from './tileFormat.js'


// Hand-written points (not any catalogue's).
const POINTS = [
  {x: 1.5, y: -2.25, z: 3, vx: 12.5, vy: -40, vz: 0.25, absMag: -1.25, teff: 9800, mag: -1.4, id: (1n << 60n) + 5n},
  {x: 1000.125, y: 0, z: -7, vx: 0, vy: 0, vz: 0, absMag: 4.83, teff: 5772, mag: 3.1, id: 42n},
  {x: -3e4, y: 2e4, z: 1, vx: -310, vy: 2, vz: 88, absMag: 13.23, teff: 0, mag: 9.5, id: 0n},
]


describe('tileFormat', () => {
  it('round-trips every column', () => {
    const buf = encodeTile(POINTS, HAS_IDS | HAS_VELOCITY)
    expect(buf.byteLength).toBe(tileBytes(3, HAS_IDS | HAS_VELOCITY))
    expect(buf.byteLength).toBe(24 + (30 * 3))
    const t = decodeTile(buf)
    expect(t.count).toBe(3)
    for (let i = 0; i < 3; i++) {
      const p = POINTS[i]
      expect(t.position[3 * i]).toBe(Math.fround(p.x))
      expect(t.position[(3 * i) + 1]).toBe(Math.fround(p.y))
      expect(t.position[(3 * i) + 2]).toBe(Math.fround(p.z))
      expect(tileId(t, i)).toBe(p.id)
      const v = tileVelocity(t, i)
      expect(v[0]).toBeCloseTo(p.vx, 0)
      expect(Math.abs(v[1] - p.vy)).toBeLessThanOrEqual(Math.abs(p.vy) * (2 ** -11))
      expect(t.absMag[i] / ABS_MAG_SCALE).toBeCloseTo(p.absMag, 3)
      expect(t.teff[i]).toBe(p.teff)
    }
  })

  it('keeps the catalogue\'s 1/256-magnitude steps exactly', () => {
    const t = decodeTile(encodeTile([{...POINTS[0], absMag: 13.23046875}], 0))
    expect(t.absMag[0] / ABS_MAG_SCALE).toBe(13.23046875)
    expect(t.ids).toBeNull()
    expect(t.velocity).toBeNull()
    expect(tileVelocity(t, 0)).toEqual([0, 0, 0])
  })

  it('refuses what isn\'t a tile', () => {
    const buf = encodeTile(POINTS, HAS_IDS)
    new Uint8Array(buf)[0] = 0
    expect(() => decodeTile(buf)).toThrow(/magic/)
    expect(() => decodeTile(encodeTile(POINTS, HAS_IDS).slice(0, 50))).toThrow(/expected/)
    expect(() => decodeTile(new ArrayBuffer(8))).toThrow(/short/)
  })

  it('names a tile by order and pixel', () => {
    expect(tilePath(3, 123)).toBe('3/123.bin')
    expect(packPath('roots')).toBe('packs/roots.bin')
  })

  it('carries a HIP number and a class (the bundled catalogue\'s columns), 22 bytes a star', () => {
    const recs = POINTS.map((p, i) => ({...p, hipId: [32349, 70890, 4294967295][i], clazz: [0x0a15, 0x7f00, 0][i]}))
    const flags = HAS_HIP | HAS_CLASS
    const buf = encodeTile(recs, flags)
    expect(buf.byteLength).toBe(24 + (22 * 3))
    const t = decodeTile(buf)
    expect([...t.hip]).toEqual([32349, 70890, 4294967295])
    expect([...t.clazz]).toEqual([0x0a15, 0x7f00, 0])
    expect(t.ids).toBeNull()
    expect(t.position[3]).toBe(Math.fround(POINTS[1].x))
    expect(t.absMag[2] / ABS_MAG_SCALE).toBeCloseTo(13.23, 3)
    // Every column together, each where its flag puts it.
    const all = decodeTile(encodeTile(recs, flags | HAS_IDS | HAS_VELOCITY))
    expect(tileId(all, 0)).toBe(POINTS[0].id)
    expect(all.hip[1]).toBe(70890)
    expect(tileVelocity(all, 2)[0]).toBeCloseTo(-310, 0)
    expect(all.teff[0]).toBe(9800)
    expect(all.clazz[0]).toBe(0x0a15)
  })

  it('packs tiles in one file, and gives each back whole and aligned', () => {
    // Odd counts, so a tile's length isn't a multiple of 4.
    const a = encodeTile(POINTS.slice(0, 1), HAS_HIP | HAS_CLASS)
    const b = encodeTile(POINTS, HAS_IDS)
    const c = encodeTile(POINTS.slice(1), HAS_HIP | HAS_CLASS)
    const pack = encodePack([{order: 0, pix: 3, buf: a}, {order: 1, pix: 13, buf: b}, {order: 1, pix: 14, buf: c}])
    const out = decodePack(pack)
    expect(out.map((e) => e.key)).toEqual(['0/3', '1/13', '1/14'])
    expect(out.map((e) => e.buf.byteLength)).toEqual([a.byteLength, b.byteLength, c.byteLength])
    expect(decodeTile(out[1].buf).count).toBe(3)
    expect(new Uint8Array(out[2].buf)).toEqual(new Uint8Array(c))
    expect(() => decodePack(pack.slice(0, pack.byteLength - 8))).toThrow(/truncated/)
    expect(() => decodePack(a)).toThrow(/magic/)
  })
})
