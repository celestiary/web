// The chrome's colour tokens, written into js/index.css's :root, and MUI's
// palette colours into js/Style.jsx, from the theme (js/theme.js uiColors;
// design/UI.md, "The theme").  `yarn theme` rewrites the blocks between the
// markers; css.test.js fails when either has drifted from the theme.
import {readFileSync, writeFileSync} from 'fs'
import {fileURLToPath} from 'url'
import {uiColors} from '../../js/theme.js'


export const CSS_PATH = fileURLToPath(new URL('../../js/index.css', import.meta.url))
export const STYLE_PATH = fileURLToPath(new URL('../../js/Style.jsx', import.meta.url))
export const JS_BEGIN = '// theme: begin.  Written by `yarn theme` from js/theme.js; edit there.'
export const JS_END = '// theme: end'
/** The ui colours MUI's palette takes (Style.jsx), which can't import the theme. */
export const STYLE_KEYS = Object.freeze(['accent', 'inkBright'])
export const BEGIN = '  /* theme: begin.  Written by `yarn theme` from js/theme.js; edit there. */'
export const END = '  /* theme: end */'


/** The `ui` colours CSS takes with an alpha: `rgba(var(--accent-rgb), 0.5)`. */
export const RGB_KEYS = Object.freeze(['accent', 'accentSoft', 'label', 'surface', 'ink4', 'inkBright', 'shadow'])


/**
 * @param {string} key A `uiColors` key, camel case
 * @returns {string} Its CSS custom property, e.g. '--ink-link', '--ink-2'
 */
export function cssVar(key) {
  return `--${key.replace(/([a-z])([A-Z0-9])/g, '$1-$2').toLowerCase()}`
}


/**
 * @param {string} hex '#rrggbb'
 * @returns {string} 'r, g, b', for `rgba(var(--x-rgb), a)`
 */
export function rgbTriple(hex) {
  const n = parseInt(hex.slice(1), 16)
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`
}


/** @returns {string} The block, markers included, as it belongs in :root */
export function themeBlock() {
  const lines = Object.entries(uiColors).map(([k, v]) => `  ${cssVar(k)}: ${v};`)
  for (const k of RGB_KEYS) {
    lines.push(`  ${cssVar(k)}-rgb: ${rgbTriple(uiColors[k])};`)
  }
  return [BEGIN, ...lines, END].join('\n')
}


/**
 * @param {string} css index.css's text
 * @returns {string} It with the block between the markers rewritten
 */
export function withThemeBlock(css) {
  const a = css.indexOf(BEGIN)
  const b = css.indexOf(END)
  if (a < 0 || b < a) {
    throw new Error(`${CSS_PATH}: no theme block (its markers) in :root`)
  }
  return css.slice(0, a) + themeBlock() + css.slice(b + END.length)
}


/** @returns {string} Style.jsx's block, markers included */
export function styleBlock() {
  const entries = STYLE_KEYS.map((k) => `  ${k}: '${uiColors[k]}',`)
  return [JS_BEGIN, 'const uiColors = {', ...entries, '}', JS_END].join('\n')
}


/**
 * @param {string} src Style.jsx's text
 * @returns {string} It with the block between the markers rewritten
 */
export function withStyleBlock(src) {
  const a = src.indexOf(JS_BEGIN)
  const b = src.indexOf(JS_END)
  if (a < 0 || b < a) {
    throw new Error(`${STYLE_PATH}: no theme block (its markers)`)
  }
  return src.slice(0, a) + styleBlock() + src.slice(b + JS_END.length)
}


if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const [path, rewrite] of [[CSS_PATH, withThemeBlock], [STYLE_PATH, withStyleBlock]]) {
    const before = readFileSync(path, 'utf8')
    const after = rewrite(before)
    writeFileSync(path, after)
    console.log(`${path}: theme block ${after === before ? 'up to date' : 'rewritten'}`)
  }
}
