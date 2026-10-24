/**
 * The HTML chrome's own state, where React components and Celestiary
 * share it:
 *
 *   - `phoneDockHeight`: the phone dock's height (ui/PhoneDock.jsx;
 *     design/UI.md "Phones: the dock"), 0 while it isn't shown, which the
 *     scene's bottom inset and the widgets sheet stand above
 *     (ui/WidgetsDrawer.jsx).
 *   - `observing`: the observing (red) theme is on (js/observing.js), as
 *     Celestiary has it; the dock's More panel switches it.
 *   - `observingOffer`: AR started after dark, and the theme is offered
 *     (ui/ObservingOffer.jsx) until it's taken, declined or AR ends.
 *
 * @param {Function} set
 * @returns {object} Zustand slice
 */
export default function createChromeSlice(set) {
  return {
    phoneDockHeight: 0,
    setPhoneDockHeight: (px) => set(() => ({phoneDockHeight: px})),
    observing: false,
    setObserving: (on) => set(() => ({observing: on})),
    observingOffer: false,
    setObservingOffer: (on) => set(() => ({observingOffer: on})),
  }
}
