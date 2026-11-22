import {describe, expect, it} from 'bun:test'
import {readFileSync} from 'fs'
import {alpha, applyCssColors, css, cssVar, sceneColors, uiColors} from '../../js/theme.js'


const CSS = readFileSync(new URL('../../js/index.css', import.meta.url), 'utf8')
const CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, '')


/** A style that records setProperty. */
function fakeStyle() {
  const props = {}
  return {props, setProperty: (k, v) => {
    props[k] = v
  }}
}


describe('the theme', () => {
  it('sets each ui colour, and the rgb triples CSS takes with an alpha', () => {
    const style = fakeStyle()
    applyCssColors(style)
    expect(style.props['--accent']).toBe(uiColors.accent)
    expect(style.props['--ink-link']).toBe(uiColors.inkLink)
    expect(style.props['--ink-2']).toBe(uiColors.ink2)
    expect(style.props['--accent-rgb']).toBe('134, 159, 219')
    expect(style.props['--shadow-rgb']).toBe('0, 0, 0')
    // No DOM (bun): a no-op, not a throw.
    expect(() => applyCssColors(undefined)).not.toThrow()
  })

  it('gives index.css every custom property it uses that it doesn\'t declare', () => {
    const style = fakeStyle()
    applyCssColors(style)
    const declared = new Set([...CODE.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]))
    const used = new Set([...CODE.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]))
    // Layout, set from script (Celestiary, the drawer, the dock, the sheet).
    const fromScript = new Set(['--dock-width', '--info-sheet-bottom', '--phone-dock-height', '--scene-height', '--sheet-height'])
    const missing = [...used].filter((v) => !declared.has(v) && !(v in style.props) && !fromScript.has(v))
    expect(missing).toEqual([])
  })

  it('leaves no colour literal in index.css', () => {
    expect(CODE.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/g)).toBeNull()
  })

  it('names the properties as CSS does, and formats colours for it', () => {
    expect(cssVar('inkLink')).toBe('--ink-link')
    expect(cssVar('surfaceRaisedHover')).toBe('--surface-raised-hover')
    expect(css(0x00ff00)).toBe('#00ff00')
    expect(css(sceneColors.label)).toBe(uiColors.label)
    expect(alpha('#869fdb', 0.5)).toBe('rgba(134, 159, 219, 0.5)')
  })
})
