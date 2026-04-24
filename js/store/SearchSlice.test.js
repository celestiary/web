import {describe, expect, it} from 'bun:test'
import createSearchSlice, {anchorPathFor} from './SearchSlice.js'


/** Run a slice against a toy store emulator so transitions can be asserted. */
function makeSlice(extraInitial = {}) {
  let state = {...extraInitial}
  const set = (updater) => {
    const partial = typeof updater === 'function' ? updater(state) : updater
    state = {...state, ...partial}
  }
  const get = () => state
  state = {...state, ...createSearchSlice(set, get)}
  return {
    get state() {
      return state
    },
    call(name, ...args) {
      return state[name](...args)
    },
  }
}


describe('SearchSlice transitions', () => {
  it('setCommittedPath clears committedStar (mutually exclusive)', () => {
    const slice = makeSlice()
    slice.call('setCommittedStar', {hipId: 1, displayName: 'X', star: {}})
    expect(slice.state.committedStar).not.toBeNull()
    slice.call('setCommittedPath', ['sun', 'earth'])
    expect(slice.state.committedPath).toEqual(['sun', 'earth'])
    expect(slice.state.committedStar).toBeNull()
  })

  it('setCommittedStar clears committedPath (mutually exclusive)', () => {
    const slice = makeSlice()
    slice.call('setCommittedPath', ['sun'])
    slice.call('setCommittedStar', {hipId: 99, displayName: 'X', star: {}})
    expect(slice.state.committedStar.hipId).toBe(99)
    expect(slice.state.committedPath).toEqual([])
  })

  it('openSearch forces picking mode off and uses hoveredAnchorIndex', () => {
    const slice = makeSlice({isStarsSelectActive: true})
    slice.call('setHoveredAnchorIndex', 2)
    slice.call('openSearch')
    expect(slice.state.isSearchOpen).toBe(true)
    expect(slice.state.anchorIndex).toBe(2)
    expect(slice.state.hoveredAnchorIndex).toBeNull()
    expect(slice.state.isStarsSelectActive).toBe(false)
  })

  it('openSearch defaults anchorIndex to 0 when nothing hovered', () => {
    const slice = makeSlice()
    slice.call('openSearch')
    expect(slice.state.anchorIndex).toBe(0)
  })

  it('closeSearch clears transient state and picking mode', () => {
    const slice = makeSlice({isStarsSelectActive: true})
    slice.call('setSearchQuery', 'rigel')
    slice.call('setSearchSelection', {id: 'hip:24436'})
    slice.call('setPreviewPath', ['sun'])
    slice.call('openSearch')
    slice.call('closeSearch')
    expect(slice.state.isSearchOpen).toBe(false)
    expect(slice.state.searchQuery).toBe('')
    expect(slice.state.searchSelection).toBeNull()
    expect(slice.state.previewPath).toBeNull()
    expect(slice.state.previewStar).toBeNull()
    expect(slice.state.isStarsSelectActive).toBe(false)
  })

  it('setPreviewPath and setPreviewStar are mutually exclusive', () => {
    const slice = makeSlice()
    slice.call('setPreviewPath', ['sun', 'earth'])
    expect(slice.state.previewStar).toBeNull()
    slice.call('setPreviewStar', {hipId: 1, star: {}})
    expect(slice.state.previewPath).toBeNull()
  })

  it('clearPreview clears both preview fields', () => {
    const slice = makeSlice()
    slice.call('setPreviewStar', {hipId: 1, star: {}})
    slice.call('clearPreview')
    expect(slice.state.previewStar).toBeNull()
    expect(slice.state.previewPath).toBeNull()
  })
})


describe('anchorPathFor', () => {
  it('empty path returns milkyway root', () => {
    expect(anchorPathFor([], 0)).toBe('milkyway')
    expect(anchorPathFor([], 5)).toBe('milkyway')
  })

  it('anchorIndex 0 returns milkyway regardless of path', () => {
    expect(anchorPathFor(['sun', 'earth'], 0)).toBe('milkyway')
  })

  it('icon before element 1 scopes to first element as subtree root', () => {
    // Icon in front of Earth → anchorPath = Earth's parent's subtree = 'milkyway/sun'
    expect(anchorPathFor(['sun', 'earth', 'moon'], 1)).toBe('milkyway/sun')
  })

  it('icon before element 2 scopes to two-deep subtree', () => {
    // Icon in front of Moon → anchorPath = Moon's parent's subtree = 'milkyway/sun/earth'
    expect(anchorPathFor(['sun', 'earth', 'moon'], 2)).toBe('milkyway/sun/earth')
  })

  it('anchorIndex beyond path length clamps', () => {
    expect(anchorPathFor(['sun', 'earth'], 99)).toBe('milkyway/sun/earth')
  })
})
