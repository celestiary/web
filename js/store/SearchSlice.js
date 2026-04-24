/**
 * Search feature state.
 *
 * @param {Function} set
 * @param {Function} get
 * @returns {object} Zustand slice
 */
export default function createSearchSlice(set, get) {
  return {
    // Breadcrumb path of the currently navigated body.  Source of truth for the
    // SearchBar's inline breadcrumb.  Empty array before first load.  Stars
    // (no hash/loader path) use committedStar instead; the two are mutually
    // exclusive — setting one clears the other.
    committedPath: [],
    setCommittedPath: (path) => set(() => ({committedPath: path, committedStar: null})),
    committedStar: null,
    setCommittedStar: (s) => set(() => ({committedStar: s, committedPath: []})),

    // Search bar expanded/collapsed state.  Crosshair picking mode is scoped
    // to the bar's lifecycle: every open starts with picker OFF, every close
    // deactivates it (per design — picking lives inside the bar now, not as a
    // top-right standalone toggle).
    isSearchOpen: false,
    openSearch: () => set((state) => ({
      isSearchOpen: true,
      anchorIndex: state.hoveredAnchorIndex !== null ? state.hoveredAnchorIndex : 0,
      hoveredAnchorIndex: null,
      isStarsSelectActive: false,
    })),
    closeSearch: () => set(() => ({
      isSearchOpen: false,
      searchQuery: '',
      searchSelection: null,
      previewPath: null,
      previewStar: null,
      hoveredAnchorIndex: null,
      isStarsSelectActive: false,
    })),

    // Subtree scoping by breadcrumb position.  anchorIndex = index in
    // committedPath that the search icon sits BEFORE.  0 = root (everything).
    // hoveredAnchorIndex mirrors hover in collapsed state; null = none.
    anchorIndex: 0,
    setAnchorIndex: (i) => set(() => ({anchorIndex: i})),
    hoveredAnchorIndex: null,
    setHoveredAnchorIndex: (i) => set(() => ({hoveredAnchorIndex: i})),

    // Query + selected option.
    searchQuery: '',
    setSearchQuery: (q) => set(() => ({searchQuery: q})),
    searchSelection: null,
    setSearchSelection: (entry) => set(() => ({searchSelection: entry})),

    // Crosshair hover pipes through this, debounced in PickLabels.
    searchHoverName: null,
    setSearchHoverName: (n) => set(() => ({searchHoverName: n})),

    // Preview target — if set, info panel renders this path instead of committedPath.
    // For stars (no loader entry) previewStar holds the hipId + star props instead.
    previewPath: null,
    setPreviewPath: (p) => set(() => ({previewPath: p, previewStar: null})),
    previewStar: null,
    setPreviewStar: (s) => set(() => ({previewStar: s, previewPath: null})),
    clearPreview: () => set(() => ({previewPath: null, previewStar: null})),
  }
}


/**
 * Compute a rooted anchor path string for SearchIndex from a breadcrumb
 * committedPath (no milkyway prefix) and the anchorIndex that the icon is
 * sitting BEFORE.
 *
 * @param {string[]} committedPath
 * @param {number} anchorIndex
 * @returns {string}
 */
export function anchorPathFor(committedPath, anchorIndex) {
  if (!committedPath || committedPath.length === 0 || anchorIndex <= 0) {
    return 'milkyway'
  }
  const take = Math.min(anchorIndex, committedPath.length)
  return `milkyway/${committedPath.slice(0, take).join('/')}`
}
