/**
 * Search index types.
 *
 * A SearchEntry is the unit of searchable content: one celestial body, star,
 * or future surface place.  Providers produce entries; the SearchIndex groups
 * them into Fuse instances and answers anchor-scoped queries.
 *
 * A SearchProvider has an `id`, a `lazy` flag, and optionally `collectAll`
 * (for eager inclusion in Tier A) or `collectUnder` (for the per-anchor
 * Tier C cache used by lazy providers like PlacesProvider).
 */


/**
 * @typedef {object} SearchEntry
 * @property {string} id Unique id ('earth', 'hip:32349', 'loc:earth:paris').
 * @property {string} displayName Primary user-facing label.
 * @property {string[]} aliases Extra search tokens.
 * @property {string} kind One of 'galaxy' | 'star' | 'planet' | 'moon' | 'place'.
 * @property {string} path Rooted path, '/'-joined, e.g. 'milkyway/sun/earth'.
 * @property {string|null} parent Parent id (null for root).
 * @property {object} payload Navigation hint — shape depends on `kind`.
 */
