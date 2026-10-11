/**
 * The page's loading text (public/index.html `#loading`), shown from the
 * first paint: fades in after a moment, out when the scene is in
 * (Celestiary's reveal) or a page without a scene mounts (the guide).
 *
 * @param {object} [doc] The document
 * @returns {boolean} Whether it was showing and now fades out
 */
export function hideLoading(doc = globalThis.document) {
  const el = doc?.getElementById?.('loading')
  if (!el?.classList || el.classList.contains('done')) {
    return false
  }
  el.classList.add('done')
  // Out of the page once faded; a browser with reduced motion may not
  // transition, and a transparent element over nothing is harmless.
  el.addEventListener?.('transitionend', () => el.remove(), {once: true})
  return true
}
