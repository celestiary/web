/**
 * Human expansion (scene/Colonization.md)
 *
 * @param {Function} set
 * @param {Function} get
 * @returns {object} Zustand slice
 */
export default function createColonizationSlice(set, get) {
  return {
    // Mirrors Scene's 'x' setting, so the drawer's switch follows the 'x'
    // and 'V' keys.  Scene.toggleColonization writes it.
    isColonizationVisible: true,
  }
}
