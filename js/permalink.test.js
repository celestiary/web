import {
  SETTINGS_DEFAULTS,
  decodePermalink,
  decodeSettings,
  decodeTimeToken,
  encodePermalink,
  encodeSettings,
  encodeTimeToken,
  formatTokenValue,
  parseTokenValue,
  parseValueList,
  pathFromFragment,
  permalinkHref,
} from './permalink.js'
import {SUPPORTED_DAYS_FROM_J2000} from './Time.js'


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

  it('returns null when a number is infinite', () => {
    expect(decodePermalink('sun/earth@0,0,0m;t=Infinityjd;cq=0,0,0,1;fov=45deg')).toBeNull()
    expect(decodePermalink('sun/earth@0,0,0m;t=-1e999jd;cq=0,0,0,1;fov=45deg')).toBeNull()
    expect(decodePermalink('sun/earth@0,0,0m;t=9233jd;cq=0,0,Infinity,1;fov=45deg')).toBeNull()
  })
})


describe('decodePermalink clamps the time to the supported dates', () => {
  it('clamps an absurd t= to the bounds', () => {
    const max = SUPPORTED_DAYS_FROM_J2000
    for (const [t, d2000] of [['1e9', max], ['1e300', max], ['-3.65e8', -max], [`${max + 1}`, max]]) {
      const decoded = decodePermalink(`sun/earth@0,0,0m;t=${t}jd;cq=0,0,0,1;fov=45deg`)
      expect(decoded.d2000).toBe(d2000)
    }
  })

  it('keeps a t= in range as it is', () => {
    const decoded = decodePermalink('sun/earth@0,0,0m;t=-1000000.5jd;cq=0,0,0,1;fov=45deg')
    expect(decoded.d2000).toBe(-1000000.5)
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


describe('L (landed) flag', () => {
  const defaults = {...SETTINGS_DEFAULTS}
  const baseArgs = ['sun/earth', 0, 48.8566, 2.3522, 35,
    {x: 0, y: 0, z: 0, w: 1}, 45]

  it('default is false', () => {
    expect(SETTINGS_DEFAULTS.L).toBe(false)
  })

  it('emits ;s=L when landed=true', () => {
    const encoded = encodePermalink(...baseArgs, {...defaults, L: true})
    expect(encoded).toContain(';s=')
    expect(encoded).toMatch(/;s=L/)
  })

  it('omits L from s= when landed=false (default)', () => {
    const encoded = encodePermalink(...baseArgs, defaults)
    expect(encoded).not.toContain(';s=')
  })

  it('round-trips the L=true state', () => {
    const encoded = encodePermalink(...baseArgs, {...defaults, L: true})
    const decoded = decodePermalink(encoded)
    expect(decoded.settings.L).toBe(true)
  })

  it('legacy permalinks without L decode landed=false (back-compat)', () => {
    // A pre-L URL might be just plain "sun/earth@0,0,0;t=0jd;cq=0,0,0,1;fov=45deg"
    // (no s=) or with other flags but no L letter.  Both must produce
    // settings.L === false.
    const noFlagsURL = encodePermalink(...baseArgs)
    expect(decodePermalink(noFlagsURL).settings.L).toBe(false)
    // s= present, L absent
    const otherFlagsOnly = encodePermalink(...baseArgs, {...defaults, a: false})
    expect(decodePermalink(otherFlagsOnly).settings.L).toBe(false)
  })

  it('coexists with other flags', () => {
    const combo = {...defaults, a: false, e: true, L: true}
    const encoded = encodePermalink(...baseArgs, combo)
    const decoded = decodePermalink(encoded)
    expect(decoded.settings).toEqual(combo)
  })
})


describe('A (AR-fallback) flag', () => {
  const defaults = {...SETTINGS_DEFAULTS}
  const baseArgs = ['sun/earth', 0, 37.77, -122.42, 2,
    {x: 0, y: 0, z: 0, w: 1}, 45]

  it('default is false', () => {
    expect(SETTINGS_DEFAULTS.A).toBe(false)
  })

  it('emits ;s=A when AR-fallback is true', () => {
    const encoded = encodePermalink(...baseArgs, {...defaults, A: true})
    expect(encoded).toMatch(/;s=A/)
  })

  it('omits A from s= when AR-fallback is false (default)', () => {
    const encoded = encodePermalink(...baseArgs, defaults)
    expect(encoded).not.toContain(';s=A')
  })

  it('round-trips A=true', () => {
    const encoded = encodePermalink(...baseArgs, {...defaults, A: true})
    const decoded = decodePermalink(encoded)
    expect(decoded.settings.A).toBe(true)
  })

  it('legacy permalinks without A decode A=false (back-compat)', () => {
    // Pre-A URL: only the L flag flipped, A absent → A must default false.
    const onlyL = encodePermalink(...baseArgs, {...defaults, L: true})
    expect(decodePermalink(onlyL).settings.A).toBe(false)
    // No s= at all.
    const noFlags = encodePermalink(...baseArgs)
    expect(decodePermalink(noFlags).settings.A).toBe(false)
  })

  it('coexists with the L (landed) flag — typical AR permalink', () => {
    // The expected shape for a permalink captured while in AR mode:
    //   landed at the surface (L=1) AND AR-fallback set (A=1).
    const combo = {...defaults, L: true, A: true}
    const encoded = encodePermalink(...baseArgs, combo)
    expect(encoded).toMatch(/;s=[LA]+/)
    const decoded = decodePermalink(encoded)
    expect(decoded.settings.L).toBe(true)
    expect(decoded.settings.A).toBe(true)
  })
})


describe('state tokens', () => {
  const view = ['sun/earth', 9233.1234, 30.2638, -97.7526, 3282, {x: 0, y: 0, z: 0, w: 1}, 45]

  it('are written after the view and settings, in order, as label:value', () => {
    const frag = encodePermalink(...view, {...SETTINGS_DEFAULTS, a: false},
        {'apps': 'open,view=expansion', 'apps.expansion': 'k=6,run=1', 'none': null})
    expect(frag).toBe('sun/earth@30.2638,-97.7526,3.282km;t=9233.1234jd;cq=0,0,0,1;fov=45deg;s=a;' +
      'apps:open,view=expansion;apps.expansion:k=6,run=1')
  })

  it('round-trip, the view params unchanged', () => {
    const tokens = {'apps': 'open,dock,pin=expansion', 'apps.expansion': 'c=0.25,at=0.5'}
    const decoded = decodePermalink(encodePermalink(...view, undefined, tokens))
    expect(decoded.tokens).toEqual(tokens)
    expect(decoded.fov).toBe(45)
    expect(decoded.settings).toEqual(SETTINGS_DEFAULTS)
  })

  it('a bare label: is an empty value', () => {
    const decoded = decodePermalink('sun@0,0,1km;t=0jd;cq=0,0,0,1;fov=45deg;apps:')
    expect(decoded.tokens).toEqual({apps: ''})
  })

  it('an empty token map writes nothing', () => {
    expect(encodePermalink(...view, undefined, {})).toBe(encodePermalink(...view))
  })

  it('values split into flags and named values', () => {
    expect(parseTokenValue('open,dock,view=a,pin=a+b')).toEqual(
        {flags: ['open', 'dock'], named: {view: 'a', pin: 'a+b'}})
    expect(parseTokenValue('')).toEqual({flags: [], named: {}})
    expect(parseTokenValue(undefined)).toEqual({flags: [], named: {}})
    expect(parseValueList('a+b')).toEqual(['a', 'b'])
    expect(parseValueList(undefined)).toEqual([])
  })

  it('values format flags first, leaving out empty named values', () => {
    expect(formatTokenValue(['open'], {view: 'a', pin: ['a', 'b'], run: [], x: null, y: undefined, k: 0}))
        .toBe('open,view=a,pin=a+b,k=0')
  })
})


describe('from= (the camera\'s frame, when not the target\'s)', () => {
  const Q = {x: 0, y: 0, z: 0, w: 1}

  it('round-trips, written after the position', () => {
    const frag = encodePermalink('sun/jupiter', 0, 1, 2, 3e6, Q, 45, undefined, undefined, 'sun/earth')
    expect(frag).toBe('sun/jupiter@1,2,3Mm;from=sun/earth;t=0jd;cq=0,0,0,1;fov=45deg')
    expect(decodePermalink(frag).from).toBe('sun/earth')
    const atStar = encodePermalink('hip:32349', 0, 1, 2, 3e6, Q, 45, undefined, undefined, 'sun/earth')
    expect(decodePermalink(atStar).from).toBe('sun/earth')
    expect(decodePermalink(encodePermalink('sun', 0, 1, 2, 3, Q, 45, undefined, undefined, 'hip:7')).from)
        .toBe('hip:7')
  })

  it('is left out when it is the path, or none', () => {
    expect(encodePermalink('sun/earth', 0, 1, 2, 3, Q, 45, undefined, undefined, 'sun/earth')).not.toContain('from=')
    expect(encodePermalink('sun/earth', 0, 1, 2, 3, Q, 45)).not.toContain('from=')
    expect(decodePermalink('sun/earth@1,2,3m;t=0jd;cq=0,0,0,1;fov=45deg').from).toBe(null)
    expect(decodePermalink('sun/earth@1,2,3m;from=sun/earth;t=0jd;cq=0,0,0,1;fov=45deg').from).toBe(null)
  })

  it('ignores a malformed one, keeping the rest of the link', () => {
    for (const bad of ['', 'Sun/Earth', 'sun//earth', 'hip:x', '../x', 'sun/earth/']) {
      const pl = decodePermalink(`sun@1,2,3m;from=${bad};t=0jd;cq=0,0,0,1;fov=45deg`)
      expect(pl.from).toBe(null)
      expect(pl.lat).toBe(1)
    }
  })

  it('is a view param, not a state token', () => {
    const pl = decodePermalink('hip:7@1,2,3m;from=hip:9;t=0jd;cq=0,0,0,1;fov=45deg;apps:open')
    expect(pl.path).toBe('hip:7')
    expect(pl.from).toBe('hip:9')
    expect(pl.tokens).toEqual({apps: 'open'})
  })
})


describe('permalinkHref', () => {
  it('keeps the query string, resolving the fragment against the base', () => {
    expect(permalinkHref('sun/earth@1,2,3m', 'https://x.github.io/web/pr-preview/pr-1/', '?perf=1&off=clouds'))
        .toBe('https://x.github.io/web/pr-preview/pr-1/?perf=1&off=clouds#sun/earth@1,2,3m')
    expect(permalinkHref('sun', 'http://localhost:8080/', '')).toBe('http://localhost:8080/#sun')
    expect(permalinkHref('sun', 'http://localhost:8080/', undefined)).toBe('http://localhost:8080/#sun')
  })

  it('falls back to the bare fragment with no usable base', () => {
    expect(permalinkHref('sun', undefined, '?perf=1')).toBe('#sun')
  })
})


describe('the exposure compensation, ev=', () => {
  const quat = {x: 0, y: 0, z: 0, w: 1}
  const encode = (ev) => encodePermalink('sun/earth', 9000, 1, 2, 3, quat, 45, undefined, undefined, undefined, ev)

  it('is left out at 0, so a link at the defaults is just the view', () => {
    expect(encode(0)).toBe('sun/earth@1,2,3m;t=9000jd;cq=0,0,0,1;fov=45deg')
    expect(encode(undefined)).toBe(encode(0))
    expect(encode(0.001)).toBe(encode(0))
    expect(encodePermalink('sun/earth', 9000, 1, 2, 3, quat, 45)).toBe(encode(0))
    expect(decodePermalink(encode(0)).ev).toBe(0)
  })

  it('is written in stops, two decimal places, after the fov', () => {
    expect(encode(1)).toBe('sun/earth@1,2,3m;t=9000jd;cq=0,0,0,1;fov=45deg;ev=1')
    expect(encode(4 / 3)).toBe('sun/earth@1,2,3m;t=9000jd;cq=0,0,0,1;fov=45deg;ev=1.33')
    expect(encode(-2 / 3)).toBe('sun/earth@1,2,3m;t=9000jd;cq=0,0,0,1;fov=45deg;ev=-0.67')
  })

  it('round-trips, alongside the settings and state tokens', () => {
    for (const ev of [1, -1, 1.33, -0.67, 0.33, 10, -10]) {
      expect(decodePermalink(encode(ev)).ev).toBe(ev)
    }
    const frag = encodePermalink('sun/earth', 9000, 1, 2, 3, quat, 45, {...SETTINGS_DEFAULTS, a: false},
        {apps: 'open'}, 'sun/mars', -1.67)
    expect(frag).toBe('sun/earth@1,2,3m;from=sun/mars;t=9000jd;cq=0,0,0,1;fov=45deg;ev=-1.67;s=a;apps:open')
    const pl = decodePermalink(frag)
    expect(pl.ev).toBe(-1.67)
    expect(pl.settings.a).toBe(false)
    expect(pl.tokens).toEqual({apps: 'open'})
    expect(pl.from).toBe('sun/mars')
  })

  it('reads a + sign, as a camera shows it', () => {
    expect(decodePermalink('sun@1,2,3m;t=0jd;cq=0,0,0,1;fov=45deg;ev=+1.3').ev).toBe(1.3)
  })

  it('is 0 when bad, and held to the range when out of it, keeping the rest of the link', () => {
    for (const bad of ['', 'x', 'NaN', 'Infinity', '--1']) {
      const pl = decodePermalink(`sun@1,2,3m;t=0jd;cq=0,0,0,1;fov=45deg;ev=${bad}`)
      expect(pl.ev).toBe(0)
      expect(pl.lat).toBe(1)
    }
    expect(decodePermalink('sun@1,2,3m;t=0jd;cq=0,0,0,1;fov=45deg;ev=99').ev).toBe(10)
    expect(decodePermalink('sun@1,2,3m;t=0jd;cq=0,0,0,1;fov=45deg;ev=-99').ev).toBe(-10)
  })

  it('is 0 in a link from before it', () => {
    expect(decodePermalink('sun@1,2,3m;t=0jd;cq=0,0,0,1;fov=45deg;s=a').ev).toBe(0)
  })
})


describe('fov=', () => {
  const Q = {x: 0, y: 0, z: 0, w: 1}
  const fovOf = (fov) => decodePermalink(encodePermalink('sun', 0, 1, 2, 3, Q, fov)).fov

  it('round-trips a telescope\'s field, to four figures', () => {
    expect(encodePermalink('sun', 0, 1, 2, 3, Q, 0.07)).toContain(';fov=0.07deg')
    expect(fovOf(0.07)).toBe(0.07)
    expect(fovOf(0.0714)).toBe(0.0714)
    expect(fovOf(0.07142857)).toBe(0.07143)
    expect(fovOf(0.91)).toBe(0.91)
    expect(fovOf(0.005)).toBe(0.005)
  })

  it('keeps the eye\'s and a wide field short', () => {
    expect(encodePermalink('sun', 0, 1, 2, 3, Q, 45)).toContain(';fov=45deg')
    expect(encodePermalink('sun', 0, 1, 2, 3, Q, 30.5)).toContain(';fov=30.5deg')
    expect(fovOf(120.456)).toBe(120.5)
  })

  it('is held to a camera that works, for a hand-written one', () => {
    expect(decodePermalink('sun@1,2,3m;t=0jd;cq=0,0,0,1;fov=0deg').fov).toBe(1e-4)
    expect(decodePermalink('sun@1,2,3m;t=0jd;cq=0,0,0,1;fov=-5deg').fov).toBe(1e-4)
    expect(decodePermalink('sun@1,2,3m;t=0jd;cq=0,0,0,1;fov=400deg').fov).toBe(179)
  })

  it('a shrinking field returns to a link\'s value within a part in a thousand', () => {
    let fov = 45
    for (let i = 0; i < 90; i++) {
      fov *= 0.9
    }
    expect(fov).toBeLessThan(0.01)
    expect(Math.abs(fovOf(fov) - fov) / fov).toBeLessThan(1e-3)
  })
})


describe('sm= (the stars\' setting)', () => {
  const Q = {x: 0, y: 0, z: 0, w: 1}
  const encode = (sm) => encodePermalink('sun', 0, 1, 2, 3, Q, 45, undefined, undefined, undefined, 0, sm)

  it('is left out at 0, and after ev, before s', () => {
    expect(encode(0)).not.toContain('sm=')
    expect(encode(1e-9)).not.toContain('sm=')
    expect(encode(-0.001)).not.toContain('sm=')
    const frag = encodePermalink('sun', 0, 1, 2, 3, Q, 45, {...SETTINGS_DEFAULTS, a: false}, undefined, undefined, 1, -1.5)
    expect(frag).toBe('sun@1,2,3m;t=0jd;cq=0,0,0,1;fov=45deg;ev=1;sm=-1.5;s=a')
  })

  it('round-trips, with or without a +', () => {
    for (const sm of [-10, -2.5, -0.5, 0.5, 1, 7.25, 10]) {
      expect(decodePermalink(encode(sm)).sm).toBe(sm)
    }
    expect(decodePermalink('sun@1,2,3m;t=0jd;cq=0,0,0,1;fov=45deg;sm=+1.5').sm).toBe(1.5)
  })

  it('is 0 when absent or bad, and held to the range', () => {
    expect(decodePermalink('sun@1,2,3m;t=0jd;cq=0,0,0,1;fov=45deg').sm).toBe(0)
    for (const bad of ['', 'x', 'NaN', 'Infinity']) {
      expect(decodePermalink(`sun@1,2,3m;t=0jd;cq=0,0,0,1;fov=45deg;sm=${bad}`).sm).toBe(0)
    }
    expect(decodePermalink('sun@1,2,3m;t=0jd;cq=0,0,0,1;fov=45deg;sm=99').sm).toBe(10)
  })
})


describe('the T setting (tracking)', () => {
  it('is off by default, and a flag in s= when on', () => {
    expect(SETTINGS_DEFAULTS.T).toBe(false)
    expect(encodeSettings({...SETTINGS_DEFAULTS, T: true})).toBe('T')
    expect(decodeSettings('T').T).toBe(true)
    expect(decodeSettings('oL').T).toBe(false)
  })
})


describe('the F setting (following)', () => {
  it('is off by default, and a flag in s= when on', () => {
    expect(SETTINGS_DEFAULTS.F).toBe(false)
    expect(encodeSettings(SETTINGS_DEFAULTS)).toBe('')
    expect(encodeSettings({...SETTINGS_DEFAULTS, F: true})).toBe('F')
    expect(decodeSettings('F').F).toBe(true)
    expect(decodeSettings('oL').F).toBe(false)
    expect(decodeSettings(undefined).F).toBe(false)
  })

  it('is independent of tracking, in either order', () => {
    const both = encodeSettings({...SETTINGS_DEFAULTS, T: true, F: true})
    expect(both).toBe('TF')
    expect(decodeSettings(both)).toMatchObject({T: true, F: true})
    expect(decodeSettings('FT')).toMatchObject({T: true, F: true})
    expect(decodeSettings('T')).toMatchObject({T: true, F: false})
    expect(decodeSettings('F')).toMatchObject({T: false, F: true})
  })

  it('round-trips through a full link, and an old link without it is off', () => {
    const link = encodePermalink(
        'sun/earth/moon', 9233.1234, 1, 2, 3000, {x: 0, y: 0, z: 0, w: 1}, 45,
        {...SETTINGS_DEFAULTS, F: true})
    expect(link).toMatch(/;s=F(;|$)/)
    expect(decodePermalink(link).settings.F).toBe(true)
    const off = encodePermalink(
        'sun/earth/moon', 9233.1234, 1, 2, 3000, {x: 0, y: 0, z: 0, w: 1}, 45, SETTINGS_DEFAULTS)
    expect(off).not.toContain('s=')
    expect(decodePermalink(off).settings.F).toBe(false)
    expect(decodePermalink('sun@1,2,3m;t=0jd;cq=0,0,0,1;fov=45deg;s=loLT').settings)
        .toMatchObject({F: false, T: true, L: true})
  })
})


describe('the time: token', () => {
  it('is left out for a clock running at real time', () => {
    expect(encodeTimeToken(false, 1)).toBe(null)
    expect(encodeTimeToken(false, 0)).toBe(null)
    expect(encodeTimeToken(false, NaN)).toBe(null)
  })

  it('is pause, rate, or both, the rate a signed multiplier', () => {
    expect(encodeTimeToken(true, 1)).toBe('pause')
    expect(encodeTimeToken(false, 8)).toBe('rate=8')
    expect(encodeTimeToken(false, -2)).toBe('rate=-2')
    expect(encodeTimeToken(true, 1024)).toBe('pause,rate=1024')
    expect(encodeTimeToken(true, -1)).toBe('pause,rate=-1')
  })

  it('round-trips', () => {
    for (const paused of [false, true]) {
      for (const rate of [1, 2, 8, -1, -2, -4096, 2 ** 40]) {
        expect(decodeTimeToken(encodeTimeToken(paused, rate) ?? undefined)).toEqual({paused, rate})
      }
    }
  })

  it('reads a link without it as running at real time, and a bad rate as 1', () => {
    expect(decodeTimeToken(undefined)).toEqual({paused: false, rate: 1})
    expect(decodeTimeToken('')).toEqual({paused: false, rate: 1})
    for (const bad of ['rate=x', 'rate=0', 'rate=', 'rate=NaN']) {
      expect(decodeTimeToken(`pause,${bad}`)).toEqual({paused: true, rate: 1})
    }
    expect(decodeTimeToken('future,rate=4,other=1')).toEqual({paused: false, rate: 4})
  })

  it('travels as a state token in the link, with the apps\'', () => {
    const Q = {x: 0, y: 0, z: 0, w: 1}
    const frag = encodePermalink('sun', 5, 1, 2, 3, Q, 45, undefined,
        {time: encodeTimeToken(true, 4), apps: 'open'})
    expect(frag).toBe('sun@1,2,3m;t=5jd;cq=0,0,0,1;fov=45deg;time:pause,rate=4;apps:open')
    const pl = decodePermalink(frag)
    expect(pl.tokens).toEqual({time: 'pause,rate=4', apps: 'open'})
    expect(decodeTimeToken(pl.tokens.time)).toEqual({paused: true, rate: 4})
    // None at real time.
    expect(encodePermalink('sun', 5, 1, 2, 3, Q, 45, undefined, {time: encodeTimeToken(false, 1)}))
        .toBe('sun@1,2,3m;t=5jd;cq=0,0,0,1;fov=45deg')
  })
})
