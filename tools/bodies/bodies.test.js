import {describe, expect, it} from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import {DATA, DIRS_OUTPUT, OUTPUT, ROOT_BODY, buildBundle, buildDirs, collectBodies, renderBundle} from './build.mjs'


const DIRS = JSON.parse(fs.readFileSync(DIRS_OUTPUT, 'utf8'))
const read = (name) => JSON.parse(fs.readFileSync(path.join(DATA, DIRS[name], 'index.json'), 'utf8'))


describe('collectBodies', () => {
  // By directory, as the tree has them: the planet a at the top, its moon
  // b and spacecraft c under it, b's moon d (a moon of a moon) under b's.
  const tree = {
    'a': {name: 'a', system: ['b', 'c']},
    'a/moons/b': {name: 'b', type: 'moon', system: ['d']},
    'a/spacecraft/c': {name: 'c', type: 'spacecraft'},
    'a/moons/b/moons/d': {name: 'd', type: 'moon', system: ['b']},
  }
  const read = (dir) => tree[dir] ?? null

  it('walks every system depth first, the root first, each body once, each in its directory', () => {
    expect(collectBodies(read, 'a').map(([n, , d]) => [n, d])).toEqual([
      ['a', 'a'], ['b', 'a/moons/b'], ['d', 'a/moons/b/moons/d'], ['c', 'a/spacecraft/c']])
  })

  it('keeps the Sun\'s children at the top, beside it', () => {
    const solar = {sun: {name: 'sun', system: ['p']}, p: {name: 'p', type: 'planet'}}
    expect(collectBodies((d) => solar[d] ?? null, 'sun').map(([, , d]) => d)).toEqual(['sun', 'p'])
  })

  it('throws for a body that has no descriptor, or one in the wrong directory', () => {
    expect(() => collectBodies((d) => (d === 'a' ? {name: 'a', system: ['x']} : null), 'a')).toThrow('no descriptor for x')
    const misfiled = {'a': {name: 'a', system: ['b']}, 'a/spacecraft/b': {name: 'b', type: 'moon'}}
    expect(() => collectBodies((d) => misfiled[d] ?? null, 'a')).toThrow('b is a moon, not in a/spacecraft/b')
  })

  it('writes a body to a line, as JSON', () => {
    const text = renderBundle(collectBodies(read, 'a'))
    expect(JSON.parse(text).bodies).toEqual(Object.fromEntries(Object.values(tree).map((o) => [o.name, o])))
    expect(text.split('\n').filter((l) => l.startsWith('"c": '))).toEqual(['"c": {"name":"c","type":"spacecraft"}'])
  })
})


describe('public/data/bodies.json', () => {
  it('is what the descriptors say (run `yarn bodies` after editing one)', () => {
    expect(fs.readFileSync(OUTPUT, 'utf8')).toBe(buildBundle())
  })

  it('and js/bodyDirs.json is where they are', () => {
    expect(fs.readFileSync(DIRS_OUTPUT, 'utf8')).toBe(buildDirs())
    expect(DIRS).toMatchObject({earth: 'earth', moon: 'earth/moons/moon', webb: 'earth/spacecraft/webb',
      charon: 'pluto/moons/charon', sun: 'sun', milkyway: 'milkyway'})
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
