import {describe, expect, it} from 'bun:test'
import {APP_VIEWS} from './appViews.js'
import {DEFAULT_RUBIN, RUBIN_APP_ID} from './rubinApp.js'


describe('APP_VIEWS', () => {
  it('has the Rubin watch, which opens the app and asks it to watch', () => {
    const view = APP_VIEWS.find((v) => v.id === 'rubin-watch')
    expect(view.aliases).toContain('watch the night')
    expect(view.name).toMatch(/Rubin Observatory/)
    expect(view.target).toBe('ed138')
    const actions = []
    let widgets = {appStates: {}}
    const store = {getState: () => ({widgets, dispatchWidgets: (a) => {
      actions.push(a)
      if (a.type === 'appState') {
        widgets = {appStates: {...widgets.appStates, [a.id]: a.appState}}
      }
    }})}
    view.open({ui: {useStore: store}})
    expect(actions[0]).toEqual({type: 'openApp', id: RUBIN_APP_ID})
    expect(actions[1]).toEqual({type: 'appState', id: RUBIN_APP_ID, appState: {...DEFAULT_RUBIN, watch: true}})
  })
})
