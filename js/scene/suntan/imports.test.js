import {describe, expect, it} from 'bun:test'
import {readFileSync, readdirSync} from 'fs'
import {join} from 'path'


// The Suntan feature is a dynamic import (Scene.getSuntan), and imports
// nothing of the first load's but three: Scene hands the rest in
// (install.js).  A first-load module imported here too is split by esbuild
// into a chunk of its own, a request more on every page's load: bodyLine.js
// did that once, and CI's homepage load went over its request budget.
const DIR = 'js/scene/suntan'
// Outside the feature but not in the first load either, so a split of them
// is between lazy chunks: the Lambert solver (craft/transfer.js loads it too).
const LAZY = new Set(['../craft/lambert.js'])


describe('the Suntan feature\'s imports', () => {
  it('are three, its own modules and lazy ones only', () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
    expect(files.length).toBeGreaterThan(3)
    for (const f of files) {
      const src = readFileSync(join(DIR, f), 'utf8')
      const specs = [...src.matchAll(/^import\s[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1])
      for (const spec of specs) {
        const ok = spec === 'three' || (/^\.\/[^/]+$/).test(spec) || LAZY.has(spec)
        if (!ok) {
          throw new Error(`${f} imports ${spec}: hand it in from Scene.getSuntan instead`)
        }
      }
    }
  })
})
