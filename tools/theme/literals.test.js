import {describe, expect, it} from 'bun:test'
import {readFileSync, readdirSync, statSync} from 'fs'
import {join} from 'path'


// Every designed colour is in js/theme.js (design/UI.md, "The theme").  A
// colour literal elsewhere in the app's code fails here, unless it is one of
// these, each not a design colour: debug fallbacks, a clear to black or to
// transparent, the Sun's white light, a model's paint (its albedo, data), a
// float's bit masks, and the MUI placeholders the corrections replace.
const ALLOWED = {
  'js/scene/shapes.js': 'debug shapes\' fallbacks',
  'js/scene/material.js': 'a material\'s debug fallback',
  'js/ThreeUI.js': 'the renderer\'s clear, black',
  'js/scene/cesium/CesiumLayers.js': 'clears to transparent',
  'js/scene/cesium/guestPages.js': 'a clear to transparent',
  'js/scene/sun/cme/CmeCloud.js': 'a clear to transparent',
  'js/scene/SpriteSheet.js': 'a clear to transparent',
  'js/scene/Star.js': 'the Sun\'s light, white',
  'js/scene/rubin/rubinModel.js': 'the telescope\'s paint: albedo, not design',
  'js/scene/points/float16.js': 'bit masks',
  'js/lib/three-custom/points.js': 'a vendored default',
  'js/Style.jsx': 'MUI\'s placeholder light and dark, until the corrections',
}
// One literal in a file that otherwise has none.
const ALLOWED_LITERALS = {
  'js/scene/Planet.js': ['0xffffff'], // the old cloud shell's material, untinted
}
// Not the app: the guide's demos, the developer tools, tests.
const SKIP = [/^js\/guide\//, /^js\/perf\//, /ARDebugHUD/, /\.test\./, /^js\/theme\.js$/]
const LITERAL = /0x[0-9a-fA-F]{6}\b|['"`]#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/g


/** @returns {Array<string>} The .js and .jsx files under dir */
function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    if (SKIP.some((re) => re.test(`${p}/`))) {
      return []
    }
    let dirent
    try {
      dirent = statSync(p)
    } catch {
      return [] // a dangling link
    }
    return dirent.isDirectory() ? walk(p) : (/\.jsx?$/).test(f) ? [p] : []
  })
}


describe('colour literals', () => {
  it('are in the theme, not the code', () => {
    const found = []
    for (const p of walk('js')) {
      if (SKIP.some((re) => re.test(p)) || ALLOWED[p]) {
        continue
      }
      // Comments say colours too: only code counts.
      const code = readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
      for (const m of code.matchAll(LITERAL)) {
        if (!ALLOWED_LITERALS[p]?.includes(m[0])) {
          found.push(`${p}: ${m[0]}`)
        }
      }
    }
    expect(found).toEqual([])
  })
})
