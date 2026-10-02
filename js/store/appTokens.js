import {formatTokenValue, parseTokenValue, parseValueList} from '../permalink.js'
import {EXPANSION_APP_ID, decodeExpansionToken, encodeExpansionToken} from './ColonizationSlice.js'
import {INITIAL_WIDGETS, TRAY} from './WidgetsSlice.js'


/**
 * The widgets drawer and its apps in the permalink (design/URLs.md):
 *
 * - `apps:` the drawer: `open`, `dock`, `view=<id>`, `pin=<id>+<id>`,
 *   `run=<id>+<id>` (running apps neither pinned nor showing).
 * - `apps.<id>:` a running app's own state, by its codec here.
 *
 * Apps are by ID, as ui/apps.jsx lists them; an app not here is dropped.
 */
export const APP_CODECS = Object.freeze({
  [EXPANSION_APP_ID]: {encode: encodeExpansionToken, decode: decodeExpansionToken},
})

export const APPS_TOKEN = 'apps'
const APP_TOKEN_PREFIX = `${APPS_TOKEN}.`


/**
 * @param {object} widgets The widgets slice's state
 * @returns {object} State tokens, {label: value}: none for the drawer
 *   closed with no app running and not docked
 */
export function encodeAppTokens(widgets) {
  const {isOpen, isDocked, view, running, pinned, appStates} = widgets
  if (!isOpen && !isDocked && running.length === 0) {
    return {}
  }
  const flags = []
  if (isOpen) {
    flags.push('open')
  }
  if (isDocked) {
    flags.push('dock')
  }
  const tokens = {
    [APPS_TOKEN]: formatTokenValue(flags, {
      view: view === TRAY ? null : view,
      pin: pinned,
      run: running.filter((id) => id !== view && !pinned.includes(id)),
    }),
  }
  for (const id of running) {
    const state = appStates[id]
    const value = state && APP_CODECS[id] ? APP_CODECS[id].encode(state) : null
    if (value) {
      tokens[`${APP_TOKEN_PREFIX}${id}`] = value
    }
  }
  return tokens
}


/**
 * @param {object} [tokens] A permalink's state tokens, {label: value}
 * @returns {object|null} The widgets slice's state they give, null if there
 *   is no `apps` token
 */
export function decodeAppTokens(tokens) {
  const value = tokens?.[APPS_TOKEN]
  if (value === undefined) {
    return null
  }
  const {flags, named} = parseTokenValue(value)
  const known = (id) => Object.hasOwn(APP_CODECS, id)
  // A bare `apps:` is the drawer open, as in Share.
  const isOpen = flags.includes('open') || value === ''
  const pinned = parseValueList(named.pin).filter(known)
  let view = known(named.view) ? named.view : TRAY
  let running = [...new Set([
    ...parseValueList(named.run).filter(known),
    ...pinned,
    ...(view === TRAY ? [] : [view]),
  ])]
  // Closed, only pinned apps run (WidgetsSlice's close).
  if (!isOpen) {
    running = running.filter((id) => pinned.includes(id))
    view = running.includes(view) ? view : TRAY
  }
  const appStates = {}
  for (const id of running) {
    const appValue = tokens[`${APP_TOKEN_PREFIX}${id}`]
    appStates[id] = APP_CODECS[id].decode(appValue)
  }
  return {...INITIAL_WIDGETS, isOpen, isDocked: flags.includes('dock'), view, running, pinned, appStates}
}
