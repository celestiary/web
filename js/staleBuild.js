/**
 * A route's chunk that failed to load (js/Routed.jsx's lazy imports).  A
 * stale build, a cached index.js asking for a chunk a deploy has deleted,
 * is the page's to recover from (public/index.html `stale-build`: it fetches
 * the entry afresh and reloads, once); the route then stays suspended,
 * behind the loading text, until the reload or the page's message.  Anything
 * else throws, as before.
 *
 * @param {Error} err The import's rejection
 * @param {object} [win] The window, with the page's `reloadStaleBuild`
 * @returns {Promise} One that never settles, if the page took the failure
 */
export function staleRoute(err, win = globalThis.window) {
  if (win?.reloadStaleBuild?.(err)) {
    return new Promise(() => {
      // Never settles: the page reloads, or shows its message.
    })
  }
  throw err
}
