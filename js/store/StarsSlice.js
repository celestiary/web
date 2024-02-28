/**
 * Stars catalog
 *
 * @param {Function} set
 * @param {Function} get
 * @returns {object} Zustand slice
 */
export default function createStarsSlice(set, get) {
  return {
    starsCatalog: {numStars: 0, hipByName: {size: 0}},
    setStarsCatalog: (catalog) => set(() => ({starsCatalog: catalog})),
    isStarsSelectActive: false,
    toggleIsStarsSelectActive: () => set((state) => ({isStarsSelectActive: !state.isStarsSelectActive})),
  }
}
