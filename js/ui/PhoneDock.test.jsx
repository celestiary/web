import {afterEach, describe, expect, it, mock} from 'bun:test'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import useStore from '../store/useStore'


// The dock's children import ReactElement, a type, from 'react', which bun
// can't load: stand-ins, keeping the test ids the dock's states show.
mock.module('./TimePanel', () => ({default: () => <div data-testid='time-panel'/>}))
mock.module('./DragModeToggle', () => ({default: () => <div data-testid='drag-mode'/>}))
// The mock is process-global, and LayersButton.test.jsx tests the module's
// other exports: keep them, from the real module by a name the mock doesn't
// take (AGENTS.md, mock.module), and stand in for LayerOptions only.
const layersButton = './LayersButton.jsx?dock'
const realLayers = await import(layersButton)
mock.module('./LayersButton', () => ({...realLayers, LayerOptions: () => <div data-testid='layers-button-panel'/>}))
mock.module('./ARButton', () => ({
  default: () => (useStore.getState().ar ?
    <button data-testid='ar-button-exit'/> : <button data-testid='ar-button-enter'/>),
}))
const {DockView, clockLabel} = await import('./PhoneDock.jsx')


const celestiary = {time: {simTime: Date.UTC(2026, 9, 21, 16, 19), timeScale: 1}, exitAR: () => {}}
const initial = useStore.getState()

/**
 * @param {object} [state] the store's, as the dock reads it
 * @returns {string} the dock's markup
 */
function render(state = {}) {
  const {layerBody = null, ar = null, widgetsOpen = false} = state
  useStore.setState({ar})
  return renderToStaticMarkup(
      <DockView celestiary={celestiary} timeStr='' isPaused={false} setIsPaused={() => {}} layerBody={layerBody}
        ar={ar} widgetsOpen={widgetsOpen} onApps={() => {}} navigate={() => {}}/>)
}


describe('PhoneDock', () => {
  afterEach(() => useStore.setState({ar: initial.ar}))

  it('holds Time, AR, Apps and More, and no panel until one is asked for', () => {
    const html = render()
    for (const id of ['time', 'apps', 'more']) {
      expect(html).toContain(`data-testid="phone-dock-${id}"`)
    }
    expect(html).toContain('data-testid="ar-button-enter"')
    expect(html).not.toContain('data-testid="phone-dock-layers"')
    expect(html).not.toContain('dock-panel')
  })

  it('offers Layers near a Cesium body', () => {
    expect(render({layerBody: 'earth'})).toContain('data-testid="phone-dock-layers"')
  })

  it('puts AR\'s controls above the bar while it\'s on, and its button exits it', () => {
    const html = render({ar: {needsCalibration: false}})
    expect(html).toContain('data-testid="phone-dock-panel-ar"')
    expect(html).toContain('data-testid="ar-button-exit"')
    expect(html).toContain('data-testid="phone-dock-ar"')
    expect(html).toContain('Exit AR')
    expect(html).not.toContain('data-testid="ar-button-enter"')
  })

  it('labels Time with the clock at real time, else the rate, or paused', () => {
    const t = {simTime: new Date(2026, 9, 21, 16, 19).getTime(), timeScale: 1}
    expect(clockLabel(t, false)).toBe('4:19 PM')
    expect(clockLabel(t, true)).toBe('Paused')
    expect(clockLabel({...t, timeScale: 86400}, false)).toBe('1 d/s')
    expect(clockLabel({...t, timeScale: -7200}, false)).toBe('-2 h/s')
    expect(clockLabel({...t, timeScale: 30}, false)).toBe('30 s/s')
    expect(clockLabel({...t, timeScale: 3 * 31557600}, false)).toBe('3 y/s')
  })
})
