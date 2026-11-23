import {RUBIN_TARGET, askRubinWatch} from './rubinApp.js'
import {askSuntan} from './suntanApp.js'
import {startBreathing} from './breathingApp.js'


// The apps' ways in, as search results (search/providers/ViewsProvider.js;
// Celestiary._registerSearchProviders): a view names what it shows, the
// words that find it, the body it is of (targeted on a pick, so the panel
// shows it) and how to open it.  Here, not with the apps' panels
// (ui/apps.jsx), so the search needs none of the panels' React.

/**
 * @type {Array<{id: string, name: string, aliases: string[], path: string, target: string,
 *   open: (celestiary: object) => void}>}
 */
export const APP_VIEWS = [
  {
    id: 'rubin-watch',
    name: 'Watch 2026 ED138 from the Rubin Observatory',
    // Not 'rubin' itself: with it the view outranked the crater and the
    // observatory for "rubin"; its name carries the words, scored lower.
    aliases: ['watch the night', 'telescope', 'dwarf planet candidate'],
    path: `milkyway/sun/${RUBIN_TARGET}`,
    target: RUBIN_TARGET,
    open: (celestiary) => askRubinWatch(celestiary.ui.useStore),
  },
  {
    id: 'suntan',
    name: 'Suntan: fly a concept mission to the Sun',
    aliases: ['suntan', 'parker solar probe', 'land on the sun', 'sun lander', 'mission to the sun'],
    path: 'milkyway/sun',
    target: 'sun',
    open: (celestiary) => askSuntan(celestiary.ui.useStore),
  },
  {
    id: 'breathing',
    name: 'Earth breathing',
    aliases: ['breathing earth', 'breathing', 'seasons', 'the seasons', 'solar noon', 'noon to noon'],
    path: 'milkyway/sun/earth',
    target: 'earth',
    open: (celestiary) => startBreathing(celestiary),
  },
]
