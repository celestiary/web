import fs from 'node:fs'
import path from 'node:path'
import {CHANGELOG, OUTPUT, STAMP, renderJson, renderStamp} from './json.mjs'
import {checkOrder, headingOfMonth, parseChangelog} from './parse.mjs'
import {decodePermalink} from '../../js/permalink.js'


// The real CHANGELOG.md and the JSON built from it (tools/changelog/README.md).
const markdown = fs.readFileSync(CHANGELOG, 'utf8')
const {entries, notes} = parseChangelog(markdown)
const PUBLIC = path.join(path.dirname(OUTPUT), '..')
const PATH_ONLY = /^#[a-z0-9:_./-]+$/
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']


describe('CHANGELOG.md', () => {
  it('has entries, newest first, with unique ids', () => {
    expect(entries.length).toBeGreaterThan(0)
    expect(checkOrder(entries)).toEqual([])
  })

  it('has each month once, newest first, and each entry under its own month', () => {
    const months = [...markdown.matchAll(/^## (.*)$/gm)].map((m) => m[1])
    expect(new Set(months).size).toBe(months.length)
    const headings = [...new Set(entries.map((e) => headingOfMonth(e.month)))]
    expect(headings.every((h) => months.includes(h))).toBe(true)
    const sorted = [...months].sort((a, b) => {
      const ma = headingToKey(a)
      const mb = headingToKey(b)
      return ma < mb ? 1 : ma > mb ? -1 : 0
    })
    expect(months).toEqual(sorted)
  })

  it('links a PR for every entry, and says something in each month\'s note', () => {
    for (const e of entries) {
      expect(e.links.some((l) => l.kind === 'pr')).toBe(true)
    }
    for (const n of notes) {
      expect(n.text.length).toBeGreaterThan(0)
    }
  })

  it('has permalinks the app can restore', () => {
    for (const e of entries.filter((x) => x.permalink)) {
      const fragment = e.permalink.slice(1)
      if (fragment.includes('@')) {
        expect(decodePermalink(fragment), `${e.headline}: ${e.permalink}`).not.toBeNull()
      } else {
        expect(e.permalink, e.headline).toMatch(PATH_ONLY)
      }
    }
  })

  it('has images that exist', () => {
    for (const e of entries.filter((x) => x.image)) {
      expect(fs.existsSync(path.join(PUBLIC, e.image.src)), `${e.headline}: ${e.image.src}`).toBe(true)
    }
  })

  it('keeps its entries short enough to read in a feed', () => {
    for (const e of entries) {
      expect(e.headline.length, e.headline).toBeLessThan(100)
      expect(e.text.length, e.headline).toBeLessThan(800)
    }
  })
})


describe('public/data/changelog.json', () => {
  it('is what CHANGELOG.md says (run `yarn changelog` after editing it)', () => {
    expect(fs.existsSync(OUTPUT)).toBe(true)
    expect(fs.readFileSync(OUTPUT, 'utf8')).toBe(renderJson(markdown))
  })
})


describe('js/changelogStamp.json', () => {
  it('is what CHANGELOG.md says (run `yarn changelog` after editing it)', () => {
    expect(fs.readFileSync(STAMP, 'utf8')).toBe(renderStamp(markdown))
  })

  it('counts the entries of each date, newest first, and is small', () => {
    const {dates} = JSON.parse(fs.readFileSync(STAMP, 'utf8'))
    expect(dates.reduce((n, [, count]) => n + count, 0)).toBe(entries.length)
    expect(dates[0][0]).toBe(entries.map((e) => e.date).sort().pop())
    expect(dates.map(([d]) => d)).toEqual([...new Set(entries.map((e) => e.date))].sort().reverse())
    expect(fs.statSync(STAMP).size).toBeLessThan(2000)
  })
})


/**
 * @param {string} heading "October 2026"
 * @returns {string} "2026-10"
 */
function headingToKey(heading) {
  const [name, year] = heading.split(' ')
  const index = MONTHS.indexOf(name)
  return `${year}-${String(index + 1).padStart(2, '0')}`
}
