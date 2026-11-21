import {describe, expect, it} from 'bun:test'
import {readFileSync} from 'fs'
import {alpha, css, sceneColors, uiColors} from '../../js/theme.js'
import {CSS_PATH, RGB_KEYS, STYLE_PATH, cssVar, rgbTriple, themeBlock, withStyleBlock, withThemeBlock} from './css.mjs'


describe('the theme', () => {
  it('writes index.css\'s colour tokens: run `yarn theme` after editing js/theme.js', () => {
    const file = readFileSync(CSS_PATH, 'utf8')
    expect(withThemeBlock(file)).toBe(file)
    expect(file).toContain(themeBlock())
  })

  it('writes MUI\'s palette colours into Style.jsx: run `yarn theme` after editing js/theme.js', () => {
    const file = readFileSync(STYLE_PATH, 'utf8')
    expect(withStyleBlock(file)).toBe(file)
    expect(file).not.toContain('theme.js\'')
  })

  it('leaves no colour literal in index.css outside its block', () => {
    const file = readFileSync(CSS_PATH, 'utf8')
    const rest = file.replace(themeBlock(), '').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(rest.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/g)).toBeNull()
  })

  it('names the properties as CSS does', () => {
    expect(cssVar('inkLink')).toBe('--ink-link')
    expect(cssVar('ink2')).toBe('--ink-2')
    expect(cssVar('surfaceRaisedHover')).toBe('--surface-raised-hover')
    expect(rgbTriple('#869fdb')).toBe('134, 159, 219')
    for (const k of RGB_KEYS) {
      expect(uiColors[k]).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('formats colours for CSS', () => {
    expect(css(0x00ff00)).toBe('#00ff00')
    expect(css(sceneColors.label)).toBe(uiColors.label)
    expect(alpha('#869fdb', 0.5)).toBe('rgba(134, 159, 219, 0.5)')
  })
})
