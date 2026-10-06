import {
  allPass, changedPixels, describeTolerance, evaluateView, formatTable, lumaAt, mean, measureView, median, medianRatios,
  profileDeviation, regionMask, sampleProfile, terminatorLine, within,
} from './measure.mjs'


/**
 * @param {number} width
 * @param {number} height
 * @param {function(number, number): Array<number>} pixel (x, y) -> [r, g, b]
 * @returns {object} An image
 */
function image(width, height, pixel) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y)
      data.set([r, g, b, 255], ((y * width) + x) * 4)
    }
  }
  return {width, height, data}
}


/**
 * @param {object} img
 * @param {number} k
 * @returns {object} The image with every channel scaled by k
 */
function scaled(img, k) {
  return {...img, data: img.data.map((v, i) => (i % 4 === 3 ? v : v * k))}
}


describe('median and mean', () => {
  it('takes the middle, or the mean of the middle two', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
  })

  it('sorts numerically, not as strings', () => {
    expect(median([10, 9, 100])).toBe(10)
  })

  it('is NaN when empty', () => {
    expect(median([])).toBeNaN()
    expect(mean([])).toBeNaN()
  })

  it('means', () => {
    expect(mean([1, 2, 6])).toBe(3)
  })
})


describe('lumaAt', () => {
  it('weights the channels by Rec. 709', () => {
    const img = image(1, 1, () => [100, 100, 100])
    expect(lumaAt(img.data, 0)).toBeCloseTo(100, 6)
    expect(lumaAt(image(1, 1, () => [255, 0, 0]).data, 0)).toBeCloseTo(0.2126 * 255, 6)
  })
})


describe('regionMask', () => {
  const flat = image(10, 10, () => [100, 100, 100])

  it('keeps the inner part of a disc', () => {
    const mask = regionMask(flat, {disc: {cx: 5, cy: 5, r: 4}, inner: 0.5})
    const count = mask.reduce((a, b) => a + b, 0)
    // A disc of radius 2 px: about 12.6 pixels.
    expect(count).toBeGreaterThan(8)
    expect(count).toBeLessThan(18)
    expect(mask[(5 * 10) + 5]).toBe(1)
    expect(mask[0]).toBe(0)
  })

  it('takes a box in image fractions', () => {
    const mask = regionMask(flat, {box: [0, 0, 0.5, 0.5]})
    expect(mask.reduce((a, b) => a + b, 0)).toBe(25)
  })

  it('leaves out pixels dark in the off render', () => {
    const half = image(10, 10, (x) => (x < 5 ? [0, 0, 0] : [100, 100, 100]))
    const mask = regionMask(half, {box: [0, 0, 1, 1]})
    expect(mask.reduce((a, b) => a + b, 0)).toBe(50)
    expect(mask[0]).toBe(0)
    expect(mask[9]).toBe(1)
  })

  it('needs a region', () => {
    expect(() => regionMask(flat, {})).toThrow()
  })
})


describe('medianRatios', () => {
  const off = image(8, 8, (x, y) => [80 + x, 100 + y, 120])

  it('is 1 for identical images', () => {
    const mask = regionMask(off, {box: [0, 0, 1, 1]})
    const r = medianRatios(off, off, mask)
    expect(r.count).toBe(64)
    for (const key of ['luma', 'r', 'g', 'b']) {
      expect(r[key]).toBeCloseTo(1, 9)
    }
  })

  it('recovers a uniform gain, overall and per channel', () => {
    const mask = regionMask(off, {box: [0, 0, 1, 1]})
    const r = medianRatios(scaled(off, 0.5), off, mask)
    expect(r.luma).toBeCloseTo(0.5, 2)
    expect(r.r).toBeCloseTo(0.5, 2)
  })

  it('reports a per-channel shift', () => {
    const on = image(8, 8, (x, y) => [(80 + x) * 1.2, 100 + y, 120])
    const r = medianRatios(on, off, regionMask(off, {box: [0, 0, 1, 1]}))
    expect(r.r).toBeCloseTo(1.2, 2)
    expect(r.g).toBeCloseTo(1, 9)
    expect(r.b).toBeCloseTo(1, 9)
    expect(r.luma).toBeGreaterThan(1)
    expect(r.luma).toBeLessThan(1.2)
  })

  it('takes the median, so outliers do not move it', () => {
    const base = image(9, 1, () => [100, 100, 100])
    const on = image(9, 1, (x) => (x === 0 ? [255, 255, 255] : x === 1 ? [0, 0, 0] : [110, 110, 110]))
    const r = medianRatios(on, base, regionMask(base, {box: [0, 0, 1, 1]}))
    expect(r.luma).toBeCloseTo(1.1, 6)
  })

  it('is NaN with nothing measured', () => {
    const dark = image(4, 4, () => [0, 0, 0])
    const r = medianRatios(dark, dark, regionMask(dark, {box: [0, 0, 1, 1]}))
    expect(r.count).toBe(0)
    expect(r.luma).toBeNaN()
  })
})


describe('sampleProfile', () => {
  // Brightness rising left to right: 0, 10, ..., 90.
  const ramp = image(10, 4, (x) => [x * 10, x * 10, x * 10])

  it('samples along the line', () => {
    const p = sampleProfile(ramp, [0.05, 0.5], [0.95, 0.5], 10, 1)
    expect(p).toHaveLength(10)
    p.forEach((v, i) => expect(v).toBeCloseTo(i * 10, 6))
  })

  it('averages across the strip', () => {
    const stripes = image(4, 4, (x, y) => (y % 2 === 0 ? [200, 200, 200] : [0, 0, 0]))
    const [v] = sampleProfile(stripes, [0.25, 0.5], [0.75, 0.5], 1, 2)
    expect(v).toBeCloseTo(100, 6)
  })

  it('ignores samples off the image', () => {
    const p = sampleProfile(ramp, [-1, 0.5], [0.05, 0.5], 2, 1)
    expect(p[0]).toBeNaN()
    expect(p[1]).toBeCloseTo(0, 6)
  })
})


describe('terminatorLine', () => {
  const size = {width: 200, height: 100}

  it('runs through the centre along the Sun, dark side first', () => {
    // Sun to the right: the line runs left to right.
    const {from, to} = terminatorLine({cx: 100, cy: 50, r: 40}, [1, 0], size, 0.5)
    expect(from[0]).toBeCloseTo(0.4, 6)
    expect(to[0]).toBeCloseTo(0.6, 6)
    expect(from[1]).toBeCloseTo(0.5, 6)
    expect(to[1]).toBeCloseTo(0.5, 6)
  })

  it('follows a diagonal Sun', () => {
    const d = Math.SQRT1_2
    const {from, to} = terminatorLine({cx: 100, cy: 50, r: 20}, [-d, -d], size)
    // Toward the upper left is lit, so the line ends there.
    expect(to[0]).toBeLessThan(0.5)
    expect(to[1]).toBeLessThan(0.5)
    expect(from[0]).toBeGreaterThan(0.5)
  })

  it('stops at the image edge when the limb is off screen', () => {
    const {from, to} = terminatorLine({cx: 100, cy: 50, r: 5000}, [1, 0], size)
    expect(from[0]).toBeCloseTo(4 / 200, 6)
    expect(to[0]).toBeCloseTo(196 / 200, 6)
  })

  it('stops at the vertical edge too', () => {
    const {from, to} = terminatorLine({cx: 100, cy: 50, r: 5000}, [0, 1], size)
    expect(from[1]).toBeCloseTo(4 / 100, 6)
    expect(to[1]).toBeCloseTo(96 / 100, 6)
  })
})


describe('profileDeviation', () => {
  it('is the max and mean absolute difference', () => {
    expect(profileDeviation([10, 20, 30], [10, 26, 27])).toEqual({max: 6, mean: 3})
  })

  it('skips samples off the image', () => {
    expect(profileDeviation([NaN, 5], [1, 3])).toEqual({max: 2, mean: 2})
  })
})


describe('within and describeTolerance', () => {
  it('checks ranges and one-sided bounds, inclusively', () => {
    expect(within(1, [0.9, 1.1])).toBe(true)
    expect(within(1.1, [0.9, 1.1])).toBe(true)
    expect(within(1.2, [0.9, 1.1])).toBe(false)
    expect(within(5, {max: 5})).toBe(true)
    expect(within(6, {max: 5})).toBe(false)
    expect(within(3, {min: 4})).toBe(false)
  })

  it('fails NaN', () => {
    expect(within(NaN, [0, 2])).toBe(false)
    expect(within(NaN, {max: 5})).toBe(false)
  })

  it('describes them', () => {
    expect(describeTolerance([0.9, 1.1])).toBe('0.9 - 1.1')
    expect(describeTolerance({max: 12})).toBe('<= 12')
    expect(describeTolerance({min: 200})).toBe('>= 200')
  })
})


describe('measureView and evaluateView', () => {
  const view = {
    region: {box: [0, 0, 1, 1]},
    profile: {from: [0.05, 0.5], to: [0.95, 0.5], samples: 8, band: 1},
  }
  const off = image(16, 16, (x) => [40 + (x * 10), 40 + (x * 10), 40 + (x * 10)])

  it('passes a matching pair', () => {
    const measured = measureView(off, off, view)
    expect(measured.profile.max).toBe(0)
    const rows = evaluateView('same', measured, {ratio: [0.95, 1.05], channelRatio: [0.9, 1.1], profileMax: 1, profileMean: 1})
    expect(rows.map((r) => r.metric)).toEqual(
        ['pixels', 'ratio luma', 'ratio r', 'ratio g', 'ratio b', 'profile max', 'profile mean'])
    expect(allPass(rows)).toBe(true)
  })

  it('takes a range per channel', () => {
    const measured = measureView(off, off, view)
    const ok = {r: [0.9, 1.1], g: [0.9, 1.1], b: [0.9, 1.1]}
    expect(allPass(evaluateView('same', measured, {channelRatio: ok}))).toBe(true)
    const rows = evaluateView('same', measured, {channelRatio: {...ok, b: [1.2, 1.4]}})
    expect(rows.filter((r) => !r.pass).map((r) => r.metric)).toEqual(['ratio b'])
  })

  it('fails a darker pair, naming what failed', () => {
    const measured = measureView(scaled(off, 0.8), off, view)
    const rows = evaluateView('dim', measured, {ratio: [0.95, 1.05], profileMax: 5})
    expect(allPass(rows)).toBe(false)
    expect(rows.filter((r) => !r.pass).map((r) => r.metric)).toEqual(['ratio luma', 'profile max'])
  })

  it('bounds each render\'s own luma, which a ratio can\'t: both washed out alike', () => {
    const washed = image(16, 16, () => [230, 225, 180])
    const rows = evaluateView('washed', measureView(washed, washed, view), {ratio: [0.95, 1.05], luma: [20, 150]})
    expect(rows.filter((r) => !r.pass).map((r) => r.metric)).toEqual(['luma on', 'luma off'])
    expect(allPass(evaluateView('fine', measureView(off, off, view), {luma: [20, 150]}))).toBe(true)
  })

  it('compares a region of the on render with a reference region of it', () => {
    // Top half sky-blue, bottom half ground-grey, in the on render; the off
    // render has sky over both (no terrain there).
    const on = image(16, 16, (x, y) => (y < 8 ? [60, 110, 200] : [180, 180, 175]))
    const offSky = image(16, 16, () => [60, 110, 200])
    const ridge = {region: {box: [0, 0, 1, 0.5]}, reference: {box: [0, 0.5, 1, 1]}, profile: null}
    const tol = {minPixels: 1, reference: {luma: [0.8, 1.2], blueRed: [0.8, 1.3]}}
    const sky = evaluateView('sky', measureView(on, offSky, ridge), tol)
    expect(sky.filter((r) => !r.pass).map((r) => r.metric)).toEqual(['ref luma', 'ref blue/red'])
    const ground = {...ridge, region: {box: [0, 0.5, 1, 0.75]}}
    expect(allPass(evaluateView('ground', measureView(on, offSky, ground), tol))).toBe(true)
  })

  it('fails a view that measured nothing', () => {
    const dark = image(16, 16, () => [0, 0, 0])
    const rows = evaluateView('empty', measureView(dark, dark, view), {ratio: [0.9, 1.1]})
    expect(allPass(rows)).toBe(false)
  })

  it('rejects images of different sizes', () => {
    expect(() => measureView(image(2, 2, () => [1, 1, 1]), image(3, 2, () => [1, 1, 1]), view)).toThrow()
  })
})


describe('changedPixels and the label check', () => {
  const plain = image(16, 16, () => [40, 40, 40])
  // Eight pixels a label drew.
  const labelled = image(16, 16, (x, y) => (y === 4 && x < 8 ? [250, 250, 250] : [40, 40, 40]))

  it('counts the pixels a frame gained, ignoring rounding', () => {
    expect(changedPixels(labelled, plain)).toBe(8)
    expect(changedPixels(plain, plain)).toBe(0)
    expect(changedPixels(scaled(plain, 1.1), plain)).toBe(0)
  })

  it('fails a view whose labels drew nothing (#172)', () => {
    const measure = (labelPixels) => ({...measureView(labelled, plain, {region: {box: [0, 0, 1, 1]}, profile: null}), labelPixels})
    const tol = {minPixels: 1, labelPixels: {min: 5}}
    expect(allPass(evaluateView('on', measure(changedPixels(labelled, plain)), tol))).toBe(true)
    const rows = evaluateView('hidden', measure(changedPixels(labelled, labelled)), tol)
    expect(rows.filter((r) => !r.pass).map((r) => r.metric)).toEqual(['label pixels'])
  })
})


describe('formatTable', () => {
  it('aligns a row per metric with PASS or FAIL', () => {
    const text = formatTable([
      {view: 'moon', metric: 'ratio luma', value: 1.0123, tolerance: '0.9 - 1.1', pass: true},
      {view: 'moon', metric: 'pixels', value: 5, tolerance: '>= 200', pass: false},
    ])
    const lines = text.split('\n')
    expect(lines).toHaveLength(4)
    expect(lines[0]).toMatch(/^view\s+metric\s+value\s+tolerance\s+result$/)
    expect(lines[2]).toContain('1.012')
    expect(lines[2]).toEndWith('PASS')
    expect(lines[3]).toEndWith('FAIL')
  })
})
