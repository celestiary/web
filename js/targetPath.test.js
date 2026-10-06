import {describe, expect, it} from 'bun:test'
import {parseTargetPath, resolvePlace, slug, targetFramePath, targetPath} from './targetPath.js'
import {decodePermalink, encodePermalink, pathFromFragment} from './permalink.js'


const PATHS = {sun: 'sun', earth: 'sun/earth', moon: 'sun/earth/moon', mars: 'sun/mars'}
const bodyPath = (name) => PATHS[name] ?? null

// The loader's descriptors, as far as resolvePlace reads them.
const LOADED = {
  sun: {system: ['mercury', 'venus', 'earth', 'mars']},
  earth: {system: ['moon'], has_locations: true},
  moon: {has_locations: true},
  mars: {system: ['phobos', 'deimos'], has_locations: true},
  jupiter: {system: ['io']},
}

const STAR = {hipId: 32349, x: 1, y: 2, z: 3}
const TARGETS = {
  body: {kind: 'body', name: 'moon'},
  place: {kind: 'place', body: 'earth', name: 'Austin', lat: 30.27, lng: -97.74},
  spacedPlace: {kind: 'place', body: 'moon', name: 'Apollo 11', lat: 0.67, lng: 23.47},
  star: {kind: 'star', star: STAR, name: 'Sirius'},
  asterism: {kind: 'asterism', name: 'Ursa Major', position: {x: 0, y: 0, z: 1}},
}


/**
 * A target's path, parsed and resolved as a link's is (Celestiary._navigate).
 *
 * @param {string} path
 * @returns {object}
 */
function resolve(path) {
  const ref = parseTargetPath(path)
  return ref.kind === 'bodies' ? resolvePlace(ref.parts, LOADED) : ref
}


describe('targetPath', () => {
  it('names each kind of target', () => {
    expect(targetPath(TARGETS.body, bodyPath)).toBe('sun/earth/moon')
    expect(targetPath(TARGETS.place, bodyPath)).toBe('sun/earth/austin')
    expect(targetPath(TARGETS.spacedPlace, bodyPath)).toBe('sun/earth/moon/apollo-11')
    expect(targetPath(TARGETS.star, bodyPath)).toBe('hip:32349')
    expect(targetPath(TARGETS.asterism, bodyPath)).toBe('asterism:ursa-major')
  })

  it('has no path for a body the loader has not placed, or no target', () => {
    expect(targetPath({kind: 'body', name: 'vulcan'}, bodyPath)).toBe(null)
    expect(targetPath({kind: 'place', body: 'vulcan', name: 'X'}, bodyPath)).toBe(null)
    expect(targetPath(null, bodyPath)).toBe(null)
  })

  it('gives the frame a camera near the target would be in', () => {
    expect(targetFramePath(TARGETS.body, bodyPath)).toBe('sun/earth/moon')
    expect(targetFramePath(TARGETS.place, bodyPath)).toBe('sun/earth')
    expect(targetFramePath(TARGETS.star, bodyPath)).toBe('hip:32349')
    expect(targetFramePath(TARGETS.asterism, bodyPath)).toBe(null)
  })
})


describe('parseTargetPath and resolvePlace', () => {
  it('round-trips every kind', () => {
    expect(resolve(targetPath(TARGETS.body, bodyPath)))
        .toEqual({kind: 'body', path: 'sun/earth/moon', name: 'moon'})
    expect(resolve(targetPath(TARGETS.place, bodyPath)))
        .toEqual({kind: 'place', path: 'sun/earth', body: 'earth', slug: 'austin'})
    expect(resolve(targetPath(TARGETS.spacedPlace, bodyPath)))
        .toEqual({kind: 'place', path: 'sun/earth/moon', body: 'moon', slug: 'apollo-11'})
    expect(resolve(targetPath(TARGETS.star, bodyPath))).toEqual({kind: 'star', hipId: 32349})
    expect(resolve(targetPath(TARGETS.asterism, bodyPath))).toEqual({kind: 'asterism', slug: 'ursa-major'})
  })

  it('keeps old body paths bodies: a body in its parent\'s system wins over a place', () => {
    expect(resolve('sun')).toEqual({kind: 'body', path: 'sun', name: 'sun'})
    expect(resolve('sun/earth')).toEqual({kind: 'body', path: 'sun/earth', name: 'earth'})
    expect(resolve('sun/mars/phobos')).toEqual({kind: 'body', path: 'sun/mars/phobos', name: 'phobos'})
    // Under a body with no places, an unknown name is still a body (for the
    // loader to fail on), not a place.
    expect(resolve('sun/jupiter/europa')).toEqual({kind: 'body', path: 'sun/jupiter/europa', name: 'europa'})
  })

  it('waits for the body above the last segment', () => {
    expect(resolvePlace(['sun', 'saturn', 'titan'], LOADED)).toBe(null)
  })

  it('rejects malformed paths', () => {
    expect(parseTargetPath('')).toBe(null)
    expect(parseTargetPath('sun//earth')).toBe(null)
    expect(parseTargetPath('hip:12x')).toBe(null)
    expect(parseTargetPath('hip:')).toBe(null)
    expect(parseTargetPath('asterism:')).toBe(null)
    expect(parseTargetPath('sun/hip:1')).toBe(null)
  })

  it('slugs names as the places\' search ids do', () => {
    expect(slug('Apollo 11')).toBe('apollo-11')
    expect(slug('  São Paulo ')).toBe('sao-paulo')
    expect(slug('Mare Tranquillitatis')).toBe('mare-tranquillitatis')
  })
})


describe('the target in a link', () => {
  const VIEW = [9233.1, 30.2638, -97.7526, 400000, {x: 0.1, y: 0.2, z: 0.3, w: 0.9}, 30]

  it('a place on the camera\'s body: its path, no from', () => {
    const path = targetPath(TARGETS.place, bodyPath)
    // The camera's frame is the place's body: no from (Celestiary.permalink).
    expect(targetFramePath(TARGETS.place, bodyPath)).toBe('sun/earth')
    const frag = encodePermalink(path, ...VIEW, undefined, undefined, null)
    expect(frag.startsWith('sun/earth/austin@30.2638,-97.7526,400km;t=')).toBe(true)
    const pl = decodePermalink(frag)
    expect(pl.path).toBe('sun/earth/austin')
    expect(pl.from).toBe(null)
    expect(pathFromFragment(frag)).toBe('sun/earth/austin')
  })

  it('a star or a body elsewhere: its path, and from= the camera\'s frame', () => {
    for (const [target, path] of [[TARGETS.star, 'hip:32349'], [{kind: 'body', name: 'mars'}, 'sun/mars'],
      [TARGETS.asterism, 'asterism:ursa-major']]) {
      const frag = encodePermalink(targetPath(target, bodyPath), ...VIEW, undefined, undefined, 'sun/earth')
      expect(frag.startsWith(`${path}@30.2638,-97.7526,400km;from=sun/earth;t=`)).toBe(true)
      const pl = decodePermalink(frag)
      expect(pl.path).toBe(path)
      expect(pl.from).toBe('sun/earth')
      expect(pl.lat).toBe(30.2638)
    }
  })

  it('a camera at a star', () => {
    const pl = decodePermalink(encodePermalink('sun/earth', ...VIEW, undefined, undefined, 'hip:32349'))
    expect(pl.from).toBe('hip:32349')
  })
})
