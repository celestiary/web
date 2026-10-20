import {describe, expect, it} from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import {DATA, OUTPUT, ROOT_BODY, buildBundle, collectBodies, renderBundle} from './build.mjs'


const read = (name) => JSON.parse(fs.readFileSync(path.join(DATA, `${name}.json`), 'utf8'))


describe('collectBodies', () => {
  const tree = {
    a: {name: 'a', system: ['b', 'c']},
    b: {name: 'b', system: ['d']},
    c: {name: 'c'},
    d: {name: 'd', system: ['b']},
  }

  it('walks every system depth first, the root first, each body once', () => {
    expect(collectBodies((n) => tree[n], 'a').map(([n]) => n)).toEqual(['a', 'b', 'd', 'c'])
  })

  it('throws for a body that has no descriptor', () => {
    expect(() => collectBodies((n) => {
      if (!tree[n]) {
        throw new Error(`no ${n}`)
      }
      return n === 'c' ? {name: 'c', system: ['x']} : tree[n]
    }, 'a')).toThrow('no x')
  })

  it('writes a body to a line, as JSON', () => {
    const text = renderBundle(collectBodies((n) => tree[n], 'a'))
    expect(JSON.parse(text).bodies).toEqual(tree)
    expect(text.split('\n').filter((l) => l.startsWith('"c": '))).toEqual(['"c": {"name":"c"}'])
  })
})


describe('public/data/bodies.json', () => {
  it('is what the descriptors say (run `yarn bodies` after editing one)', () => {
    expect(fs.readFileSync(OUTPUT, 'utf8')).toBe(buildBundle())
  })

  it('holds every body under the Milky Way, as its own file has it', () => {
    const {bodies} = JSON.parse(fs.readFileSync(OUTPUT, 'utf8'))
    expect(Object.keys(bodies)[0]).toBe(ROOT_BODY)
    for (const name of ['stars', 'sun', 'earth', 'moon', 'saturn', 'titan', 'pluto', 'charon']) {
      expect(bodies[name], name).toEqual(read(name))
    }
    // Not the guide's demo scenes.
    expect(bodies['earth-as-moon']).toBeUndefined()
  })
})
