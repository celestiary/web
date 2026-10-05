import {decodePermalink, encodePermalink} from '../permalink.js'
import {APPS_TOKEN, decodeAppTokens, encodeAppTokens} from './appTokens.js'
import {DEFAULT_EXPANSION, EXPANSION_APP_ID, decodeExpansionToken, encodeExpansionToken} from './ColonizationSlice.js'
import {INITIAL_WIDGETS, TRAY, widgetsReducer} from './WidgetsSlice.js'


const ID = EXPANSION_APP_ID


/**
 * @param {Array<object>} actions
 * @returns {object} Widgets state after applying them from the initial state
 */
function run(actions) {
  return actions.reduce(widgetsReducer, INITIAL_WIDGETS)
}


/**
 * @param {object} widgets
 * @returns {object} widgets, through a whole permalink and back
 */
function viaPermalink(widgets) {
  const frag = encodePermalink('sun', 0, 0, 0, 1000, {x: 0, y: 0, z: 0, w: 1}, 45, undefined, encodeAppTokens(widgets))
  return decodeAppTokens(decodePermalink(frag).tokens)
}


describe('apps token', () => {
  it('is left out for the drawer closed, nothing running', () => {
    expect(encodeAppTokens(INITIAL_WIDGETS)).toEqual({})
    expect(decodeAppTokens({})).toBe(null)
    expect(decodeAppTokens(undefined)).toBe(null)
  })

  it('writes the drawer open on the tray', () => {
    const s = run([{type: 'open'}])
    expect(encodeAppTokens(s)).toEqual({[APPS_TOKEN]: 'open'})
    expect(viaPermalink(s)).toEqual(s)
  })

  it('writes the drawer open on the app, its state its own token', () => {
    const appState = {...DEFAULT_EXPANSION, numNeighbors: 6, isRun: true, progress: 0.25}
    const s = run([{type: 'openApp', id: ID}, {type: 'appState', id: ID, appState}])
    expect(encodeAppTokens(s)).toEqual({[APPS_TOKEN]: `open,view=${ID}`, [`apps.${ID}`]: 'k=6,run=1,at=0.25'})
    expect(viaPermalink(s)).toEqual(s)
  })

  it('writes a pinned app with the drawer closed, and docked', () => {
    const s = run([{type: 'openApp', id: ID}, {type: 'pin', id: ID}, {type: 'close'}, {type: 'toggleDock'}])
    expect(encodeAppTokens(s)).toEqual({[APPS_TOKEN]: `dock,view=${ID},pin=${ID}`})
    expect(viaPermalink(s)).toEqual({...s, appStates: {[ID]: decodeExpansionToken(undefined)}})
  })

  it('writes an app running behind the tray', () => {
    const s = run([{type: 'openApp', id: ID}, {type: 'tray'}])
    expect(encodeAppTokens(s)).toEqual({[APPS_TOKEN]: `open,run=${ID}`})
    expect(viaPermalink(s).running).toEqual([ID])
    expect(viaPermalink(s).view).toBe(TRAY)
  })

  it('reads a bare apps: as the drawer open', () => {
    expect(decodeAppTokens({apps: ''})).toEqual({...INITIAL_WIDGETS, isOpen: true})
  })

  it('drops unknown apps, and unpinned apps with the drawer closed', () => {
    const s = decodeAppTokens({apps: `view=nope,run=nope+${ID}`})
    expect(s.isOpen).toBe(false)
    expect(s.running).toEqual([])
    expect(s.view).toBe(TRAY)
    expect(decodeAppTokens({apps: 'open,view=nope,pin=nope'}).pinned).toEqual([])
  })
})


describe('apps.expansion token', () => {
  it('is empty at the defaults', () => {
    expect(encodeExpansionToken(DEFAULT_EXPANSION)).toBe(null)
    expect(decodeExpansionToken(undefined)).toEqual(DEFAULT_EXPANSION)
  })

  it('round-trips every field', () => {
    const s = {
      speedC: 0.25,
      numNeighbors: 6,
      launchDelayYears: 250,
      playSeconds: 60,
      isRun: true,
      progress: 0.4321,
      isPlaying: true,
      pacing: 'years',
      routeHip: 71683,
      style: {widthFirst: 8, widthLast: 1, opacity: 0.5, sizeAttenuation: false, attenuationLy: 316.2278},
      pulse: {on: true, stepSec: 0.2, trail: 4},
    }
    const value = encodeExpansionToken(s)
    expect(value).toBe('c=0.25,k=6,delay=250,dur=60,run=1,at=0.4321,play=1,pace=years,star=71683,' +
      'w0=8,w1=1,op=0.5,atten=0,full=316.2278,pulse=1,T=0.2,N=4')
    expect(decodeExpansionToken(value)).toEqual(s)
  })

  it('writes the timeline only with a run', () => {
    expect(encodeExpansionToken({...DEFAULT_EXPANSION, progress: 0.5, isPlaying: true})).toBe(null)
  })

  it('rounds to 4 places', () => {
    expect(encodeExpansionToken({...DEFAULT_EXPANSION, isRun: true, progress: 1 / 3})).toBe('run=1,at=0.3333')
  })

  it('holds values to the controls\' ranges, and a bad value is its default', () => {
    const s = decodeExpansionToken('c=5,k=2.5,at=-1,op=x,N=99,star=-3,pace=weeks,run=yes')
    expect(s.speedC).toBe(1)
    expect(s.numNeighbors).toBe(DEFAULT_EXPANSION.numNeighbors)
    expect(s.progress).toBe(0)
    expect(s.style.opacity).toBe(DEFAULT_EXPANSION.style.opacity)
    expect(s.pulse.trail).toBe(30)
    expect(s.routeHip).toBe(null)
    expect(s.pacing).toBe('stars')
    expect(s.isRun).toBe(false)
  })
})
