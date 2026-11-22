import {describe, expect, it} from 'bun:test'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {decodeAppTokens, encodeAppTokens} from './appTokens.js'
import {APP_VIEWS} from './appViews.js'
import {
  BREATHING_APP_ID,
  BREATHING_SPEEDS,
  BREATHING_VIEW,
  decodeBreathingToken,
  encodeBreathingToken,
  startBreathing,
  stopBreathing,
} from './breathingApp.js'
import {INITIAL_WIDGETS} from './WidgetsSlice.js'
import Time from '../Time.js'
import {decodePermalink, decodeTimeToken} from '../permalink.js'
import SearchIndex from '../search/SearchIndex.js'
import ViewsProvider from '../search/providers/ViewsProvider.js'
import {breathingApp} from '../ui/breathingApp.js'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Slider from '@mui/material/Slider'
import Stack from '@mui/material/Stack'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import PauseIcon from '@mui/icons-material/Pause'
import PlayIcon from '@mui/icons-material/PlayArrow'
import {daysPerSecond} from './breathingApp.js'


// As apps.jsx's BREATHING_DEPS (apps.jsx imports the other apps' panels,
// which bun can't load).
const DEPS = {React, Box, Stack, Typography, IconButton, Slider, ToggleButton, ToggleButtonGroup, PlayIcon, PauseIcon,
  speeds: BREATHING_SPEEDS, daysPerSecond}


/**
 * @returns {{celestiary: object, actions: Array, links: Array}} A stand-in
 *   Celestiary: its store, its clock and openLink
 */
function standIn() {
  const actions = []
  const links = []
  const celestiary = {
    time: new Time,
    ui: {useStore: {getState: () => ({dispatchWidgets: (a) => actions.push(a)})}},
    openLink: (link) => links.push(link),
  }
  return {celestiary, actions, links}
}


describe('the Earth breathing app', () => {
  it('opens on its view: the drawer on the app, a flight to Earth stepping by day at 32 days a second', () => {
    const {celestiary, actions, links} = standIn()
    startBreathing(celestiary)
    expect(actions).toEqual([{type: 'openApp', id: BREATHING_APP_ID}])
    expect(links).toEqual([BREATHING_VIEW])
    const pl = decodePermalink(BREATHING_VIEW)
    expect(pl.path).toBe('sun/earth')
    expect([pl.lat, pl.lng, pl.alt]).toEqual([50, 69.8893, 7e6])
    // Turning with Earth (Y) and following (F).
    expect(pl.settings.Y).toBe(true)
    expect(decodeTimeToken(pl.tokens.time)).toEqual({paused: false, rate: 32 * 86400, stepDays: 1})
  })

  it('stopping returns the clock to real time, continuous, paused or not as it was', () => {
    const {celestiary} = standIn()
    const time = celestiary.time
    time.setStepDays(1)
    time.setRate(30 * 86400)
    time.setPaused(true)
    const modes = []
    celestiary.scene = {cameraMode: () => ({mode: 'turning', auto: false, body: 'earth'}),
      setCameraMode: (m) => modes.push(m)}
    stopBreathing(celestiary)
    expect([time.stepDays, time.timeScale, time.timeScaleSteps, time.isPaused]).toEqual([0, 1, 0, true])
    // The view's turning with Earth, back to the height's choice.
    expect(modes).toEqual(['auto'])
  })

  it('has no state of its own in the link, but runs from it', () => {
    expect(encodeBreathingToken({})).toBe(null)
    expect(decodeBreathingToken('anything')).toEqual({})
    const widgets = {...INITIAL_WIDGETS, isOpen: true, view: BREATHING_APP_ID, running: [BREATHING_APP_ID]}
    const tokens = encodeAppTokens(widgets)
    expect(tokens).toEqual({apps: 'open,view=breathing'})
    const back = decodeAppTokens(tokens)
    expect([back.view, back.running]).toEqual([BREATHING_APP_ID, [BREATHING_APP_ID]])
  })

  it('is found by search as "Earth breathing", "breathing" and "seasons", and Go starts it', async () => {
    const idx = new SearchIndex()
    idx.register(new ViewsProvider(APP_VIEWS))
    await idx.ensureReady()
    for (const q of ['Earth breathing', 'earth breathing', 'breathing', 'seasons']) {
      expect(idx.query(q)[0].entry.id).toBe('view:breathing')
    }
    const view = APP_VIEWS.find((v) => v.id === 'breathing')
    expect(view.target).toBe('earth')
    const {celestiary, actions, links} = standIn()
    view.open(celestiary)
    expect(actions).toEqual([{type: 'openApp', id: BREATHING_APP_ID}])
    expect(links).toEqual([BREATHING_VIEW])
  })

  it('its panel shows the date, the month and the speeds', () => {
    const Panel = breathingApp(DEPS)
    const time = new Time
    time.setTime(Date.UTC(2026, 6, 4, 7, 30))
    time.setStepDays(1, {land: false})
    time.setRate(32 * 86400)
    const html = renderToStaticMarkup(React.createElement(Panel, {celestiary: {time}}))
    expect(html).toContain('data-testid="breathing-app"')
    expect(html).toContain('July, day 185')
    expect(html).toContain('32 days a second')
    for (const days of BREATHING_SPEEDS) {
      expect(html).toContain(`${days} d/s`)
    }
  })
})
