import {
  SETTINGS_DEFAULTS,
  decodePermalink,
  decodeSettings,
  encodePermalink,
  encodeSettings,
  pathFromFragment,
} from './permalink.js'


describe('encodePermalink / decodePermalink round-trip', () => {
  it('round-trips a realistic Earth-orbit view', () => {
    const path = 'sun/earth'
    const d2000 = 9233.1234
    const lat = 30.2638
    const lng = -97.7526
    const alt = 3282
    const quat = {x: 0, y: 0, z: 0, w: 1}
    const fov = 45
    const encoded = encodePermalink(path, d2000, lat, lng, alt, quat, fov)
    expect(encoded).toBe('sun/earth@30.2638,-97.7526,3.282km;t=9233.1234jd;cq=0,0,0,1;fov=45deg')
    const decoded = decodePermalink(encoded)
    expect(decoded.path).toBe(path)
    expect(decoded.d2000).toBeCloseTo(d2000, 4)
    expect(decoded.lat).toBeCloseTo(lat, 4)
    expect(decoded.lng).toBeCloseTo(lng, 4)
    expect(decoded.alt).toBe(alt)
    expect(decoded.quat).toEqual(quat)
    expect(decoded.fov).toBeCloseTo(fov, 2)
  })

  it('round-trips a non-trivial quaternion', () => {
    const quat = {x: 0.1234, y: -0.2345, z: 0.3456, w: 0.8776}
    const encoded = encodePermalink('sun/mars', 0, 0, 0, 1000000, quat, 30)
    const decoded = decodePermalink(encoded)
    expect(decoded.quat.x).toBeCloseTo(quat.x, 4)
    expect(decoded.quat.y).toBeCloseTo(quat.y, 4)
    expect(decoded.quat.z).toBeCloseTo(quat.z, 4)
    expect(decoded.quat.w).toBeCloseTo(quat.w, 4)
  })

  it('round-trips a pre-J2000 (negative d2000) date', () => {
    const d2000 = -36524.0
    const encoded = encodePermalink('sun', d2000, 0, 0, 696000000, {x: 0, y: 0, z: 0, w: 1}, 45)
    const decoded = decodePermalink(encoded)
    expect(decoded.d2000).toBeCloseTo(d2000, 4)
  })

  it('round-trips negative lat/lng (southern hemisphere, east longitude)', () => {
    const lat = -33.8688
    const lng = 151.2093
    const encoded = encodePermalink('sun/earth', 9000, lat, lng, 5000, {x: 0, y: 0, z: 0, w: 1}, 45)
    const decoded = decodePermalink(encoded)
    expect(decoded.lat).toBeCloseTo(lat, 4)
    expect(decoded.lng).toBeCloseTo(lng, 4)
  })

  it('ignores unknown parameter keys', () => {
    const fragment = 'sun/earth@30.27,-97.75,3282m;t=9233.1234jd;cq=0,0,0,1;fov=45deg;track=1'
    const decoded = decodePermalink(fragment)
    expect(decoded).not.toBeNull()
    expect(decoded.path).toBe('sun/earth')
  })

  it('parameter order does not affect decode', () => {
    const fragment = 'sun/earth@30.27,-97.75,3282m;fov=45deg;cq=0,0,0,1;t=9233.1234jd'
    const decoded = decodePermalink(fragment)
    expect(decoded).not.toBeNull()
    expect(decoded.path).toBe('sun/earth')
    expect(decoded.fov).toBeCloseTo(45, 2)
  })
})


describe('decodePermalink returns null for invalid input', () => {
  it('returns null for legacy path-only hash', () => {
    expect(decodePermalink('sun/earth/moon')).toBeNull()
  })

  it('returns null when no semicolon after position', () => {
    expect(decodePermalink('sun/earth@30.27,-97.75,3282m')).toBeNull()
  })

  it('returns null when position has wrong field count', () => {
    expect(decodePermalink('sun/earth@0,0;t=9233jd;cq=0,0,0,1;fov=45deg')).toBeNull()
  })

  it('returns null when required keys are missing', () => {
    // Missing cq
    expect(decodePermalink('sun/earth@0,0,0m;t=9233jd;fov=45deg')).toBeNull()
  })

  it('returns null when t has wrong suffix', () => {
    expect(decodePermalink('sun/earth@0,0,0m;t=9233.1234;cq=0,0,0,1;fov=45deg')).toBeNull()
  })

  it('returns null when fov has wrong suffix', () => {
    expect(decodePermalink('sun/earth@0,0,0m;t=9233.1234jd;cq=0,0,0,1;fov=45')).toBeNull()
  })

  it('returns null when a number is NaN', () => {
    expect(decodePermalink('sun/earth@NaN,0,0m;t=9233.1234jd;cq=0,0,0,1;fov=45deg')).toBeNull()
  })
})


describe('pathFromFragment', () => {
  it('passes through a legacy path', () => {
    expect(pathFromFragment('sun/earth/moon')).toBe('sun/earth/moon')
  })

  it('strips the @... suffix from a permalink', () => {
    expect(pathFromFragment('sun/earth@30.27,-97.75,3282m;t=9233.1234jd;cq=0,0,0,1;fov=45deg')).toBe('sun/earth')
  })

  it('handles a single-node path', () => {
    expect(pathFromFragment('sun@0,0,696Mm;t=0jd;cq=0,0,0,1;fov=45deg')).toBe('sun')
  })
})


describe('SI meter encoding for altitude', () => {
  const cases = [
    [0, '0'],
    [500, '500m'],
    [1500, '1.5km'],
    [7370000, '7.37Mm'],
    [20000000, '20Mm'],
    [1500000000, '1.5Gm'],
    [2000000000000, '2Tm'],
    [-7370000, '-7.37Mm'],
    [-500, '-500m'],
  ]
  for (const [meters, expected] of cases) {
    it(`${meters}m → '${expected}' and back`, () => {
      const encoded = encodePermalink('sun', 0, 0, 0, meters, {x: 0, y: 0, z: 0, w: 1}, 45)
      const decoded = decodePermalink(encoded)
      expect(decoded.alt).toBe(meters)
      // Check that the encoded string contains the expected alt token
      expect(encoded).toContain(`,${expected};`)
    })
  }
})


describe('FOV encoding', () => {
  it('trims trailing zeros from FOV', () => {
    const encoded = encodePermalink('sun', 0, 0, 0, 1000000, {x: 0, y: 0, z: 0, w: 1}, 45.0)
    expect(encoded).toContain('fov=45deg')
  })

  it('preserves non-integer FOV', () => {
    const encoded = encodePermalink('sun', 0, 0, 0, 1000000, {x: 0, y: 0, z: 0, w: 1}, 30.5)
    expect(encoded).toContain('fov=30.5deg')
    const decoded = decodePermalink(encoded)
    expect(decoded.fov).toBeCloseTo(30.5, 2)
  })
})


describe('quaternion encoding', () => {
  it('identity quaternion encodes as 0,0,0,1', () => {
    const encoded = encodePermalink('sun', 0, 0, 0, 1000000, {x: 0, y: 0, z: 0, w: 1}, 45)
    expect(encoded).toContain('cq=0,0,0,1')
  })

  it('trims trailing zeros from quaternion components', () => {
    const encoded = encodePermalink('sun', 0, 0, 0, 1000000, {x: 0.5, y: 0.5, z: 0.5, w: 0.5}, 45)
    expect(encoded).toContain('cq=0.5,0.5,0.5,0.5')
  })
})


describe('lat/lng encoding', () => {
  it('encodes zero lat/lng as bare 0', () => {
    const encoded = encodePermalink('sun', 0, 0, 0, 1000000, {x: 0, y: 0, z: 0, w: 1}, 45)
    expect(encoded).toMatch(/^sun@0,0,/)
  })

  it('trims trailing zeros from lat/lng', () => {
    const encoded = encodePermalink('sun/earth', 0, 45.0, -90.0, 1000, {x: 0, y: 0, z: 0, w: 1}, 45)
    expect(encoded).toMatch(/^sun\/earth@45,-90,/)
  })
})


describe('settings encoding', () => {
  const defaults = {...SETTINGS_DEFAULTS}
  const baseArgs = ['sun/earth', 0, 0, 0, 1000, {x: 0, y: 0, z: 0, w: 1}, 45]

  it('omits the s= param when all settings are at defaults', () => {
    const encoded = encodePermalink(...baseArgs, defaults)
    expect(encoded).not.toContain(';s=')
  })

  it('omits the s= param when settings is undefined (back-compat)', () => {
    const encoded = encodePermalink(...baseArgs)
    expect(encoded).not.toContain(';s=')
  })

  it('flags only deviations from defaults', () => {
    const encoded = encodePermalink(...baseArgs,
        {...defaults, a: false, e: true})
    expect(encoded).toContain(';s=')
    expect(encoded).toMatch(/;s=[ae]+/)
    // a is default ON, set to OFF → "a"; e is default OFF, set to ON → "e"
    const m = encoded.match(/;s=(\w+)/)
    const flags = m[1].split('').sort().join('')
    expect(flags).toBe('ae')
  })

  it('round-trips an all-defaults permalink', () => {
    const encoded = encodePermalink(...baseArgs, defaults)
    const decoded = decodePermalink(encoded)
    expect(decoded.settings).toEqual(defaults)
  })

  it('round-trips a permalink with custom settings', () => {
    const custom = {...defaults, a: false, l: false, e: true, c: true, g: true}
    const encoded = encodePermalink(...baseArgs, custom)
    const decoded = decodePermalink(encoded)
    expect(decoded.settings).toEqual(custom)
  })

  it('round-trips the v (nav) flag — default ON', () => {
    expect(SETTINGS_DEFAULTS.v).toBe(true)
    const navOff = {...defaults, v: false}
    const encoded = encodePermalink(...baseArgs, navOff)
    expect(encoded).toContain(';s=v')
    const decoded = decodePermalink(encoded)
    expect(decoded.settings.v).toBe(false)
  })

  it('decodePermalink always populates settings, even with no s= param', () => {
    // back-compat: pre-settings permalinks should still round-trip cleanly,
    // with the settings field defaulted.
    const encoded = encodePermalink(...baseArgs)
    expect(encoded).not.toContain(';s=')
    const decoded = decodePermalink(encoded)
    expect(decoded.settings).toEqual(defaults)
  })

  it('decodeSettings returns full defaults map for empty / missing input', () => {
    expect(decodeSettings(undefined)).toEqual(defaults)
    expect(decodeSettings('')).toEqual(defaults)
  })

  it('decodeSettings ignores unknown letter codes', () => {
    expect(decodeSettings('aZQ')).toEqual({...defaults, a: false})
  })

  it('encodeSettings is stable in key order regardless of input ordering', () => {
    // Caller may build the settings object in any order; the encoded string
    // must be deterministic so the URL doesn't churn between identical states.
    const s1 = {a: false, l: true, p: true, o: true, e: true, c: false, g: false}
    const s2 = {g: false, c: false, e: true, o: true, p: true, l: true, a: false}
    expect(encodeSettings(s1)).toBe(encodeSettings(s2))
  })
})
