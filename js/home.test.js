import {describe, expect, it} from 'bun:test'
import {existsSync, statSync} from 'node:fs'
import {HOME_CARDS, HOME_HISTORY_KEY, cardImage, isHomeEntry, isHomepage} from './home.js'
import {decodePermalink, pathFromFragment} from './permalink.js'
import {parseTargetPath} from './targetPath.js'


describe('the homepage decision', () => {
  const ROOT = 'https://celestiary.github.io/'
  const PROJECT = 'https://celestiary.github.io/web/'
  const PREVIEW = 'https://celestiary.github.io/web/pr-preview/pr-241/'

  it('shows at the bare URL: no fragment, the site\'s root', () => {
    expect(isHomepage({hash: '', pathname: '/'}, ROOT)).toBe(true)
    expect(isHomepage({hash: '', pathname: '/web/'}, PROJECT)).toBe(true)
    expect(isHomepage({hash: '', pathname: '/web'}, PROJECT)).toBe(true)
    expect(isHomepage({hash: '', pathname: '/web/index.html'}, PROJECT)).toBe(true)
    expect(isHomepage({hash: '', pathname: '/web/pr-preview/pr-241/'}, PREVIEW)).toBe(true)
  })

  it('an empty fragment is the bare URL too', () => {
    expect(isHomepage({hash: '#', pathname: '/'}, ROOT)).toBe(true)
  })

  it('a query string doesn\'t count: ?perf=1 still shows it', () => {
    // location.pathname has no query; the query is location.search.
    expect(isHomepage({hash: '', pathname: '/web/', search: '?perf=1'}, PROJECT)).toBe(true)
  })

  it('a permalink goes to its scene', () => {
    expect(isHomepage({hash: '#sun/earth@0,0,1Mm;t=0jd;cq=0,0,0,1;fov=45deg', pathname: '/web/'}, PROJECT))
        .toBe(false)
  })

  it('a path alone goes to its target', () => {
    expect(isHomepage({hash: '#sun', pathname: '/'}, ROOT)).toBe(false)
    expect(isHomepage({hash: '#hip:32349', pathname: '/'}, ROOT)).toBe(false)
  })

  it('a route is not the homepage', () => {
    expect(isHomepage({hash: '', pathname: '/settings'}, ROOT)).toBe(false)
    expect(isHomepage({hash: '', pathname: '/web/about'}, PROJECT)).toBe(false)
    expect(isHomepage({hash: '', pathname: '/web/guide/star'}, PROJECT)).toBe(false)
  })

  it('without a path to read (a test\'s location), not the homepage', () => {
    expect(isHomepage({hash: ''}, ROOT)).toBe(false)
    expect(isHomepage(null, ROOT)).toBe(false)
  })

  it('with no base (a test\'s document), the root', () => {
    expect(isHomepage({hash: '', pathname: '/'})).toBe(true)
    expect(isHomepage({hash: '', pathname: '/web/'})).toBe(false)
  })

  it('the homepage\'s history entry is marked', () => {
    expect(isHomeEntry({[HOME_HISTORY_KEY]: true})).toBe(true)
    expect(isHomeEntry({other: 1})).toBe(false)
    expect(isHomeEntry(null)).toBe(false)
    expect(isHomeEntry(undefined)).toBe(false)
  })
})


describe('the homepage\'s cards', () => {
  it('are tonight\'s sky first, then Earth, the occultation and Gaia\'s stars', () => {
    expect(HOME_CARDS.map((c) => c.id)).toEqual(['tonight', 'earth', 'occultation', 'gaia'])
    // Tonight's sky isn't a link: it's the visitor's.
    expect(HOME_CARDS[0].link).toBe(null)
  })

  it('each link is a whole view: a link restores its time and camera only with them', () => {
    for (const card of HOME_CARDS.filter((c) => c.link)) {
      const pl = decodePermalink(card.link)
      expect(pl).not.toBeNull()
      expect(parseTargetPath(pathFromFragment(card.link))?.kind).toBe('bodies')
      expect(card.title.length).toBeGreaterThan(0)
      expect(card.text.length).toBeGreaterThan(0)
    }
  })

  it('the occultation and Gaia cards are the views from testing (#192)', () => {
    expect(HOME_CARDS[2].link).toBe(
        'sun/jupiter@41.2054,-82.3901,169m;from=sun/earth;t=9774.891jd;cq=0.3372,-0.7003,-0.112,0.6191;fov=0.91deg;s=oL')
    expect(HOME_CARDS[3].link).toBe(
        'sun/earth@43.3389,-9.9593,30373373.021376Tm;t=9779.5692jd;cq=-0.436,0.7975,0.0666,0.4116;fov=45deg;ev=1.33;s=alovTF')
  })

  it('the Earth card is near enough to show it whole, from celestiary\'s own Earth', () => {
    const pl = decodePermalink(HOME_CARDS[1].link)
    // Over the ground by 1 to 3 radii: the disc and its limb in a 45° field.
    expect(pl.alt).toBeGreaterThan(6.4e6)
    expect(pl.alt).toBeLessThan(2e7)
    expect(pl.fov).toBe(45)
  })

  it('each has its image, small enough to be in the repository', () => {
    expect(cardImage('earth')).toBe('images/home/earth.webp')
    for (const card of HOME_CARDS) {
      const file = `public/${cardImage(card.id)}`
      expect(existsSync(file)).toBe(true)
      expect(statSync(file).size).toBeLessThan(150000)
    }
  })
})
