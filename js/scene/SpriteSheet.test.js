import {describe, expect, it} from 'bun:test'

// SpriteSheet reaches for document.* (a hidden canvas): stub the canvas APIs
// it touches, each label measuring the width its text's length gives.
global.document = global.document ?? {
  createElement: () => ({
    setAttribute: () => {},
    getContext: () => ({
      fillStyle: '',
      font: '',
      textBaseline: '',
      fillRect: () => {},
      fill: () => {},
      fillText: () => {},
      save: () => {},
      restore: () => {},
      translate: () => {},
      measureText: (text) => ({width: 6 * text.length, actualBoundingBoxAscent: 10, actualBoundingBoxDescent: 2}),
    }),
    width: 0,
    height: 0,
  }),
  body: {appendChild: () => {}},
}

// The real class, by a name the process-global mock of './scene/SpriteSheet'
// in Celestiary.test.js doesn't take (the query makes it its own module).
const realSpecifier = './SpriteSheet.js?real'
const SpriteSheet = (await import(realSpecifier)).default


describe('SpriteSheet.sideToPack', () => {
  it('is the smallest side the cells fit in, laid out in rows in the order given', () => {
    expect(SpriteSheet.sideToPack([])).toBe(1)
    expect(SpriteSheet.sideToPack([10])).toBe(10)
    // Four 10 px cells: a 20 px square holds them in two rows of two (and a
    // pixel between rows is spent: 21 high, so 21 wide).
    const side = SpriteSheet.sideToPack([10, 10, 10, 10])
    expect(side).toBeGreaterThanOrEqual(21)
    expect(side).toBeLessThan(25)
  })

  it('fits a mixed lot, in every order, and far smaller than the longest label would give', () => {
    const cells = Array.from({length: 200}, (_, i) => 20 + ((i * 37) % 90))
    const longest = Math.max(...cells)
    for (const order of [cells, [...cells].sort((a, b) => b - a), [...cells].sort((a, b) => a - b)]) {
      const side = SpriteSheet.sideToPack(order)
      let x = 0
      let y = 0
      let rowH = 0
      for (const c of order) {
        if (x + c > side) {
          x = 0
          y += rowH + 1
          rowH = 0
        }
        x += c
        rowH = Math.max(rowH, c)
      }
      expect(y + rowH).toBeLessThanOrEqual(side)
      expect(side).toBeLessThan(Math.sqrt(order.length) * longest)
    }
  })
})


describe('SpriteSheet sized from its labels', () => {
  it('takes the canvas side from the labels given, which all fit', () => {
    const names = ['Mare Imbrium', 'Tycho', 'Plato', 'Kepler', 'Copernicus', 'Aristarchus']
    const byList = new SpriteSheet(names.length, names)
    for (const n of names) {
      byList.add(0, 0, 0, n)
    }
    expect(byList.labelCount).toBe(names.length)
    // The cells the labels took (the longer side of each text's box).
    const cells = names.map((_, i) => byList.sizes[2 * i])
    expect(byList.size).toBe(SpriteSheet.sideToPack(cells))
    expect(byList.size).toBeGreaterThanOrEqual(Math.max(...cells))
  })
})


describe('SpriteSheet.setShown', () => {
  it('starts every label shown, and flips one in the geometry\'s attribute, reporting a change', () => {
    const sheet = new SpriteSheet(3, 'Tycho')
    for (const n of ['a', 'b', 'c']) {
      sheet.add(0, 0, 0, n)
    }
    const points = sheet.compile()
    const shown = points.geometry.getAttribute('shown')
    expect(Array.from(shown.array)).toEqual([1, 1, 1])
    expect(sheet.setShown(1, false)).toBe(true)
    expect(Array.from(shown.array)).toEqual([1, 0, 1])
    expect(sheet.setShown(1, false)).toBe(false) // no change, no upload
    expect(sheet.setShown(1, true)).toBe(true)
    expect(Array.from(shown.array)).toEqual([1, 1, 1])
    expect(sheet.shown).toEqual([1, 1, 1])
  })

  it('works before it is compiled', () => {
    const sheet = new SpriteSheet(2, 'Tycho')
    sheet.add(0, 0, 0, 'a')
    sheet.add(0, 0, 0, 'b')
    expect(sheet.setShown(0, false)).toBe(true)
    const shown = sheet.compile().geometry.getAttribute('shown')
    expect(Array.from(shown.array)).toEqual([0, 1])
  })
})
