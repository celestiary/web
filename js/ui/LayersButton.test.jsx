import {describe, expect, it} from 'bun:test'
import createCache from '@emotion/cache'
import {CacheProvider} from '@emotion/react'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {NEW_YORK_LABEL, NewYorkToggle, newYorkControl} from './LayersButton.jsx'


/**
 * MUI's markup, with an Emotion cache of its own: in the whole run another
 * file's stub `document` (Celestiary.test.js) makes Emotion take the page for
 * a browser with no default cache, and a cache keyed 'css' would read the
 * stub's styles.  The container takes nothing: styles insert in effects,
 * which a server render doesn't run.
 *
 * @param {React.ReactElement} element
 * @returns {string}
 */
function markup(element) {
  const cache = createCache({key: 'nyctest', container: {insertBefore: () => {}, appendChild: () => {}}})
  return renderToStaticMarkup(<CacheProvider value={cache}>{element}</CacheProvider>)
}


describe('the New York toggle', () => {
  const state = (extra) => ({newYorkNear: true, newYorkOn: false, newYorkStatus: null, ...extra})

  it('is offered only where the city can show: Earth\'s Cesium layer active, in the city\'s range', () => {
    expect(newYorkControl(state({newYorkNear: false}))).toBe(null)
    expect(newYorkControl(state({newYorkNear: false, newYorkOn: true}))).toBe(null)
    expect(newYorkControl(state())).not.toBe(null)
  })

  it('is off by default, its caption the cost', () => {
    const c = newYorkControl(state())
    expect(c).toEqual({checked: false, loading: false, error: false, caption: 'Manhattan\'s buildings, about 140 MB'})
    const html = markup(<NewYorkToggle control={c} onChange={() => {}}/>)
    expect(html).toContain(NEW_YORK_LABEL)
    expect(html).toContain(`aria-label="${NEW_YORK_LABEL}"`)
    expect(html).toContain('type="checkbox"')
    expect(html).not.toContain('checked=""')
    expect(html).toContain('about 140 MB')
    expect(html).not.toContain('MuiCircularProgress')
  })

  it('shows a spinner and says so while the city builds', () => {
    const c = newYorkControl(state({newYorkOn: true, newYorkStatus: 'loading'}))
    expect(c.loading).toBe(true)
    const html = markup(<NewYorkToggle control={c} onChange={() => {}}/>)
    expect(html).toContain('checked=""')
    expect(html).toContain('MuiCircularProgress')
    expect(html).toContain('role="status"')
    expect(html).toContain('Building the city…')
  })

  it('says when the city is in, or couldn\'t load', () => {
    expect(newYorkControl(state({newYorkOn: true, newYorkStatus: 'ready'})).caption).toContain('Slop New York')
    const failed = newYorkControl(state({newYorkOn: true, newYorkStatus: 'error'}))
    expect(failed.error).toBe(true)
    expect(failed.caption).toBe('The city couldn\'t load')
    // Off again, the old state is no longer shown.
    expect(newYorkControl(state({newYorkOn: false, newYorkStatus: 'error'})).error).toBe(false)
  })
})
