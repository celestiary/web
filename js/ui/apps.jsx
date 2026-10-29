import ColonizationApp from './ColonizationApp'
import RubinApp from './RubinApp'
import {EXPANSION_APP_ID} from '../store/ColonizationSlice'
import {RUBIN_APP_ID} from '../store/rubinApp'
import RocketIcon from '@mui/icons-material/RocketLaunchOutlined'
import TelescopeIcon from '@mui/icons-material/TravelExploreOutlined'


/**
 * The apps in the widgets drawer's tray (WidgetsDrawer.jsx).  An app is a
 * panel the drawer shows, an icon for the tray and the dock, and a stop that
 * removes whatever it added to the scene.  Its panel stays mounted while it
 * runs, drawer open or not, so a pinned app keeps its state and keeps going.
 * An app with state for the permalink has a codec in store/appTokens.js,
 * by the same ID.
 *
 * @type {Array<{id: string, name: string, description: string, Icon: Function, Panel: Function, stop: Function}>}
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
]


/**
 * @param {string} id
 * @returns {object|undefined}
 */
export function appById(id) {
  return APPS.find((app) => app.id === id)
}
