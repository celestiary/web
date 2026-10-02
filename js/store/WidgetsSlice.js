/**
 * The widgets drawer and dock (ui/WidgetsDrawer.jsx): which apps run, which
 * are pinned, and what's showing.
 *
 * - The drawer is open or closed; open, it shows the app tray or one app.
 * - The dock, a bar of icons right of the canvas, shows while docked or
 *   while any app is pinned.
 * - An app runs from when it's opened until it's stopped (its X), or, if not
 *   pinned, until the drawer closes.  A pinned app keeps running with the
 *   drawer closed, its icon in the dock.
 *
 * @param {Function} set
 * @param {Function} get
 * @returns {object} Zustand slice
 */
export default function createWidgetsSlice(set, get) {
  return {
    widgets: INITIAL_WIDGETS,
    dispatchWidgets: (action) => set((state) => ({widgets: widgetsReducer(state.widgets, action)})),
  }
}


export const TRAY = 'tray'

export const INITIAL_WIDGETS = Object.freeze({
  isOpen: false,
  isDocked: false,
  view: TRAY,
  running: [],
  pinned: [],
})


/**
 * @param {object} state
 * @param {object} action {type, id?}: toggle, open, close, openApp, tray,
 *   pin, unpin, stop, toggleDock
 * @returns {object} The next state
 */
export function widgetsReducer(state, action) {
  const {id} = action
  switch (action.type) {
    case 'toggle': return state.isOpen ? close(state) : {...state, isOpen: true}
    case 'open': return {...state, isOpen: true}
    case 'close': return close(state)
    case 'openApp': return {...state, isOpen: true, view: id, running: add(state.running, id)}
    case 'tray': return {...state, view: TRAY}
    case 'pin': return {...state, pinned: add(state.pinned, id)}
    case 'unpin': {
      const next = {...state, pinned: remove(state.pinned, id)}
      return next.isOpen ? next : close(next)
    }
    case 'stop': return {
      ...state,
      view: state.view === id ? TRAY : state.view,
      running: remove(state.running, id),
      pinned: remove(state.pinned, id),
    }
    case 'toggleDock': return {...state, isDocked: !state.isDocked}
    default: return state
  }
}


/**
 * @param {object} state
 * @returns {boolean} Whether the dock shows: docked, or an app pinned to it
 */
export function isDockVisible(state) {
  return state.isDocked || state.pinned.length > 0
}


/** @returns {object} The drawer closed, the apps not pinned stopped */
function close(state) {
  const running = state.running.filter((id) => state.pinned.includes(id))
  return {
    ...state,
    isOpen: false,
    running,
    view: running.includes(state.view) ? state.view : TRAY,
  }
}


/** @returns {Array<string>} */
function add(list, id) {
  return list.includes(id) ? list : [...list, id]
}


/** @returns {Array<string>} */
function remove(list, id) {
  return list.filter((x) => x !== id)
}
