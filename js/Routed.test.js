import {describe, expect, it} from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'


const JS_DIR = import.meta.dir


/**
 * @param {string} dir
 * @returns {string[]} The .jsx and .tsx files under dir
 */
function componentFiles(dir) {
  const out = []
  for (const ent of fs.readdirSync(dir, {withFileTypes: true})) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      out.push(...componentFiles(p))
    } else if (/\.[jt]sx$/.test(ent.name)) {
      out.push(p)
    }
  }
  return out
}


// A React.lazy() made inside a component is a new component type on each
// render, and a new lazy type suspends on its first render even when its
// module is loaded: its Suspense boundary hides everything under it until
// the import's promise settles.  Routed made App's lazy in its body, so
// every path change (the Settings and About dialogs) blanked the whole page
// for a frame or more.  There's no DOM in bun to render that, so this reads
// the sources: every lazy() is at module scope, unindented.
describe('React.lazy components', () => {
  it('are made once, at module scope', () => {
    const inBodies = []
    for (const file of componentFiles(JS_DIR)) {
      fs.readFileSync(file, 'utf8').split('\n').forEach((line, ndx) => {
        if (/\blazy\(/.test(line) && !/^\s*\/\//.test(line) && /^\s/.test(line)) {
          inBodies.push(`${path.relative(JS_DIR, file)}:${ndx + 1}: ${line.trim()}`)
        }
      })
    }
    expect(inBodies).toEqual([])
  })

  it('include the app and the guide, in Routed', () => {
    const src = fs.readFileSync(path.join(JS_DIR, 'Routed.jsx'), 'utf8')
    expect(src).toMatch(/^const App = lazy\(/m)
    expect(src).toMatch(/^const Guide = lazy\(/m)
  })
})
