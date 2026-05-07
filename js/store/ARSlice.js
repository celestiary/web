import {DEFAULT_ALPHA_DAMPING} from '../ar/DeviceOrientationPoseSource'


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
    // ARDebugHUD overlay visibility.  Off by default — the debug HUD
    // polls the controller per frame and runs a canvas redraw, so we
    // keep it gated to the explicit Settings → Info → "AR debug HUD"
    // toggle.  When off, the rAF loop in ARDebugHUD doesn't even start.
    arDebugVisible: false,
    setARDebugVisible: (v) => set(() => ({arDebugVisible: !!v})),
    toggleARDebug: () => set((s) => ({arDebugVisible: !s.arDebugVisible})),
    // Alpha-axis damping preset (light / medium / heavy).  Mirror of the
    // active preset on the pose source so the AR HUD can highlight the
    // selected button.  Driven by setARAlphaDamping() below — that fn
    // both updates the store value and forwards to the running pose
    // source via celestiary.setARAlphaDamping().
    arAlphaDamping: DEFAULT_ALPHA_DAMPING,
    setARAlphaDamping: (name) => set(() => ({arAlphaDamping: name})),
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
