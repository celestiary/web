/**
 * The homepage's foreground (DESIGN.md "Homepage"; ui/Homepage.jsx), as
 * Celestiary sets it (`_setHomePhase`):
 *
 *   - 'hidden': not in the page (any link, or once the homepage is left);
 *   - 'waiting': in the page, unseen, while the scene loads under it;
 *   - 'in': showing, over the tour;
 *   - 'out': fading out, as the homepage is left.
 *
 * @param {Function} set
 * @returns {object} Zustand slice
 */
export default function createHomeSlice(set) {
  return {
    homePhase: 'hidden',
    setHomePhase: (phase) => set(() => ({homePhase: phase})),
  }
}
