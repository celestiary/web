import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {estimates, findTestFiles, median, parseCounts, parseShard, partition, selectFiles} from './plan.mjs'


const ROOT = path.join(import.meta.dir, '..', '..')


describe('finding the test files', () => {
  it('takes what bun test takes, and skips node_modules, docs and dot-directories', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-test-'))
    try {
      const touch = (rel) => {
        fs.mkdirSync(path.dirname(path.join(dir, rel)), {recursive: true})
        fs.writeFileSync(path.join(dir, rel), '')
      }
      for (const rel of ['a.test.js', 'js/b.spec.ts', 'js/ui/c.test.jsx', 'tools/d_test.mjs', 'e.test.js.txt', 'js/notatest.js',
        'node_modules/x/f.test.js', 'docs/g.test.js', '.claude/worktrees/h.test.js', '.hidden/i.test.js']) {
        touch(rel)
      }
      expect(findTestFiles(dir)).toEqual(['a.test.js', 'js/b.spec.ts', 'js/ui/c.test.jsx', 'tools/d_test.mjs'])
    } finally {
      fs.rmSync(dir, {recursive: true})
    }
  })

  it('finds this file in the repository', () => {
    expect(findTestFiles(ROOT)).toContain('tools/test/plan.test.js')
  })

  it('picks by substring as bun does, tolerating a leading ./', () => {
    const files = ['js/Keys.test.js', 'js/scene/Scene.test.js', 'js/scene/Planet.test.js']
    expect(selectFiles(files, [])).toEqual(files)
    expect(selectFiles(files, ['./js/Keys.test.js'])).toEqual(['js/Keys.test.js'])
    expect(selectFiles(files, ['scene/', 'Keys'])).toEqual(files)
    expect(selectFiles(files, ['nothing'])).toEqual([])
  })
})


describe('estimating', () => {
  it('has the median of an odd and an even count, and 1 for none', () => {
    expect(median([5, 1, 3])).toBe(3)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(median([])).toBe(1)
  })

  it('takes a file the timings lack as the median of those they have', () => {
    const seconds = estimates(['a', 'b', 'c', 'new'], {a: 1, b: 9, c: 3, gone: 100})
    expect([...seconds]).toEqual([['a', 1], ['b', 9], ['c', 3], ['new', 3]])
  })
})


describe('partitioning', () => {
  const seconds = new Map(Object.entries({a: 9, b: 5, c: 4, d: 3, e: 3, f: 2, g: 1}))
  const files = [...seconds.keys()]
  const load = (bin) => bin.reduce((n, f) => n + seconds.get(f), 0)

  it('puts every file in exactly one bin', () => {
    for (const count of [1, 2, 3, 4, 10]) {
      const bins = partition(files, seconds, count)
      expect(bins.length).toBe(count)
      expect(bins.flat().sort()).toEqual(files)
    }
  })

  it('gives each file, longest first, to the lightest bin', () => {
    const bins = partition(files, seconds, 3)
    expect(bins).toEqual([['a'], ['b', 'e', 'g'], ['c', 'd', 'f']])
    expect(bins.map(load)).toEqual([9, 9, 9])
  })

  it('splits the same whatever order the files come in', () => {
    expect(partition([...files].reverse(), seconds, 3)).toEqual(partition(files, seconds, 3))
  })

  it('splits this repository\'s files into shards that cover them all, and are not lopsided', () => {
    const all = findTestFiles(ROOT)
    const secs = estimates(all, JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/test/timings.json'), 'utf8')).files)
    for (const count of [2, 3, 4]) {
      const bins = partition(all, secs, count)
      expect(bins.flat().sort()).toEqual(all)
      const loads = bins.map((bin) => bin.reduce((n, f) => n + secs.get(f), 0))
      // One file (Celestiary.test.js, 29 s) is a fifth of the total, so the
      // shards can't be closer than that.
      expect(Math.max(...loads) - Math.min(...loads)).toBeLessThan(Math.max(...secs.values()))
    }
  })
})


describe('the command line and the output', () => {
  it('reads --shard as 1-based i/n', () => {
    expect(parseShard('2/3')).toEqual({index: 2, count: 3})
    for (const bad of ['0/3', '4/3', '1/0', '1', 'a/b', '1/2/3']) {
      expect(() => parseShard(bad)).toThrow('--shard')
    }
  })

  it('reads the counts off the end of bun test\'s output', () => {
    const out = 'js/a.test.js:\n(pass) x [1ms]\n\n 12 pass\n 1 todo\n 2 fail\n 30 expect() calls\nRan 15 tests across 1 file. [9.00ms]\n'
    expect(parseCounts(out)).toEqual({pass: 12, fail: 2, todo: 1, skip: 0, tests: 15})
    expect(parseCounts('error: nothing')).toEqual({pass: 0, fail: 0, todo: 0, skip: 0, tests: 0})
  })
})
