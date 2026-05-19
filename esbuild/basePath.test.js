import {describe, expect, it} from 'bun:test'
import {normalizeBasePath} from './basePath.js'


describe('normalizeBasePath', () => {
  it('leaves "/" alone', () => {
    expect(normalizeBasePath('/')).toBe('/')
  })

  it('treats empty / whitespace / undefined as root', () => {
    expect(normalizeBasePath('')).toBe('/')
    expect(normalizeBasePath('   ')).toBe('/')
    expect(normalizeBasePath(undefined)).toBe('/')
  })

  it('adds leading and trailing slash', () => {
    expect(normalizeBasePath('web')).toBe('/web/')
    expect(normalizeBasePath('/web')).toBe('/web/')
    expect(normalizeBasePath('web/')).toBe('/web/')
    expect(normalizeBasePath('/web/')).toBe('/web/')
  })

  it('handles nested paths', () => {
    expect(normalizeBasePath('/web/pr-preview/pr-42/')).toBe('/web/pr-preview/pr-42/')
    expect(normalizeBasePath('web/pr-preview/pr-42')).toBe('/web/pr-preview/pr-42/')
  })

  it('collapses repeated slashes', () => {
    expect(normalizeBasePath('//')).toBe('/')
    expect(normalizeBasePath('//web//')).toBe('/web/')
    expect(normalizeBasePath('/web///pr-42/')).toBe('/web/pr-42/')
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeBasePath('  /web/  ')).toBe('/web/')
  })
})
