import {describe, expect, it} from 'bun:test'
import {readFileSync} from 'node:fs'


// The quiet-load script in public/index.html: it has to run before the
// body's first paint, so it is inline there; this runs that source.
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8')
const source = html.match(/<script type="text\/javascript" id="quiet-load">([\s\S]*?)<\/script>/)[1]


/**
 * @param {string} hash The page's fragment, with its '#'
 * @returns {boolean} Whether the page loads quiet
 */
function quiet(hash) {
  const classes = new Set()
  const window = {location: {hash}}
  const document = {documentElement: {classList: {add: (c) => classes.add(c)}}}
  new Function('window', 'document', source)(window, document)
  return classes.has('quiet-load')
}


const VIEW = '#sun/earth@43.3389,-9.9593,30373373.021376Tm;t=9779.5692jd;cq=-0.436,0.7975,0.0666,0.4116;fov=45deg'


describe('quiet-load', () => {
  it('loads quiet for a view link with the HUD off', () => {
    expect(quiet(`${VIEW};s=alopvTF`)).toBe(true)
    expect(quiet(`${VIEW};s=v`)).toBe(true)
  })

  it('shows the loading text otherwise', () => {
    expect(quiet('')).toBe(false)
    expect(quiet('#sun/earth')).toBe(false)
    expect(quiet(VIEW)).toBe(false)
    expect(quiet(`${VIEW};s=aloTF`)).toBe(false)
    expect(quiet(`${VIEW};sm=1.5;ev=1.33`)).toBe(false)
  })

  it('reads only the s= param, not a state token or sm=', () => {
    expect(quiet(`${VIEW};apps:open,view=v`)).toBe(false)
    expect(quiet(`${VIEW};sm=2`)).toBe(false)
  })

  it('needs a whole view, as permalink.js does', () => {
    expect(quiet('#sun/earth@1,2,3m;s=v')).toBe(false)
  })
})
