import {slug} from '../targetPath.js'
import {capitalize} from '../utils.js'


/**
 * Search feature state.
 *
 * @param {Function} set
 * @param {Function} get
 * @returns {object} Zustand slice
 */
export default function createSearchSlice(set, get) {
  return {
    // The target (Scene.setTarget, its one writer): {kind: 'body', name},
    // {kind: 'place', body, name, lat, lng, alt}, {kind: 'star', star, name,
    // hipId} or {kind: 'asterism', name, position}; null before the first.
    // committedPath and committedStar are views of it, for their readers:
    // the path of the body it is or is on (empty for a star or an
    // asterism), and a star as {hipId, displayName, star}.  The breadcrumb
    // is the path, then a place's, star's or asterism's name.
    committedTarget: null,
    setCommittedTarget: (target, path = []) => set(() => ({
      committedTarget: target,
      committedPath: ['body', 'place', 'satellite'].includes(target?.kind) ? path : [],
      committedStar: target?.kind === 'star' ?
        {hipId: target.star.hipId, displayName: target.name, star: target.star} : null,
      committedGalaxy: target?.kind === 'galaxy' ? target.galaxy : null,
    })),
    // A SPARC galaxy that is the target (js/scene/Galaxies.md), its record.
    committedGalaxy: null,
    // The breadcrumb's body path.  Empty array before first load.
    committedPath: [],
    // As setCommittedTarget, for a body by its path.
    setCommittedPath: (path) => set(() => ({
      committedPath: path,
      committedStar: null,
      committedGalaxy: null,
      committedTarget: path.length > 0 ? {kind: 'body', name: path[path.length - 1]} : null,
    })),
    committedStar: null,
    // As setCommittedTarget, for a star as {hipId, displayName, star}.
    setCommittedStar: (s) => set(() => ({
      committedStar: s,
      committedGalaxy: null,
      committedPath: [],
      committedTarget: s ? {kind: 'star', star: s.star, name: s.displayName, hipId: s.hipId} : null,
    })),

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
      previewGalaxy: null,
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
    setPreviewPath: (p) => set(() => ({previewPath: p, previewStar: null, previewGalaxy: null})),
    previewStar: null,
    setPreviewStar: (s) => set(() => ({previewStar: s, previewPath: null, previewGalaxy: null})),
    // And a SPARC galaxy's record.
    previewGalaxy: null,
    setPreviewGalaxy: (g) => set(() => ({previewGalaxy: g, previewPath: null, previewStar: null})),
    clearPreview: () => set(() => ({previewPath: null, previewStar: null, previewGalaxy: null})),
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


/** How many of the breadcrumb's last chips a phone shows behind its "…" chip. */
export const PHONE_CRUMBS = 2


/**
 * Where the breadcrumb starts showing chips: on a phone, closed and not
 * expanded, a path of more than PHONE_CRUMBS + 1 shows its last
 * PHONE_CRUMBS behind a "…" chip that expands it (design/UI.md, "Phones:
 * the breadcrumb").  A shorter path, or a "…" that would hide one chip only,
 * shows whole.
 *
 * @param {number} count The path's chips
 * @param {object} state
 * @param {boolean} state.phone useIsMobile's
 * @param {boolean} state.open The search is open: it scopes by the path, whole
 * @param {boolean} state.expanded The "…" was tapped, for this path
 * @returns {number} The first chip shown; 0 for all
 */
export function breadcrumbStart(count, {phone, open, expanded}) {
  return phone && !open && !expanded && count > PHONE_CRUMBS + 1 ? count - PHONE_CRUMBS : 0
}


/**
 * The breadcrumb's elements for a target: its body path, each element a
 * link to its own path, then a place's or a satellite's name; a star's or an asterism's
 * name alone.
 *
 * @param {?object} target committedTarget
 * @param {string[]} committedPath
 * @returns {Array<{label: string, hash: string}>}
 */
export function breadcrumbItems(target, committedPath) {
  if (target?.kind === 'star') {
    return [{label: target.name || `HIP ${target.star.hipId}`, hash: `hip:${target.star.hipId}`}]
  }
  if (target?.kind === 'asterism') {
    return [{label: target.name, hash: `asterism:${slug(target.name)}`}]
  }
  if (target?.kind === 'galaxy') {
    return [{label: target.name, hash: `galaxy:${target.galaxy.id}`}]
  }
  const items = committedPath.map((name, i) => ({
    label: capitalize(name),
    hash: committedPath.slice(0, i + 1).join('/'),
  }))
  if (target?.kind === 'place' && committedPath.length > 0) {
    items.push({label: target.name, hash: `${committedPath.join('/')}/${slug(target.name)}`})
  }
  if (target?.kind === 'satellite') {
    items.push({label: target.name, hash: `sat:${target.id}`})
  }
  return items
}
