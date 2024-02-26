/**
 * Asterisms catalog
 *
 * @param {Function} set
 * @param {Function} get
 * @returns {object} Zustand slice
 */
export default function createAsterismsSlice(set, get) {
  return {
    asterismsCatalog: {numAsterisms: 0},
    setAsterismsCatalog: (catalog) => set(() => ({asterismsCatalog: catalog})),
  }
}
