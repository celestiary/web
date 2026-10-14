/**
 * The homepage's foreground (DESIGN.md "Homepage"; ui/Homepage.jsx), as
 * Celestiary sets it (`_setHomePhase`):
 *
 *   - 'hidden': not in the page (any link, or once the homepage is left);
 *   - 'waiting': in the page, unseen, while the scene loads under it;
 *   - 'in': showing, over the tour;
 *   - 'out': fading out, as the homepage is left.
 *
 * And the changelog tour's (newsTour.js; ui/NewsTour.jsx), as Celestiary
 * sets it (`_setNewsTour`): null, or the stop it is at, its caption and
 * whether it is paused.
 *
 * @param {Function} set
 * @returns {object} Zustand slice
 */
export default function createHomeSlice(set) {
  return {
    homePhase: 'hidden',
    setHomePhase: (phase) => set(() => ({homePhase: phase})),
    newsTour: null,
    setNewsTour: (newsTour) => set(() => ({newsTour})),
  }
}
