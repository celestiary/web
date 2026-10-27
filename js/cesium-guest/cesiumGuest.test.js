import {describe, expect, it} from 'bun:test'
import {MAX_CREDITS, creditsOf, sanitizeCredits} from './credits.js'
import {CESIUM_GUEST_HOSTS, DEFAULT_GUEST_PAGE, dataBase, guestOptions, guestPage} from './origins.js'
import {hostOrigin} from '../layer/origins.js'


describe('the guest page celestiary loads', () => {
  it('is none without ?cesium=iframe', () => {
    expect(guestOptions('')).toBe(null)
    expect(guestOptions('?cesiumGuest=http://localhost:5491/')).toBe(null)
  })

  it('is the fork\'s Pages by default', () => {
    expect(guestOptions('?cesium=iframe').href).toBe(DEFAULT_GUEST_PAGE)
  })

  it('is another copy only on an allowed origin, the page named or the directory\'s', () => {
    expect(guestOptions('?cesium=iframe&cesiumGuest=http://localhost:5491/').href)
        .toBe('http://localhost:5491/cesium-guest.html')
    expect(guestPage('http://127.0.0.1:8080/x/cesium-guest.html?a=1').href).toBe('http://127.0.0.1:8080/x/cesium-guest.html?a=1')
    const warn = console.warn
    console.warn = () => {}
    try {
      expect(guestOptions('?cesium=iframe&cesiumGuest=https://evil.example/').href).toBe(DEFAULT_GUEST_PAGE)
    } finally {
      console.warn = warn
    }
    expect(guestPage('https://celestiary.org/web/pr-preview/pr-1/cesium-guest.html').href)
        .toBe('https://celestiary.org/web/pr-preview/pr-1/cesium-guest.html')
    expect(guestPage('https://pablo-mayrgundter.github.io/cesium-portal/pr-preview/pr-310/').href)
        .toBe('https://pablo-mayrgundter.github.io/cesium-portal/pr-preview/pr-310/cesium-guest.html')
    expect(guestPage('https://cesium.celestiary.org/cesium-guest.html')).toBe(null)
    expect(guestPage('https://evil.example/cesium-guest.html')).toBe(null)
    expect(guestPage('javascript:alert(1)')).toBe(null)
    expect(guestPage('not a url')).toBe(null)
  })
})


describe('the guest\'s host and data', () => {
  it('takes its host only from the allow-list', () => {
    expect(hostOrigin({ancestors: ['https://celestiary.org']}, CESIUM_GUEST_HOSTS)).toBe('https://celestiary.org')
    expect(hostOrigin({ancestors: ['https://pablo-mayrgundter.github.io']}, CESIUM_GUEST_HOSTS)).toBe(null)
    expect(hostOrigin({search: '?host=http://127.0.0.1:5490'}, CESIUM_GUEST_HOSTS)).toBe('http://127.0.0.1:5490')
  })

  it('fetches data only from an allowed host', () => {
    expect(dataBase('https://celestiary.org/')).toBe('https://celestiary.org/')
    expect(dataBase('http://127.0.0.1:5490/')).toBe('http://127.0.0.1:5490/')
    expect(dataBase('https://evil.example/')).toBe(null)
    expect(dataBase(null)).toBe(null)
    expect(dataBase('nonsense')).toBe(null)
  })
})


describe('credits across the iframe', () => {
  // A credit container as Cesium fills it, as far as creditsOf reads it.
  const el = (tagName, props = {}, children = []) => ({
    tagName, children, ...props,
    get textContent() {
      return props.text ?? children.map((c) => c.textContent).join('')
    },
    querySelector: (sel) => (sel === 'img' && children.some((c) => c.tagName === 'IMG') ? {} : null),
    closest: () => props.parentLink ?? null,
  })

  it('reads text, links and logos', () => {
    const link = {href: 'https://cesium.com/'}
    const root = el('DIV', {}, [
      el('DIV', {}, [el('IMG', {src: 'https://cesium.com/logo.png', parentLink: link})]),
      el('SPAN', {text: 'Earthstar Geographics'}),
      el('A', {href: 'https://visibleearth.nasa.gov/', text: 'NASA Blue Marble'}),
    ])
    expect(creditsOf(root)).toEqual([
      {img: 'https://cesium.com/logo.png', href: 'https://cesium.com/'},
      {text: 'Earthstar Geographics'},
      {text: 'NASA Blue Marble', href: 'https://visibleearth.nasa.gov/'},
    ])
  })

  it('keeps only text, http(s) links and https or data images', () => {
    expect(sanitizeCredits([
      {text: ' ok ', href: 'javascript:alert(1)'},
      {img: 'http://insecure.example/i.png'},
      {img: 'data:image/png;base64,AAAA', href: 'http://example.org/'},
      {text: '', img: 'javascript:x'},
      'not an object',
    ])).toEqual([
      {text: 'ok'},
      {img: 'data:image/png;base64,AAAA', href: 'http://example.org/'},
    ])
    expect(sanitizeCredits('nonsense')).toEqual([])
    expect(sanitizeCredits(Array.from({length: 100}, () => ({text: 'x'.repeat(1000)})))).toHaveLength(MAX_CREDITS)
    expect(sanitizeCredits([{text: 'x'.repeat(1000)}])[0].text).toHaveLength(300)
  })
})
