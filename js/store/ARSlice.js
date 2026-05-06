/**
 * AR (Augmented Reality) sky-view state.
 *
 * `ar` is null when AR mode is inactive (the default).  When the
 * ARController calls `setARMode({active: true, ...})`, this slice holds
 * the live state so the React UI can mount the AR HUD (gear button,
 * status pill, exit button) and the AR-aware permalink encoder can flag
 * the URL with `s=A`.
 *
 * Keeping it as a single object (rather than a flat fan of fields) means
 * a single Zustand subscription captures every transition; React UI
 * components can subscribe to `(s) => s.ar` and re-render only when AR
 * mode flips or its parameters change.
 *
 * @param {Function} set
 * @param {Function} _get
 * @returns {object}
 */
export default function createARSlice(set, _get) {
  return {
    ar: null,
    setARMode: setAR(set),
  }
}


/**
 * Builder for the AR setter — extracted so we can attach a doc comment
 * without provoking the slice's nested-arrow JSDoc warning.
 *
 * @param {Function} set
 * @returns {Function} `(v) => void`; pass `{active: false}` to clear
 */
function setAR(set) {
  return (v) => set(() => ({ar: v && v.active ? v : null}))
}
