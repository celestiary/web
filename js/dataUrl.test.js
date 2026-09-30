import {describe, expect, it} from 'bun:test'
import {dataUrl, resolveDataUrl} from './dataUrl.js'


const PROD = 'https://celestiary.github.io/web/'


describe('resolveDataUrl', () => {
  it('leaves the path relative with no base', () => {
    expect(resolveDataUrl('textures/mars.jpg')).toBe('textures/mars.jpg')
    expect(resolveDataUrl('textures/mars.jpg', '')).toBe('textures/mars.jpg')
  })

  it('joins a base with a trailing slash', () => {
    expect(resolveDataUrl('textures/mars.jpg', PROD)).toBe(`${PROD}textures/mars.jpg`)
  })

  it('adds the missing trailing slash to a base', () => {
    expect(resolveDataUrl('data/stars.dat', 'https://celestiary.github.io/web'))
        .toBe(`${PROD}data/stars.dat`)
  })

  it('takes a path-only base', () => {
    expect(resolveDataUrl('data/stars.dat', '/cdn/')).toBe('/cdn/data/stars.dat')
  })

  it('drops leading ./ and / from the path', () => {
    expect(resolveDataUrl('./data/stars.dat', PROD)).toBe(`${PROD}data/stars.dat`)
    expect(resolveDataUrl('/data/stars.dat', PROD)).toBe(`${PROD}data/stars.dat`)
  })

  it('keeps tile template placeholders intact', () => {
    const tmpl = 'textures/earth/blue-marble/2004-03/{z}/{x}/{y}.jpg'
    expect(resolveDataUrl(tmpl, PROD)).toBe(`${PROD}${tmpl}`)
  })

  it('passes absolute URLs through', () => {
    expect(resolveDataUrl('https://example.org/a.jpg', PROD)).toBe('https://example.org/a.jpg')
    expect(resolveDataUrl('//example.org/a.jpg', PROD)).toBe('//example.org/a.jpg')
    expect(resolveDataUrl('data:image/png;base64,AAAA', PROD)).toBe('data:image/png;base64,AAAA')
  })
})


describe('dataUrl', () => {
  it('is the identity when no base URL was defined at build time', () => {
    expect(dataUrl('textures/mars.jpg')).toBe('textures/mars.jpg')
  })
})
