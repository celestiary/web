import React, {Suspense, lazy} from 'react'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Slider from '@mui/material/Slider'
import Stack from '@mui/material/Stack'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import PauseIcon from '@mui/icons-material/Pause'
import PlayIcon from '@mui/icons-material/PlayArrow'
import EarthIcon from '@mui/icons-material/Public'
import ColonizationApp from './ColonizationApp'
import RubinApp from './RubinApp'
import SuntanApp from './SuntanApp'
import {EXPANSION_APP_ID} from '../store/ColonizationSlice'
import {RUBIN_APP_ID} from '../store/rubinApp'
import {SUNTAN_APP_ID} from '../store/suntanApp'
import {BREATHING_APP_ID, BREATHING_SPEEDS, daysPerSecond, startBreathing, stopBreathing} from '../store/breathingApp'
import RocketIcon from '@mui/icons-material/RocketLaunchOutlined'
import SunIcon from '@mui/icons-material/WbSunnyOutlined'
import TelescopeIcon from '@mui/icons-material/TravelExploreOutlined'


/**
 * What the Earth breathing app's panel, a chunk of its own (breathingApp.js),
 * shares with the first load, handed in rather than imported (AGENTS.md).
 */
export const BREATHING_DEPS = Object.freeze({
  React, Box, Stack, Typography, IconButton, Slider, ToggleButton, ToggleButtonGroup, PlayIcon, PauseIcon,
  speeds: BREATHING_SPEEDS, daysPerSecond,
})


/**
 * The Earth breathing panel, loaded on the app's first open.
 *
 * @returns {Promise<{default: Function}>} For React's lazy
 */
export function loadBreathingApp() {
  return import('./breathingApp.js')
      .then((m) => ({default: m.breathingApp(BREATHING_DEPS)}))
      .catch((err) => {
        // A failed chunk (a stale build, offline): no panel; the steps run.
        console.warn('[breathing] the panel didn\'t load', err)
        return {default: () => null}
      })
}


const BreathingPanel = lazy(loadBreathingApp)


/**
 * @property {object} celestiary
 * @returns {object} The panel, once its chunk is in
 */
function BreathingApp({celestiary}) {
  return <Suspense fallback={null}><BreathingPanel celestiary={celestiary}/></Suspense>
}


/**
 * The apps in the widgets drawer's tray (WidgetsDrawer.jsx).  An app is a
 * panel the drawer shows, an icon for the tray and the dock, and a stop that
 * removes whatever it added to the scene.  Its panel stays mounted while it
 * runs, drawer open or not, so a pinned app keeps its state and keeps going.
 * An app with state for the permalink has a codec in store/appTokens.js,
 * by the same ID.  An app with a `start` runs it when opened from the tray
 * (not when a link restores it): Earth breathing's flight to its view.
 *
 * @type {Array<{id: string, name: string, description: string, Icon: Function, Panel: Function, stop: Function,
 *   start?: Function}>}
 */
export const APPS = [
  {
    id: EXPANSION_APP_ID,
    name: 'Human Expansion',
    description: 'Humans spreading across the stars at a fraction of light speed',
    Icon: RocketIcon,
    Panel: ColonizationApp,
    stop: (celestiary) => celestiary.scene.removeColonization(),
  },
  {
    id: RUBIN_APP_ID,
    name: 'Rubin Observatory',
    description: 'The telescope on Cerro Pachón following 2026 ED138, its first dwarf planet candidate',
    Icon: TelescopeIcon,
    Panel: RubinApp,
    stop: (celestiary) => celestiary.scene.removeRubin(),
  },
  {
    id: SUNTAN_APP_ID,
    name: 'Suntan',
    description: 'A concept mission to the Sun\'s surface on Parker Solar Probe\'s path, with its sensors',
    Icon: SunIcon,
    Panel: SuntanApp,
    stop: (celestiary) => celestiary.scene.removeSuntan(),
  },
  {
    id: BREATHING_APP_ID,
    name: 'Earth breathing',
    description: 'The seasons from noon to noon: a day a step, the Sun held over the same ground',
    Icon: EarthIcon,
    Panel: BreathingApp,
    start: startBreathing,
    stop: stopBreathing,
  },
]


/**
 * @param {string} id
 * @returns {object|undefined}
 */
export function appById(id) {
  return APPS.find((app) => app.id === id)
}
