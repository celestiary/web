/**
 * The HTML chrome's own layout, where React components and Celestiary
 * share it: the phone dock's height (ui/PhoneDock.jsx; design/UI.md
 * "Phones: the dock"), 0 while it isn't shown, which the scene's bottom
 * inset and the widgets sheet stand above (ui/WidgetsDrawer.jsx).
 *
 * @param {Function} set
 * @returns {object} Zustand slice
 */
export default function createChromeSlice(set) {
  return {
    phoneDockHeight: 0,
    setPhoneDockHeight: (px) => set(() => ({phoneDockHeight: px})),
  }
}
