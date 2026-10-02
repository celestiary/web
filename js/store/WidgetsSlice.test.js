import {INITIAL_WIDGETS, TRAY, isDockVisible, widgetsReducer} from './WidgetsSlice.js'


/**
 * @param {Array<object>} actions
 * @returns {object} State after applying them from the initial state
 */
function run(actions) {
  return actions.reduce(widgetsReducer, INITIAL_WIDGETS)
}


describe('WidgetsSlice', () => {
  it('opens on the tray, and an app opens and runs', () => {
    let s = run([{type: 'toggle'}])
    expect(s.isOpen).toBe(true)
    expect(s.view).toBe(TRAY)
    s = widgetsReducer(s, {type: 'openApp', id: 'a'})
    expect(s.view).toBe('a')
    expect(s.running).toEqual(['a'])
    expect(isDockVisible(s)).toBe(false)
  })

  it('closing the drawer stops apps that are not pinned', () => {
    const s = run([{type: 'openApp', id: 'a'}, {type: 'close'}])
    expect(s.isOpen).toBe(false)
    expect(s.running).toEqual([])
    expect(s.view).toBe(TRAY)
    expect(isDockVisible(s)).toBe(false)
  })

  it('a pinned app keeps running when the drawer closes, in the dock', () => {
    const s = run([{type: 'openApp', id: 'a'}, {type: 'pin', id: 'a'}, {type: 'toggle'}])
    expect(s.isOpen).toBe(false)
    expect(s.running).toEqual(['a'])
    expect(s.view).toBe('a')
    expect(isDockVisible(s)).toBe(true)
    // Unpinned while the drawer is closed: stopped, and the dock goes.
    const t = widgetsReducer(s, {type: 'unpin', id: 'a'})
    expect(t.running).toEqual([])
    expect(isDockVisible(t)).toBe(false)
  })

  it('stop ends an app, unpins it, and returns to the tray', () => {
    const s = run([{type: 'openApp', id: 'a'}, {type: 'pin', id: 'a'}, {type: 'stop', id: 'a'}])
    expect(s.running).toEqual([])
    expect(s.pinned).toEqual([])
    expect(s.view).toBe(TRAY)
    expect(s.isOpen).toBe(true)
  })

  it('docks on request, with no app pinned', () => {
    const s = run([{type: 'toggleDock'}])
    expect(isDockVisible(s)).toBe(true)
    expect(isDockVisible(widgetsReducer(s, {type: 'toggleDock'}))).toBe(false)
  })
})
