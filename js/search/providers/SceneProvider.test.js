import {afterEach, describe, expect, it} from 'bun:test'
import SearchIndex from '../SearchIndex.js'
import * as SearchRegistry from '../SearchRegistry.js'
import SceneProvider from './SceneProvider.js'
import bundle from '../../../public/data/bodies.json'


describe('SceneProvider', () => {
  afterEach(() => SearchRegistry._reset())

  const loader = {loaded: structuredClone(bundle.bodies), loadObj: () => {}}

  it('indexes a spacecraft as a body, under its parent', () => {
    const webb = new SceneProvider(loader).collectAll().find((e) => e.id === 'webb')
    expect(webb).toBeDefined()
    expect(webb.kind).toBe('spacecraft')
    expect(webb.displayName).toBe('Webb')
    expect(webb.path).toBe('milkyway/sun/earth/webb')
    expect(webb.aliases).toContain('jwst')
  })

  it('finds Webb by "JWST" and by its full name', async () => {
    const idx = new SearchIndex()
    idx.register(new SceneProvider(loader))
    await idx.ensureReady()
    expect(idx.query('JWST')[0]?.entry.id).toBe('webb')
    expect(idx.query('james webb')[0]?.entry.id).toBe('webb')
  })
})
